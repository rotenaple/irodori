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

        const matchPalette = palette;

        // --- PHASE 1: LOW-RES SOLVE (Original Resolution) ---
        const nativePixelData = nCtx.getImageData(0, 0, nativeWidth, nativeHeight).data;
        let lowResIdxMap = new Int16Array(nativeWidth * nativeHeight);

        // Pre-create a flat mapping from all member colors to their group index
        // This is more efficient for the initial pass
        const colorToGroupIdx = new Map<string, number>();
        parameters.palette.forEach((p, pIdx) => {
            // Find the group this palette entry belongs to
            const group = parameters.colorGroups?.find(g => g.id === p.id);
            if (group) {
                group.members.forEach(m => {
                    colorToGroupIdx.set(m.hex.toLowerCase(), pIdx);
                });
            } else {
                // For manual layers or groups without explicit members in the message, just use its own hex
                colorToGroupIdx.set(p.hex.toLowerCase(), pIdx);
            }
        });

        for (let i = 0; i < nativePixelData.length; i += 4) {
            const r = nativePixelData[i];
            const g = nativePixelData[i + 1];
            const b = nativePixelData[i + 2];
            const hex = rgbToHex(r, g, b);

            let pIdx = colorToGroupIdx.get(hex);
            if (pIdx === undefined) {
                const pixel = { r, g, b };
                const closest = findClosestColor(pixel, matchPalette);
                pIdx = matchPalette.findIndex(p => p.id === closest.id);
            }

            lowResIdxMap[i / 4] = pIdx !== -1 ? pIdx : 0;
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
            const paletteSize = matchPalette.length;

            for (let iter = 0; iter < iterations; iter++) {
                for (let y = 0; y < nativeHeight; y++) {
                    const yStart = Math.max(0, y - radius);
                    const yEnd = Math.min(nativeHeight - 1, y + radius);

                    for (let x = 0; x < nativeWidth; x++) {
                        const xStart = Math.max(0, x - radius);
                        const xEnd = Math.min(nativeWidth - 1, x + radius);

                        const idx = y * nativeWidth + x;
                        const currentIdx = lowResIdxMap[idx];
                        const sIdx = idx * 4;
                        const src = { r: nativePixelData[sIdx], g: nativePixelData[sIdx + 1], b: nativePixelData[sIdx + 2] };

                        const localCounts = new Map<number, number>();
                        for (let ny = yStart; ny <= yEnd; ny++) {
                            for (let nx = xStart; nx <= xEnd; nx++) {
                                const nIdx = lowResIdxMap[ny * nativeWidth + nx];
                                localCounts.set(nIdx, (localCounts.get(nIdx) || 0) + 1);
                            }
                        }

                        // 2. Identify candidates
                        const sorted = Array.from(localCounts.entries())
                            .sort((a, b) => b[1] - a[1]);

                        let major1Idx = sorted[0][0];
                        let major2Idx = sorted.length > 1 ? sorted[1][0] : major1Idx;
                        let m3 = sorted.length > 2 ? sorted[2][0] : major2Idx;

                        // BETWEENNESS FILTER:
                        if (major1Idx !== major2Idx && major2Idx !== m3) {
                            const p1 = matchPalette[major1Idx], p2 = matchPalette[major2Idx], p3 = matchPalette[m3];
                            const d13 = Math.sqrt((p1.r - p3.r) ** 2 + (p1.g - p3.g) ** 2 + (p1.b - p3.b) ** 2);
                            const d12 = Math.sqrt((p1.r - p2.r) ** 2 + (p1.g - p2.g) ** 2 + (p1.b - p2.b) ** 2);
                            const d23 = Math.sqrt((p3.r - p2.r) ** 2 + (p3.g - p2.g) ** 2 + (p3.b - p2.b) ** 2);
                            if (d12 + d23 < d13 * 1.10) { major2Idx = m3; }
                        }

                        // REPRESENTATION FILTER (SAFE 10%):
                        // Only "melt" if the shape is truly tiny/isolated noise.
                        const totalWindow = (yEnd - yStart + 1) * (xEnd - xStart + 1);
                        const m2Count = localCounts.get(major2Idx) || 0;
                        if (m2Count < totalWindow * 0.10) { major2Idx = major1Idx; }

                        // 3. Topology cleaning:
                        if (currentIdx !== major1Idx && currentIdx !== major2Idx) {
                            const pC = matchPalette[currentIdx];
                            const p1 = matchPalette[major1Idx];
                            const p2 = matchPalette[major2Idx];
                            const d1 = (pC.r - p1.r) ** 2 + (pC.g - p1.g) ** 2 + (pC.b - p1.b) ** 2;
                            const d2 = (pC.r - p2.r) ** 2 + (pC.g - p2.g) ** 2 + (pC.b - p2.b) ** 2;
                            tempIdxMap[idx] = d1 < d2 ? major1Idx : major2Idx;
                            continue;
                        }

                        // 4. Resolve between majors - Source Similarity Multiplier
                        const p1 = matchPalette[major1Idx];
                        const p2 = matchPalette[major2Idx];
                        let err1 = (src.r - p1.r) ** 2 + (src.g - p1.g) ** 2 + (src.b - p1.b) ** 2;
                        let err2 = (src.r - p2.r) ** 2 + (src.g - p2.g) ** 2 + (src.b - p2.b) ** 2;

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

        for (let y = 0; y < finalWorkspaceHeight; y++) {
            // Pre-calculate Y neighbors
            const ly = Math.min(nativeHeight - 1, Math.floor(y / scaleY));
            const yMin = Math.max(0, ly - 1);
            const yMax = Math.min(nativeHeight - 1, ly + 1);

            for (let x = 0; x < finalWorkspaceWidth; x++) {
                const lx = Math.min(nativeWidth - 1, Math.floor(x / scaleX));
                const idx = y * finalWorkspaceWidth + x;
                const outIdx = idx * 4;

                const currentRefColor = {
                    r: highResPixelData[outIdx],
                    g: highResPixelData[outIdx + 1],
                    b: highResPixelData[outIdx + 2]
                };

                // 1. Regularize the local candidates list (Expand to 5x5)
                const yMin = Math.max(0, ly - 2);
                const yMax = Math.min(nativeHeight - 1, ly + 2);
                const xMin = Math.max(0, lx - 2);
                const xMax = Math.min(nativeWidth - 1, lx + 2);

                let localWeights = new Map<number, number>();
                for (let ny = yMin; ny <= yMax; ny++) {
                    const dy = Math.abs(ny - ly);
                    for (let nx = xMin; nx <= xMax; nx++) {
                        const dx = Math.abs(nx - lx);
                        const nIdx = lowResIdxMap[ny * nativeWidth + nx];

                        // GAUSSIAN WEIGHTING:
                        // Center = 1.0, 1px away = 0.5, 2px away = 0.2
                        let weight = 1.0;
                        if (dx > 0 || dy > 0) weight = 0.5;
                        if (dx > 1 || dy > 1) weight = 0.2;

                        localWeights.set(nIdx, (localWeights.get(nIdx) || 0) + weight);
                    }
                }
                // 1. Identify all unique candidates in the 1x neighborhood
                const uniqueCandidates = Array.from(localWeights.keys());

                // 2. STRUCTURAL FILTER (ARTIFACT REJECTION):
                // If a color in the neighborhood is mathematically a "Between" color 
                // of two other colors IN THE SAME neighborhood, it is an artifact (anti-aliasing).
                // We reject it from being a blend partner.
                const structuralCandidates = uniqueCandidates.filter(cIdx => {
                    const pC = matchPalette[cIdx];
                    const weightC = localWeights.get(cIdx) || 0;

                    for (const aIdx of uniqueCandidates) {
                        for (const bIdx of uniqueCandidates) {
                            if (aIdx === cIdx || bIdx === cIdx || aIdx === bIdx) continue;

                            const pA = matchPalette[aIdx], pB = matchPalette[bIdx];
                            const weightA = localWeights.get(aIdx) || 0, weightB = localWeights.get(bIdx) || 0;

                            const dAB = Math.sqrt((pA.r - pB.r) ** 2 + (pA.g - pB.g) ** 2 + (pA.b - pB.b) ** 2);
                            const dAC = Math.sqrt((pA.r - pC.r) ** 2 + (pA.g - pC.g) ** 2 + (pA.b - pC.b) ** 2);
                            const dBC = Math.sqrt((pB.r - pC.r) ** 2 + (pB.g - pC.g) ** 2 + (pB.b - pC.b) ** 2);

                            // RULE: Reject C if it's between A and B, AND A and B are both 'stronger' shapes in context.
                            // Increased tolerance to 1.10 to catch JPG noise.
                            if (dAC + dBC < dAB * 1.10 && dAB > 10) {
                                if (weightA > weightC && weightB > weightC) {
                                    return false; // Transitional artifact detected
                                }
                            }
                        }
                    }
                    return true;
                });
                // 3. Identify the STRUCTURAL MAJORS (with Adjacency Gating)
                // Any color not in the immediate 3x3 is hit with a massive penalty.
                const adjWhitelist = new Set<number>();
                const y3Min = Math.max(0, ly - 1), y3Max = Math.min(nativeHeight - 1, ly + 1);
                const x3Min = Math.max(0, lx - 1), x3Max = Math.min(nativeWidth - 1, lx + 1);
                for (let ny = y3Min; ny <= y3Max; ny++) {
                    for (let nx = x3Min; nx <= x3Max; nx++) {
                        adjWhitelist.add(lowResIdxMap[ny * nativeWidth + nx]);
                    }
                }

                const scoredStructural = structuralCandidates.map(cIdx => {
                    const p = matchPalette[cIdx];
                    const weight = localWeights.get(cIdx) || 0;
                    const err = (currentRefColor.r - p.r) ** 2 + (currentRefColor.g - p.g) ** 2 + (currentRefColor.b - p.b) ** 2;

                    // ADJACENCY GATING: Hard penalty for non-touching colors.
                    const gatingPenalty = adjWhitelist.has(cIdx) ? 0 : -1000;

                    // Score = Mass weight + Adjacency Gate + Error penalty
                    return { id: cIdx, score: (weight * 10) + gatingPenalty - Math.sqrt(err) };
                }).sort((a, b) => b.score - a.score);

                const major1Idx = scoredStructural[0]?.id ?? uniqueCandidates[0];
                const major2Idx = (scoredStructural.length > 1 && scoredStructural[1].score > -500)
                    ? scoredStructural[1].id
                    : major1Idx;
                // 4. Determine Resolve Pair
                const coreIdx = lowResIdxMap[ly * nativeWidth + lx];
                let blendA = coreIdx;
                let blendB = major1Idx;

                // Is the core pixel itself an artifact?
                const isCoreStructural = structuralCandidates.includes(coreIdx);

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
                const weightB = localWeights.get(blendB) || 0;
                if (weightB < 0.3) {
                    blendB = blendA;
                }

                let finalColor: ColorRGB & { id: string };

                if (blendA === blendB) {
                    const p = matchPalette[blendA];
                    const rgb = p.targetHex ? hexToRgb(p.targetHex)! : { r: p.r, g: p.g, b: p.b };
                    finalColor = { ...rgb, id: p.id };
                } else if (effectiveSmoothingLevels === 0) {
                    const p1 = matchPalette[blendA], p2 = matchPalette[blendB];
                    const dist1 = (currentRefColor.r - p1.r) ** 2 + (currentRefColor.g - p1.g) ** 2 + (currentRefColor.b - p1.b) ** 2;
                    const dist2 = (currentRefColor.r - p2.r) ** 2 + (currentRefColor.g - p2.g) ** 2 + (currentRefColor.b - p2.b) ** 2;
                    const winner = dist1 < dist2 ? p1 : p2;
                    const rgb = winner.targetHex ? hexToRgb(winner.targetHex)! : { r: winner.r, g: winner.g, b: winner.b };
                    finalColor = { ...rgb, id: winner.id };
                } else {
                    const c1p = matchPalette[blendA], c2p = matchPalette[blendB];
                    const dr = c2p.r - c1p.r, dg = c2p.g - c1p.g, db = c2p.b - c1p.b;
                    const pr = currentRefColor.r - c1p.r, pg = currentRefColor.g - c1p.g, pb = currentRefColor.b - c1p.b;
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
                            const midR = (c1p.r + c2p.r) / 2, midG = (c1p.g + c2p.g) / 2, midB = (c1p.b + c2p.b) / 2;
                            const midDistRefSq = (c1p.r - midR) ** 2 + (c1p.g - midG) ** 2 + (c1p.b - midB) ** 2;

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
                                    const nDistMidSq = (nr - midR) ** 2 + (ng - midG) ** 2 + (nb - midB) ** 2;

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
                        const r = currentRefColor.r, g = currentRefColor.g, b = currentRefColor.b;
                        const c1 = matchPalette[blendA], c2 = matchPalette[blendB];
                        const noiseDistSq = (r - c1.r) ** 2 + (g - c1.g) ** 2 + (b - c1.b) ** 2;
                        const transitionDistSq = (c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2;
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

                    const p1 = matchPalette[blendA], p2 = matchPalette[blendB];
                    const t1 = p1.targetHex ? hexToRgb(p1.targetHex)! : p1;
                    const t2 = p2.targetHex ? hexToRgb(p2.targetHex)! : p2;

                    finalColor = {
                        r: Math.round(t1.r + finalT * (t2.r - t1.r)),
                        g: Math.round(t1.g + finalT * (t2.g - t1.g)),
                        b: Math.round(t1.b + finalT * (t2.b - t1.b)),
                        id: `blend-${blendA}-${blendB}`
                    };
                }


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
