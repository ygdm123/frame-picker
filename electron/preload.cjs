// Preload - contextBridge 暴露安全 API
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const api = {
  // Electron 32+ 移除 File.path,必须用 webUtils.getPathForFile
  getPathForFile: (file) => webUtils.getPathForFile(file),
  dialog: {
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
    openFiles: () => ipcRenderer.invoke("dialog:openFiles"),
    openExportDir: () => ipcRenderer.invoke("dialog:openExportDir"),
  },
  fs: {
    listVideos: (dirPath) => ipcRenderer.invoke("fs:listVideos", dirPath),
    listFrames: (dirPath) => ipcRenderer.invoke("fs:listFrames", dirPath),
    stat: (p) => ipcRenderer.invoke("fs:stat", p),
  },
  frames: {
    extract: (payload) => ipcRenderer.invoke("frames:extract", payload),
    cancelExtract: () => ipcRenderer.invoke("frames:extract:cancel"),
    score: (framesDir, algorithm) => ipcRenderer.invoke("frames:score", framesDir, algorithm),
    cancelScore: () => ipcRenderer.invoke("frames:score:cancel"),
    exportCopy: (payload) => ipcRenderer.invoke("frames:export:copy", payload),
    exportGrid: (payload) => ipcRenderer.invoke("frames:export:grid", payload),
  },
  shell: {
    showInFolder: (filePath) => ipcRenderer.invoke("shell:showInFolder", filePath),
    deleteTmp: (filePath) => ipcRenderer.invoke("shell:deleteTmp", filePath),
  },
  on: {
    extractProgress: (handler) => {
      const listener = (_e, progress) => handler(progress);
      ipcRenderer.on("frames:extract:progress", listener);
      return () => ipcRenderer.removeListener("frames:extract:progress", listener);
    },
    scoreProgress: (handler) => {
      const listener = (_e, progress) => handler(progress);
      ipcRenderer.on("frames:score:progress", listener);
      return () => ipcRenderer.removeListener("frames:score:progress", listener);
    },
  },
};

contextBridge.exposeInMainWorld("framePicker", api);