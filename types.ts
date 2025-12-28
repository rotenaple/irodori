
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

export type RecolorMode = 'palette' | 'tint';

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
  baseHue?: number;           // For tint mode: the average/representative hue of the group (0-360)
  targetHue?: number;         // For tint mode: the target hue to shift to (0-360)
}

export interface Supergroup {
  id: string;
  label: string;
  memberGroupIds: string[]; // IDs of the ColorGroups belonging to this supergroup
  tint?: TintSettings; // The master tint for this supergroup (optional)
}

export interface PixelArtConfig {
  enabled: boolean;
  pixelWidth: number;
  pixelHeight: number;
  lockAspect: boolean;
  showGrid: boolean;
  offsetX: number;
  offsetY: number;
  lockOffset: boolean;
}

export type ProcessingState = 'idle' | 'processing' | 'completed';

export interface TintSettings {
  hue: number;           // Target hue (0-360)
  saturation: number;    // Saturation adjustment (-100 to 100, 0 = no change)
  lightness: number;     // Lightness adjustment (-100 to 100, 0 = no change)
  hueForce: number;      // How strongly to apply hue shift (0-100, 100 = full)
  saturationForce: number; // How strongly to apply saturation shift (0-100, 100 = full)
  lightnessForce: number;  // How strongly to apply lightness shift (0-100, 100 = full)
}

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
    alphaSmoothness: number;
    preserveTransparency: boolean;
    pixelArtConfig?: PixelArtConfig;
    recolorMode?: RecolorMode;        // 'palette' (default) or 'tint'
    tintOverrides?: Record<string, TintSettings>;  // For tint mode: group ID -> tint settings
  };
  svgContent?: string;
};

export type WorkerResponse = {
  type: 'complete' | 'progress';
  result?: Blob;
  progress?: number;
  error?: string;
};
