// scoring worker - 处理分配的帧,返回每帧的 Laplacian 方差分数
const { parentPort, workerData } = require("worker_threads");
const sharp = require("sharp");

const filePaths = workerData.filePaths;

// 3x3 Laplacian kernel: [0,1,0; 1,-4,1; 0,1,0]
function laplacianVariance(filePath) {
  return sharp(filePath)
    .grayscale()
    .resize({ width: 360, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const { width, height, data: pixels } = info;
      const dataArr = data;
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      for (let y = 1; y < height - 1; y++) {
        const rowBase = y * width;
        const prevRow = rowBase - width;
        const nextRow = rowBase + width;
        for (let x = 1; x < width - 1; x++) {
          const v =
            dataArr[prevRow + x - 1] +
            dataArr[prevRow + x] +
            dataArr[prevRow + x + 1] +
            dataArr[rowBase + x - 1] -
            4 * dataArr[rowBase + x] +
            dataArr[rowBase + x + 1] +
            dataArr[nextRow + x - 1] +
            dataArr[nextRow + x] +
            dataArr[nextRow + x + 1];
          sum += v;
          sumSq += v * v;
          count++;
        }
      }
      const mean = sum / count;
      return sumSq / count - mean * mean;
    });
}

(async () => {
  const results = [];
  let done = 0;
  for (const fp of filePaths) {
    try {
      const score = await laplacianVariance(fp);
      const file = fp.split("/").pop();
      const videoName = file.replace(/_frame_\d+\.jpe?g$/i, "");
      results.push({ file, path: fp, videoName, score });
    } catch (e) {
      // skip
    }
    done++;
    if (done % 5 === 0 || done === filePaths.length) {
      parentPort.postMessage({ kind: "progress", done });
    }
  }
  parentPort.postMessage({ kind: "done", results });
})();