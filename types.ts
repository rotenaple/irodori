
export interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

export interface PaletteColor extends ColorRGB {
  hex: string;
  id: string;
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
