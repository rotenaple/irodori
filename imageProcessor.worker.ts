import { PaletteColor, ColorRGB, WorkerMessage, RecolorMode, TintSettings } from './types';
import {
    rgbToHex,
    hexToRgb,
    findClosestColor,
    blendColors,
    sigmoidSnap,
    applyMedianFilter,
    getColorDistance,
    rgbToHsl,
    hslToRgb,
    getHueDifference,
    shiftHue,
    calculateGroupBaseHue
} from './utils/colorUtils';

/**
 * Apply tint to an RGB color with full HSL adjustments and individual force values.
 * @param r - Red component (0-255)
 * @param g - Green component (0-255)
 * @param b - Blue component (0-255)
 * @param baseHue - The reference hue of the color group (0-360)
 * @param tint - The tint settings (hue, saturation shift, lightness shift, individual forces)
 * @returns The tinted color as RGB
 */
function applyTintRGB(r: number, g: number, b: number, baseHue: number, tint: TintSettings): ColorRGB {
    const hsl = rgbToHsl(r, g, b);

    // For achromatic colors (very low saturation), only apply lightness adjustment
    if (hsl.s < 5) {
        const lForce = tint.lightnessForce / 100;
        const adjustedL = Math.max(0, Math.min(100, hsl.l + tint.lightness * lForce));
        return hslToRgb(hsl.h, hsl.s, adjustedL);
    }

    // Calculate the hue offset from the group's base hue
    const hueOffset = getHueDifference(baseHue, hsl.h);

    // Apply the same offset to the target hue
    const targetHue = shiftHue(tint.hue, hueOffset);

    // Apply individual force values for H, S, L
    const hForce = tint.hueForce / 100;
    const sForce = tint.saturationForce / 100;
    const lForce = tint.lightnessForce / 100;

    // Blend hue based on hueForce
    const newHue = hForce < 1 ? hsl.h + (targetHue - hsl.h) * hForce : targetHue;

    // Apply saturation shift with saturationForce
    const saturationShift = tint.saturation * sForce;
    const newS = Math.max(0, Math.min(100, hsl.s + saturationShift));

    // Apply lightness shift with lightnessForce
    const lightnessShift = tint.lightness * lForce;
    const newL = Math.max(0, Math.min(100, hsl.l + lightnessShift));

    return hslToRgb(newHue, newS, newL);
}

/**
 * Finds the optimal quality for a given format using binary search.
 * Returns the blob and quality that fits within the target size.
 */
async function findOptimalQuality(
    canvas: OffscreenCanvas,
    format: string,
    targetSize: number,
    minQuality: number = 0.5,
    maxQuality: number = 1.0
): Promise<{ blob: Blob | null; quality: number }> {
    let bestBlob: Blob | null = null;
    let bestQuality = minQuality;
    let low = minQuality;
    let high = maxQuality;
    const tolerance = 0.01; // Higher precision for better quality

    while (high - low > tolerance) {
        const mid = (low + high) / 2;
        const testBlob = await canvas.convertToBlob({
            type: format,
            quality: mid
        });

        if (testBlob.size <= targetSize) {
            // This quality works, try higher
            bestBlob = testBlob;
            bestQuality = mid;
            low = mid;
        } else {
            // Too large, try lower quality
            high = mid;
        }
    }

    return { blob: bestBlob, quality: bestQuality };
}

/**
 * Intelligently compresses an image to fit within the target size limit.
 * For nationstates.net compatibility, tries PNG (preferred), GIF, and JPEG formats.
 * Prioritizes PNG for lossless quality, then GIF for flag-style images.
 */
