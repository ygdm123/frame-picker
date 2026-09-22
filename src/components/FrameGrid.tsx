import { memo, useCallback, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatScore } from "@/lib/utils";
import type { ScoredFrame, VideoGroup } from "@/types";

interface FrameGridProps {
  groups: VideoGroup[];
  framesDir: string;
  selected: Set<string>;
  thumbMap: Map<string, string>; // 原图路径 -> 缩略图缓存路径
  onToggle: (frame: ScoredFrame) => void;
  onPreview?: (frame: ScoredFrame) => void;
}

export function FrameGrid({ groups, framesDir: _framesDir, selected, thumbMap, onToggle, onPreview }: FrameGridProps) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <VideoGroupCard
          key={g.videoName}
          group={g}
          selected={selected}
          thumbMap={thumbMap}
          onToggle={onToggle}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}

function VideoGroupCard({
  group,
  selected,
  thumbMap,
  onToggle,
  onPreview,
}: {
  group: VideoGroup;
  selected: Set<string>;
  thumbMap: Map<string, string>;
  onToggle: (frame: ScoredFrame) => void;
  onPreview?: (frame: ScoredFrame) => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{group.videoName}</div>
          <Badge variant="muted">{group.allCount} 帧</Badge>
          <Badge variant="outline" className="font-mono">
            max {formatScore(group.max)}
          </Badge>
        </div>
      </div>
      <CardContent className="pt-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {group.top.map((f) => (
            <FrameThumb
              key={f.path}
              frame={f}
              checked={selected.has(f.path)}
              finalSrc={"file://" + (thumbMap.get(f.path) ?? f.path)}
              onToggle={onToggle}
              onPreview={onPreview}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// FrameThumb:React.memo + 稳定 props,避免 thumbMap/selected 变化时无谓重渲染
// 之前 10 个 thumb × useState + useEffect = 20 个 React 内部 hook,现在去掉 useEffect,
// finalSrc 由父组件直接计算后传入,thumb 内部只有 loaded 一个 useState(图片 onLoad 后变 true)。
const FrameThumb = memo(function FrameThumb({
  frame,
  checked,
  finalSrc,
  onToggle,
  onPreview,
}: {
  frame: ScoredFrame;
  checked: boolean;
  finalSrc: string;
  onToggle: (frame: ScoredFrame) => void;
  onPreview?: (frame: ScoredFrame) => void;
}) {
  // loaded 只在图片 onLoad 时变 true(没有 useEffect 监听 src)
  // thumbPath 异步变化时,父组件传的 finalSrc 字符串变了 → memo 触发 re-render,
  //   key=frame.path 保持稳定,所以 React 复用同一个 img 元素 → 浏览器加载新图 → onLoad → setLoaded(true)
  // 视觉上已加载的图不会"闪一下 skeleton",因为 DOM 元素被复用。
  const [loaded, setLoaded] = useState(false);

  // onToggle/onPreview 在 VideoGroupCard 已经是 useCallback 稳定引用,
  // 在 FrameThumb 内部包装时用 useCallback 也只能稳定一层,直接调用即可。
  const handleClick = useCallback(() => onToggle(frame), [onToggle, frame]);
  const handleDouble = useCallback(() => onPreview?.(frame), [onPreview, frame]);

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-md border-2 transition-all ${
        checked
          ? "border-[hsl(var(--color-primary))] ring-2 ring-[hsl(var(--color-primary))]/40"
          : "border-transparent hover:border-[hsl(var(--color-border))]"
      }`}
      onClick={handleClick}
      onDoubleClick={handleDouble}
    >
      <div className="absolute left-2 top-2 z-10">
        <Checkbox checked={checked} onCheckedChange={handleClick} />
      </div>
      <div className="absolute right-2 top-2 z-10">
        <Badge className="font-mono">{formatScore(frame.score)}</Badge>
      </div>
      {/* 底部来源 strip:merged 模式下让用户看出每张来自哪个视频(单视频时也提示文件名) */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-3">
        <div className="truncate text-[10px] font-medium text-white/90" title={frame.videoName}>
          {frame.videoName}
        </div>
      </div>
      <div className="relative aspect-[9/16] w-full bg-[hsl(var(--color-muted))]">
        <img
          src={finalSrc}
          alt={frame.file}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
        />
        {!loaded && (
          <div className="absolute inset-0 animate-pulse bg-[hsl(var(--color-muted))]" />
        )}
      </div>
    </div>
  );
});