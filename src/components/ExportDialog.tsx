import { useEffect, useState } from "react";
import { Download, ImageIcon, FolderOpen, Loader2 } from "lucide-react";
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
}

const SIZE_PRESETS = [
  { id: "original", label: "原图" },
  { id: "xiaohongshu_3_4", label: "小红书 1080×1440 (3:4)" },
  { id: "xianyu_1_1", label: "闲鱼 800×800 (1:1)" },
  { id: "weibo_4_3", label: "微博 1200×900 (4:3)" },
];

export function ExportDialog({ open, onOpenChange, selections }: ExportDialogProps) {
  const [exportDir, setExportDir] = useState<string>("");
  const [doCopy, setDoCopy] = useState(true);
  const [doGrid, setDoGrid] = useState(true);
  const [gridColumns, setGridColumns] = useState(5);
  const [sizePreset, setSizePreset] = useState("original");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>("");
  const [previewPath, setPreviewPath] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const pickExportDir = async () => {
    const dir = await window.framePicker.dialog.openExportDir();
    if (dir) setExportDir(dir);
  };

  // 打开对话框时,如果已有选择,立即生成预览图(用 tmp 路径)
  // 用 selections 的指纹(数量 + 第一个 path)做依赖,避免 length 没变但内容变了不重渲染
  const selectionsFingerprint = selections.length > 0
    ? `${selections.length}-${selections[0].path}-${selections[selections.length - 1].path}`
    : "0";

  // 关闭对话框时清理之前生成的临时预览文件
  const [tmpFile, setTmpFile] = useState<string>("");
  useEffect(() => {
    return () => {
      // 对话框 unmount 时清掉最后一次的 tmp
      if (tmpFile) {
        try {
          // 走 IPC 让主进程删
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

  const run = async () => {
    if (!exportDir) {
      toast("请先选择导出目录", "warning");
      return;
    }
    if (!doCopy && !doGrid) {
      toast("至少选一种导出方式", "warning");
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
        });
        if (r.ok) {
          const sub = sizePreset === "original" ? "" : ` (${SIZE_PRESETS.find(p => p.id === sizePreset)?.label})`;
          lines.push(`✓ 已复制 ${r.count} 张到 ${r.outputDir}${sub}`);
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