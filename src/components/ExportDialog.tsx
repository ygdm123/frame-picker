import { useEffect, useState, useMemo } from "react";
import { Download, ImageIcon, FolderOpen, Loader2, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/Toast";
import type { ScoredFrame } from "@/types";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selections: ScoredFrame[];
  defaultExportDir?: string;
}

const SIZE_PRESETS = [
  { id: "original", label: "原图" },
  { id: "xiaohongshu_3_4", label: "小红书 1080×1440 (3:4)" },
  { id: "xianyu_1_1", label: "闲鱼 800×800 (1:1)" },
  { id: "weibo_4_3", label: "微博 1200×900 (4:3)" },
];

const NAMING_PRESETS = [
  { id: "default", label: "默认", pattern: "{index:02}_{videoName}_{file}.jpg" },
  { id: "simple", label: "简洁", pattern: "{index:02}_{videoName}.jpg" },
  { id: "with_score", label: "带分数", pattern: "{index:02}_{videoName}_{score}.jpg" },
  { id: "with_date", label: "含日期", pattern: "{date}_{index:02}_{videoName}.jpg" },
];

// 文档化的可用占位符(从主进程镜像过来,这样渲染时不开 IPC 也能用)
const NAMING_HELP = {
  "{index:02}": "序号(01,02,03...),宽度可调(如 {index:03})",
  "{index}": "序号,不补零",
  "{videoName}": "源视频名(去扩展名)",
  "{file}": "原帧文件名(去扩展名)",
  "{score}": "清晰度分数(保留 1 位小数)",
  "{date}": "导出日期 YYYYMMDD",
  "{time}": "导出时间 HHMMSS",
};

// 本地预览:把命名模板应用到第一项 selection 上
function previewName(pattern: string, sel: ScoredFrame | undefined): string {
  if (!sel) return "(需先选帧)";
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  const indexStr = pattern.match(/\{index:(\d+)\}/)
    ? String(1).padStart(parseInt(pattern.match(/\{index:(\d+)\}/)![1], 10), "0")
    : "1";
  let name = pattern
    .replace(/\{index:\d+\}/g, indexStr)
    .replace(/\{index\}/g, "1")
    .replace(/\{videoName\}/g, sel.videoName)
    .replace(/\{file\}/g, sel.file.replace(/\.jpe?g$/i, ""))
    .replace(/\{score\}/g, sel.score?.toFixed?.(1) ?? "")
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time);
  if (!/\.(jpe?g|png|webp)$/i.test(name)) name += ".jpg";
  return name.replace(/[/\\]/g, "_");
}

