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
import { createWebGPUProcessor, WebGPUProcessor } from './utils/webgpuProcessor';
import { MAX_PALETTE_SIZE, MAX_WORKSPACE_PIXELS, NS_TARGET_SIZE } from './utils/processingConstants';

// Global WebGPU processor instance (initialized lazily)
let webgpuProcessor: WebGPUProcessor | null | undefined = undefined;

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
    const TARGET_SIZE = NS_TARGET_SIZE;
    
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

/**
 * Initialize WebGPU processor (lazy initialization)
 */
async function initWebGPU(): Promise<boolean> {
    if (webgpuProcessor === undefined) {
        try {
            webgpuProcessor = await createWebGPUProcessor();
            if (webgpuProcessor) {
                console.log('WebGPU processor initialized successfully');
                return true;
            } else {
                console.log('WebGPU not available, using CPU fallback');
                return false;
            }
        } catch (error) {
            console.warn('Failed to initialize WebGPU:', error);
            webgpuProcessor = null;
            return false;
        }
    }
    return webgpuProcessor !== null;
}

/**
 * Process using WebGPU acceleration
 */
async function processWithWebGPU(
    nativePixelData: Uint8ClampedArray,
    nativeWidth: number,
    nativeHeight: number,
    workspaceWidth: number,
    workspaceHeight: number,
    matchPalette: PaletteColor[],
    colorToGroupIdx: Map<string, number>,
    highResPixelData: Uint8ClampedArray,
    edgeProtection: number,
    smoothingLevels: number
): Promise<Uint8ClampedArray> {
    if (!webgpuProcessor) {
        throw new Error('WebGPU processor not available');
    }

    // Phase 1: Palette matching
    const lowResIdxMap = await webgpuProcessor.paletteMatching(
        nativePixelData,
        nativeWidth,
        nativeHeight,
        matchPalette,
        colorToGroupIdx
    );

    // Phase 2: Edge protection
    let processedIndices = lowResIdxMap;
    if (edgeProtection > 0) {
        let radius = Math.max(1, Math.round((edgeProtection / 100) * 3));
        let iterations = Math.max(1, Math.round((edgeProtection / 100) * 4));
        if (edgeProtection > 66) { radius = 3; iterations = 3; }
        if (edgeProtection > 85) { radius = 5; iterations = 5; }

        processedIndices = await webgpuProcessor.edgeProtection(
            lowResIdxMap,
            nativePixelData,
            nativeWidth,
            nativeHeight,
            matchPalette,
            radius,
            iterations
        );
    }

    // Phase 3: High-resolution reconstruction
    const outputData = await webgpuProcessor.reconstruction(
        processedIndices,
        highResPixelData,
        {
            nativeWidth,
            nativeHeight,
            workspaceWidth,
            workspaceHeight,
            palette: matchPalette,
            colorToGroupIdx,
            edgeProtection,
            smoothingLevels
        }
    );

    return outputData;
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
        
        // 1. Setup Maps for Fast Lookup
        // We use a map to link specific hex codes directly to a palette index.
        // This ensures the user's manual groupings override mathematical distance.
        const colorToGroupIdx = new Map<string, number>();
        const paletteIdMap = new Map<string, number>();

        // Create quick lookup: Palette ID -> Index in matchPalette array
        matchPalette.forEach((p, idx) => paletteIdMap.set(p.id, idx));

        // 2. Populate Group Mappings (Priority: Explicit Group Members)
        // Accessing parameters.colorGroups ensures we see all members currently assigned in the UI
        if (parameters.colorGroups) {
            parameters.colorGroups.forEach(group => {
                const pIdx = paletteIdMap.get(group.id);
                // Only if the group is actually part of the active palette (enabled)
                if (pIdx !== undefined) {
                    group.members.forEach(m => {
                        colorToGroupIdx.set(m.hex.toLowerCase(), pIdx);
                    });
                }
            });
        }

        // 3. Ensure Palette Heads are mapped (Secondary)
        // This handles manual layers or colors that might not be in the 'members' list (e.g. initial seeds)
        matchPalette.forEach((p, idx) => {
            const hex = p.hex.toLowerCase();
            if (!colorToGroupIdx.has(hex)) {
                colorToGroupIdx.set(hex, idx);
            }
        });

        // Determine effective parameters
        const effectiveEdgeProtection = disablePostProcessing ? 0 : edgeProtection;
        const effectiveSmoothingLevels = disablePostProcessing ? 0 : smoothingLevels;

        // --- TRY WEBGPU ACCELERATION FIRST ---
        let useWebGPU = false;
        let lowResIdxMap = new Int16Array(nativeWidth * nativeHeight);
        
        try {
            const webgpuAvailable = await initWebGPU();
            if (webgpuAvailable && webgpuProcessor) {
                // Prepare workspace for WebGPU
                const workspaceScale = targetUpscale * 4;
                const workspaceWidth = Math.round(nativeWidth * workspaceScale);
                const workspaceHeight = Math.round(nativeHeight * workspaceScale);

                const currentPixels = workspaceWidth * workspaceHeight;
                const safeScale = currentPixels > MAX_WORKSPACE_PIXELS ? Math.sqrt(MAX_WORKSPACE_PIXELS / (nativeWidth * nativeHeight)) : workspaceScale;

                const finalWorkspaceWidth = Math.round(nativeWidth * safeScale);
                const finalWorkspaceHeight = Math.round(nativeHeight * safeScale);

                const workspaceCanvas = new OffscreenCanvas(finalWorkspaceWidth, finalWorkspaceHeight);
                const wCtx = workspaceCanvas.getContext('2d', { willReadFrequently: true });
                if (!wCtx) throw new Error("Could not get workspace context");

                wCtx.imageSmoothingEnabled = true;
                wCtx.imageSmoothingQuality = 'high';
                wCtx.drawImage(nativeCanvas, 0, 0, finalWorkspaceWidth, finalWorkspaceHeight);

                const highResPixelData = wCtx.getImageData(0, 0, finalWorkspaceWidth, finalWorkspaceHeight).data;

                // Process with WebGPU
                const outputData = await processWithWebGPU(
                    new Uint8ClampedArray(nativePixelData),
                    nativeWidth,
                    nativeHeight,
                    finalWorkspaceWidth,
                    finalWorkspaceHeight,
                    matchPalette,
                    colorToGroupIdx,
                    new Uint8ClampedArray(highResPixelData),
                    effectiveEdgeProtection,
                    effectiveSmoothingLevels
                );

                // Put processed data back to canvas
                const imageData = new ImageData(new Uint8ClampedArray(outputData), finalWorkspaceWidth, finalWorkspaceHeight);
                wCtx.putImageData(imageData, 0, 0);

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
                
                useWebGPU = true;
                return;
            }
        } catch (webgpuError) {
            console.warn('WebGPU processing failed, falling back to CPU:', webgpuError);
            useWebGPU = false;
        }

        // --- CPU FALLBACK: Continue with original CPU implementation ---
        if (!useWebGPU) {
            // 4. Pixel Loop (CPU implementation) - Optimized
            // Pre-compute palette lookup for direct distance comparison
            const paletteRGB = new Float32Array(matchPalette.length * 3);
            for (let i = 0; i < matchPalette.length; i++) {
                paletteRGB[i * 3] = matchPalette[i].r;
                paletteRGB[i * 3 + 1] = matchPalette[i].g;
                paletteRGB[i * 3 + 2] = matchPalette[i].b;
            }
            
            for (let i = 0; i < nativePixelData.length; i += 4) {
            const r = nativePixelData[i];
            const g = nativePixelData[i + 1];
            const b = nativePixelData[i + 2];
            
            // Step A: Check if this specific color is explicitly grouped
            // Only compute hex if we have color groups
            let pIdx: number | undefined;
            if (colorToGroupIdx.size > 0) {
                const hex = rgbToHex(r, g, b);
                pIdx = colorToGroupIdx.get(hex);
            }

            // Step B: If not in a group, fall back to optimized distance calculation
            if (pIdx === undefined) {
                // Inline distance calculation for better performance
                let minDistSq = Infinity;
                pIdx = 0;
                for (let j = 0; j < matchPalette.length; j++) {
                    const idx3 = j * 3;
                    const dr = r - paletteRGB[idx3];
                    const dg = g - paletteRGB[idx3 + 1];
                    const db = b - paletteRGB[idx3 + 2];
                    const distSq = dr * dr + dg * dg + db * db;
                    if (distSq < minDistSq) {
                        minDistSq = distSq;
                        pIdx = j;
                    }
                }
            }

            lowResIdxMap[i / 4] = pIdx;
        }

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
            
            // Optimize: Pre-allocate array for counting instead of Map
            const localCountsArray = new Uint16Array(MAX_PALETTE_SIZE);

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
                        const srcR = nativePixelData[sIdx];
                        const srcG = nativePixelData[sIdx + 1];
                        const srcB = nativePixelData[sIdx + 2];

                        // Reset counts array
                        localCountsArray.fill(0);
                        
                        for (let ny = yStart; ny <= yEnd; ny++) {
                            for (let nx = xStart; nx <= xEnd; nx++) {
                                const nIdx = lowResIdxMap[ny * nativeWidth + nx];
                                // Bounds check for defensive programming - ensures we don't overflow the counts array
                                if (nIdx >= 0 && nIdx < MAX_PALETTE_SIZE) {
                                    localCountsArray[nIdx]++;
                                }
                            }
                        }

                        // 2. Identify candidates - find top 3 most common
                        let major1Idx = 0, major1Count = 0;
                        let major2Idx = 0, major2Count = 0;
                        let m3 = 0, m3Count = 0;
                        
                        for (let i = 0; i < paletteSize; i++) {
                            const count = localCountsArray[i];
                            if (count > major1Count) {
                                m3 = major2Idx;
                                m3Count = major2Count;
                                major2Idx = major1Idx;
                                major2Count = major1Count;
                                major1Idx = i;
                                major1Count = count;
                            } else if (count > major2Count) {
                                m3 = major2Idx;
                                m3Count = major2Count;
                                major2Idx = i;
                                major2Count = count;
                            } else if (count > m3Count) {
                                m3 = i;
                                m3Count = count;
                            }
                        }

                        // BETWEENNESS FILTER (optimized - use squared distances):
                        if (major1Idx !== major2Idx && major2Idx !== m3) {
                            const p1 = matchPalette[major1Idx], p2 = matchPalette[major2Idx], p3 = matchPalette[m3];
                            // Use squared distances to avoid sqrt
                            const d13Sq = (p1.r - p3.r) ** 2 + (p1.g - p3.g) ** 2 + (p1.b - p3.b) ** 2;
                            const d12Sq = (p1.r - p2.r) ** 2 + (p1.g - p2.g) ** 2 + (p1.b - p2.b) ** 2;
                            const d23Sq = (p3.r - p2.r) ** 2 + (p3.g - p2.g) ** 2 + (p3.b - p2.b) ** 2;
                            // sqrt(a) + sqrt(b) < sqrt(c) * 1.1 => check with squared values
                            const sumSq = (Math.sqrt(d12Sq) + Math.sqrt(d23Sq)) ** 2;
                            const targetSq = (Math.sqrt(d13Sq) * 1.10) ** 2;
                            if (sumSq < targetSq) { major2Idx = m3; }
                        }

                        // REPRESENTATION FILTER (SAFE 10%):
                        // Only "melt" if the shape is truly tiny/isolated noise.
                        const totalWindow = (yEnd - yStart + 1) * (xEnd - xStart + 1);
                        const m2Count = localCountsArray[major2Idx];
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

                        // 4. Resolve between majors - Source Similarity Multiplier (optimized)
                        const p1 = matchPalette[major1Idx];
                        const p2 = matchPalette[major2Idx];
                        let err1 = (srcR - p1.r) ** 2 + (srcG - p1.g) ** 2 + (srcB - p1.b) ** 2;
                        let err2 = (srcR - p2.r) ** 2 + (srcG - p2.g) ** 2 + (srcB - p2.b) ** 2;

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

        const currentPixels = workspaceWidth * workspaceHeight;
        const safeScale = currentPixels > MAX_WORKSPACE_PIXELS ? Math.sqrt(MAX_WORKSPACE_PIXELS / (nativeWidth * nativeHeight)) : workspaceScale;

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
        
        // Optimize: Pre-allocate arrays for local weights
        const localWeightsArray = new Float32Array(MAX_PALETTE_SIZE);

        for (let y = 0; y < finalWorkspaceHeight; y++) {
            // Pre-calculate Y neighbors
            const ly = Math.min(nativeHeight - 1, Math.floor(y / scaleY));

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

                // Reset weights array
                localWeightsArray.fill(0);
                
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

                        // Bounds check for defensive programming - ensures we don't overflow the weights array
                        if (nIdx >= 0 && nIdx < MAX_PALETTE_SIZE) {
                            localWeightsArray[nIdx] += weight;
                        }
                    }
                }
                
                // Identify unique candidates
                const uniqueCandidates: number[] = [];
                for (let i = 0; i < matchPalette.length; i++) {
                    if (localWeightsArray[i] > 0) {
                        uniqueCandidates.push(i);
                    }
                }

                // 2. STRUCTURAL FILTER (ARTIFACT REJECTION):
                // If a color in the neighborhood is mathematically a "Between" color 
                // of two other colors IN THE SAME neighborhood, it is an artifact (anti-aliasing).
                // We reject it from being a blend partner.
                const structuralCandidates = uniqueCandidates.filter(cIdx => {
                    const pC = matchPalette[cIdx];
                    const weightC = localWeightsArray[cIdx];

                    for (const aIdx of uniqueCandidates) {
                        for (const bIdx of uniqueCandidates) {
                            if (aIdx === cIdx || bIdx === cIdx || aIdx === bIdx) continue;

                            const pA = matchPalette[aIdx], pB = matchPalette[bIdx];
                            const weightA = localWeightsArray[aIdx];
                            const weightB = localWeightsArray[bIdx];

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
                    const weight = localWeightsArray[cIdx];
                    const err = (refR - p.r) ** 2 + (refG - p.g) ** 2 + (refB - p.b) ** 2;

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
                const weightB = localWeightsArray[blendB];
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
                    const dist1 = (refR - p1.r) ** 2 + (refG - p1.g) ** 2 + (refB - p1.b) ** 2;
                    const dist2 = (refR - p2.r) ** 2 + (refG - p2.g) ** 2 + (refB - p2.b) ** 2;
                    const winner = dist1 < dist2 ? p1 : p2;
                    const rgb = winner.targetHex ? hexToRgb(winner.targetHex)! : { r: winner.r, g: winner.g, b: winner.b };
                    finalColor = { ...rgb, id: winner.id };
                } else {
                    const c1p = matchPalette[blendA], c2p = matchPalette[blendB];
                    const dr = c2p.r - c1p.r, dg = c2p.g - c1p.g, db = c2p.b - c1p.b;
                    const pr = refR - c1p.r, pg = refG - c1p.g, pb = refB - c1p.b;
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
                        const c1 = matchPalette[blendA], c2 = matchPalette[blendB];
                        const noiseDistSq = (refR - c1.r) ** 2 + (refG - c1.g) ** 2 + (refB - c1.b) ** 2;
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

        const blob = await intelligentCompress(finalCanvas, upscaleFactor === 'NS');
        self.postMessage({ type: 'complete', result: blob });
        } // End of CPU fallback block

    } catch (error: any) {
        self.postMessage({ type: 'complete', error: error.message });
    }
};