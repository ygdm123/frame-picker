import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertCircle, Info } from "lucide-react";

export type ToastKind = "success" | "error" | "warning" | "info";

export interface ToastData {
  id: number;
  kind: ToastKind;
  message: string;
}

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-[hsl(var(--color-primary))]" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
  warning: <AlertCircle className="h-4 w-4 text-amber-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
};

// 全局 toast bus
let _nextId = 1;
const _listeners = new Set<(toasts: ToastData[]) => void>();
let _toasts: ToastData[] = [];

function emit() {
  for (const l of _listeners) l(_toasts);
}

export function toast(message: string, kind: ToastKind = "info") {
  const t = { id: _nextId++, kind, message };
  _toasts = [..._toasts, t];
  emit();
  // 错误多停一会儿
  const ms = kind === "error" ? 6000 : 3000;
  setTimeout(() => dismissToast(t.id), ms);
}

export function dismissToast(id: number) {
  _toasts = _toasts.filter((t) => t.id !== id);
  emit();
}

export function ToastList() {
  const [list, setList] = useState<ToastData[]>(_toasts);
  useEffect(() => {
    _listeners.add(setList);
    return () => { _listeners.delete(setList); };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-md items-center gap-2 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-4 py-2 shadow-lg"
        >
          {ICONS[t.kind]}
          <span className="flex-1 text-sm">{t.message}</span>
          <button
            className="text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]"
            onClick={() => dismissToast(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}