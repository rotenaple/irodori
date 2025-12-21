import { PaletteColor, ProcessingState, ColorGroup, ColorRGB, WorkerMessage, WorkerResponse } from './types';
import {
    rgbToHex,
    hexToRgb,
    findClosestColor,
    blendColors,
    sigmoidSnap,
    applyMedianFilter,
    getColorDistance
} from './utils/colorUtils';

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    if (e.data.type !== 'process') return;

    const { imageBitmap, parameters } = e.data;
    const {
        upscaleFactor,
        denoiseRadius,
        edgeProtection,
        disablePostProcessing,
        disableRecoloring,
        disableScaling,
        palette,
        smoothingLevels
    } = parameters;

    try {
        const nativeWidth = imageBitmap.width;
        const nativeHeight = imageBitmap.height;

        // determine target scale
        let targetUpscale = 1;
        if (!disableScaling) {
            if (upscaleFactor === 'NS') {
                const longNative = Math.max(nativeWidth, nativeHeight);
                const shortNative = Math.min(nativeWidth, nativeHeight);
                const scaleA = Math.min(535 / longNative, 355 / shortNative);
                const scaleB = Math.min(568 / longNative, 321 / shortNative);
                targetUpscale = Math.max(scaleA, scaleB);
            } else {
                targetUpscale = upscaleFactor as number;
            }
        }

        const nativeCanvas = new OffscreenCanvas(nativeWidth, nativeHeight);
        const nCtx = nativeCanvas.getContext('2d', { willReadFrequently: true });
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

            const blob = await finalCanvas.convertToBlob({ type: 'image/png' });
            self.postMessage({ type: 'complete', result: blob });
            return;
        }

        // Processing Logic
        const workspaceScale = targetUpscale * 4;
        const workspaceWidth = Math.round(nativeWidth * workspaceScale);
        const workspaceHeight = Math.round(nativeHeight * workspaceScale);

        const MAX_PIXELS = 10000000;
        const currentPixels = workspaceWidth * workspaceHeight;
        const safeScale = currentPixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (nativeWidth * nativeHeight)) : workspaceScale;

        const finalWorkspaceWidth = Math.round(nativeWidth * safeScale);
        const finalWorkspaceHeight = Math.round(nativeHeight * safeScale);

        const workspaceCanvas = new OffscreenCanvas(finalWorkspaceWidth, finalWorkspaceHeight);
        const wCtx = workspaceCanvas.getContext('2d', { willReadFrequently: true });
        if (!wCtx) throw new Error("Could not get workspace context");

        wCtx.imageSmoothingEnabled = true;
        wCtx.imageSmoothingQuality = 'high';
        wCtx.drawImage(nativeCanvas, 0, 0, finalWorkspaceWidth, finalWorkspaceHeight);

        const pixelData = wCtx.getImageData(0, 0, finalWorkspaceWidth, finalWorkspaceHeight).data;

        // Reconstruct matchPalette properly since it was passed as JSON
        // The palette passed in parameters is already the 'target' palette (enabled colors with overrides)
        // We need to ensure we have the correct structure for finding colors.
        // Actually, App.tsx logic constructs matchPalette from enabledGroups.
        // But since the worker receives the *full* palette (constructed in useMemo in App), we can just use that.
        // Wait, let's verify what `palette` is in App.tsx. It is `PaletteColor[]`.
        const matchPalette = palette;

        const outputData = new Uint8ClampedArray(pixelData.length);
        let coreIdxMap = new Int16Array(finalWorkspaceWidth * finalWorkspaceHeight);

        // Initial color matching
        for (let i = 0; i < pixelData.length; i += 4) {
            const pixel = { r: pixelData[i], g: pixelData[i + 1], b: pixelData[i + 2] };
            const closest = findClosestColor(pixel, matchPalette);
            // Find index in matchPalette
            const pIdx = matchPalette.findIndex(p => p.id === closest.id);
            coreIdxMap[i / 4] = pIdx !== -1 ? pIdx : 0;
        }

        // Determine effective parameters based on flags
        const effectiveEdgeProtection = disablePostProcessing ? 0 : edgeProtection;
        const effectiveSmoothingLevels = disablePostProcessing ? 0 : smoothingLevels;

        // Edge Protection (Refinement)
        if (effectiveEdgeProtection > 0) {
            let radius = 1;
            let iterations = 1;
            if (effectiveEdgeProtection > 33) { radius = 2; iterations = 2; }
            if (effectiveEdgeProtection > 66) { radius = 3; iterations = 3; }
            if (effectiveEdgeProtection > 85) { radius = 4; iterations = 5; }

            let tempIdxMap = new Int16Array(coreIdxMap.length);

            // Allocate a single reusable buffer for counting neighbors.
            // Size is palette length. 
            // Note: If palette length is very small, this is cheap. 
            // If palette length grows, this is still much cheaper than Map allocation per pixel.
            // We use Int16Array to match coreIdxMap types and handle counts.
            // Assuming palette size won't exceed ~256 usually, but safe size is needed.
            // Using a larger fixed size buffer to be safe or dynamic based on palette length.
            const paletteSize = matchPalette.length;
            const counts = new Int16Array(paletteSize);

            for (let iter = 0; iter < iterations; iter++) {
                for (let y = 0; y < finalWorkspaceHeight; y++) {
                    for (let x = 0; x < finalWorkspaceWidth; x++) {
                        const idx = y * finalWorkspaceWidth + x;

                        // Reset counts buffer
                        // Since palette is small, filling 0 is fast.
                        counts.fill(0);

                        let maxCount = 0;
                        let dominantIdx = coreIdxMap[idx];

                        for (let dy = -radius; dy <= radius; dy++) {
                            for (let dx = -radius; dx <= radius; dx++) {
                                const ny = y + dy;
                                const nx = x + dx;
                                if (ny >= 0 && ny < finalWorkspaceHeight && nx >= 0 && nx < finalWorkspaceWidth) {
                                    const nIdx = coreIdxMap[ny * finalWorkspaceWidth + nx];

                                    // Safety check although nIdx should be valid from previous steps
                                    if (nIdx >= 0 && nIdx < paletteSize) {
                                        counts[nIdx]++;
                                        const c = counts[nIdx];
                                        if (c > maxCount) {
                                            maxCount = c;
                                            dominantIdx = nIdx;
                                        }
                                    }
                                }
                            }
                        }
                        tempIdxMap[idx] = dominantIdx;
                    }
                }
                coreIdxMap.set(tempIdxMap);
            }
        }

        // Smoothing & Final Output
        for (let y = 0; y < finalWorkspaceHeight; y++) {
            for (let x = 0; x < finalWorkspaceWidth; x++) {
                const idx = y * finalWorkspaceWidth + x;
                const coreIdx = coreIdxMap[idx];
                let neighborIndices = new Set<number>();

                if (effectiveSmoothingLevels > 0) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = x + dx, ny = y + dy;
                            if (nx >= 0 && nx < finalWorkspaceWidth && ny >= 0 && ny < finalWorkspaceHeight) {
                                const ni = coreIdxMap[ny * finalWorkspaceWidth + nx];
                                if (ni !== coreIdx) neighborIndices.add(ni);
                            }
                        }
                    }
                }

                let finalColor: PaletteColor;
                if (neighborIndices.size === 0 || effectiveSmoothingLevels === 0) {
                    const p = matchPalette[coreIdx];
                    if (p.targetHex) {
                        const tRgb = hexToRgb(p.targetHex);
                        finalColor = tRgb ? { ...tRgb, hex: p.targetHex, id: p.id } : p;
                    } else {
                        finalColor = p;
                    }
                } else {
                    const outIdx = idx * 4;
                    const currentPixel = { r: pixelData[outIdx], g: pixelData[outIdx + 1], b: pixelData[outIdx + 2] };
                    const candidates: PaletteColor[] = [matchPalette[coreIdx]];
                    const steps = Math.pow(2, effectiveSmoothingLevels) - 1;

                    neighborIndices.forEach(ni => {
                        // Matching is done against SOURCE colors (matchPalette has source RGBs)
                        candidates.push(matchPalette[ni]);
                        const contrast = getColorDistance(matchPalette[coreIdx], matchPalette[ni]);
                        const sharpFactor = contrast > 120 ? 18 : 10;

                        // Pre-calculate target colors for blending if needed? No, we need source blends for matching.
                        // We only need target colors for the final output.
                        const targetC1 = matchPalette[coreIdx].targetHex ? hexToRgb(matchPalette[coreIdx].targetHex!)! : matchPalette[coreIdx];
                        const targetC2 = matchPalette[ni].targetHex ? hexToRgb(matchPalette[ni].targetHex!)! : matchPalette[ni];

                        for (let s = 1; s <= steps; s++) {
                            const sr = sigmoidSnap(s / (steps + 1), sharpFactor);
                            // Blend between the TARGET colors for the candidates list (what we want to see)
                            // BUT wait, findClosestColor compares against the PIXEL (source). 
                            // The pixel matches matchPalette[coreIdx] (source).
                            // So the candidate color for matching should be a blend of the SOURCE colors.
                            // However, we want the ID to carry the blend info, and we'll resolve the final color later.

                            const bSource = blendColors(matchPalette[coreIdx], matchPalette[ni], sr);
                            // We construct a candidate that LOOKS like the source blend for matching purposes
                            candidates.push({ ...bSource, hex: rgbToHex(bSource.r, bSource.g, bSource.b), id: `blend-${coreIdx}-${ni}-${s}` });
                        }
                    });

                    // 0.8 weight for original pixel adherence
                    const winner = findClosestColor(currentPixel, candidates, 0.8);
                    // reconstruct color if blend
                    if (winner.id.startsWith('blend-')) {
                        const parts = winner.id.split('-');
                        const i1 = parseInt(parts[1]), i2 = parseInt(parts[2]), s = parseInt(parts[3]);

                        // Resolve the TARGET colors for the final output
                        const p1 = matchPalette[i1];
                        const p2 = matchPalette[i2];
                        const c1 = p1.targetHex ? hexToRgb(p1.targetHex)! : p1;
                        const c2 = p2.targetHex ? hexToRgb(p2.targetHex)! : p2;

                        const b = blendColors(c1, c2, sigmoidSnap(s / (steps + 1), 12));
                        finalColor = { ...b, hex: rgbToHex(b.r, b.g, b.b), id: winner.id };
                    } else {
                        // It's a palette color
                        // winner matches a candidate, which comes from matchPalette
                        const found = matchPalette.find(p => p.id === winner.id);
                        // If found, use its target color if available
                        if (found) {
                            if (found.targetHex) {
                                const tRgb = hexToRgb(found.targetHex);
                                finalColor = tRgb ? { ...tRgb, hex: found.targetHex, id: found.id } : found;
                            } else {
                                finalColor = found;
                            }
                        } else {
                            // Fallback to coreIdx if something weird happens, ensuring targetHex usage
                            const core = matchPalette[coreIdx];
                            if (core.targetHex) {
                                const tRgb = hexToRgb(core.targetHex);
                                finalColor = tRgb ? { ...tRgb, hex: core.targetHex, id: core.id } : core;
                            } else {
                                finalColor = core;
                            }
                        }
                    }
                }

                const outIdx = idx * 4;
                outputData[outIdx] = finalColor.r;
                outputData[outIdx + 1] = finalColor.g;
                outputData[outIdx + 2] = finalColor.b;
                outputData[outIdx + 3] = 255;
            }
        }

        wCtx.putImageData(new ImageData(outputData, finalWorkspaceWidth, finalWorkspaceHeight), 0, 0);

        const finalCanvas = new OffscreenCanvas(Math.round(nativeWidth * targetUpscale), Math.round(nativeHeight * targetUpscale));
        const fCtx = finalCanvas.getContext('2d');
        if (!fCtx) throw new Error("Could not get final context");

        fCtx.fillStyle = '#000000';
        fCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
        fCtx.imageSmoothingEnabled = true;
        fCtx.imageSmoothingQuality = 'high';
        fCtx.drawImage(workspaceCanvas, 0, 0, finalCanvas.width, finalCanvas.height);

        const blob = await finalCanvas.convertToBlob({ type: 'image/png' });
        self.postMessage({ type: 'complete', result: blob });

    } catch (error: any) {
        self.postMessage({ type: 'complete', error: error.message });
    }
};
