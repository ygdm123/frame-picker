import { useCallback, useState } from "react";
import { FolderOpen, FileVideo, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface DropZoneProps {
  onSelectVideos: (paths: string[]) => void;
  onSelectDirectory: (path: string) => void;
}

export function DropZone({ onSelectVideos, onSelectDirectory }: DropZoneProps) {
  const [hover, setHover] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setHover(false);
      const files = Array.from(e.dataTransfer.files);
      // Electron 32+: File.path 已废弃,用 webUtils.getPathForFile
      const paths = files
        .map((f) => window.framePicker.getPathForFile(f))
        .filter(Boolean);
      if (paths.length > 0) onSelectVideos(paths);
    },
    [onSelectVideos]
  );

  const pickFiles = async () => {
    const paths = await window.framePicker.dialog.openFiles();
    if (paths.length > 0) onSelectVideos(paths);
  };

  const pickDirectory = async () => {
    const path = await window.framePicker.dialog.openDirectory();
    if (path) onSelectDirectory(path);
  };

  return (
    <Card
      className={`flex flex-col items-center justify-center gap-4 border-dashed p-10 transition-colors ${
        hover ? "border-[hsl(var(--color-primary))] bg-[hsl(var(--color-muted))]" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={handleDrop}
    >
      <Upload className="h-10 w-10 text-[hsl(var(--color-muted-foreground))]" />
      <div className="text-center">
        <div className="text-sm font-medium">拖入视频文件或目录</div>
        <div className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]">
          支持 mp4 / mov / mkv / avi / webm
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={pickFiles}>
          <FileVideo className="h-4 w-4" />
          选择文件
        </Button>
        <Button variant="outline" size="sm" onClick={pickDirectory}>
          <FolderOpen className="h-4 w-4" />
          选择目录
        </Button>
      </div>
    </Card>
  );
}