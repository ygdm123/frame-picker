# Frame Picker

视频抽帧 + 清晰度评分 + 智能选图 的桌面工具(Electron)。

把一批视频拖进去,自动按帧清晰度排序,挑出主体最清晰的几张导出。

## 特性

- **拖拽即用**:拖入视频文件 / 目录,自动展开
- **集合概念**:拖入目录 = 一个整体(跨视频选 top N);拖入独立文件 = 各自分组
- **跳过重复劳动**:如果 `all_frames/` 已存在,自动跳过抽帧直接评分
- **清晰度评分**:基于 Laplacian 方差算法(纯 JS,无 Python 依赖),worker pool 并行
- **两种导出**:复制选中帧到目录 + 生成对比网格图
- **macOS 原生**:窗口、文件对话框、Finder 集成

## 使用

### 准备

```bash
pnpm install
node node_modules/electron/install.js  # 下载 Electron binary(如果 pnpm build scripts 被忽略)
```

### 开发模式

```bash
./node_modules/.bin/vite & \
  ./node_modules/.bin/electron electron/main.cjs
```

### 生产模式(直接跑)

```bash
./node_modules/.bin/vite build
NODE_ENV=production ./node_modules/.bin/electron electron/main.cjs
```

### 打包成 .app / .dmg

```bash
./node_modules/.bin/electron-builder
```

## 工作流

1. **拖入** — 视频文件 / 目录进窗口
2. **点开始处理** — 抽帧 + 评分(已有帧目录会自动跳过抽帧)
3. **多选** — 在网格里点选需要的帧
4. **导出** — 复制到目录 + 生成对比网格图

## 技术栈

- **Electron 33** + Vite 6 + React 18 + TypeScript 5.7
- **Tailwind v4** + shadcn/ui 风格(手写 7 个基础组件)
- **sharp 0.33** — Laplacian 方差评分 + 网格拼图
- **ffmpeg** — 视频抽帧(通过 worker_threads 子进程隔离)
- **worker_threads** — 抽帧(避开 Electron 主进程 child_process 异常)+ 评分(并行加速 ~4x)

## 关键文件

| 文件 | 作用 |
|---|---|
| `electron/main.cjs` | Electron 主进程入口 + IPC handlers |
| `electron/preload.cjs` | contextBridge 暴露安全 API 到 renderer |
| `electron/services/ffmpeg.cjs` | 抽帧服务(用 worker_threads) |
| `electron/services/ffmpeg-worker.cjs` | 抽帧 worker(spawnSync 跑 ffmpeg) |
| `electron/services/scoring.cjs` | 评分服务(worker pool 并行) |
| `electron/services/scoring-worker.cjs` | 评分 worker(单图 Laplacian 计算) |
| `electron/services/export.cjs` | 复制导出 + 网格拼图 |
| `src/App.tsx` | React 主应用 + 状态管理 |
| `src/components/DropZone.tsx` | 拖入视频/选目录入口 |
| `src/components/FrameGrid.tsx` | 网格预览 + 多选 |
| `src/components/ExportDialog.tsx` | 导出对话框 |

## 已知限制

- macOS only(用了 SMB 路径的特定处理,逻辑跨平台但测试只在本机)
- 评分算法只用了 Laplacian 方差,后续可加 Brenner / 局部方差等备选
- 没有打包成 .app 的 production 构建

## License

MIT