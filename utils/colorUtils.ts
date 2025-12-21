import { ColorRGB, PaletteColor, ColorGroup, ColorInstance } from '../types';

export const rgbToHex = (r: number, g: number, b: number): string => {
  const componentToHex = (c: number) => {
    const hex = Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
    return hex;
  };
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`.toLowerCase();
};

export const hexToRgb = (hex: string): ColorRGB | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

export const getColorDistance = (c1: ColorRGB, c2: ColorRGB): number => {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
    Math.pow(c1.g - c2.g, 2) +
    Math.pow(c1.b - c2.b, 2)
  );
};

export const sigmoidSnap = (r: number, k: number = 12): number => {
  return 1 / (1 + Math.exp(-k * (r - 0.5)));
};

export const findClosestColor = (pixel: ColorRGB, palette: PaletteColor[], coreWeight: number = 1.0): PaletteColor => {
  if (palette.length === 0) return { r: 0, g: 0, b: 0, hex: '#000000', id: 'default' };
  let minDistance = Infinity;
  let closestColor = palette[0];

  for (const color of palette) {
    let distance = getColorDistance(pixel, color);
    if (color.id.startsWith('group-')) {
      distance *= coreWeight;
    }
    if (distance < minDistance) {
      minDistance = distance;
      closestColor = color;
    }
  }
  return closestColor;
};

export const blendColors = (c1: ColorRGB, c2: ColorRGB, ratio: number): ColorRGB => {
  return {
    r: Math.round(c1.r * (1 - ratio) + c2.r * ratio),
    g: Math.round(c1.g * (1 - ratio) + c2.g * ratio),
    b: Math.round(c1.b * (1 - ratio) + c2.b * ratio),
  };
};

export const applyMedianFilter = (imageData: ImageData, radius: number = 1): ImageData => {
  const { width, height, data } = imageData;
  const output = new ImageData(new Uint8ClampedArray(data), width, height);
  const outData = output.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rs: number[] = [];
      const gs: number[] = [];
      const bs: number[] = [];

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          const idx = (ny * width + nx) * 4;
          rs.push(data[idx]);
          gs.push(data[idx + 1]);
          bs.push(data[idx + 2]);
        }
      }

      const mid = Math.floor(rs.length / 2);
      const sort = (a: number, b: number) => a - b;
      const outIdx = (y * width + x) * 4;
      outData[outIdx] = rs.sort(sort)[mid];
      outData[outIdx + 1] = gs.sort(sort)[mid];
      outData[outIdx + 2] = bs.sort(sort)[mid];
    }
  }
  return output;
};

export interface ExtractionResult {
  groups: ColorGroup[];
  totalSamples: number;
}

export const extractColorGroups = (imageData: ImageData, distanceThreshold: number = 45): ExtractionResult => {
  const data = imageData.data;
  const frequencyMap: Record<string, number> = {};
  let totalSamples = 0;

  const step = Math.max(1, Math.floor((imageData.width * imageData.height) / 50000)) * 4;
  for (let i = 0; i < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const hex = rgbToHex(r, g, b);
    frequencyMap[hex] = (frequencyMap[hex] || 0) + 1;
    totalSamples++;
  }

  const sortedColors = Object.entries(frequencyMap)
    .sort(([, a], [, b]) => b - a)
    .map(([hex, count]) => ({ hex, rgb: hexToRgb(hex)!, count }));

  const groups: ColorGroup[] = [];

  for (const item of sortedColors) {
    let placed = false;
    for (const group of groups) {
      if (getColorDistance(item.rgb, group.members[0].rgb) < distanceThreshold) {
        group.members.push(item);
        group.totalCount += item.count;
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push({
        id: `group-${Math.random().toString(36).substr(2, 5)}`,
        members: [item],
        totalCount: item.count
      });
    }
  }

  const minFrequency = totalSamples * 0.01;
  const filteredGroups = groups
    .filter(g => g.totalCount > minFrequency)
    .sort((a, b) => b.totalCount - a.totalCount);

  return {
    groups: filteredGroups,
    totalSamples
  };
};

export const HTML_COLORS: Record<string, string> = {
  "#f0f8ff": "AliceBlue", "#faebd7": "AntiqueWhite", "#00ffff": "Aqua", "#7fffd4": "Aquamarine", "#f0ffff": "Azure",
  "#f5f5dc": "Beige", "#ffe4c4": "Bisque", "#000000": "Black", "#ffebcd": "BlanchedAlmond", "#0000ff": "Blue",
  "#8a2be2": "BlueViolet", "#a52a2a": "Brown", "#deb887": "BurlyWood", "#5f9ea0": "CadetBlue", "#7fff00": "Chartreuse",
  "#d2691e": "Chocolate", "#ff7f50": "Coral", "#6495ed": "CornflowerBlue", "#fff8dc": "Cornsilk", "#dc143c": "Crimson",
  "#00008b": "DarkBlue", "#008b8b": "DarkCyan", "#b8860b": "DarkGoldenRod", "#a9a9a9": "DarkGray", "#006400": "DarkGreen",
  "#bdb76b": "DarkKhaki", "#8b008b": "DarkMagenta", "#556b2f": "DarkOliveGreen", "#ff8c00": "DarkOrange", "#9932cc": "DarkOrchid",
  "#8b0000": "DarkRed", "#e9967a": "DarkSalmon", "#8fbc8f": "DarkSeaGreen", "#483d8b": "DarkSlateBlue", "#2f4f4f": "DarkSlateGray",
  "#00ced1": "DarkTurquoise", "#9400d3": "DarkViolet", "#ff1493": "DeepPink", "#00bfff": "DeepSkyBlue", "#696969": "DimGray",
  "#1e90ff": "DodgerBlue", "#b22222": "FireBrick", "#fffaf0": "FloralWhite", "#228b22": "ForestGreen", "#ff00ff": "Fuchsia",
  "#dcdcdc": "Gainsboro", "#f8f8ff": "GhostWhite", "#ffd700": "Gold", "#daa520": "GoldenRod", "#808080": "Gray",
  "#008000": "Green", "#adff2f": "GreenYellow", "#f0fff0": "HoneyDew", "#ff69b4": "HotPink", "#cd5c5c": "IndianRed",
  "#4b0082": "Indigo", "#fffff0": "Ivory", "#f0e68c": "Khaki", "#e6e6fa": "Lavender", "#fff0f5": "LavenderBlush",
  "#7cfc00": "LawnGreen", "#fffacd": "LemonChiffon", "#add8e6": "LightBlue", "#f08080": "LightCoral", "#e0ffff": "LightCyan",
  "#fafad2": "LightGoldenRodYellow", "#d3d3d3": "LightGray", "#90ee90": "LightGreen", "#ffb6c1": "LightPink", "#ffa07a": "LightSalmon",
  "#20b2aa": "LightSeaGreen", "#87cefa": "LightSkyBlue", "#778899": "LightSlateGray", "#b0c4de": "LightSteelBlue", "#ffffe0": "LightYellow",
  "#00ff00": "Lime", "#32cd32": "LimeGreen", "#faf0e6": "Linen", "#800000": "Maroon",
  "#66cdaa": "MediumAquaMarine", "#0000cd": "MediumBlue", "#ba55d3": "MediumOrchid", "#9370db": "MediumPurple", "#3cb371": "MediumSeaGreen",
  "#7b68ee": "MediumSlateBlue", "#00fa9a": "MediumSpringGreen", "#48d1cc": "MediumTurquoise", "#c71585": "MediumVioletRed", "#191970": "MidnightBlue",
  "#f5fffa": "MintCream", "#ffe4e1": "MistyRose", "#ffe4b5": "Moccasin", "#ffdead": "NavajoWhite", "#000080": "Navy",
  "#fdf5e6": "OldLace", "#808000": "Olive", "#6b8e23": "OliveDrab", "#ffa500": "Orange", "#ff4500": "OrangeRed",
  "#da70d6": "Orchid", "#eee8aa": "PaleGoldenRod", "#98fb98": "PaleGreen", "#afeeee": "PaleTurquoise", "#db7093": "PaleVioletRed",
  "#ffefd5": "PapayaWhip", "#ffdab9": "PeachPuff", "#cd853f": "Peru", "#ffc0cb": "Pink", "#dda0dd": "Plum",
  "#b0e0e6": "PowderBlue", "#800080": "Purple", "#ff0000": "Red", "#bc8f8f": "RosyBrown", "#4169e1": "RoyalBlue",
  "#8b4513": "SaddleBrown", "#fa8072": "Salmon", "#f4a460": "SandyBrown", "#2e8b57": "SeaGreen", "#fff5ee": "SeaShell",
  "#a0522d": "Sienna", "#c0c0c0": "Silver", "#87ceeb": "SkyBlue", "#6a5acd": "SlateBlue", "#708090": "SlateGray",
  "#fffafa": "Snow", "#00ff7f": "SpringGreen", "#4682b4": "SteelBlue", "#d2b48c": "Tan", "#008080": "Teal",
  "#d8bfd8": "Thistle", "#ff6347": "Tomato", "#40e0d0": "Turquoise", "#ee82ee": "Violet", "#f5deb3": "Wheat",
  "#ffffff": "White", "#f5f5f5": "WhiteSmoke", "#ffff00": "Yellow", "#9acd32": "YellowGreen"
};