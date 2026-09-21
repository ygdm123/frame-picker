import { useCallback, useEffect, useState } from "react";
import { Play, Loader2, X, Download, ChevronUp, FolderOpen, FileVideo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DropZone } from "@/components/DropZone";
import { FrameGrid } from "@/components/FrameGrid";
import { ExportDialog } from "@/components/ExportDialog";
import type { ScoredFrame, VideoGroup, ScoreProgress, Source } from "@/types";

export default function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [framesDir, setFramesDir] = useState<string>("");
  const [groups, setGroups] = useState<VideoGroup[]>([]);
  const [selected, setSelected] = useState<Map<string, ScoredFrame>>(new Map());
  const [progress, setProgress] = useState< ScoreProgress | null>(null);
  const [busy, setBusy] = useState<"idle" | "extract" | "score">("idle");
  const [exportOpen, setExportOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const off1 = window.framePicker.on.extractProgress((p) => setProgress(p));
    const off2 = window.framePicker.on.scoreProgress((p) => setProgress(p));
    return () => {
      off1();
      off2();
    };
  }, []);

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
      alert("没有找到视频文件");
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
    setSources((prev) => [...prev, ...newSources]);
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
        await score(framesDir);
      } else {
        const r = await window.framePicker.frames.extract({
          videoPaths: allPaths,
          outputDir: framesDir,
        });
        if (r.ok) {
          await score(framesDir);
        }
      }
    } catch (e: any) {
      alert(`处理失败: ${e.message ?? e}`);
    } finally {
      setBusy("idle");
    }
  };

  const score = async (dir: string) => {
    setBusy("score");
    setProgress(null);
    try {
      const r = await window.framePicker.frames.score(dir);
      if (!r.ok) return;

      // 重组 groups:按 source 的 mode
      // merged: 跨 source 内所有视频的所有帧合并成一个 group(整体 topN)
      // separate: 每个视频单独一个 group(沿用 r.groups 的结构)
      const newGroups: VideoGroup[] = [];
      for (const src of sources) {
        if (src.mode === "merged") {
          // 收集 source 内所有视频的所有帧
          const videoNames = new Set(src.paths.map((p) => basename(p)));
          const inScope: ScoredFrame[] = [];
          for (const g of r.groups) {
            if (videoNames.has(g.videoName) && g.all) {
              inScope.push(...g.all);
            }
          }
          inScope.sort((a, b) => b.score - a.score);
          newGroups.push({
            videoName: src.name + " (整体)",
            top: inScope.slice(0, 30), // 默认展示 top30,UI 上让用户调整
            allCount: inScope.length,
            max: inScope[0]?.score ?? 0,
            median: inScope[Math.floor(inScope.length / 2)]?.score ?? 0,
          });
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
    } catch (e: any) {
      alert(`评分失败: ${e.message ?? e}`);
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

  const clearSelected = () => setSelected(new Map());
  const selections = Array.from(selected.values());

  // 推断输出目录(用于 UI 显示)
  const inferredOutputDir = sources[0]
    ? sources[0].paths[0].replace(/\/[^/]+$/, "") + "/all_frames"
    : "";

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
            <Card className="flex items-center justify-between p-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">准备就绪</div>
                <div className="mt-1 truncate font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
                  输出: {inferredOutputDir}
                </div>
              </div>
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
            </Card>
          )}

          {/* 进度条 */}
          {progress && busy !== "idle" && (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">{progress.message}</div>
                <Badge variant="outline">
                  {progress.stage === "extract"
                    ? `${progress.videoIndex ?? 0}/${progress.videoTotal ?? 1}`
                    : `${progress.processed ?? 0}/${progress.total ?? 0}`}
                </Badge>
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
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">预览与选择</div>
                  <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
                    {sources.some((s) => s.mode === "merged")
                      ? "merged 集合内跨视频选 top,纯文件按视频分组各选 top"
                      : "按视频分组,各选 top"}
                  </div>
                </div>
                {selected.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearSelected}>
                    清空选择
                  </Button>
                )}
              </div>
              <FrameGrid
                groups={groups}
                framesDir={framesDir}
                selected={new Set(selected.keys())}
                onToggle={toggleSelect}
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
      />
    </div>
  );
}

function basename(p: string): string {
  // 与 scoring 服务保持一致:去掉扩展名
  return p.split("/").filter(Boolean).pop()?.replace(/\.[^.]+$/, "") || "";
}