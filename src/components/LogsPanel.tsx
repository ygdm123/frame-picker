import { useEffect, useRef } from "react";
import { X, Trash2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLogs, clearLogs, formatTs, type LogEntry, type LogLevel } from "@/lib/log";

interface LogsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "text-[hsl(var(--color-muted-foreground))]",
  success: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO",
  success: "OK ",
  warn: "WARN",
  error: "ERR",
};

export function LogsPanel({ open, onOpenChange }: LogsPanelProps) {
  const logs = useLogs();
  const scrollRef = useRef<HTMLDivElement>(null);

  // auto-scroll 到底部(新日志进来)
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs.length, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
      <div className="flex h-[70vh] w-full max-w-5xl flex-col rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-2">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            <div className="text-sm font-semibold">流程日志</div>
            <Badge variant="muted" className="font-mono text-xs">
              {logs.length} 条
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearLogs()}
              disabled={logs.length === 0}
            >
              <Trash2 className="h-3 w-3" /> 清空
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-black/40 p-3 font-mono text-xs leading-5"
        >
          {logs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[hsl(var(--color-muted-foreground))]">
              暂无日志。开始抽帧/评分/导出后这里会有流程记录。
            </div>
          ) : (
            logs.map((log) => <LogRow key={log.id} log={log} />)
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  return (
    <div className="flex gap-3 hover:bg-white/5">
      <span className="shrink-0 text-[hsl(var(--color-muted-foreground))]">{formatTs(log.ts)}</span>
      <span className={`shrink-0 ${LEVEL_STYLE[log.level]}`}>{LEVEL_LABEL[log.level]}</span>
      <span className={`flex-1 ${LEVEL_STYLE[log.level]}`}>{log.message}</span>
    </div>
  );
}