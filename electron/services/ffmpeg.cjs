// ffmpeg 抽帧服务 - 通过 worker_threads 跑 spawnSync,绕开 Electron 主进程 child_process 异常
const { Worker } = require("worker_threads");
const fs = require("fs/promises");
const path = require("path");

// 找 ffmpeg 完整路径
function findFfmpeg() {
  const candidates = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ];
  for (const c of candidates) {
    try {
      const { spawnSync } = require("child_process");
      const r = spawnSync(c, ["-version"], { stdio: ["ignore", "pipe", "pipe"] });
      if (r.status === 0) return c;
    } catch {}
  }
  return "ffmpeg";
}

const FFMPEG_BIN = findFfmpeg();

let currentJob = null; // { canceled: boolean, workers: Worker[] }

function cancelExtraction() {
  if (!currentJob) return;
  currentJob.canceled = true;
  // 并行抽帧时可能有多个 worker 同时跑,全部 terminate 掉
  if (currentJob.workers) {
    currentJob.workers.forEach((w) => w.terminate());
  }
}

async function extractFrames(videoPaths, outputDir, onProgress) {
  await fs.mkdir(outputDir, { recursive: true });
  currentJob = { canceled: false, workers: [] };

  const totalVideos = videoPaths.length;
  let completedVideos = 0;
  let totalFrames = 0;
  const results = [];

  // 多视频并行抽帧:但限制并发数(用户工作目录是 SMB 网络卷,过高并发会拖垮磁盘 IO)
  // 默认 3 路并发:覆盖大多数 2-5 视频场景,不让 SMB 抽风
  const CONCURRENCY = Math.min(3, totalVideos);

  // 把每个视频抽帧包装成一个 task
  const tasks = videoPaths.map((videoPath, _i) => {
    return async () => {
      if (currentJob.canceled) return;
      const videoName = path.basename(videoPath, path.extname(videoPath));
      const pattern = path.join(outputDir, `${videoName}_frame_%04d.jpg`);

      onProgress?.({
        stage: "extract",
        videoIndex: completedVideos,
        videoName,
        videoTotal: totalVideos,
        frame: 0,
        message: `[${completedVideos + 1}/${totalVideos}] 开始: ${videoName}`,
      });

      await runInWorker(videoPath, pattern, (frame) => {
        onProgress?.({
          stage: "extract",
          videoIndex: completedVideos,
          videoName,
          videoTotal: totalVideos,
          frame,
          message: `${videoName}: ${frame} 帧`,
        });
      });

      if (currentJob.canceled) return;

      // 数实际生成的文件数
      const files = await fs.readdir(outputDir);
      const count = files.filter((f) => f.startsWith(`${videoName}_frame_`) && f.endsWith(".jpg")).length;
      totalFrames += count;
      results.push({ videoName, frames: count });
      completedVideos++;

      onProgress?.({
        stage: "extract",
        videoIndex: completedVideos,
        videoName,
        videoTotal: totalVideos,
        message: `✓ ${videoName} (${count} 帧) · ${completedVideos}/${totalVideos}`,
      });
    };
  });

  // 限流:CONCURRENCY 个 worker 共享一个 task 队列,谁抢到谁跑
  const queue = [...tasks];
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      if (t) await t();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if (currentJob.canceled) {
    return { ok: false, canceled: true, framesDir: outputDir, totalFrames };
  }
  currentJob = null;
  return { ok: true, framesDir: outputDir, totalFrames, results };
}

function runInWorker(input, outputPattern, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "ffmpeg-worker.cjs"), {
      workerData: { ffmpegBin: FFMPEG_BIN, input, outputPattern },
    });

    // 把 worker 注册到 currentJob,cancel 时统一 terminate(支持并行)
    if (currentJob) {
      currentJob.workers.push(worker);
      // 已 cancel 则立刻 terminate 这个 worker
      if (currentJob.canceled) worker.terminate();
    }

    worker.on("message", (msg) => {
      if (currentJob?.canceled) return;
      if (msg.kind === "progress") onProgress(msg.frame);
      else if (msg.kind === "done") {
        if (msg.ok) {
          resolve(msg.frame);
        } else if (msg.error) {
          reject(new Error(msg.error));
        } else {
          reject(new Error(`ffmpeg failed (code=${msg.code})\n\nstderr:\n${msg.stderr}`));
        }
      }
    });

    worker.on("error", (err) => reject(err));
    worker.on("exit", () => {
      // 从 currentJob.workers 中摘除
      if (currentJob?.workers) {
        const i = currentJob.workers.indexOf(worker);
        if (i >= 0) currentJob.workers.splice(i, 1);
      }
    });
  });
}

module.exports = { extractFrames, cancelExtraction };