// ffmpeg worker - 在 worker_threads 里跑 spawnSync 抽帧,绕过 Electron 主进程 child_process 异常
const { parentPort, workerData } = require("worker_threads");
const { spawnSync } = require("child_process");
const fs = require("fs");

const FFMPEG_BIN = workerData.ffmpegBin;
const input = workerData.input;
const outputPattern = workerData.outputPattern;

try {
  const args = [
    "-hide_banner",
    "-err_detect", "ignore_err",
    "-fflags", "+discardcorrupt",
    "-i", input,
    "-qscale:v", "2",
    "-y",
    outputPattern,
  ];

  // 用 spawnSync 而不是 spawn:工作线程里同步跑没问题,完成后一次性报结果
  // 同时实时把 stderr 转发出去(虽然 spawnSync 等到结束才返回,但我们可以分段观察文件数)
  let lastCount = 0;
  const interval = setInterval(() => {
    try {
      const dir = outputPattern.replace(/\/[^/]+$/, "");
      const files = fs.readdirSync(dir);
      const count = files.filter((f) => f.endsWith(".jpg") && f.includes("_frame_")).length;
      if (count > lastCount) {
        lastCount = count;
        parentPort.postMessage({ kind: "progress", frame: count });
      }
    } catch {}
  }, 1000);

  const r = spawnSync(FFMPEG_BIN, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  clearInterval(interval);

  if (r.status === 0) {
    parentPort.postMessage({ kind: "done", ok: true, frame: lastCount });
  } else {
    parentPort.postMessage({
      kind: "done",
      ok: false,
      code: r.status,
      stderr: (r.stderr || "").slice(-2000),
    });
  }
} catch (e) {
  parentPort.postMessage({ kind: "done", ok: false, error: e.message });
}