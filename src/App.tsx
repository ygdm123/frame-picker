import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Loader2, X, Download, ChevronUp, FolderOpen, FileVideo, Sparkles, XCircle, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropZone } from "@/components/DropZone";
import { FrameGrid } from "@/components/FrameGrid";
import { ExportDialog } from "@/components/ExportDialog";
import { ToastList, toast } from "@/components/Toast";
import { LogsPanel } from "@/components/LogsPanel";
import { pushLog } from "@/lib/log";
import { formatScore } from "@/lib/utils";
import type { ScoredFrame, VideoGroup, ScoreProgress, Source } from "@/types";

// 根据 progress + 开始时间算 ETA(剩余时间预估);<5s 进度直接返回空字符串避免抖动
function computeEta(p: ScoreProgress, startMs: number): string {
  if (!startMs) return "";
  const elapsedMs = Date.now() - startMs;
  if (elapsedMs < 2000) return "";
  let processed = 0;
  let total = 0;
  if (p.stage === "extract") {
    // 抽帧按视频数估算;帧级 rate 不直观,这里退化为视频剩余秒数
    processed = p.videoIndex ?? 0;
    total = p.videoTotal ?? 0;
  } else {
    processed = p.processed ?? 0;
    total = p.total ?? 0;
  }
  if (total === 0 || processed === 0) return "";
  if (processed >= total) return "即将完成";
  const rate = processed / elapsedMs; // 单位/毫秒
  const remainMs = (total - processed) / rate;
  const sec = Math.round(remainMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  if (min < 60) return `${min}m${s}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}

export default function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [framesDir, setFramesDir] = useState<string>("");
  const [groups, setGroups] = useState<VideoGroup[]>([]);
  const [selected, setSelected] = useState<Map<string, ScoredFrame>>(new Map());
  const [progress, setProgress] = useState< ScoreProgress | null>(null);
  const [busy, setBusy] = useState<"idle" | "extract" | "score">("idle");
  const [exportOpen, setExportOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [autoN, setAutoN] = useState(10);
  const [previewFrame, setPreviewFrame] = useState<ScoredFrame | null>(null);
  const [algorithm, setAlgorithm] = useState<"laplacian" | "brenner" | "variance">("laplacian");
  const [thumbMap, setThumbMap] = useState<Map<string, string>>(new Map());
  const [eta, setEta] = useState<string>("");
  const [logsOpen, setLogsOpen] = useState(false);
  const stageStartRef = useRef<number>(0);
  const lastStageRef = useRef<string>("");

  useEffect(() => {
    const off1 = window.framePicker.on.extractProgress((p) => {
      // 进入新阶段时重置开始时间(extract -> score 切换时)
      if (!stageStartRef.current || (progress && progress.stage !== p.stage)) {
        stageStartRef.current = Date.now();
      }
      setProgress(p);
      setEta(computeEta(p, stageStartRef.current));
      // 去重粒度按阶段:extract 按 videoName(每个新视频一条),score 按 50 帧桶
      // 避免 600 帧评分刷出 120 条日志
      const stageKey =
        p.stage === "extract"
          ? `extract-${p.videoName ?? ""}`
          : `score-${Math.floor((p.processed ?? 0) / 50)}`;
      if (stageKey !== lastStageRef.current && p.message) {
        lastStageRef.current = stageKey;
        pushLog(`[${p.stage}] ${p.message}`, "info");
      }
    });
    const off2 = window.framePicker.on.scoreProgress((p) => {
      if (!stageStartRef.current || (progress && progress.stage !== p.stage)) {
        stageStartRef.current = Date.now();
      }
      setProgress(p);
      setEta(computeEta(p, stageStartRef.current));
      const stageKey =
        p.stage === "extract"
          ? `extract-${p.videoName ?? ""}`
          : `score-${Math.floor((p.processed ?? 0) / 50)}`;
      if (stageKey !== lastStageRef.current && p.message) {
        lastStageRef.current = stageKey;
        pushLog(`[${p.stage}] ${p.message}`, "info");
      }
    });
    return () => {
      off1();
      off2();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 全局键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (previewFrame && e.key === "Escape") {
        setPreviewFrame(null);
        return;
      }
      if (groups.length === 0) return;
      const k = e.key.toLowerCase();
      if (/^[1-9]$/.test(k)) {
        const n = parseInt(k, 10);
        autoSelectTop(n);
        e.preventDefault();
      } else if (k === "a") {
        autoSelectTop(autoN);
        e.preventDefault();
      } else if (k === "c") {
        clearSelected();
        e.preventDefault();
      } else if (k === "e" && selected.size > 0) {
        setExportOpen(true);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, autoN, selected.size, previewFrame]);

  // 拖入文件/目录混合时统一处理:
  // - 包含至少 1 个目录 → 整个 batch 当作 merged 集合(整体选 topN)
  // - 全是独立文件 → 按父目录分组,每组一个 separate 集合
  const handleSelectVideos = async (paths: string[]) => {
    const dirSet = new Set<string>();
    const filePaths: string[] = [];
    for (const p of paths) {
      const stat = await window.framePicker.fs.stat(p);
      if (stat.isDirectory) {
        const videos = await window.framePicker.fs.listVideos(p);
        if (videos.length > 0) {
          filePaths.push(...videos);
          dirSet.add(p);
        }
      } else {
        filePaths.push(p);
      }
    }
    if (filePaths.length === 0) {
      toast("没有找到视频文件", "warning");
      pushLog("没有找到视频文件", "warn");
      return;
    }

    const newSources: Source[] = [];
    if (dirSet.size > 0) {
      // merged: 用第一个目录名作为集合名
      const firstDir = [...dirSet][0];
      const name = firstDir.split("/").filter(Boolean).pop() || "merged";
      newSources.push({ name, mode: "merged", paths: filePaths });
    } else {
      // 纯文件:按父目录分组
      const byDir = new Map<string, string[]>();
      for (const p of filePaths) {
        const dir = p.replace(/\/[^/]+$/, "");
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir)!.push(p);
      }
      for (const [dir, list] of byDir) {
        const name = dir.split("/").filter(Boolean).pop() || "files";
        newSources.push({ name, mode: "separate", paths: list });
      }
    }
    // 去重:合并已有 sources,key = path,避免同一文件多次入列
    let droppedCount = 0;
    setSources((prev) => {
      const seen = new Set<string>();
      const merged: Source[] = [];
      for (const s of [...prev, ...newSources]) {
        const filtered = s.paths.filter((p) => {
          if (seen.has(p)) {
            droppedCount++;
            return false;
          }
          seen.add(p);
          return true;
        });
        if (filtered.length > 0) merged.push({ ...s, paths: filtered });
      }
      return merged;
    });

    // 日志:记录选择摘要(去重前的)
    const mode = dirSet.size > 0 ? "merged" : "separate";
    if (droppedCount > 0) {
      pushLog(`已选 ${filePaths.length} 个视频 (${mode}),其中 ${droppedCount} 个重复已忽略`, "warn");
    } else {
      pushLog(`已选 ${filePaths.length} 个视频 (${mode})`, "info");
    }
  };

  const extract = async () => {
    if (sources.length === 0) return;
    const allPaths = sources.flatMap((s) => s.paths);
    if (allPaths.length === 0) return;

    // 默认输出到第一个视频父目录 + /all_frames 子文件夹
    const firstVideo = allPaths[0];
    const parentDir = firstVideo.replace(/\/[^/]+$/, "");
    const framesDir = `${parentDir.replace(/\/$/, "")}/all_frames`;

    setFramesDir(framesDir);
    setBusy("extract");
    setProgress(null);
    setGroups([]);
    setSelected(new Map());

    try {
      // 快速路径:如果 framesDir 已经有抽好的帧,跳过抽帧直接评分
      const existing = await window.framePicker.fs.listFrames?.(framesDir);
      if (existing && existing.count > 0) {
        pushLog(`已检测到 ${existing.count} 帧,跳过抽帧直接评分`, "info");
        await score(framesDir);
      } else {
        pushLog(`开始抽帧 (${allPaths.length} 个视频 → ${framesDir})`, "info");
        const r = await window.framePicker.frames.extract({
          videoPaths: allPaths,
          outputDir: framesDir,
        });
        if (r.ok) {
          pushLog(`✓ 抽帧完成 (共 ${r.totalFrames} 帧)`, "success");
          await score(framesDir);
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!msg.includes("CANCELED")) {
        toast(`处理失败: ${msg}`, "error");
        pushLog(`处理失败: ${msg}`, "error");
      }
    } finally {
      setBusy("idle");
    }
  };

  // 取消当前正在跑的抽帧或评分
  const cancelCurrent = () => {
    const stage = busy;
    if (busy === "extract") window.framePicker.frames.cancelExtract();
    else if (busy === "score") window.framePicker.frames.cancelScore();
    pushLog(`✗ 取消${stage === "extract" ? "抽帧" : "评分"}`, "warn");
    setBusy("idle");
    setProgress(null);
    setEta("");
    stageStartRef.current = 0;
  };

  const score = async (dir: string) => {
    setBusy("score");
    setProgress(null);
    try {
      pushLog(`开始评分 (${algorithm}, ${dir})`, "info");
      const r = await window.framePicker.frames.score(dir, algorithm);
      if (!r.ok) return;

      // 重组 groups:按 source 的 mode
      // merged: 跨 source 内所有视频的所有帧合并成一个 group(整体 topN)
      // separate: 每个视频单独一个 group(沿用 r.groups 的结构)
      const newGroups: VideoGroup[] = [];
      for (const src of sources) {
        if (src.mode === "merged") {
          // merged 模式下也按 videoName 分桶,每个视频一个 group card
          // 用户能看到每个视频各自的 topN + 总配额分布
          const videoNames = new Set(src.paths.map((p) => basename(p)));
          const buckets = new Map<string, ScoredFrame[]>();
          for (const g of r.groups) {
            if (videoNames.has(g.videoName) && g.all) {
              for (const f of g.all) {
                if (!buckets.has(f.videoName)) buckets.set(f.videoName, []);
                buckets.get(f.videoName)!.push(f);
              }
            }
          }
          for (const [videoName, frames] of buckets) {
            frames.sort((a, b) => b.score - a.score);
            newGroups.push({
              videoName,
              top: frames.slice(0, Math.max(autoN, 1)), // 每个视频展示自己的 top
              all: frames,
              allCount: frames.length,
              max: frames[0]?.score ?? 0,
              median: frames[Math.floor(frames.length / 2)]?.score ?? 0,
            });
          }
        } else {
          // separate mode:每个视频单独一个 group
          const videoNames = new Set(src.paths.map((p) => basename(p)));
          for (const g of r.groups) {
            if (videoNames.has(g.videoName)) {
              newGroups.push(g);
            }
          }
        }
      }
      setGroups(newGroups);
      pushLog(`✓ 评分完成 (${r.totalFrames} 帧, ${algorithm})`, "success");
    } catch (e: any) {
      toast(`评分失败: ${e.message ?? e}`, "error");
      pushLog(`评分失败: ${e.message ?? e}`, "error");
    } finally {
      setBusy("idle");
      setProgress(null);
    }
  };

  const toggleSelect = useCallback((frame: ScoredFrame) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(frame.path)) {
        next.delete(frame.path);
      } else {
        next.set(frame.path, frame);
      }
      return next;
    });
  }, []);

  const clearSelected = () => {
    if (selected.size > 0) pushLog(`清空选中 (${selected.size} 张)`, "info");
    setSelected(new Map());
  };
  const selections = Array.from(selected.values());

  // 一键自动选 topN — 配额制:每视频保底 1 张,剩下按全局 score 补齐
  // 避免最清晰的视频独占全部 topN
  const autoSelectTop = (n: number) => {
    // 按 videoName 分桶,每桶按 score 降序
    const byVideo = new Map<string, ScoredFrame[]>();
    for (const g of groups) {
      const frames = g.all ?? g.top;
      for (const f of frames) {
        if (!byVideo.has(f.videoName)) byVideo.set(f.videoName, []);
        byVideo.get(f.videoName)!.push(f);
      }
    }
    for (const arr of byVideo.values()) {
      arr.sort((a, b) => b.score - a.score);
    }

    // Step 1:每个视频先选 1 张(score 最高的)作为保底
    const next = new Map<string, ScoredFrame>();
    for (const arr of byVideo.values()) {
      if (arr.length > 0) next.set(arr[0].path, arr[0]);
    }

    // Step 2:收集剩余帧(每个视频第 2 张起),按全局 score 降序,补到 N
    if (next.size < n) {
      const remaining: ScoredFrame[] = [];
      for (const arr of byVideo.values()) {
        for (let i = 1; i < arr.length; i++) remaining.push(arr[i]);
      }
      remaining.sort((a, b) => b.score - a.score);
      const need = n - next.size;
      for (let i = 0; i < need && i < remaining.length; i++) {
        next.set(remaining[i].path, remaining[i]);
      }
    }

    setSelected(next);
    if (next.size > 0) {
      const arr = Array.from(next.values());
      const min = arr[arr.length - 1].score;
      const max = arr[0].score;
      // 统计每个视频贡献了几张,显示在日志里(用户能看清配额效果)
      const contrib = new Map<string, number>();
      for (const f of arr) contrib.set(f.videoName, (contrib.get(f.videoName) ?? 0) + 1);
      const breakdown = [...contrib.entries()].map(([v, c]) => `${v}×${c}`).join(", ");
      pushLog(`✓ 配额选 top ${n} · ${arr.length} 张 (分数 ${min.toFixed(0)}-${max.toFixed(0)}) · ${breakdown}`, "success");
    }
  };

  // 推断输出目录(用于 UI 显示)
  const inferredOutputDir = sources[0]
    ? sources[0].paths[0].replace(/\/[^/]+$/, "") + "/all_frames"
    : "";

  // 推断导出目录:第一个视频父目录 + /picked 子文件夹
  const inferredExportDir = sources[0]
    ? sources[0].paths[0].replace(/\/[^/]+$/, "") + "/picked"
    : "";

  // 评分完成后批量生成缩略图(主进程 sharp resize 320px,缓存到 .thumbnails/)
  // 只为 UI 展示的 topN 生成(默认 10 张)— 不再浪费 450 张
  useEffect(() => {
    if (groups.length === 0 || !framesDir) return;
    let cancelled = false;
    const topPaths: string[] = [];
    for (const g of groups) {
      for (const f of g.top) topPaths.push(f.path);
    }
    if (topPaths.length === 0) return;
    (async () => {
      try {
        const map = await window.framePicker.frames.thumbnail({
          framesDir,
          framePaths: topPaths,
          width: 320,
        });
        if (cancelled || !map || map.error) return;
        setThumbMap(new Map(Object.entries(map)));
        pushLog(`✓ 已生成 ${topPaths.length} 张缩略图`, "success");
      } catch (e: any) {
        if (!cancelled) {
          console.warn("thumbnail failed:", e?.message ?? e);
          pushLog(`缩略图失败: ${e?.message ?? e}`, "warn");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groups, framesDir]);

  // 评分完成(或重评分 / 改 autoN)后自动选 topN — 用户的需求就是固定 N 张,不要让他手选
  useEffect(() => {
    if (groups.length > 0 && autoN > 0) {
      autoSelectTop(autoN);
    }
  }, [groups, autoN]);

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar */}
      <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] font-bold">
            F
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">Frame Picker</div>
            <div className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]">
              视频抽帧 · 清晰度评分 · 智能选图
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sources.length > 0 && <Badge variant="outline">{sources.length} 个集合</Badge>}
          {sources.reduce((a, s) => a + s.paths.length, 0) > 0 && (
            <Badge variant="outline">{sources.reduce((a, s) => a + s.paths.length, 0)} 个视频</Badge>
          )}
          {groups.length > 0 && (
            <Badge variant="outline">{groups.reduce((a, g) => a + g.allCount, 0)} 帧</Badge>
          )}
          {selected.size > 0 && <Badge>{selected.size} 已选</Badge>}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLogsOpen(true)}
            title="查看流程日志"
          >
            <ScrollText className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main scroll area */}
      <main className="scrollbar-thin flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Step 1: 选择视频 */}
          {sources.length === 0 && (
            <DropZone
              onSelectVideos={(paths) => handleSelectVideos(paths)}
              onSelectDirectory={(path) => handleSelectVideos([path])}
            />
          )}

          {/* 集合列表 */}
          {sources.length > 0 && (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">视频集合 ({sources.length})</div>
                <Button variant="ghost" size="sm" onClick={() => setSources([])}>
                  <X className="h-3 w-3" /> 清空
                </Button>
              </div>
              <div className="space-y-2">
                {sources.map((src, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {src.mode === "merged" ? (
                        <FolderOpen className="h-4 w-4 shrink-0 text-[hsl(var(--color-primary))]" />
                      ) : (
                        <FileVideo className="h-4 w-4 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{src.name}</div>
                        <div className="truncate font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
                          {src.paths[0].replace(/\/[^/]+$/, "")}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="muted">{src.paths.length} 视频</Badge>
                      <Badge variant={src.mode === "merged" ? "default" : "outline"}>
                        {src.mode === "merged" ? "整体选 N" : "各自选 N"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Step 2: 抽帧 + 评分 按钮 */}
          {sources.length > 0 && groups.length === 0 && (
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">准备就绪</div>
                  <div className="mt-1 truncate font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
                    输出: {inferredOutputDir}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="h-9 rounded-md border border-[hsl(var(--color-border))] bg-transparent px-2 text-sm"
                    value={algorithm}
                    onChange={(e) => setAlgorithm(e.target.value as any)}
                  >
                    <option value="laplacian">Laplacian 方差</option>
                    <option value="brenner">Brenner 梯度</option>
                    <option value="variance">局部方差</option>
                  </select>
                  <Button onClick={extract} disabled={busy !== "idle"}>
                    {busy === "extract" || busy === "score" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {busy === "extract" ? "抽帧中..." : "评分中..."}
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        开始处理
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* 进度条 */}
          {progress && busy !== "idle" && (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">{progress.message}</div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {progress.stage === "extract"
                      ? `${progress.videoIndex ?? 0}/${progress.videoTotal ?? 1}`
                      : `${progress.processed ?? 0}/${progress.total ?? 0}`}
                  </Badge>
                  {eta && (
                    <Badge variant="muted" className="font-mono">
                      ETA {eta}
                    </Badge>
                  )}
                  <Button variant="outline" size="sm" onClick={cancelCurrent}>
                    <X className="h-3 w-3" /> 取消
                  </Button>
                </div>
              </div>
              <Progress
                value={
                  progress.stage === "extract"
                    ? Math.round(((progress.videoIndex ?? 0) / Math.max(1, progress.videoTotal ?? 1)) * 100)
                    : Math.round(((progress.processed ?? 0) / Math.max(1, progress.total ?? 1)) * 100)
                }
              />
            </Card>
          )}

          {/* Step 3: 网格预览 */}
          {groups.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">预览与选择</div>
                  <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
                    双击图片放大预览 · 点击切换选中
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-[hsl(var(--color-border))] bg-transparent px-2 text-sm"
                    value={algorithm}
                    onChange={(e) => setAlgorithm(e.target.value as any)}
                  >
                    <option value="laplacian">Laplacian</option>
                    <option value="brenner">Brenner</option>
                    <option value="variance">Variance</option>
                  </select>
                  <Button variant="outline" size="sm" onClick={() => { pushLog(`重评分 (${algorithm})`); score(framesDir); }} disabled={busy !== "idle"}>
                    重评分
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    value={autoN}
                    onChange={(e) => setAutoN(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8 w-16 text-center"
                  />
                  <Button variant="default" size="sm" onClick={() => autoSelectTop(autoN)}>
                    <Sparkles className="h-3.5 w-3.5" />
                    一键选最清晰的 {autoN} 张
                  </Button>
                  {selected.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearSelected}>
                      清空
                    </Button>
                  )}
                </div>
              </div>
              <FrameGrid
                groups={groups}
                framesDir={framesDir}
                selected={new Set(selected.keys())}
                thumbMap={thumbMap}
                onToggle={toggleSelect}
                onPreview={setPreviewFrame}
              />
            </div>
          )}
        </div>
      </main>

      {/* Bottom bar */}
      {selected.size > 0 && (
        <footer
          className={`fixed bottom-0 left-0 right-0 border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] transition-all ${
            collapsed ? "h-10" : "h-16"
          }`}
        >
          <div className="flex h-full items-center justify-between px-6">
            {collapsed ? (
              <Button variant="ghost" size="sm" onClick={() => setCollapsed(false)}>
                <ChevronUp className="h-4 w-4" />
                已选 {selected.size} 张 · 点击展开
              </Button>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Badge>{selected.size} 张已选</Badge>
                  <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
                    {Array.from(new Set(selections.map((s) => s.videoName))).join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCollapsed(true)}>
                    收起
                  </Button>
                  <Button onClick={() => setExportOpen(true)}>
                    <Download className="h-4 w-4" />
                    导出
                  </Button>
                </div>
              </>
            )}
          </div>
        </footer>
      )}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        selections={selections}
        defaultExportDir={inferredExportDir}
      />

      <ToastList />

      <LogsPanel open={logsOpen} onOpenChange={setLogsOpen} />

      {/* 大图预览 */}
      {previewFrame && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setPreviewFrame(null)}
        >
          <div className="relative max-h-full max-w-full">
            <img
              src={"file://" + previewFrame.path}
              alt={previewFrame.file}
              className="max-h-[85vh] max-w-[85vw] rounded-lg shadow-2xl"
            />
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between rounded-b-lg bg-black/70 px-4 py-2 text-sm">
              <div className="font-mono">
                {previewFrame.videoName} · {previewFrame.file}
              </div>
              <div className="flex items-center gap-3">
                <Badge className="font-mono">{formatScore(previewFrame.score)}</Badge>
                <Button
                  variant={selected.has(previewFrame.path) ? "default" : "outline"}
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(previewFrame);
                  }}
                >
                  {selected.has(previewFrame.path) ? "已选" : "选中"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewFrame(null);
                  }}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function basename(p: string): string {
  // 与 scoring 服务保持一致:去掉扩展名
  return p.split("/").filter(Boolean).pop()?.replace(/\.[^.]+$/, "") || "";
}