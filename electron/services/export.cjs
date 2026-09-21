// 导出:复制 + 网格拼图
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

// 导出尺寸预设(key = preset id,value = target width/height;null = 原图)
const SIZE_PRESETS = {
  original: { w: null, h: null, label: "原图" },
  xiaohongshu_3_4: { w: 1080, h: 1440, label: "小红书 1080×1440 (3:4)" },
  xianyu_1_1: { w: 800, h: 800, label: "闲鱼 800×800 (1:1)" },
  weibo_4_3: { w: 1200, h: 900, label: "微博 1200×900 (4:3)" },
};

/**
 * 把选中帧复制到 outputDir,命名按 01_<videoName>_<frame>.jpg
 * 可选按尺寸预设 resize
 */
async function exportCopy(selections, outputDir, sizePreset = "original") {
  await fs.mkdir(outputDir, { recursive: true });
  const results = [];
  const preset = SIZE_PRESETS[sizePreset] || SIZE_PRESETS.original;
  const subdir = sizePreset === "original" ? "" : `_${sizePreset}`;

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    const fileBase = sel.file.replace(/\.jpe?g$/i, "");
    const targetName = `${String(i + 1).padStart(2, "0")}_${sel.videoName}_${fileBase}${subdir}.jpg`;
    const target = path.join(outputDir, targetName);
    if (preset.w && preset.h) {
      await sharp(sel.path)
        .resize({ width: preset.w, height: preset.h, fit: "cover" })
        .jpeg({ quality: 90 })
        .toFile(target);
    } else {
      await fs.copyFile(sel.path, target);
    }
    results.push({ index: i + 1, target });
  }

  return { ok: true, outputDir, count: selections.length, files: results, sizePreset };
}

/**
 * 把选中帧拼成 columns 列的网格大图,可指定尺寸预设
 */
async function exportGrid(selections, outputPath, columns = 5, sizePreset = "preview") {
  if (selections.length === 0) {
    return { ok: false, error: "没有选中任何帧" };
  }

  const meta = await sharp(selections[0].path).metadata();
  // preview 模式用小图快速生成;其他预设按比例放大
  const isPreview = sizePreset === "preview";
  const cellW = isPreview ? Math.min(320, meta.width) : Math.min(640, meta.width);
  const cellH = Math.round(cellW * (meta.height / meta.width));
  const padding = 12;
  const labelH = 32;

  const rows = Math.ceil(selections.length / columns);
  const W = columns * cellW + (columns + 1) * padding;
  const H = rows * (cellH + labelH) + (rows + 1) * padding;

  const composites = [{ input: Buffer.from(makeBackground(W, H)), top: 0, left: 0 }];

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    const row = Math.floor(i / columns);
    const col = i % columns;
    const x = padding + col * (cellW + padding);
    const y = padding + row * (cellH + labelH + padding);

    const resized = await sharp(sel.path)
      .resize({ width: cellW, height: cellH, fit: "cover" })
      .toBuffer();
    composites.push({ input: resized, top: y, left: x });

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

module.exports = { exportCopy, exportGrid, SIZE_PRESETS };