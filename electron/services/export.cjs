// 导出:复制 + 网格拼图
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

/**
 * 把选中帧复制到 outputDir,命名按 01_<videoName>_<frame>.jpg
 * @param {Array<{path:string, videoName:string, file:string}>} selections
 * @param {string} outputDir
 */
async function exportCopy(selections, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const results = [];

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    const target = path.join(
      outputDir,
      `${String(i + 1).padStart(2, "0")}_${sel.videoName}_${sel.file}`
    );
    await fs.copyFile(sel.path, target);
    results.push({ index: i + 1, target });
  }

  return { ok: true, outputDir, count: selections.length, files: results };
}

/**
 * 把选中帧拼成 columns 列的网格大图
 * @param {Array} selections
 * @param {string} outputPath
 * @param {number} columns
 */
async function exportGrid(selections, outputPath, columns = 5) {
  if (selections.length === 0) {
    return { ok: false, error: "没有选中任何帧" };
  }

  // 取第一张确定基准尺寸
  const meta = await sharp(selections[0].path).metadata();
  const cellW = Math.min(640, meta.width);
  const cellH = Math.round(cellW * (meta.height / meta.width));
  const padding = 12;
  const labelH = 32;

  const rows = Math.ceil(selections.length / columns);
  const W = columns * cellW + (columns + 1) * padding;
  const H = rows * (cellH + labelH) + (rows + 1) * padding;

  // 背景
  const composites = [{ input: Buffer.from(makeBackground(W, H)), top: 0, left: 0 }];

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    const row = Math.floor(i / columns);
    const col = i % columns;
    const x = padding + col * (cellW + padding);
    const y = padding + row * (cellH + labelH + padding);

    // 缩放图片到 cell 大小
    const resized = await sharp(sel.path)
      .resize({ width: cellW, height: cellH, fit: "cover" })
      .toBuffer();
    composites.push({ input: resized, top: y, left: x });

    // 标签 SVG
    const label = `${String(i + 1).padStart(2, "0")} · ${sel.videoName}`;
    const labelSvg = Buffer.from(
      `<svg width="${cellW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#111"/>
        <text x="8" y="22" font-family="monospace" font-size="14" fill="#22c55e">${escapeXml(label)}</text>
        <text x="${cellW - 80}" y="22" font-family="monospace" font-size="14" fill="#888">${sel.score?.toFixed?.(1) ?? ""}</text>
      </svg>`
    );
    composites.push({ input: labelSvg, top: y + cellH, left: x });
  }

  await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 10, g: 10, b: 10 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  return { ok: true, outputPath };
}

function makeBackground(W, H) {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0a0a0a"/>
  </svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
}

module.exports = { exportCopy, exportGrid };