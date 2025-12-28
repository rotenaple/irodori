
export interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorHSL {
  h: number;
  s: number;
  l: number;
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
  percentage?: number;
  score?: number;
}

export interface ColorGroup {
  id: string;
  members: ColorInstance[];
  totalCount: number;
  representativeHex?: string; // Cache the chosen representative or override
}

export type ProcessingState = 'idle' | 'processing' | 'completed';

export type WorkerMessage = {
  type: 'process';
  imageBitmap: ImageBitmap;
  parameters: {
    upscaleFactor: number | 'NS';
    denoiseRadius: number;
    edgeProtection: number;
    disablePostProcessing: boolean;
    disableRecoloring: boolean;
    disableScaling: boolean;
    palette: PaletteColor[];
    colorGroups?: ColorGroup[];
    enabledGroups: string[];
    selectedInGroup: Record<string, string>;
    smoothingLevels: number;
    vertexInertia: number;
  };
  svgContent?: string;
};

export type WorkerResponse = {
  type: 'complete' | 'progress';
  result?: Blob;
  progress?: number;
  error?: string;
};
