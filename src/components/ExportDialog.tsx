import { useState } from "react";
import { Download, ImageIcon, FolderOpen } from "lucide-react";
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
import type { ScoredFrame } from "@/types";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selections: ScoredFrame[];
}

export function ExportDialog({ open, onOpenChange, selections }: ExportDialogProps) {
  const [exportDir, setExportDir] = useState<string>("");
  const [doCopy, setDoCopy] = useState(true);
  const [doGrid, setDoGrid] = useState(true);
  const [gridColumns, setGridColumns] = useState(5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>("");

  const pickExportDir = async () => {
    const dir = await window.framePicker.dialog.openExportDir();
    if (dir) setExportDir(dir);
  };

  const run = async () => {
    if (!exportDir) {
      alert("请先选择导出目录");
      return;
    }
    if (!doCopy && !doGrid) {
      alert("至少选一种导出方式");
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
        });
        if (r.ok) {
          lines.push(`✓ 已复制 ${r.count} 张到 ${r.outputDir}`);
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
    } catch (e: any) {
      setResult(`✗ 出错: ${e.message ?? e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导出 {selections.length} 张精选图</DialogTitle>
          <DialogDescription>
            选择导出方式。复制 = 复制到目录;网格图 = 把所有选中帧拼成一张大图方便预览。
          </DialogDescription>
        </DialogHeader>

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
            <label className="text-sm font-medium">导出方式</label>
            <div className="space-y-2 rounded-md border border-[hsl(var(--color-border))] p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={doCopy} onCheckedChange={(c) => setDoCopy(!!c)} />
                <Download className="h-4 w-4" />
                复制到目录 (命名为 01_视频名_帧.jpg)
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