
export interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

export interface PaletteColor extends ColorRGB {
  hex: string;
  id: string;
  targetHex?: string;
}

export interface ColorInstance {
  hex: string;
  rgb: ColorRGB;
  count: number;
}

export interface ColorGroup {
  id: string;
  members: ColorInstance[];
  totalCount: number;
}

export type ProcessingState = 'idle' | 'processing' | 'completed';

export type WorkerMessage = {
  type: 'process';
  imageBitmap: ImageBitmap;
  parameters: {
    upscaleFactor: number | 'NS';
    denoiseRadius: number;
    edgeProtection: number;
    skipColorCleanup: boolean;
    scaling: number;
    palette: PaletteColor[];
    enabledGroups: string[];
    selectedInGroup: Record<string, string>;
    smoothingLevels: number;
  };
};

export type WorkerResponse = {
  type: 'complete' | 'progress';
  result?: Blob;
  progress?: number;
  error?: string;
};
