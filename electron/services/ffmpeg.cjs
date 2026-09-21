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

let currentJob = null; // { canceled: boolean }

function cancelExtraction() {
  if (currentJob) currentJob.canceled = true;
}

async function extractFrames(videoPaths, outputDir, onProgress) {
  await fs.mkdir(outputDir, { recursive: true });
  currentJob = { canceled: false };

  const totalVideos = videoPaths.length;
  let totalFrames = 0;
  const results = [];

  for (let i = 0; i < videoPaths.length; i++) {
    if (currentJob.canceled) {
      return { ok: false, canceled: true, framesDir: outputDir, totalFrames };
    }

    const videoPath = videoPaths[i];
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const pattern = path.join(outputDir, `${videoName}_frame_%04d.jpg`);

    onProgress?.({
      stage: "extract",
      videoIndex: i,
      videoName,
      videoTotal: totalVideos,
      frame: 0,
      message: `开始抽帧: ${videoName}`,
    });

    await runInWorker(videoPath, pattern, (frame) => {
      onProgress?.({
        stage: "extract",
        videoIndex: i,
        videoName,
        videoTotal: totalVideos,
        frame,
        frameTotal: 0,
        message: `${videoName}: ${frame} 帧`,
      });
    });

    // 数实际生成的文件数
    const files = await fs.readdir(outputDir);
    const count = files.filter((f) => f.startsWith(`${videoName}_frame_`) && f.endsWith(".jpg")).length;
    totalFrames += count;
    results.push({ videoName, frames: count });
  }

  currentJob = null;
  return { ok: true, framesDir: outputDir, totalFrames, results };
}

function runInWorker(input, outputPattern, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "ffmpeg-worker.cjs"), {
      workerData: { ffmpegBin: FFMPEG_BIN, input, outputPattern },
    });

    worker.on("message", (msg) => {
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
    worker.on("exit", (code) => {
      if (code !== 0 && currentJob && !currentJob.canceled) {
        // worker crashed
      }
    });

    // 取消时 terminate
    if (currentJob) {
      const orig = currentJob.canceled;
      Object.defineProperty(currentJob, "canceled", {
        get() { return orig; },
        set(v) {
          if (v) worker.terminate();
        },
      });
    }
  });
}

module.exports = { extractFrames, cancelExtraction };