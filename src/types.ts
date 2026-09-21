export interface ScoredFrame {
  file: string;
  path: string;
  videoName: string;
  score: number;
}

export interface Source {
  name: string;
  mode: "merged" | "separate";
  paths: string[];
}

export interface VideoGroup {
  videoName: string;
  top: ScoredFrame[];
  all?: ScoredFrame[];
  allCount: number;
  max: number;
  median: number;
}

export interface ScoreProgress {
  stage: "extract" | "score";
  videoIndex?: number;
  videoName?: string;
  videoTotal?: number;
  frame?: number;
  frameTotal?: number;
  processed?: number;
  total?: number;
  message: string;
}

declare global {
  interface Window {
    framePicker: {
      getPathForFile: (file: File) => string;
      fs: {
        listVideos: (dirPath: string) => Promise<string[]>;
        listFrames: (dirPath: string) => Promise<{ count: number; sample?: string[]; error?: string }>;
        stat: (p: string) => Promise<{ isDirectory?: boolean; isFile?: boolean; size?: number; error?: string }>;
      };
      dialog: {
        openDirectory: () => Promise<string | null>;
        openFiles: () => Promise<string[]>;
        openExportDir: () => Promise<string | null>;
      };
      frames: {
        extract: (payload: { videoPaths: string[]; outputDir: string }) => Promise<{
          ok: boolean;
          canceled?: boolean;
          framesDir: string;
          totalFrames: number;
          results?: Array<{ videoName: string; frames: number }>;
        }>;
        cancelExtract: () => Promise<boolean>;
        cancelScore: () => Promise<boolean>;
        score: (framesDir: string, algorithm?: string) => Promise<{ ok: boolean; groups: VideoGroup[]; totalFrames: number; algorithm?: string }>;
        exportCopy: (payload: { selections: ScoredFrame[]; outputDir: string; sizePreset?: string }) => Promise<{
          ok: boolean;
          outputDir: string;
          count: number;
          files: Array<{ index: number; target: string }>;
        }>;
        exportGrid: (payload: {
          selections: ScoredFrame[];
          outputPath: string;
          columns?: number;
        }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
      };
      shell: {
        showInFolder: (filePath: string) => Promise<boolean>;
        deleteTmp: (filePath: string) => Promise<boolean>;
      };
      on: {
        extractProgress: (handler: (p: ScoreProgress) => void) => () => void;
        scoreProgress: (handler: (p: ScoreProgress) => void) => () => void;
      };
    };
  }
}