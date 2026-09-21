import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatScore } from "@/lib/utils";
import type { ScoredFrame, VideoGroup } from "@/types";

interface FrameGridProps {
  groups: VideoGroup[];
  framesDir: string;
  selected: Set<string>;
  onToggle: (frame: ScoredFrame) => void;
  onPreview?: (frame: ScoredFrame) => void;
}

export function FrameGrid({ groups, framesDir, selected, onToggle, onPreview }: FrameGridProps) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <VideoGroupCard
          key={g.videoName}
          group={g}
          framesDir={framesDir}
          selected={selected}
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
  onToggle,
  onPreview,
}: {
  group: VideoGroup;
  framesDir: string;
  selected: Set<string>;
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
  onToggle,
  onPreview,
}: {
  frame: ScoredFrame;
  dir: string;
  checked: boolean;
  onToggle: () => void;
  onPreview?: () => void;
}) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    // 用 file:// 协议直接显示本地图片(Electron renderer 允许)
    // frame.path 是绝对路径
    const url = "file://" + frame.path;
    setSrc(url);
  }, [frame.path]);

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
      {src && (
        <img
          src={src}
          alt={frame.file}
          className="block aspect-[9/16] w-full object-cover"
          loading="lazy"
        />
      )}
    </div>
  );
}