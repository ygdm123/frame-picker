// 全局日志 store: 订阅 + push + clear
// 类似一个简化版 console.log,可以订阅、记录流程事件
// LogsPanel 渲染时订阅 useSyncExternalStore,其他地方 push 即可

export type LogLevel = "info" | "warn" | "error" | "success";

export interface LogEntry {
  id: number;
  ts: number; // Date.now()
  level: LogLevel;
  message: string;
}

type Listener = () => void;

let entries: LogEntry[] = [];
const listeners = new Set<Listener>();
let nextId = 1;
// 上限 500 条,防止内存爆
const MAX_ENTRIES = 500;

function notify() {
  for (const fn of listeners) fn();
}

export function pushLog(message: string, level: LogLevel = "info"): void {
  const entry: LogEntry = { id: nextId++, ts: Date.now(), level, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  notify();
}

export function clearLogs(): void {
  entries = [];
  notify();
}

export function getLogs(): readonly LogEntry[] {
  return entries;
}

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSnapshot(): readonly LogEntry[] {
  return entries;
}

export function getServerSnapshot(): readonly LogEntry[] {
  return [];
}

// React hook: 订阅 logs store
import { useSyncExternalStore } from "react";
export function useLogs(): readonly LogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// 格式化时间戳 HH:MM:SS
export function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}