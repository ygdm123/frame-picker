#!/usr/bin/env node
// frame-picker CLI — 不需要 GUI,纯 Node 直接跑完整管道:
// 扫视频 → 抽帧 → 评分 → 配额选图 → 导出
//
// 用法:
//   frame-picker --input <dir> --output <dir> [选项]
//
// 进度输出: 每次进度以 JSON line 写到 stdout(可 pipe 给 jq 等)
// 最终结果 {"stage":"done", ...}

const fs = require("fs/promises");
const path = require("path");
const { extractFrames, cancelExtraction } = require("../electron/services/ffmpeg.cjs");
const { scoreFrames, cancelScoring } = require("../electron/services/scoring.cjs");
const { exportCopy, SIZE_PRESETS } = require("../electron/services/export.cjs");

const VIDEO_EXT = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;

async function listVideos(dirPath) {
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
  out.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  return out;
}

function parseArgs(argv) {
  const args = {
    algorithm: "laplacian",
    top: 10,
    size: "original",
    namePattern: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "-i":
      case "--input":
        args.input = v;
        i++;
        break;
      case "-o":
      case "--output":
        args.output = v;
        i++;
        break;
      case "-a":
      case "--algorithm":
        args.algorithm = v;
        i++;
        break;
      case "-n":
      case "--top":
        args.top = parseInt(v, 10);
        i++;
        break;
      case "-s":
      case "--size":
        args.size = v;
        i++;
        break;
      case "--name-pattern":
        args.namePattern = v;
        i++;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
    }
  }
  return args;
}

function usage() {
  console.log(`frame-picker CLI — 视频抽帧 + 清晰度评分 + 选图导出

用法:
  frame-picker --input <dir> --output <dir> [选项]

必填:
  -i, --input <dir>      视频所在目录(递归查找 mp4/mov/mkv/avi/webm/m4v)
  -o, --output <dir>     导出目录(自动创建)

可选:
  -a, --algorithm <alg>   评分算法 (laplacian|brenner|variance)
                           默认 laplacian(业界标准)
  -n, --top <N>           选 N 张(配额制: 每视频保底 1 张 + 全局补)
                           默认 10
  -s, --size <preset>     导出尺寸:
                           original(原图) / xiaohongshu_3_4(小红书)
                           / xianyu_1_1(闲鱼) / weibo_4_3(微博)
                           默认 original
      --name-pattern <pat> 文件名模板,可用变量:
                           {index:02} {index} {videoName} {file}
                           {score} {date} {time}
                           例: "{date}_{index:02}_{videoName}_{score}.jpg"
  -h, --help              显示帮助

输出:
  进度以 JSON line 写到 stdout(每行一个 JSON 对象),例如:
    {"stage":"extract","videoIndex":1,"videoTotal":3,"message":"..."}
    {"stage":"score","processed":300,"total":600,"message":"..."}
    {"stage":"done","selected":10,"exported":10,"outputDir":"..."}

退出码: 0 成功, 1 失败
`);
}

function emit(obj) {
  console.log(JSON.stringify(obj));
}

// 配额制选图:每视频保底 1 张,剩下按全局 score 补齐到 N
function quotaPickTop(allFrames, n) {
  const byVideo = new Map();
  for (const f of allFrames) {
    if (!byVideo.has(f.videoName)) byVideo.set(f.videoName, []);
    byVideo.get(f.videoName).push(f);
  }
  for (const arr of byVideo.values()) arr.sort((a, b) => b.score - a.score);

  const picked = new Map();
  for (const arr of byVideo.values()) {
    if (arr.length > 0) picked.set(arr[0].path, arr[0]);
  }
  if (picked.size < n) {
    const remaining = [];
    for (const arr of byVideo.values()) {
      for (let i = 1; i < arr.length; i++) remaining.push(arr[i]);
    }
    remaining.sort((a, b) => b.score - a.score);
    const need = n - picked.size;
    for (let i = 0; i < need && i < remaining.length; i++) {
      picked.set(remaining[i].path, remaining[i]);
    }
  }
  return Array.from(picked.values());
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.input || !args.output) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  if (!["laplacian", "brenner", "variance"].includes(args.algorithm)) {
    console.error(`无效算法: ${args.algorithm}`);
    process.exit(1);
  }
  if (!SIZE_PRESETS[args.size]) {
    console.error(`无效尺寸: ${args.size},可选: ${Object.keys(SIZE_PRESETS).join(", ")}`);
    process.exit(1);
  }

  // 处理 Ctrl+C 取消(尽力)
  process.on("SIGINT", () => {
    cancelExtraction();
    cancelScoring();
    console.error("\n[中断] 正在取消...");
    process.exit(130);
  });

  emit({ stage: "scan", message: `扫描视频目录: ${args.input}` });
  const videos = await listVideos(args.input);
  if (videos.length === 0) {
    console.error(`目录里没找到视频: ${args.input}`);
    process.exit(1);
  }
  emit({ stage: "scan", videoCount: videos.length, videos: videos.map((v) => path.basename(v)) });

  // 默认输出到第一个视频父目录 + /all_frames
  const parentDir = videos[0].replace(/\/[^/]+$/, "");
  const framesDir = `${parentDir.replace(/\/$/, "")}/all_frames`;

  // 快速路径:已有抽好的帧就跳过
  let existing = 0;
  try {
    const files = await fs.readdir(framesDir);
    existing = files.filter((f) => /\.jpe?g$/i.test(f)).length;
  } catch {}

  if (existing === 0) {
    emit({ stage: "extract", message: `开始抽帧 (${videos.length} 个视频 → ${framesDir})` });
    const r = await extractFrames(videos, framesDir, (p) => emit({ stage: "extract", ...p }));
    if (!r.ok) {
      console.error("抽帧失败或被取消");
      process.exit(1);
    }
    emit({ stage: "extract", message: `✓ 抽帧完成 (${r.totalFrames} 帧)` });
  } else {
    emit({ stage: "extract", message: `已检测到 ${existing} 帧,跳过抽帧` });
  }

  emit({ stage: "score", message: `开始评分 (${args.algorithm}, ${framesDir})` });
  const sr = await scoreFrames(framesDir, (p) => emit({ stage: "score", ...p }), args.algorithm);
  if (!sr.ok) {
    console.error("评分失败");
    process.exit(1);
  }
  emit({ stage: "score", message: `✓ 评分完成 (${sr.totalFrames} 帧)` });

  // 配额制选图(跨所有 group)
  const allFrames = [];
  for (const g of sr.groups) {
    for (const f of g.all ?? []) allFrames.push(f);
  }
  const selections = quotaPickTop(allFrames, args.top);
  const breakdown = selections.reduce((m, f) => {
    m[f.videoName] = (m[f.videoName] ?? 0) + 1;
    return m;
  }, {});
  emit({ stage: "select", selected: selections.length, breakdown, message: `配额选 top ${args.top} → ${selections.length} 张` });

  // 导出
  emit({ stage: "export", message: `开始导出到 ${args.output}` });
  const er = await exportCopy(selections, args.output, args.size, args.namePattern);
  if (!er.ok) {
    console.error(`导出失败: ${er.error}`);
    process.exit(1);
  }
  emit({ stage: "done", selected: selections.length, exported: er.count, outputDir: er.outputDir, sizePreset: er.sizePreset, message: `✓ 导出完成 (${er.count} 张 → ${er.outputDir})` });
}

main().catch((e) => {
  console.error("错误:", e.stack || e.message);
  process.exit(1);
});