/**
 * Pre-baked gradient cache for color picker
 * 
 * This module generates and caches gradient images to avoid
 * expensive per-frame canvas computations.
 */

import { hslToRgb } from './colorUtils';

// Perceptual hue correction functions (copied from ColorPickerModal)
const perceptualToHue = (t: number): number => {
  if (t < 0.15) return t / 0.15 * 45;
  if (t < 0.30) return 45 + (t - 0.15) / 0.15 * 30;
  if (t < 0.45) return 75 + (t - 0.30) / 0.15 * 75;
  if (t < 0.60) return 150 + (t - 0.45) / 0.15 * 50;
  if (t < 0.80) return 200 + (t - 0.60) / 0.20 * 80;
  return 280 + (t - 0.80) / 0.20 * 80;
};

// Lightness curve parameters
const GAMMA_LIGHT = 0.7;
const GAMMA_DARK = 0.5;

const yToLightness = (yRatio: number): number => {
  if (yRatio <= 0.5) {
    return 100 - 50 * Math.pow(yRatio * 2, GAMMA_LIGHT);
  } else {
    return 50 * Math.pow((1 - yRatio) * 2, GAMMA_DARK);
  }
};

// Cache storage
let hueLightnessCache: Map<number, ImageData> = new Map();
let saturationCache: Map<string, ImageData> = new Map();

// Pre-bake configuration
const CACHE_WIDTH = 400;
const CACHE_HEIGHT = 100;
const SAT_CACHE_WIDTH = 24;
const SAT_CACHE_HEIGHT = 100;

/**
 * Generate Hue×Lightness gradient ImageData at a specific saturation
 */
export function generateHueLightnessGradient(
  width: number,
  height: number,
  saturation: number
): ImageData {
  const imageData = new ImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    const yRatio = y / height;
    const l = yToLightness(yRatio);

    for (let x = 0; x < width; x++) {
      const xRatio = x / width;
      const h = perceptualToHue(xRatio);
      const rgb = hslToRgb(h, saturation, l);

      const idx = (y * width + x) * 4;
      data[idx] = rgb.r;
      data[idx + 1] = rgb.g;
      data[idx + 2] = rgb.b;
      data[idx + 3] = 255;
    }
  }

  return imageData;
}

/**
 * Generate Saturation slider gradient ImageData
 */
export function generateSaturationGradient(
  width: number,
  height: number,
  hue: number,
  lightness: number
): ImageData {
  const imageData = new ImageData(width, height);
  const data = imageData.data;
  const gammaSat = 0.5;

  for (let y = 0; y < height; y++) {
    const yRatio = y / height;
    const s = 100 * Math.pow(1 - yRatio, gammaSat);
    const rgb = hslToRgb(hue, s, lightness);

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = rgb.r;
      data[idx + 1] = rgb.g;
      data[idx + 2] = rgb.b;
      data[idx + 3] = 255;
    }
  }

  return imageData;
}

/**
 * Get cached or generate Hue×Lightness gradients
 * Returns both saturated (S=100%) and grayscale (S=0%) versions
 */
export function getCachedHueLightnessGradients(
  width: number,
  height: number
): { saturated: ImageData; grayscale: ImageData } {
  if (!hueLightnessCache.has(100)) {
    hueLightnessCache.set(100, generateHueLightnessGradient(width, height, 100));
  }
  if (!hueLightnessCache.has(0)) {
    hueLightnessCache.set(0, generateHueLightnessGradient(width, height, 0));
  }
  
  return {
    saturated: hueLightnessCache.get(100)!,
    grayscale: hueLightnessCache.get(0)!
  };
}

/**
 * Pre-warm the cache on module load
 */
export function prewarmCache(): void {
  // Pre-generate both saturated and grayscale gradients
  getCachedHueLightnessGradients(CACHE_WIDTH, CACHE_HEIGHT);
}

/**
 * Clear all cached gradients (useful for memory cleanup)
 */
export function clearCache(): void {
  hueLightnessCache.clear();
  saturationCache.clear();
}

/**
 * Create a data URL from ImageData for use as CSS background
 */
export function imageDataToDataURL(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

// Auto-prewarm cache when module is imported
if (typeof window !== 'undefined') {
  // Defer prewarming to avoid blocking initial render
  requestIdleCallback?.(() => prewarmCache()) ?? setTimeout(prewarmCache, 100);
}
