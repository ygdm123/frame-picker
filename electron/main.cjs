// Electron main process (CommonJS)
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { extractFrames, cancelExtraction } = require("./services/ffmpeg.cjs");
const { scoreFrames, cancelScoring } = require("./services/scoring.cjs");
const { exportCopy, exportGrid } = require("./services/export.cjs");
const { ensureThumbnails } = require("./services/thumbnail.cjs");

const isDev = process.env.NODE_ENV === "development";

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Frame Picker",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    // 生产模式也开 DevTools 方便排查渲染错误
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // 把 renderer 控制台日志转发到主进程 stdout,方便无 GUI 场景诊断
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const tag = ["LOG", "WARN", "ERROR", "INFO"][level] || "LOG";
    console.log(`[renderer ${tag}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer] crashed:", details);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ====================== IPC ======================

// 选目录
ipcMain.handle("dialog:openDirectory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "选择视频目录",
  });
  return result.canceled ? null : result.filePaths[0];
});

// 递归列举目录里的视频文件
const VIDEO_EXT = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;
ipcMain.handle("fs:stat", async (_event, p) => {
  const fs = require("fs/promises");
  try {
    const s = await fs.stat(p);
    return { isDirectory: s.isDirectory(), isFile: s.isFile(), size: s.size };
  } catch (e) {
    return { error: e.message };
  }
});

// 检查目录里是否已有抽好的帧
ipcMain.handle("fs:listFrames", async (_event, dirPath) => {
  const fs = require("fs/promises");
  try {
    const files = await fs.readdir(dirPath);
    const jpgs = files.filter((f) => /\.jpe?g$/i.test(f));
    return { count: jpgs.length, sample: jpgs.slice(0, 5) };
  } catch (e) {
    return { count: 0, error: e.message };
  }
});

ipcMain.handle("fs:listVideos", async (_event, dirPath) => {
  const fs = require("fs/promises");
  const path = require("path");
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        await walk(p);
      } else if (VIDEO_EXT.test(e.name)) {
        out.push(p);
      }
    }
  }
  await walk(dirPath);
  // 按文件名排序,稳定可预期
  out.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  return out;
});

// 选文件(可多选 mp4/mov 等)
ipcMain.handle("dialog:openFiles", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    title: "选择视频文件",
    filters: [
      { name: "视频文件", extensions: ["mp4", "mov", "mkv", "avi", "webm"] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

// 选择输出目录
ipcMain.handle("dialog:openExportDir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "选择导出目录",
  });
  return result.canceled ? null : result.filePaths[0];
});

// 抽帧
ipcMain.handle("frames:extract", async (event, payload) => {
  const { videoPaths, outputDir } = payload;
  const win = BrowserWindow.fromWebContents(event.sender);

  return await extractFrames(videoPaths, outputDir, (progress) => {
    if (win) win.webContents.send("frames:extract:progress", progress);
  });
});

// 取消抽帧
ipcMain.handle("frames:extract:cancel", async () => {
  cancelExtraction();
  return true;
});

// 取消评分
ipcMain.handle("frames:score:cancel", async () => {
  cancelScoring();
  return true;
});

// 评分
ipcMain.handle("frames:score", async (event, framesDir, algorithm) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return await scoreFrames(framesDir, (progress) => {
    if (win) win.webContents.send("frames:score:progress", progress);
  }, algorithm || "laplacian");
});

// 导出:复制
ipcMain.handle("frames:export:copy", async (_event, { selections, outputDir, sizePreset, namingPattern }) => {
  return await exportCopy(selections, outputDir, sizePreset || "original", namingPattern);
});

// 缩略图(批量)
ipcMain.handle("frames:thumbnail", async (_event, { framesDir, framePaths, width }) => {
  try {
    return await ensureThumbnails({ framesDir, framePaths, width });
  } catch (e) {
    return { error: e.message };
  }
});

// 导出:网格拼图
ipcMain.handle("frames:export:grid", async (_event, { selections, outputPath, columns }) => {
  return await exportGrid(selections, outputPath, columns || 5);
});

// 在 Finder 中打开
ipcMain.handle("shell:showInFolder", async (_event, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

// 删除临时预览文件
ipcMain.handle("shell:deleteTmp", async (_event, filePath) => {
  try {
    await require("fs/promises").unlink(filePath);
    return true;
  } catch {
    return false;
  }
});