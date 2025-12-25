import { PaletteColor, ColorRGB, WorkerMessage } from './types';
import {
    rgbToHex,
    hexToRgb,
    findClosestColor,
    blendColors,
    sigmoidSnap,
    applyMedianFilter,
    getColorDistance
} from './utils/colorUtils';

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
        smoothingLevels
    } = parameters;

    try {
        const nativeWidth = imageBitmap.width;
        const nativeHeight = imageBitmap.height;

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

            const blob = await intelligentCompress(finalCanvas, upscaleFactor === 'NS');
            self.postMessage({ type: 'complete', result: blob });
            return;
        }

        const matchPalette = palette;

        // --- PHASE 1: LOW-RES SOLVE (Original Resolution) ---
        const nativePixelData = nCtx.getImageData(0, 0, nativeWidth, nativeHeight).data;
        let lowResIdxMap = new Int16Array(nativeWidth * nativeHeight);

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

                        // Count local palette indices
                        const localCounts = new Uint16Array(paletteSize);
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
        const wCtx = workspaceCanvas.getContext('2d', { willReadFrequently: true });
        if (!wCtx) throw new Error("Could not get workspace context");

        wCtx.imageSmoothingEnabled = true;
        wCtx.imageSmoothingQuality = 'high';
        wCtx.drawImage(nativeCanvas, 0, 0, finalWorkspaceWidth, finalWorkspaceHeight);

        const highResPixelData = wCtx.getImageData(0, 0, finalWorkspaceWidth, finalWorkspaceHeight).data;
        const outputData = new Uint8ClampedArray(highResPixelData.length);

        const scaleX = finalWorkspaceWidth / nativeWidth;
        const scaleY = finalWorkspaceHeight / nativeHeight;
        
        // Pre-cache targetHex conversions for all palette colors
        const paletteTargetR = new Uint8Array(paletteSize);
        const paletteTargetG = new Uint8Array(paletteSize);
        const paletteTargetB = new Uint8Array(paletteSize);
        for (let i = 0; i < paletteSize; i++) {
            const p = matchPalette[i];
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
                paletteTargetR[i] = paletteR[i];
                paletteTargetG[i] = paletteG[i];
                paletteTargetB[i] = paletteB[i];
            }
        }

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

                // Use typed array instead of Map for local weights
                const localWeights = new Float32Array(paletteSize);
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

                        localWeights[nIdx] += weight;
                    }
                }
                
                // 1. Identify all unique candidates in the neighborhood
                const uniqueCandidates: number[] = [];
                for (let i = 0; i < paletteSize; i++) {
                    if (localWeights[i] > 0) uniqueCandidates.push(i);
                }

                // 2. STRUCTURAL FILTER (ARTIFACT REJECTION):
                // If a color in the neighborhood is mathematically a "Between" color 
                // of two other colors IN THE SAME neighborhood, it is an artifact (anti-aliasing).
                // We reject it from being a blend partner.
                const structuralCandidates: number[] = [];
                const ucLen = uniqueCandidates.length;
                
                outer: for (let ci = 0; ci < ucLen; ci++) {
                    const cIdx = uniqueCandidates[ci];
                    const pCr = paletteR[cIdx], pCg = paletteG[cIdx], pCb = paletteB[cIdx];
                    const weightC = localWeights[cIdx];

                    for (let ai = 0; ai < ucLen; ai++) {
                        const aIdx = uniqueCandidates[ai];
                        if (aIdx === cIdx) continue;
                        
                        for (let bi = 0; bi < ucLen; bi++) {
                            const bIdx = uniqueCandidates[bi];
                            if (bIdx === cIdx || aIdx === bIdx) continue;

                            const pAr = paletteR[aIdx], pAg = paletteG[aIdx], pAb = paletteB[aIdx];
                            const pBr = paletteR[bIdx], pBg = paletteG[bIdx], pBb = paletteB[bIdx];
                            const weightA = localWeights[aIdx], weightB = localWeights[bIdx];

                            const dAB = Math.sqrt((pAr - pBr) ** 2 + (pAg - pBg) ** 2 + (pAb - pBb) ** 2);
                            const dAC = Math.sqrt((pAr - pCr) ** 2 + (pAg - pCg) ** 2 + (pAb - pCb) ** 2);
                            const dBC = Math.sqrt((pBr - pCr) ** 2 + (pBg - pCg) ** 2 + (pBb - pCb) ** 2);

                            // RULE: Reject C if it's between A and B, AND A and B are both 'stronger' shapes in context.
                            // Increased tolerance to 1.10 to catch JPG noise.
                            if (dAC + dBC < dAB * 1.10 && dAB > 10) {
                                if (weightA > weightC && weightB > weightC) {
                                    continue outer; // Transitional artifact detected
                                }
                            }
                        }
                    }
                    structuralCandidates.push(cIdx);
                }
                // 3. Identify the STRUCTURAL MAJORS (with Adjacency Gating)
                // Any color not in the immediate 3x3 is hit with a massive penalty.
                const adjWhitelist = new Uint8Array(paletteSize); // 1 if adjacent, 0 otherwise
                const y3Min = Math.max(0, ly - 1), y3Max = Math.min(nativeHeight - 1, ly + 1);
                const x3Min = Math.max(0, lx - 1), x3Max = Math.min(nativeWidth - 1, lx + 1);
                for (let ny = y3Min; ny <= y3Max; ny++) {
                    const nyOffset = ny * nativeWidth;
                    for (let nx = x3Min; nx <= x3Max; nx++) {
                        adjWhitelist[lowResIdxMap[nyOffset + nx]] = 1;
                    }
                }

                // Score structural candidates
                const scLen = structuralCandidates.length;
                const scores = new Float32Array(scLen);
                let maxScore = -Infinity;
                let maxIdx = 0;
                
                for (let i = 0; i < scLen; i++) {
                    const cIdx = structuralCandidates[i];
                    const pR = paletteR[cIdx], pG = paletteG[cIdx], pB = paletteB[cIdx];
                    const weight = localWeights[cIdx];
                    const dr = refR - pR, dg = refG - pG, db = refB - pB;
                    const err = dr * dr + dg * dg + db * db;

                    // ADJACENCY GATING: Hard penalty for non-touching colors.
                    const gatingPenalty = adjWhitelist[cIdx] ? 0 : -1000;

                    // Score = Mass weight + Adjacency Gate + Error penalty
                    const score = (weight * 10) + gatingPenalty - Math.sqrt(err);
                    scores[i] = score;
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
                    if (i !== maxIdx && scores[i] > secondMaxScore) {
                        secondMaxScore = scores[i];
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
                const weightB = localWeights[blendB];
                if (weightB < 0.3) {
                    blendB = blendA;
                }

                let finalR: number, finalG: number, finalB: number;

                if (blendA === blendB) {
                    finalR = paletteTargetR[blendA];
                    finalG = paletteTargetG[blendA];
                    finalB = paletteTargetB[blendA];
                } else if (effectiveSmoothingLevels === 0) {
                    const p1R = paletteR[blendA], p1G = paletteG[blendA], p1B = paletteB[blendA];
                    const p2R = paletteR[blendB], p2G = paletteG[blendB], p2B = paletteB[blendB];
                    const dr1 = refR - p1R, dg1 = refG - p1G, db1 = refB - p1B;
                    const dr2 = refR - p2R, dg2 = refG - p2G, db2 = refB - p2B;
                    const dist1 = dr1 * dr1 + dg1 * dg1 + db1 * db1;
                    const dist2 = dr2 * dr2 + dg2 * dg2 + db2 * db2;
                    const winnerIdx = dist1 < dist2 ? blendA : blendB;
                    finalR = paletteTargetR[winnerIdx];
                    finalG = paletteTargetG[winnerIdx];
                    finalB = paletteTargetB[winnerIdx];
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

                    const t1R = paletteTargetR[blendA], t1G = paletteTargetG[blendA], t1B = paletteTargetB[blendA];
                    const t2R = paletteTargetR[blendB], t2G = paletteTargetG[blendB], t2B = paletteTargetB[blendB];

                    finalR = Math.round(t1R + finalT * (t2R - t1R));
                    finalG = Math.round(t1G + finalT * (t2G - t1G));
                    finalB = Math.round(t1B + finalT * (t2B - t1B));
                }


                outputData[outIdx] = finalR;
                outputData[outIdx + 1] = finalG;
                outputData[outIdx + 2] = finalB;
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

        const blob = await intelligentCompress(finalCanvas, upscaleFactor === 'NS');
        self.postMessage({ type: 'complete', result: blob });

    } catch (error: any) {
        self.postMessage({ type: 'complete', error: error.message });
    }
};