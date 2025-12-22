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

  let minDistanceSq = Infinity;
  let closestColor = palette[0];
  const { r, g, b } = pixel; // Destructure once

  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    // Inline squared distance calculation to avoid function call overhead and sqrt
    let distSq = (r - color.r) ** 2 + (g - color.g) ** 2 + (b - color.b) ** 2;

    // Applying weight effectively means dealing with distance, so we square the weight for squared distance comparison
    if (color.id.startsWith('group-')) {
      // approximate: if we want to weight the distance, typically we multiply the distance.
      // d' = d * w => d'^2 = d^2 * w^2
      distSq *= (coreWeight * coreWeight);
    }

    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      closestColor = color;
    }
  }
  return closestColor;
};

export const blendColors = (c1: ColorRGB, c2: ColorRGB, ratio: number): ColorRGB => {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * ratio),
    g: Math.round(c1.g + (c2.g - c1.g) * ratio),
    b: Math.round(c1.b + (c2.b - c1.b) * ratio),
  };
};

export const applyMedianFilter = (imageData: ImageData, radius: number = 1): ImageData => {
  const { width, height, data } = imageData;
  const output = new ImageData(new Uint8ClampedArray(data), width, height);
  const outData = output.data;
  const windowSize = (2 * radius + 1) ** 2;
  const mid = Math.floor(windowSize / 2);

  // Reusable arrays to avoid allocation in loop
  const rs = new Uint8Array(windowSize);
  const gs = new Uint8Array(windowSize);
  const bs = new Uint8Array(windowSize);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;

        const yOffset = ny * width;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;

          const idx = (yOffset + nx) * 4;
          rs[count] = data[idx];
          gs[count] = data[idx + 1];
          bs[count] = data[idx + 2];
          count++;
        }
      }

      // Fill remaining if window was clipped (edge case), though usually we just sort valid pixels
      // For simplicity/speed on edges, we just use what we gathered.
      // A full quickselect is faster for variable sizes, but for small fixed kernels (3x3, 5x5),
      // a simple sort is often acceptable if we avoid array creation overhead.
      // Since 'count' < windowSize at edges, we sort only the valid portion.

      const validRs = rs.subarray(0, count).sort();
      const validGs = gs.subarray(0, count).sort();
      const validBs = bs.subarray(0, count).sort();
      const midIdx = Math.floor(count / 2);

      const outIdx = (y * width + x) * 4;
      outData[outIdx] = validRs[midIdx];
      outData[outIdx + 1] = validGs[midIdx];
      outData[outIdx + 2] = validBs[midIdx];
      outData[outIdx + 3] = data[outIdx + 3]; // Preserve alpha
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

  return processFrequencyMap(frequencyMap, totalSamples, distanceThreshold);
};

export const extractSvgColors = (svgContent: string): ExtractionResult => {
  const frequencyMap: Record<string, number> = {};
  let totalSamples = 0;

  // 1. Find all Hex colors
  const hexRegex = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
  let match;
  while ((match = hexRegex.exec(svgContent)) !== null) {
    let hex = match[0].toLowerCase();
    if (hex.length === 4) { // #abc -> #aabbcc
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    frequencyMap[hex] = (frequencyMap[hex] || 0) + 1;
    totalSamples++;
  }

  // 2. Find all rgb colors
  const rgbRegex = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;
  while ((match = rgbRegex.exec(svgContent)) !== null) {
    const hex = rgbToHex(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    frequencyMap[hex] = (frequencyMap[hex] || 0) + 1;
    totalSamples++;
  }

  // 3. Find named colors
  const nameToHex: Record<string, string> = {};
  for (const [hex, name] of Object.entries(HTML_COLORS)) {
    nameToHex[name.toLowerCase()] = hex;
  }

  const colorAttrRegex = /(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?([a-zA-Z]+)["']?/g;
  while ((match = colorAttrRegex.exec(svgContent)) !== null) {
    const name = match[1].toLowerCase();
    if (nameToHex[name]) {
      const hex = nameToHex[name];
      frequencyMap[hex] = (frequencyMap[hex] || 0) + 1;
      totalSamples++;
    }
  }

  // For SVGs, we use a much tighter distance threshold as colors are usually intentional
  return processFrequencyMap(frequencyMap, totalSamples, 15);
};

const processFrequencyMap = (frequencyMap: Record<string, number>, totalSamples: number, distanceThreshold: number): ExtractionResult => {
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

  // Post-process groups to calculate percentages and representative scores
  for (const group of groups) {
    // Calculate percentages
    for (const member of group.members) {
      member.percentage = (member.count / group.totalCount) * 100;
    }

    // Calculate representative score for each member
    // Score = Sum over all members j of (member[j].count / (1 + distance_ij))
    for (let i = 0; i < group.members.length; i++) {
      let score = 0;
      const mI = group.members[i];
      for (let j = 0; j < group.members.length; j++) {
        const mJ = group.members[j];
        const dist = getColorDistance(mI.rgb, mJ.rgb);
        // We use a weighted contribution: frequency of j weighted by proximity to i
        // This favors dense areas and high frequency.
        score += mJ.count / (1 + dist);
      }
      mI.score = score;
    }

    // Sort members by score descending
    group.members.sort((a, b) => (b.score || 0) - (a.score || 0));
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

export const recolorSvg = (svgContent: string, colorGroups: ColorGroup[], colorOverrides: Record<string, string>): string => {
  // Create a mapping from any found color string to its new target hex
  const colorToTarget: Record<string, string> = {};

  for (const group of colorGroups) {
    const target = colorOverrides[group.id];
    if (target) {
      for (const member of group.members) {
        colorToTarget[member.hex.toLowerCase()] = target;
      }
    }
  }

  // Replace hex colors
  let newSvg = svgContent.replace(/#(?:[0-9a-fA-F]{3}){1,2}\b/g, (match) => {
    let hex = match.toLowerCase();
    if (hex.length === 4) {
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    return colorToTarget[hex] || match;
  });

  // Replace rgb colors
  newSvg = newSvg.replace(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, (match, r, g, b) => {
    const hex = rgbToHex(parseInt(r), parseInt(g), parseInt(b));
    return colorToTarget[hex] || match;
  });

  // Replace named colors
  const nameToHex: Record<string, string> = {};
  for (const [hex, name] of Object.entries(HTML_COLORS)) {
    nameToHex[name.toLowerCase()] = hex;
  }

  newSvg = newSvg.replace(/((?:fill|stroke|stop-color|color)\s*[:=]\s*["']?)([a-zA-Z]+)(["']?)/g, (match, prefix, name, suffix) => {
    const hex = nameToHex[name.toLowerCase()];
    if (hex && colorToTarget[hex]) {
      return prefix + colorToTarget[hex] + suffix;
    }
    return match;
  });

  return newSvg;
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