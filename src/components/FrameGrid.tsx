import { useState, useEffect } from "react";
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

export function FrameGrid({ groups, framesDir, selected, thumbMap, onToggle, onPreview }: FrameGridProps) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <VideoGroupCard
          key={g.videoName}
          group={g}
          framesDir={framesDir}
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
  framesDir,
  selected,
  thumbMap,
  onToggle,
  onPreview,
}: {
  group: VideoGroup;
  framesDir: string;
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
              dir={framesDir}
              checked={selected.has(f.path)}
              thumbPath={thumbMap.get(f.path)}
              onToggle={() => onToggle(f)}
              onPreview={() => onPreview?.(f)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FrameThumb({
  frame,
  dir,
  checked,
  thumbPath,
  onToggle,
  onPreview,
}: {
  frame: ScoredFrame;
  dir: string;
  checked: boolean;
  thumbPath?: string;
  onToggle: () => void;
  onPreview?: () => void;
}) {
  // 优先用缩略图(主进程 sharp resize 过,~50KB),fallback 到 file:// 原图
  const finalSrc = thumbPath ? "file://" + thumbPath : "file://" + frame.path;
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    setLoaded(false);
    setSrc(finalSrc);
  }, [finalSrc]);

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-md border-2 transition-all ${
        checked
          ? "border-[hsl(var(--color-primary))] ring-2 ring-[hsl(var(--color-primary))]/40"
          : "border-transparent hover:border-[hsl(var(--color-border))]"
      }`}
      onClick={onToggle}
      onDoubleClick={() => onPreview?.()}
    >
      <div className="absolute left-2 top-2 z-10">
        <Checkbox checked={checked} onCheckedChange={onToggle} />
      </div>
      <div className="absolute right-2 top-2 z-10">
        <Badge className="font-mono">{formatScore(frame.score)}</Badge>
      </div>
      <div className="relative aspect-[9/16] w-full bg-[hsl(var(--color-muted))]">
        {src && (
          <img
            src={src}
            alt={frame.file}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
          />
        )}
        {!loaded && (
          <div className="absolute inset-0 animate-pulse bg-[hsl(var(--color-muted))]" />
        )}
      </div>
    </div>
  );
}