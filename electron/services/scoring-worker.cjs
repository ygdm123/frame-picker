// scoring worker - 处理分配的帧,返回每帧清晰度分数(支持多种算法)
const { parentPort, workerData } = require("worker_threads");
const sharp = require("sharp");

const filePaths = workerData.filePaths;
const algorithm = workerData.algorithm || "laplacian";

// 读图 + 缩到 ~360 宽 + 灰度,返回 Uint8 数组
async function loadGray(filePath) {
  const { data, info } = await sharp(filePath)
    .grayscale()
    .resize({ width: 360, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

// 3x3 Laplacian 方差(边缘清晰度)
function laplacianVariance(p, w, h) {
  const d = p;
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    const rowBase = y * w;
    const prevRow = rowBase - w;
    const nextRow = rowBase + w;
    for (let x = 1; x < w - 1; x++) {
      const v =
        d[prevRow + x - 1] +
        d[prevRow + x] +
        d[prevRow + x + 1] +
        d[rowBase + x - 1] -
        4 * d[rowBase + x] +
        d[rowBase + x + 1] +
        d[nextRow + x - 1] +
        d[nextRow + x] +
        d[nextRow + x + 1];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

// 5 ROI + max: 适合产品在画面任意位置,取最清晰区域的分数
function laplacianVarianceROI(p, w, h, x0, y0, x1, y1) {
  const d = p;
  let sum = 0, sumSq = 0, count = 0;
  for (let y = y0 + 1; y < y1 - 1; y++) {
    const rowBase = y * w;
    const prevRow = rowBase - w;
    const nextRow = rowBase + w;
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const v =
        d[prevRow + x - 1] +
        d[prevRow + x] +
        d[prevRow + x + 1] +
        d[rowBase + x - 1] -
        4 * d[rowBase + x] +
        d[rowBase + x + 1] +
        d[nextRow + x - 1] +
        d[nextRow + x] +
        d[nextRow + x + 1];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function multiROIScore(p, w, h) {
  // 5 个 ROI:中心 + 左 + 右 + 上 + 下,各占图 50% 宽高区域
  // 取 max(任一区域清晰 → 该帧清晰)
  const rois = [
    { x0: Math.floor(w * 0.2), y0: Math.floor(h * 0.2), x1: Math.floor(w * 0.8), y1: Math.floor(h * 0.8) }, // center
    { x0: 0,                     y0: Math.floor(h * 0.15), x1: Math.floor(w * 0.5), y1: Math.floor(h * 0.85) }, // left
    { x0: Math.floor(w * 0.5),   y0: Math.floor(h * 0.15), x1: w,                 y1: Math.floor(h * 0.85) }, // right
    { x0: Math.floor(w * 0.15),  y0: 0,                    x1: Math.floor(w * 0.85), y1: Math.floor(h * 0.5) }, // top
    { x0: Math.floor(w * 0.15),  y0: Math.floor(h * 0.5),  x1: Math.floor(w * 0.85), y1: h }, // bottom
  ];
  let maxVar = 0;
  for (const r of rois) {
    if (r.x1 <= r.x0 + 2 || r.y1 <= r.y0 + 2) continue; // ROI 太小跳过
    const v = laplacianVarianceROI(p, w, h, r.x0, r.y0, r.x1, r.y1);
    if (v > maxVar) maxVar = v;
  }
  return maxVar;
}

// Brenner 梯度(相邻像素差平方和)
function brennerScore(p, w, h) {
  const d = p;
  let sum = 0, count = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w - 2; x++) {
      const dx = d[row + x + 2] - d[row + x];
      sum += dx * dx;
      count++;
    }
  }
  return sum / count;
}

// 局部方差(每个像素与局部均值差平方,再求和)
function localVariance(p, w, h) {
  const d = p;
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const localMean = (
        d[row - w + x - 1] + d[row - w + x] + d[row - w + x + 1] +
        d[row + x - 1] + d[row + x] + d[row + x + 1] +
        d[row + w + x - 1] + d[row + w + x] + d[row + w + x + 1]
      ) / 9;
      const dx = d[row + x] - localMean;
      sum += dx;
      sumSq += dx * dx;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

const ALGOS = {
  laplacian: laplacianVariance,
  brenner: brennerScore,
  variance: localVariance,
  multi_roi: multiROIScore,
};

async function score(filePath) {
  const { data, w, h } = await loadGray(filePath);
  const fn = ALGOS[algorithm] || ALGOS.laplacian;
  return fn(data, w, h);
}

(async () => {
  const results = [];
  let done = 0;
  for (const fp of filePaths) {
    try {
      const s = await score(fp);
      const file = fp.split("/").pop();
      const videoName = file.replace(/_frame_\d+\.jpe?g$/i, "");
      results.push({ file, path: fp, videoName, score: s });
    } catch (e) {
      console.error("[worker] score error for", fp, ":", e?.message ?? e);
    }
    done++;
    if (done % 5 === 0 || done === filePaths.length) {
      parentPort.postMessage({ kind: "progress", done });
    }
  }
  console.error("[worker] done, total results:", results.length, "first score:", results[0]?.score);
  parentPort.postMessage({ kind: "done", results });
})();