export function ExportDialog({ open, onOpenChange, selections, defaultExportDir }: ExportDialogProps) {
  const [exportDir, setExportDir] = useState<string>(defaultExportDir ?? "");
  const [doCopy, setDoCopy] = useState(true);
  const [doGrid, setDoGrid] = useState(false);
  const [gridColumns, setGridColumns] = useState(5);
  const [sizePreset, setSizePreset] = useState("original");
  const [namingPattern, setNamingPattern] = useState("{index:02}_{videoName}_{file}.jpg");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>("");
  const [previewPath, setPreviewPath] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showNamingHelp, setShowNamingHelp] = useState(false);

  // 打开对话框时把 exportDir 同步到推断的默认目录(用户没手动改过的话)
  useEffect(() => {
    if (open && defaultExportDir) {
      setExportDir(defaultExportDir);
    }
  }, [open, defaultExportDir]);

  const pickExportDir = async () => {
    const dir = await window.framePicker.dialog.openExportDir();
    if (dir) setExportDir(dir);
  };

  const selectionsFingerprint = selections.length > 0
    ? `${selections.length}-${selections[0].path}-${selections[selections.length - 1].path}`
    : "0";

  const [tmpFile, setTmpFile] = useState<string>("");
  useEffect(() => {
    return () => {
      if (tmpFile) {
        try {
          window.framePicker.shell.deleteTmp?.(tmpFile);
        } catch {}
      }
    };
  }, [tmpFile]);

  useEffect(() => {
    if (!open || selections.length === 0) {
      setPreviewPath("");
      return;
    }
    const gen = async () => {
      setPreviewLoading(true);
      try {
        const tmp = `/tmp/frame-picker-preview-${Date.now()}.jpg`;
        const r = await window.framePicker.frames.exportGrid({
          selections,
          outputPath: tmp,
          columns: gridColumns,
        });
        if (r.ok && r.outputPath) {
          setTmpFile(r.outputPath);
          setPreviewPath(`file://${r.outputPath}?t=${Date.now()}`);
        }
      } catch {
        // ignore
      } finally {
        setPreviewLoading(false);
      }
    };
    gen();
  }, [open, selectionsFingerprint, gridColumns]);

  // 命名模板实时预览(用第一项 selection)
  const namingPreview = useMemo(
    () => previewName(namingPattern, selections[0]),
    [namingPattern, selections]
  );

  // 模板里至少要有 {videoName} 或 {file} 之一,否则全是数字/日期会撞名
  const namingValid = useMemo(() => {
    if (!namingPattern.trim()) return false;
    return /\{videoName\}|\{file\}/.test(namingPattern);
  }, [namingPattern]);

  const run = async () => {
    if (!exportDir) {
      toast("请先选择导出目录", "warning");
      return;
    }
    if (!doCopy && !doGrid) {
      toast("至少选一种导出方式", "warning");
      return;
    }
    if (doCopy && !namingValid) {
      toast("命名模板需包含 {videoName} 或 {file} 之一,避免文件名撞车", "warning");
      return;
    }
    setRunning(true);
    setResult("");
    try {
      const lines: string[] = [];
      if (doCopy) {
        const r = await window.framePicker.frames.exportCopy({
          selections,
          outputDir: exportDir,
          sizePreset,
          namingPattern,
        });
        if (r.ok) {
          const sub = sizePreset === "original" ? "" : ` (${SIZE_PRESETS.find((p) => p.id === sizePreset)?.label})`;
          lines.push(`✓ 已复制 ${r.count} 张到 ${r.outputDir}${sub}`);
        } else {
          lines.push(`✗ 复制失败: ${r.error}`);
        }
      }
      if (doGrid) {
        const gridPath = `${exportDir.replace(/\/$/, "")}/compare-grid.jpg`;
        const r = await window.framePicker.frames.exportGrid({
          selections,
          outputPath: gridPath,
          columns: gridColumns,
        });
        if (r.ok) {
          lines.push(`✓ 已生成对比网格图: ${r.outputPath}`);
        } else {
          lines.push(`✗ 网格图生成失败: ${r.error}`);
        }
      }
      setResult(lines.join("\n"));
      toast("导出完成", "success");
    } catch (e: any) {
      setResult(`✗ 出错: ${e.message ?? e}`);
      toast(`导出失败: ${e.message ?? e}`, "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>导出 {selections.length} 张精选图</DialogTitle>
          <DialogDescription>
            预览效果:左侧是按当前列数生成的对比网格。尺寸预设会应用到复制出的图片。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 左侧:设置 */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">导出目录</label>
              <div className="flex gap-2">
                <Input
                  value={exportDir}
                  onChange={(e) => setExportDir(e.target.value)}
                  placeholder="选择目录"
                  readOnly
                />
                <Button variant="outline" size="icon" onClick={pickExportDir}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">尺寸预设 (复制时生效)</label>
              <select
                className="h-9 w-full rounded-md border border-[hsl(var(--color-border))] bg-transparent px-2 text-sm"
                value={sizePreset}
                onChange={(e) => setSizePreset(e.target.value)}
              >
                {SIZE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">文件名模板 (复制时生效)</label>
                <button
                  type="button"
                  onClick={() => setShowNamingHelp((v) => !v)}
                  className="text-xs text-[hsl(var(--color-muted-foreground))] hover:underline inline-flex items-center gap-1"
                >
                  <Info className="h-3 w-3" />
                  {showNamingHelp ? "收起" : "可用变量"}
                </button>
              </div>
              <Input
                value={namingPattern}
                onChange={(e) => setNamingPattern(e.target.value)}
                placeholder="{index:02}_{videoName}_{file}.jpg"
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap gap-1">
                {NAMING_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setNamingPattern(p.pattern)}
                    className={`rounded px-2 py-0.5 text-xs border ${
                      namingPattern === p.pattern
                        ? "border-[hsl(var(--color-primary))] bg-[hsl(var(--color-primary))]/10 text-[hsl(var(--color-primary))]"
                        : "border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
                预览: <span className={namingValid ? "" : "text-red-500"}>{namingPreview}</span>
              </div>
              {showNamingHelp && (
                <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] p-2 text-xs space-y-0.5">
                  {Object.entries(NAMING_HELP).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <code className="font-mono text-[hsl(var(--color-primary))]">{k}</code>
                      <span className="text-[hsl(var(--color-muted-foreground))]">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">导出方式</label>
              <div className="space-y-2 rounded-md border border-[hsl(var(--color-border))] p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={doCopy} onCheckedChange={(c) => setDoCopy(!!c)} />
                  <Download className="h-4 w-4" />
                  复制到目录
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={doGrid} onCheckedChange={(c) => setDoGrid(!!c)} />
                  <ImageIcon className="h-4 w-4" />
                  生成对比网格图
                  {doGrid && (
                    <select
                      className="ml-2 rounded border border-[hsl(var(--color-border))] bg-transparent px-2 py-0.5 text-xs"
                      value={gridColumns}
                      onChange={(e) => setGridColumns(Number(e.target.value))}
                    >
                      <option value="2">2 列</option>
                      <option value="3">3 列</option>
                      <option value="4">4 列</option>
                      <option value="5">5 列</option>
                      <option value="6">6 列</option>
                    </select>
                  )}
                </label>
              </div>
            </div>

            {result && (
              <pre className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] p-3 text-xs whitespace-pre-wrap">
                {result}
              </pre>
            )}
          </div>

          {/* 右侧:预览 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">预览</label>
            <div className="flex aspect-[9/16] max-h-[420px] items-center justify-center overflow-hidden rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))]">
              {previewLoading ? (
                <div className="flex items-center gap-2 text-sm text-[hsl(var(--color-muted-foreground))]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成预览中...
                </div>
              ) : previewPath ? (
                <img
                  src={previewPath}
                  alt="preview"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="text-sm text-[hsl(var(--color-muted-foreground))]">
                  选中帧后这里会显示预览
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            关闭
          </Button>
          <Button onClick={run} disabled={running || selections.length === 0}>
            {running ? "导出中..." : "开始导出"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}