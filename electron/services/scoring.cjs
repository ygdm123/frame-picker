// Laplacian 方差清晰度评分 - 用 worker pool 并行化
const { Worker } = require("worker_threads");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

// 评分 worker pool 状态(支持取消)
let activeJob = null; // { cancel: () => void, workers: Worker[] }

function cancelScoring() {
  if (activeJob) activeJob.cancel();
}

/**
 * 评分目录下所有 jpg,按 <videoName>_frame_NNNN.jpg 分组,返回按分数排序的结果
 * @param {string} framesDir
 * @param {(p:any)=>void} onProgress
 * @returns {Promise<{ ok: boolean, groups: Array }>}
 */
async function scoreFrames(framesDir, onProgress) {
  const entries = await fs.readdir(framesDir);
  const files = entries.filter((f) => /\.jpe?g$/i.test(f));
  const total = files.length;

  onProgress?.({ stage: "score", total, processed: 0, message: "开始评分" });

  // 把文件路径列表分成 N 块,N = CPU 核数(默认最多 8)
  const numWorkers = Math.min(os.cpus().length || 4, 8, Math.max(1, Math.ceil(total / 50)));
  const chunks = chunkArray(files.map((f) => path.join(framesDir, f)), numWorkers);

  // 起 worker pool
  const workers = [];
  const chunkResults = new Array(numWorkers);
  let completedChunks = 0;
  let processedTotal = 0;
  let canceled = false;

  return new Promise((resolve, reject) => {
    activeJob = {
      cancel: () => {
        canceled = true;
        workers.forEach((w) => w.terminate());
      },
    };

    for (let i = 0; i < numWorkers; i++) {
      const w = new Worker(path.join(__dirname, "scoring-worker.cjs"), {
        workerData: { filePaths: chunks[i] },
      });
      workers.push(w);

      w.on("message", (msg) => {
        if (canceled) return;
        if (msg.kind === "progress") {
          processedTotal += msg.done - (chunkResults[i]?._progress || 0);
          chunkResults[i] = { ...(chunkResults[i] || {}), _progress: msg.done };
          onProgress?.({
            stage: "score",
            total,
            processed: processedTotal,
            message: `${processedTotal}/${total}`,
          });
        } else if (msg.kind === "done") {
          chunkResults[i] = msg.results;
          completedChunks++;
          if (completedChunks === numWorkers) {
            // 全部完成,合并结果
            const all = chunkResults.flat();
            const groups = buildGroups(all);
            activeJob = null;
            resolve({ ok: true, groups, totalFrames: all.length });
          }
        }
      });

      w.on("error", (err) => {
        if (canceled) return;
        activeJob = null;
        reject(err);
      });
    }
  });
}

function chunkArray(arr, n) {
  if (arr.length === 0) return [[]];
  const chunks = Array.from({ length: n }, () => []);
  arr.forEach((item, i) => chunks[i % n].push(item));
  return chunks;
}

function buildGroups(all) {
  const byVideo = new Map();
  for (const item of all) {
    if (!byVideo.has(item.videoName)) byVideo.set(item.videoName, []);
    byVideo.get(item.videoName).push(item);
  }
  const groups = [];
  for (const [videoName, items] of byVideo.entries()) {
    items.sort((a, b) => b.score - a.score);
    groups.push({
      videoName,
      all: items,
      top: items.slice(0, 10),
      allCount: items.length,
      max: items[0]?.score ?? 0,
      median: items[Math.floor(items.length / 2)]?.score ?? 0,
    });
  }
  return groups;
}

module.exports = { scoreFrames, cancelScoring };