async function intelligentCompress(
    canvas: OffscreenCanvas,
    isAutoMode: boolean
): Promise<Blob> {
    const TARGET_SIZE = 150 * 1024; // 150KB in bytes

    if (!isAutoMode) {
        // For non-auto modes, use PNG without compression
        return await canvas.convertToBlob({ type: 'image/png' });
    }

    // Try PNG first - it's lossless, so if it fits, it's the best choice for flags
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });

    if (pngBlob.size <= TARGET_SIZE) {
        return pngBlob;
    }

    // PNG is too large, try other formats
    let bestBlob: Blob = pngBlob;
    let bestFormat = 'png';

    // Try GIF - good for flag-style images with limited colors, avoids JPEG artifacts
    try {
        const gifBlob = await canvas.convertToBlob({ type: 'image/gif' });
        if (gifBlob.size <= TARGET_SIZE) {
            // GIF fits and is lossless for images with limited colors
            bestBlob = gifBlob;
            bestFormat = 'gif';
        }
    } catch (e) {
        // GIF encoding might not be supported in all environments
    }

    // Only try JPEG as last resort - JPEG creates artifacts on flag-style images
    if (bestFormat === 'png') {
        const jpegResult = await findOptimalQuality(canvas, 'image/jpeg', TARGET_SIZE, 0.5, 1.0);
        if (jpegResult.blob && jpegResult.blob.size <= TARGET_SIZE) {
            bestBlob = jpegResult.blob;
            bestFormat = 'jpeg';
        }
    }

    return bestBlob;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    if (e.data.type !== 'process') return;

    const { imageBitmap, parameters } = e.data;
    const {
        upscaleFactor,
        denoiseRadius,
        edgeProtection,
        vertexInertia,
        disablePostProcessing,
        disableRecoloring,
        disableScaling,
        palette,
        smoothingLevels,
        alphaSmoothness,
        preserveTransparency,
        pixelArtConfig,
        recolorMode,
        tintOverrides
    } = parameters;

    try {
        const nativeWidth = imageBitmap.width;
        const nativeHeight = imageBitmap.height;

        // PIXEL ART MODE - Handle separately with different processing
        if (pixelArtConfig?.enabled) {
            const { pixelWidth, pixelHeight, offsetX, offsetY } = pixelArtConfig;

            // Calculate pixelated dimensions
            const pixelCols = Math.ceil(nativeWidth / pixelWidth);
            const pixelRows = Math.ceil(nativeHeight / pixelHeight);

            // Create canvas at native resolution for sampling
            const sourceCanvas = new OffscreenCanvas(nativeWidth, nativeHeight);
            const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
            if (!sourceCtx) throw new Error("Could not get source context");
            sourceCtx.imageSmoothingEnabled = false; // Disable antialiasing
            sourceCtx.drawImage(imageBitmap, 0, 0);
            const sourceData = sourceCtx.getImageData(0, 0, nativeWidth, nativeHeight);

            // Create pixelated canvas
            const pixelCanvas = new OffscreenCanvas(pixelCols, pixelRows);
            const pixelCtx = pixelCanvas.getContext('2d');
            if (!pixelCtx) throw new Error("Could not get pixel context");
            const pixelImageData = pixelCtx.createImageData(pixelCols, pixelRows);

            // Sample majority color for each pixel block
            for (let py = 0; py < pixelRows; py++) {
                for (let px = 0; px < pixelCols; px++) {
                    const colorCounts = new Map<string, { count: number; r: number; g: number; b: number; a: number }>();

                    // Sample all pixels in this block with offset
                    // Clamp coordinates to stay within image bounds to avoid sampling undefined pixels
                    const startX = Math.max(0, Math.min(px * pixelWidth + offsetX, nativeWidth - 1));
                    const startY = Math.max(0, Math.min(py * pixelHeight + offsetY, nativeHeight - 1));
                    const endX = Math.max(0, Math.min(startX + pixelWidth, nativeWidth));
                    const endY = Math.max(0, Math.min(startY + pixelHeight, nativeHeight));

                    for (let sy = startY; sy < endY; sy++) {
                        for (let sx = startX; sx < endX; sx++) {
                            const idx = (sy * nativeWidth + sx) * 4;
                            const r = sourceData.data[idx];
                            const g = sourceData.data[idx + 1];
                            const b = sourceData.data[idx + 2];
                            const a = sourceData.data[idx + 3];

                            const key = `${r},${g},${b},${a}`;
                            const existing = colorCounts.get(key);
                            if (existing) {
                                existing.count++;
                            } else {
                                colorCounts.set(key, { count: 1, r, g, b, a });
                            }
                        }
                    }

                    // Find majority color
                    let maxCount = 0;
                    let majorityColor = { r: 0, g: 0, b: 0, a: 255 };
                    for (const color of colorCounts.values()) {
                        if (color.count > maxCount) {
                            maxCount = color.count;
                            majorityColor = color;
                        }
                    }

                    // Apply recoloring if enabled
                    let finalColor = majorityColor;
                    if (!disableRecoloring && palette.length > 0) {
                        // Find closest palette color to determine which group this pixel belongs to
                        const sourceRGB = { r: majorityColor.r, g: majorityColor.g, b: majorityColor.b };
                        const closest = findClosestColor(sourceRGB, palette);

                        if (recolorMode === 'tint' && tintOverrides) {
                            // Tint mode: apply tint if set, otherwise keep original color
                            const tint = tintOverrides[closest.id];
                            if (tint !== undefined) {
                                // Get base hue for the group
                                const group = parameters.colorGroups?.find(g => g.id === closest.id);
                                const baseHue = group?.baseHue ?? 0;
                                const tinted = applyTintRGB(majorityColor.r, majorityColor.g, majorityColor.b, baseHue, tint);
                                finalColor = { ...tinted, a: majorityColor.a };
                            }
                            // If no tint override, keep original color (finalColor = majorityColor)
                        } else {
                            // Palette mode: use target color if set, otherwise use the matched source color from palette
                            if (closest.targetHex) {
                                const targetRGB = hexToRgb(closest.targetHex);
                                if (targetRGB) {
                                    finalColor = { ...targetRGB, a: majorityColor.a }; // Recolor to target
                                }
                            } else {
                                // Use the matched palette color (closest.r/g/b are the source color)
                                finalColor = { r: closest.r, g: closest.g, b: closest.b, a: majorityColor.a };
                            }
                        }
                    }

                    // Set pixel color
                    const pixelIdx = (py * pixelCols + px) * 4;
                    pixelImageData.data[pixelIdx] = finalColor.r;
                    pixelImageData.data[pixelIdx + 1] = finalColor.g;
                    pixelImageData.data[pixelIdx + 2] = finalColor.b;
                    pixelImageData.data[pixelIdx + 3] = preserveTransparency ? finalColor.a : 255;
                }
            }

            pixelCtx.putImageData(pixelImageData, 0, 0);

            // Determine integer upscale factor - find largest integer that fits in target
            let finalScale = 1;
            if (!disableScaling) {
                let targetWidth: number;
                let targetHeight: number;

                if (upscaleFactor === 'NS') {
                    // Auto-scale to fit NationStates dimensions
                    const isLandscape = nativeWidth >= nativeHeight;
                    targetWidth = isLandscape ? 535 : 321;
                    targetHeight = isLandscape ? 355 : 568;
                } else {
                    // Use upscale factor as maximum dimension multiplier
                    const scale = upscaleFactor as number;
                    targetWidth = nativeWidth * scale;
                    targetHeight = nativeHeight * scale;
                }

                // Find largest integer scale that fits within target dimensions
                const maxScaleX = Math.floor(targetWidth / pixelCols);
                const maxScaleY = Math.floor(targetHeight / pixelRows);
                finalScale = Math.max(1, Math.min(maxScaleX, maxScaleY));
            }

            // Create final canvas with nearest-neighbor scaling (no smoothing)
            const finalWidth = pixelCols * finalScale;
            const finalHeight = pixelRows * finalScale;
            const finalCanvas = new OffscreenCanvas(finalWidth, finalHeight);
            const finalCtx = finalCanvas.getContext('2d');
            if (!finalCtx) throw new Error("Could not get final context");

            finalCtx.imageSmoothingEnabled = false; // Critical for pixel art
            finalCtx.drawImage(pixelCanvas, 0, 0, finalWidth, finalHeight);

            const blob = await intelligentCompress(finalCanvas, upscaleFactor === 'NS');
            self.postMessage({ type: 'complete', result: blob });
            return;
        }

        // determine target scale
        let targetUpscale = 1;
        if (!disableScaling) {
            if (upscaleFactor === 'NS') {
                // Check if the image is Horizontal (Landscape) or Vertical (Portrait)
                const isLandscape = nativeWidth >= nativeHeight;

                if (isLandscape) {
                    // Horizontal: Fit into 535x355
                    targetUpscale = Math.min(535 / nativeWidth, 355 / nativeHeight);
                } else {
                    // Vertical: Fit into 321x568
                    targetUpscale = Math.min(321 / nativeWidth, 568 / nativeHeight);
                }
            } else {
                targetUpscale = upscaleFactor as number;
            }
        }

        const nativeCanvas = new OffscreenCanvas(nativeWidth, nativeHeight);
        const nCtx = nativeCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
        if (!nCtx) throw new Error("Could not get native context");

        nCtx.drawImage(imageBitmap, 0, 0);

        // Denoise (Part of Post-Processing)
        if (!disablePostProcessing && denoiseRadius > 0) {
            const baseData = nCtx.getImageData(0, 0, nativeWidth, nativeHeight);
            const denoisedData = applyMedianFilter(baseData, denoiseRadius);
            nCtx.putImageData(denoisedData, 0, 0);
        }

        // If Recoloring is disabled, we skip the palette matching / cleanup entirely
        // and just upscale the (possibly denoised) native image.
        if (disableRecoloring) {
            const finalW = Math.round(nativeWidth * targetUpscale);
            const finalH = Math.round(nativeHeight * targetUpscale);

            const finalCanvas = new OffscreenCanvas(finalW, finalH);
            const fCtx = finalCanvas.getContext('2d');
            if (!fCtx) throw new Error("Could not get final context");

            fCtx.imageSmoothingEnabled = true;
            fCtx.imageSmoothingQuality = 'high';
            fCtx.drawImage(nativeCanvas, 0, 0, finalW, finalH);

            const blob = await intelligentCompress(finalCanvas, upscaleFactor === 'NS');
            self.postMessage({ type: 'complete', result: blob });
            return;
        }

        const matchPalette = palette;

        // --- PHASE 1: LOW-RES SOLVE (Original Resolution) ---
        const nativePixelData = nCtx.getImageData(0, 0, nativeWidth, nativeHeight).data;
        let lowResIdxMap = new Int16Array(nativeWidth * nativeHeight);

        // Store original alpha channel at native resolution for nearest-neighbor lookup
        let nativeAlpha: Uint8ClampedArray | null = null;
        if (preserveTransparency) {
            nativeAlpha = new Uint8ClampedArray(nativeWidth * nativeHeight);
            for (let i = 0; i < nativePixelData.length; i += 4) {
                nativeAlpha[i / 4] = nativePixelData[i + 3];
            }
        }

        // 1. Setup Maps for Fast Lookup
        // We use a map to link specific hex codes directly to a palette index.
        // This ensures the user's manual groupings override mathematical distance.
        const colorToGroupIdx = new Map<string, number>();
        const paletteIdMap = new Map<string, number>();

        // Pre-cache palette colors in arrays for faster access
        const paletteSize = matchPalette.length;
        const paletteR = new Uint8Array(paletteSize);
        const paletteG = new Uint8Array(paletteSize);
        const paletteB = new Uint8Array(paletteSize);
        const paletteIds = new Array<string>(paletteSize);

        // Create quick lookup: Palette ID -> Index in matchPalette array
        for (let idx = 0; idx < paletteSize; idx++) {
            const p = matchPalette[idx];
            paletteIdMap.set(p.id, idx);
            paletteR[idx] = p.r;
            paletteG[idx] = p.g;
            paletteB[idx] = p.b;
            paletteIds[idx] = p.id;
        }

        // 2. Populate Group Mappings (Priority: Explicit Group Members)
        // Accessing parameters.colorGroups ensures we see all members currently assigned in the UI
        if (parameters.colorGroups) {
            for (let i = 0; i < parameters.colorGroups.length; i++) {
                const group = parameters.colorGroups[i];
                const pIdx = paletteIdMap.get(group.id);
                // Only if the group is actually part of the active palette (enabled)
                if (pIdx !== undefined) {
                    for (let j = 0; j < group.members.length; j++) {
                        colorToGroupIdx.set(group.members[j].hex.toLowerCase(), pIdx);
                    }
                }
            }
        }

        // 3. Ensure Palette Heads are mapped (Secondary)
        // This handles manual layers or colors that might not be in the 'members' list (e.g. initial seeds)
        for (let idx = 0; idx < paletteSize; idx++) {
            const hex = matchPalette[idx].hex.toLowerCase();
            if (!colorToGroupIdx.has(hex)) {
                colorToGroupIdx.set(hex, idx);
            }
        }

        // 4. Pixel Loop - Optimized with cached palette arrays
        for (let i = 0; i < nativePixelData.length; i += 4) {
            const r = nativePixelData[i];
            const g = nativePixelData[i + 1];
            const b = nativePixelData[i + 2];
            const hex = rgbToHex(r, g, b); // Ensure this util returns compatible hex (e.g. lowercase)

            // Step A: Check if this specific color is explicitly grouped
            let pIdx = colorToGroupIdx.get(hex);

            // Step B: If not in a group, fall back to Nearest Neighbor logic (optimized inline)
            if (pIdx === undefined) {
                let minDistSq = Infinity;
                let closestIdx = 0;

                // Inline distance calculation using cached arrays
                for (let j = 0; j < paletteSize; j++) {
                    const dr = r - paletteR[j];
                    const dg = g - paletteG[j];
                    const db = b - paletteB[j];
                    const distSq = dr * dr + dg * dg + db * db;

                    if (distSq < minDistSq) {
                        minDistSq = distSq;
                        closestIdx = j;
                    }
                }
                pIdx = closestIdx;
            }

            lowResIdxMap[i / 4] = pIdx;
        }

        // Determine effective parameters
        const effectiveEdgeProtection = disablePostProcessing ? 0 : edgeProtection;
        const effectiveSmoothingLevels = disablePostProcessing ? 0 : smoothingLevels;

        // --- PHASE 2: LOW-RES BLEED GUARD (Edge Protection at 1x) ---
        if (effectiveEdgeProtection > 0) {
            // BALANCED RADIUS SCALING:
            // Scaled to a max of 5x5 to protect thin 1px lines/details.
            let radius = Math.max(1, Math.round((effectiveEdgeProtection / 100) * 3));
            let iterations = Math.max(1, Math.round((effectiveEdgeProtection / 100) * 4));
            if (effectiveEdgeProtection > 66) { radius = 3; iterations = 3; }
            if (effectiveEdgeProtection > 85) { radius = 5; iterations = 5; }

            const tempIdxMap = new Int16Array(lowResIdxMap.length);
            const localCounts = new Uint32Array(paletteSize);

            for (let iter = 0; iter < iterations; iter++) {
                for (let y = 0; y < nativeHeight; y++) {
                    const yStart = Math.max(0, y - radius);
                    const yEnd = Math.min(nativeHeight - 1, y + radius);
                    const rowOffset = y * nativeWidth;

                    for (let x = 0; x < nativeWidth; x++) {
                        const xStart = Math.max(0, x - radius);
                        const xEnd = Math.min(nativeWidth - 1, x + radius);

                        const idx = rowOffset + x;
                        const currentIdx = lowResIdxMap[idx];
                        const sIdx = idx * 4;
                        const srcR = nativePixelData[sIdx];
                        const srcG = nativePixelData[sIdx + 1];
                        const srcB = nativePixelData[sIdx + 2];

                        // Count local palette indices (use Uint32Array to prevent overflow)
                        localCounts.fill(0);
                        for (let ny = yStart; ny <= yEnd; ny++) {
                            const nyOffset = ny * nativeWidth;
                            for (let nx = xStart; nx <= xEnd; nx++) {
                                const nIdx = lowResIdxMap[nyOffset + nx];
                                localCounts[nIdx]++;
                            }
                        }

                        // 2. Identify candidates - find top 3 by count
                        let major1Idx = 0, major1Count = 0;
                        let major2Idx = 0, major2Count = 0;
                        let m3 = 0, m3Count = 0;

                        for (let i = 0; i < paletteSize; i++) {
                            const count = localCounts[i];
                            if (count > major1Count) {
                                m3 = major2Idx; m3Count = major2Count;
                                major2Idx = major1Idx; major2Count = major1Count;
                                major1Idx = i; major1Count = count;
                            } else if (count > major2Count) {
                                m3 = major2Idx; m3Count = major2Count;
                                major2Idx = i; major2Count = count;
                            } else if (count > m3Count) {
                                m3 = i; m3Count = count;
                            }
                        }

                        // BETWEENNESS FILTER:
                        if (major1Idx !== major2Idx && major2Idx !== m3) {
                            const p1r = paletteR[major1Idx], p1g = paletteG[major1Idx], p1b = paletteB[major1Idx];
                            const p2r = paletteR[major2Idx], p2g = paletteG[major2Idx], p2b = paletteB[major2Idx];
                            const p3r = paletteR[m3], p3g = paletteG[m3], p3b = paletteB[m3];

                            const d13 = Math.sqrt((p1r - p3r) ** 2 + (p1g - p3g) ** 2 + (p1b - p3b) ** 2);
                            const d12 = Math.sqrt((p1r - p2r) ** 2 + (p1g - p2g) ** 2 + (p1b - p2b) ** 2);
                            const d23 = Math.sqrt((p3r - p2r) ** 2 + (p3g - p2g) ** 2 + (p3b - p2b) ** 2);
                            if (d12 + d23 < d13 * 1.10) { major2Idx = m3; major2Count = m3Count; }
                        }

                        // REPRESENTATION FILTER (SAFE 10%):
                        // Only "melt" if the shape is truly tiny/isolated noise.
                        const totalWindow = (yEnd - yStart + 1) * (xEnd - xStart + 1);
                        if (major2Count < totalWindow * 0.10) { major2Idx = major1Idx; }

                        // 3. Topology cleaning:
                        if (currentIdx !== major1Idx && currentIdx !== major2Idx) {
                            const pCr = paletteR[currentIdx], pCg = paletteG[currentIdx], pCb = paletteB[currentIdx];
                            const p1r = paletteR[major1Idx], p1g = paletteG[major1Idx], p1b = paletteB[major1Idx];
                            const p2r = paletteR[major2Idx], p2g = paletteG[major2Idx], p2b = paletteB[major2Idx];
                            const d1 = (pCr - p1r) ** 2 + (pCg - p1g) ** 2 + (pCb - p1b) ** 2;
                            const d2 = (pCr - p2r) ** 2 + (pCg - p2g) ** 2 + (pCb - p2b) ** 2;
                            tempIdxMap[idx] = d1 < d2 ? major1Idx : major2Idx;
                            continue;
                        }

                        // 4. Resolve between majors - Source Similarity Multiplier
                        const p1r = paletteR[major1Idx], p1g = paletteG[major1Idx], p1b = paletteB[major1Idx];
                        const p2r = paletteR[major2Idx], p2g = paletteG[major2Idx], p2b = paletteB[major2Idx];
                        let err1 = (srcR - p1r) ** 2 + (srcG - p1g) ** 2 + (srcB - p1b) ** 2;
                        let err2 = (srcR - p2r) ** 2 + (srcG - p2g) ** 2 + (srcB - p2b) ** 2;

                        const stiffness = 1.0 - (vertexInertia / 100) * 0.8;
                        if (currentIdx === major1Idx) err1 *= stiffness;
                        if (currentIdx === major2Idx) err2 *= stiffness;

                        tempIdxMap[idx] = err1 < err2 ? major1Idx : major2Idx;
                    }
                }
                lowResIdxMap.set(tempIdxMap);
            }
        }

        // --- PHASE 3: HIGH-RES RECONSTRUCTION (Edge-Optimized) ---
        const workspaceScale = targetUpscale * 4;
        const workspaceWidth = Math.round(nativeWidth * workspaceScale);
        const workspaceHeight = Math.round(nativeHeight * workspaceScale);

        const MAX_PIXELS = 10000000;
        const currentPixels = workspaceWidth * workspaceHeight;
        const safeScale = currentPixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (nativeWidth * nativeHeight)) : workspaceScale;

        const finalWorkspaceWidth = Math.round(nativeWidth * safeScale);
        const finalWorkspaceHeight = Math.round(nativeHeight * safeScale);

        const workspaceCanvas = new OffscreenCanvas(finalWorkspaceWidth, finalWorkspaceHeight);
        const wCtx = workspaceCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
        if (!wCtx) throw new Error("Could not get workspace context");

        wCtx.imageSmoothingEnabled = true;
        wCtx.imageSmoothingQuality = 'high';
        wCtx.drawImage(nativeCanvas, 0, 0, finalWorkspaceWidth, finalWorkspaceHeight);

        const highResPixelData = wCtx.getImageData(0, 0, finalWorkspaceWidth, finalWorkspaceHeight).data;
        const outputData = new Uint8ClampedArray(highResPixelData.length);

        const scaleX = finalWorkspaceWidth / nativeWidth;
        const scaleY = finalWorkspaceHeight / nativeHeight;

        // Pre-cache targetHex conversions for all palette colors (palette mode)
        const paletteTargetR = new Uint8Array(paletteSize);
        const paletteTargetG = new Uint8Array(paletteSize);
        const paletteTargetB = new Uint8Array(paletteSize);

        // Pre-cache base hues and tint settings for tint mode
        const paletteBaseHue = new Float32Array(paletteSize);
        const paletteTintSettings: (TintSettings | null)[] = new Array(paletteSize).fill(null);
        const paletteHasTint = new Uint8Array(paletteSize); // 1 if this palette entry has a tint override

        const isTintMode = recolorMode === 'tint' && tintOverrides;

        for (let i = 0; i < paletteSize; i++) {
            const p = matchPalette[i];

            if (isTintMode) {
                // Tint mode: cache base hue and tint settings
                const tint = tintOverrides![p.id];
                if (tint !== undefined) {
                    const group = parameters.colorGroups?.find(g => g.id === p.id);
                    paletteBaseHue[i] = group?.baseHue ?? 0;
                    paletteTintSettings[i] = tint;
                    paletteHasTint[i] = 1;
                } else {
                    paletteHasTint[i] = 0;
                }
                // Still cache palette colors for non-tinted groups
                paletteTargetR[i] = paletteR[i];
                paletteTargetG[i] = paletteG[i];
                paletteTargetB[i] = paletteB[i];
            } else {
                // Palette mode: direct color replacement
                if (p.targetHex) {
                    const rgb = hexToRgb(p.targetHex);
                    if (rgb) {
                        paletteTargetR[i] = rgb.r;
                        paletteTargetG[i] = rgb.g;
                        paletteTargetB[i] = rgb.b;
                    } else {
                        paletteTargetR[i] = paletteR[i];
                        paletteTargetG[i] = paletteG[i];
                        paletteTargetB[i] = paletteB[i];
                    }
                } else {
                    // If no targetHex, use the source color (paletteR/G/B)
                    paletteTargetR[i] = paletteR[i];
                    paletteTargetG[i] = paletteG[i];
                    paletteTargetB[i] = paletteB[i];
                }
            }
        }

        // Pre-allocate reusable arrays for pixel loop to reduce allocations
        const reuseLocalWeights = new Float32Array(paletteSize);
        const reuseAdjWhitelist = new Uint8Array(paletteSize);
        const reuseScores = new Float32Array(paletteSize);

        for (let y = 0; y < finalWorkspaceHeight; y++) {
            // Pre-calculate Y neighbors
            const ly = Math.min(nativeHeight - 1, Math.floor(y / scaleY));
            const lyOffset = ly * nativeWidth;

            for (let x = 0; x < finalWorkspaceWidth; x++) {
                const lx = Math.min(nativeWidth - 1, Math.floor(x / scaleX));
                const idx = y * finalWorkspaceWidth + x;
                const outIdx = idx * 4;

                const refR = highResPixelData[outIdx];
                const refG = highResPixelData[outIdx + 1];
                const refB = highResPixelData[outIdx + 2];

                // 1. Regularize the local candidates list (Expand to 5x5)
                const yMin = Math.max(0, ly - 2);
                const yMax = Math.min(nativeHeight - 1, ly + 2);
                const xMin = Math.max(0, lx - 2);
                const xMax = Math.min(nativeWidth - 1, lx + 2);

                // Reuse typed array instead of allocating new one - clear it first
                reuseLocalWeights.fill(0);
                for (let ny = yMin; ny <= yMax; ny++) {
                    const dy = Math.abs(ny - ly);
                    const nyOffset = ny * nativeWidth;
                    for (let nx = xMin; nx <= xMax; nx++) {
                        const dx = Math.abs(nx - lx);
                        const nIdx = lowResIdxMap[nyOffset + nx];

                        // GAUSSIAN WEIGHTING:
                        // Center = 1.0, 1px away = 0.5, 2px away = 0.2
                        let weight = 1.0;
                        if (dx > 0 || dy > 0) weight = 0.5;
                        if (dx > 1 || dy > 1) weight = 0.2;

                        reuseLocalWeights[nIdx] += weight;
                    }
                }

                // 1. Identify all unique candidates in the neighborhood
                const uniqueCandidates: number[] = [];
                for (let i = 0; i < paletteSize; i++) {
                    if (reuseLocalWeights[i] > 0) uniqueCandidates.push(i);
                }

                // 2. STRUCTURAL FILTER (ARTIFACT REJECTION):
                // If a color in the neighborhood is mathematically a "Between" color 
                // of two other colors IN THE SAME neighborhood, it is an artifact (anti-aliasing).
                // We reject it from being a blend partner.
                const structuralCandidates: number[] = [];
                const ucLen = uniqueCandidates.length;

                candidateLoop: for (let ci = 0; ci < ucLen; ci++) {
                    const cIdx = uniqueCandidates[ci];
                    const pCr = paletteR[cIdx];
                    const pCg = paletteG[cIdx];
                    const pCb = paletteB[cIdx];
                    const weightC = reuseLocalWeights[cIdx];

                    for (let ai = 0; ai < ucLen; ai++) {
                        const aIdx = uniqueCandidates[ai];
                        if (aIdx === cIdx) continue;

                        for (let bi = 0; bi < ucLen; bi++) {
                            const bIdx = uniqueCandidates[bi];
                            if (bIdx === cIdx || aIdx === bIdx) continue;

                            const pAr = paletteR[aIdx];
                            const pAg = paletteG[aIdx];
                            const pAb = paletteB[aIdx];
                            const pBr = paletteR[bIdx];
                            const pBg = paletteG[bIdx];
                            const pBb = paletteB[bIdx];
                            const weightA = reuseLocalWeights[aIdx];
                            const weightB = reuseLocalWeights[bIdx];

                            const dAB = Math.sqrt((pAr - pBr) ** 2 + (pAg - pBg) ** 2 + (pAb - pBb) ** 2);
                            const dAC = Math.sqrt((pAr - pCr) ** 2 + (pAg - pCg) ** 2 + (pAb - pCb) ** 2);
                            const dBC = Math.sqrt((pBr - pCr) ** 2 + (pBg - pCg) ** 2 + (pBb - pCb) ** 2);

                            // RULE: Reject C if it's between A and B, AND A and B are both 'stronger' shapes in context.
                            // Increased tolerance to 1.10 to catch JPG noise.
                            if (dAC + dBC < dAB * 1.10 && dAB > 10) {
                                if (weightA > weightC && weightB > weightC) {
                                    continue candidateLoop; // Transitional artifact detected
                                }
                            }
                        }
                    }
                    structuralCandidates.push(cIdx);
                }
                // 3. Identify the STRUCTURAL MAJORS (with Adjacency Gating)
                // Any color not in the immediate 3x3 is hit with a massive penalty.
                reuseAdjWhitelist.fill(0); // Clear from previous iteration
                const y3Min = Math.max(0, ly - 1);
                const y3Max = Math.min(nativeHeight - 1, ly + 1);
                const x3Min = Math.max(0, lx - 1);
                const x3Max = Math.min(nativeWidth - 1, lx + 1);
                for (let ny = y3Min; ny <= y3Max; ny++) {
                    const nyOffset = ny * nativeWidth;
                    for (let nx = x3Min; nx <= x3Max; nx++) {
                        reuseAdjWhitelist[lowResIdxMap[nyOffset + nx]] = 1;
                    }
                }

                // Score structural candidates - reuse array
                const scLen = structuralCandidates.length;
                let maxScore = -Infinity;
                let maxIdx = 0;

                for (let i = 0; i < scLen; i++) {
                    const cIdx = structuralCandidates[i];
                    const pR = paletteR[cIdx];
                    const pG = paletteG[cIdx];
                    const pB = paletteB[cIdx];
                    const weight = reuseLocalWeights[cIdx];
                    const dr = refR - pR;
                    const dg = refG - pG;
                    const db = refB - pB;
                    const err = dr * dr + dg * dg + db * db;

                    // ADJACENCY GATING: Hard penalty for non-touching colors.
                    const gatingPenalty = reuseAdjWhitelist[cIdx] ? 0 : -1000;

                    // Score = Mass weight + Adjacency Gate + Error penalty
                    const score = (weight * 10) + gatingPenalty - Math.sqrt(err);
                    reuseScores[i] = score;
                    if (score > maxScore) {
                        maxScore = score;
                        maxIdx = i;
                    }
                }

                // Find top 2 by score
                let major1Idx = scLen > 0 ? structuralCandidates[maxIdx] : uniqueCandidates[0];
                let major2Idx = major1Idx;
                let secondMaxScore = -Infinity;

                for (let i = 0; i < scLen; i++) {
                    if (i !== maxIdx && reuseScores[i] > secondMaxScore) {
                        secondMaxScore = reuseScores[i];
                        major2Idx = structuralCandidates[i];
                    }
                }

                if (secondMaxScore <= -500) {
                    major2Idx = major1Idx;
                }

                // 4. Determine Resolve Pair
                const coreIdx = lowResIdxMap[lyOffset + lx];
                let blendA = coreIdx;
                let blendB = major1Idx;

                // Is the core pixel itself an artifact?
                let isCoreStructural = false;
                for (let i = 0; i < scLen; i++) {
                    if (structuralCandidates[i] === coreIdx) {
                        isCoreStructural = true;
                        break;
                    }
                }

                if (!isCoreStructural) {
                    // CORE IS ARTIFACT: Solve strictly between the real shapes
                    blendA = major1Idx;
                    blendB = major2Idx;
                } else {
                    // CORE IS LEGIT: Find the best neighbor among structural majors
                    blendA = coreIdx;
                    blendB = (coreIdx === major1Idx) ? major2Idx : major1Idx;
                }

                // Disallow smoothing if the second shape weight is truly trace
                const weightB = reuseLocalWeights[blendB];
                if (weightB < 0.3) {
                    blendB = blendA;
                }

                let finalR: number, finalG: number, finalB: number;

                // Helper function to get the final color for a palette index
                // In tint mode, applies tint to reference pixel; in palette mode, uses target color
                const getFinalColor = (pIdx: number, srcR: number, srcG: number, srcB: number): ColorRGB => {
                    if (isTintMode) {
                        return (paletteHasTint[pIdx] && paletteTintSettings[pIdx])
                            ? applyTintRGB(srcR, srcG, srcB, paletteBaseHue[pIdx], paletteTintSettings[pIdx]!)
                            : { r: srcR, g: srcG, b: srcB };
                    }
                    return { r: paletteTargetR[pIdx], g: paletteTargetG[pIdx], b: paletteTargetB[pIdx] };
                };

                if (blendA === blendB) {
                    if (isTintMode) {
                        if (paletteHasTint[blendA] && paletteTintSettings[blendA]) {
                            const tinted = applyTintRGB(refR, refG, refB, paletteBaseHue[blendA], paletteTintSettings[blendA]!);
                            finalR = tinted.r; finalG = tinted.g; finalB = tinted.b;
                        } else {
                            finalR = refR; finalG = refG; finalB = refB;
                        }
                    } else {
                        finalR = paletteTargetR[blendA];
                        finalG = paletteTargetG[blendA];
                        finalB = paletteTargetB[blendA];
                    }
                } else if (effectiveSmoothingLevels === 0) {
                    const p1R = paletteR[blendA], p1G = paletteG[blendA], p1B = paletteB[blendA];
                    const p2R = paletteR[blendB], p2G = paletteG[blendB], p2B = paletteB[blendB];
                    const dr1 = refR - p1R, dg1 = refG - p1G, db1 = refB - p1B;
                    const dr2 = refR - p2R, dg2 = refG - p2G, db2 = refB - p2B;
                    const dist1 = dr1 * dr1 + dg1 * dg1 + db1 * db1;
                    const dist2 = dr2 * dr2 + dg2 * dg2 + db2 * db2;
                    const winnerIdx = dist1 < dist2 ? blendA : blendB;

                    if (isTintMode) {
                        if (paletteHasTint[winnerIdx] && paletteTintSettings[winnerIdx]) {
                            const tinted = applyTintRGB(refR, refG, refB, paletteBaseHue[winnerIdx], paletteTintSettings[winnerIdx]!);
                            finalR = tinted.r; finalG = tinted.g; finalB = tinted.b;
                        } else {
                            finalR = refR; finalG = refG; finalB = refB;
                        }
                    } else {
                        finalR = paletteTargetR[winnerIdx];
                        finalG = paletteTargetG[winnerIdx];
                        finalB = paletteTargetB[winnerIdx];
                    }
                } else {
                    const c1R = paletteR[blendA], c1G = paletteG[blendA], c1B = paletteB[blendA];
                    const c2R = paletteR[blendB], c2G = paletteG[blendB], c2B = paletteB[blendB];
                    const dr = c2R - c1R, dg = c2G - c1G, db = c2B - c1B;
                    const pr = refR - c1R, pg = refG - c1G, pb = refB - c1B;
                    const lenSq = dr * dr + dg * dg + db * db;

                    let bestT = 0;
                    if (lenSq > 0) {
                        bestT = Math.max(0, Math.min(1, (pr * dr + pg * dg + pb * db) / lenSq));
                    }

                    const intensity = effectiveSmoothingLevels / 100;

                    // 1. EXTENDED TRANSITION CONTINUITY:
                    let isOrphan = false;
                    if (bestT > 0 && bestT < 1.0) {
                        // Relax fringe detection at high intensities
                        const fringeWindow = 0.4 * (1 - intensity * 0.5);
                        const isFringe = bestT < fringeWindow || bestT > (1 - fringeWindow);

                        if (isFringe) {
                            const midR = (c1R + c2R) / 2, midG = (c1G + c2G) / 2, midB = (c1B + c2B) / 2;
                            const dr1 = c1R - midR, dg1 = c1G - midG, db1 = c1B - midB;
                            const midDistRefSq = dr1 * dr1 + dg1 * dg1 + db1 * db1;

                            let hasMidPointNeighbor = false;
                            // Search 5x5 at low, up to 7x7 at high intensity
                            const searchRadius = intensity > 0.7 ? 3 : 2;

                            for (let nyOff = -searchRadius; nyOff <= searchRadius; nyOff += 1) {
                                for (let nxOff = -searchRadius; nxOff <= searchRadius; nxOff += 1) {
                                    if (nxOff === 0 && nyOff === 0) continue;
                                    const nY = Math.max(0, Math.min(finalWorkspaceHeight - 1, y + nyOff));
                                    const nX = Math.max(0, Math.min(finalWorkspaceWidth - 1, x + nxOff));
                                    const nOutIdx = (nY * finalWorkspaceWidth + nX) * 4;
                                    const nr = highResPixelData[nOutIdx], ng = highResPixelData[nOutIdx + 1], nb = highResPixelData[nOutIdx + 2];
                                    const drN = nr - midR, dgN = ng - midG, dbN = nb - midB;
                                    const nDistMidSq = drN * drN + dgN * dgN + dbN * dbN;

                                    // Relax neighbor check at high intensity
                                    const similarityThreshold = 0.6 + (intensity * 0.2);
                                    if (nDistMidSq < midDistRefSq * similarityThreshold) {
                                        hasMidPointNeighbor = true;
                                        break;
                                    }
                                }
                                if (hasMidPointNeighbor) break;
                            }
                            if (!hasMidPointNeighbor) isOrphan = true;
                        }
                    }
                    if (isOrphan) bestT = (bestT < 0.5) ? 0 : 1;

                    // 2. CONTEXTUAL BLIP FILTER:
                    if (bestT > 0 && bestT < 0.25) {
                        const dr1 = refR - c1R, dg1 = refG - c1G, db1 = refB - c1B;
                        const dr2 = c1R - c2R, dg2 = c1G - c2G, db2 = c1B - c2B;
                        const noiseDistSq = dr1 * dr1 + dg1 * dg1 + db1 * db1;
                        const transitionDistSq = dr2 * dr2 + dg2 * dg2 + db2 * db2;
                        // Reduce blip filter sensitivity as intensity increases
                        const blipSensitivity = 0.05 * (1 - intensity);
                        if (noiseDistSq < transitionDistSq * blipSensitivity) { bestT = 0; }
                    }

                    // 3. SNAP DEADZONE (Dynamic):
                    const deadzone = 0.15 * (1 - intensity);
                    if (bestT < deadzone) bestT = 0;
                    if (bestT > (1 - deadzone)) bestT = 1;

                    // 4. SIGMOID (Dynamic k):
                    // k=28 at 0%, k=18 at 50%, k=8 at 100%
                    const k = 28 * (1 - intensity) + 8 * intensity;

                    const s0 = 1 / (1 + Math.exp(-k * (-0.5)));
                    const s1 = 1 / (1 + Math.exp(-k * (0.5)));
                    const rawS = 1 / (1 + Math.exp(-k * (bestT - 0.5)));
                    const finalT = (rawS - s0) / (s1 - s0);

                    // For tint mode, apply tint to ORIGINAL source pixel, then blend
                    if (isTintMode) {
                        // Tint the source pixel based on each group's tint settings, then blend
                        let t1R: number, t1G: number, t1B: number;
                        let t2R: number, t2G: number, t2B: number;

                        if (paletteHasTint[blendA] && paletteTintSettings[blendA]) {
                            const tinted = applyTintRGB(refR, refG, refB, paletteBaseHue[blendA], paletteTintSettings[blendA]!);
                            t1R = tinted.r; t1G = tinted.g; t1B = tinted.b;
                        } else {
                            // No tint: use original source pixel color
                            t1R = refR; t1G = refG; t1B = refB;
                        }

                        if (paletteHasTint[blendB] && paletteTintSettings[blendB]) {
                            const tinted = applyTintRGB(refR, refG, refB, paletteBaseHue[blendB], paletteTintSettings[blendB]!);
                            t2R = tinted.r; t2G = tinted.g; t2B = tinted.b;
                        } else {
                            // No tint: use original source pixel color
                            t2R = refR; t2G = refG; t2B = refB;
                        }

                        finalR = Math.round(t1R + finalT * (t2R - t1R));
                        finalG = Math.round(t1G + finalT * (t2G - t1G));
                        finalB = Math.round(t1B + finalT * (t2B - t1B));
                    } else {
                        // Palette mode: blend target colors
                        const t1R = paletteTargetR[blendA], t1G = paletteTargetG[blendA], t1B = paletteTargetB[blendA];
                        const t2R = paletteTargetR[blendB], t2G = paletteTargetG[blendB], t2B = paletteTargetB[blendB];
                        finalR = Math.round(t1R + finalT * (t2R - t1R));
                        finalG = Math.round(t1G + finalT * (t2G - t1G));
                        finalB = Math.round(t1B + finalT * (t2B - t1B));
                    }
                }


                // Compute sharp (native, nearest-neighbor) and smooth (interpolated) alpha, then
                // blend/shape the result based on the alphaSmoothness parameter (with optional sigmoid)
                const nativeAlphaIdx = ly * nativeWidth + lx;
                const sharpAlpha = nativeAlpha[nativeAlphaIdx];
                const smoothAlpha = highResPixelData[outIdx + 3];

                let finalAlpha: number;
                const alphaIntensity = (alphaSmoothness || 0) / 100;

                if (alphaIntensity === 0) {
                    // Binary snap: pure nearest-neighbor
                    finalAlpha = sharpAlpha;
                } else {
                    // Apply sigmoid to interpolated alpha value
                    // Normalize to 0-1 range
                    const alphaNorm = smoothAlpha / 255;

                    // Sigmoid sharpness: k increases with lower alphaSmoothness
                    // At 10%: k=20 (very sharp, nearly binary)
                    // At 50%: k=8 (moderate smoothing)
                    // At 100%: k=2 (gentle smoothing)
                    const k = 20 * (1 - alphaIntensity) + 2 * alphaIntensity;

                    // Apply sigmoid centered at 0.5
                    const s0 = 1 / (1 + Math.exp(-k * (-0.5)));
                    const s1 = 1 / (1 + Math.exp(-k * (0.5)));
                    const rawS = 1 / (1 + Math.exp(-k * (alphaNorm - 0.5)));
                    const sigmoidAlpha = (rawS - s0) / (s1 - s0);

                    finalAlpha = Math.round(sigmoidAlpha * 255);
                }

                outputData[outIdx] = finalR;
                outputData[outIdx + 1] = finalG;
                outputData[outIdx + 2] = finalB;
                outputData[outIdx + 3] = preserveTransparency ? finalAlpha : 255;
            }
        }


        wCtx.putImageData(new ImageData(outputData, finalWorkspaceWidth, finalWorkspaceHeight), 0, 0);

        const finalCanvas = new OffscreenCanvas(Math.round(nativeWidth * targetUpscale), Math.round(nativeHeight * targetUpscale));
        const fCtx = finalCanvas.getContext('2d', { alpha: true });
        if (!fCtx) throw new Error("Could not get final context");

        fCtx.imageSmoothingEnabled = true;
        fCtx.imageSmoothingQuality = 'high';
        fCtx.drawImage(workspaceCanvas, 0, 0, finalCanvas.width, finalCanvas.height);

        const blob = await intelligentCompress(finalCanvas, upscaleFactor === 'NS');
        self.postMessage({ type: 'complete', result: blob });

    } catch (error: any) {
        self.postMessage({ type: 'complete', error: error.message });
    }
};