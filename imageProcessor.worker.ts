import { ColorRGB, WorkerMessage, TintSettings } from './types';
import {
    rgbToHex,
    hexToRgb,
    findClosestColor,
    applyMedianFilter,
    rgbToHsl,
    hslToRgb,
    getHueDifference,
    shiftHue
} from './utils/colorUtils';

 * @param baseHue - The reference hue of the color group (0-360)
const rgbToInt = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

function applyTintRGB(r: number, g: number, b: number, baseHue: number, tint: TintSettings): ColorRGB {
    const hsl = rgbToHsl(r, g, b);
    let { h, s, l } = hsl;
    if (s < 5) {
        return hslToRgb(h, s, Math.max(0, Math.min(100, l + tint.lightness * (tint.lightnessForce / 100))));
    }
    const targetHue = shiftHue(tint.hue, getHueDifference(baseHue, h));
    h = tint.hueForce < 100 ? h + (targetHue - h) * (tint.hueForce / 100) : targetHue;
    s = Math.max(0, Math.min(100, s + (tint.saturation * (tint.saturationForce / 100))));
    l = Math.max(0, Math.min(100, l + (tint.lightness * (tint.lightnessForce / 100))));
    return hslToRgb(h, s, l);
}

async function intelligentCompress(canvas: OffscreenCanvas, isAutoMode: boolean): Promise<Blob> {
    const TARGET_SIZE = 150 * 1024;
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    if (!isAutoMode || pngBlob.size <= TARGET_SIZE) return pngBlob;
    try {
        const gifBlob = await canvas.convertToBlob({ type: 'image/gif' });
        if (gifBlob.size <= TARGET_SIZE) return gifBlob;
    } catch {}
    let low = 0.5, high = 1.0, bestBlob = pngBlob;
    for (let i = 0; i < 6; i++) {
        const mid = (low + high) / 2;
        const test = await canvas.convertToBlob({ type: 'image/jpeg', quality: mid });
        if (test.size <= TARGET_SIZE) { bestBlob = test; low = mid; } else high = mid;
    }
    return bestBlob;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    if (e.data.type !== 'process') return;
    const totalStart = performance.now();
    const { imageBitmap, parameters } = e.data;
    const { upscaleFactor, denoiseRadius, edgeProtection, vertexInertia, disablePostProcessing, disableRecoloring, disableScaling, palette, smoothingLevels, alphaSmoothness, preserveTransparency, recolorMode, tintOverrides } = parameters;

    try {
        const nativeWidth = imageBitmap.width, nativeHeight = imageBitmap.height;
        let targetUpscale = 1;
        if (!disableScaling) {
            targetUpscale = upscaleFactor === 'NS' 
                ? (nativeWidth >= nativeHeight ? Math.min(535/nativeWidth, 355/nativeHeight) : Math.min(321/nativeWidth, 568/nativeHeight))
                : (upscaleFactor as number);
        }

        const nativeCanvas = new OffscreenCanvas(nativeWidth, nativeHeight);
        const nCtx = nativeCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
        nCtx!.drawImage(imageBitmap, 0, 0);

        if (!disablePostProcessing && denoiseRadius > 0) {
            const dStart = performance.now();
            nCtx!.putImageData(applyMedianFilter(nCtx!.getImageData(0, 0, nativeWidth, nativeHeight), denoiseRadius), 0, 0);
            console.log(`[WORKER] Denoise: ${Math.round(performance.now() - dStart)}ms`);
        }

        if (disableRecoloring) {
            const fW = Math.round(nativeWidth * targetUpscale), fH = Math.round(nativeHeight * targetUpscale);
            const fCanvas = new OffscreenCanvas(fW, fH);
            fCanvas.getContext('2d')!.drawImage(nativeCanvas, 0, 0, fW, fH);
            self.postMessage({ type: 'complete', result: await intelligentCompress(fCanvas, upscaleFactor === 'NS') });
            return;
        }

        // --- PHASE 1: COLOR SOLVE (Unique Cache) ---
        const p1Start = performance.now();
        const nativePixelData = nCtx!.getImageData(0, 0, nativeWidth, nativeHeight).data;
        const lowResIdxMap = new Int16Array(nativeWidth * nativeHeight);
        const paletteSize = palette.length;
        const pR = new Uint8Array(paletteSize), pG = new Uint8Array(paletteSize), pB = new Uint8Array(paletteSize);
        const colorToIdxCache = new Map<number, number>();
        const paletteIdMap = new Map<string, number>();

        for (let i = 0; i < paletteSize; i++) {
            pR[i] = palette[i].r; pG[i] = palette[i].g; pB[i] = palette[i].b;
            paletteIdMap.set(palette[i].id, i);
            colorToIdxCache.set(rgbToInt(pR[i], pG[i], pB[i]), i);
        }
        if (parameters.colorGroups) {
            for (const g of parameters.colorGroups) {
                const pIdx = paletteIdMap.get(g.id);
                if (pIdx !== undefined) for (const m of g.members) {
                    const rgb = hexToRgb(m.hex);
                    if (rgb) colorToIdxCache.set(rgbToInt(rgb.r, rgb.g, rgb.b), pIdx);
                }
            }
        }

        let nativeAlpha: Uint8ClampedArray | null = null;
        if (preserveTransparency) {
            nativeAlpha = new Uint8ClampedArray(nativeWidth * nativeHeight);
        }

        for (let i = 0; i < nativePixelData.length; i += 4) {
            const r = nativePixelData[i], g = nativePixelData[i+1], b = nativePixelData[i+2];
            const key = rgbToInt(r, g, b);
            let pIdx = colorToIdxCache.get(key);
            if (pIdx === undefined) {
                let minDistSq = Infinity;
                for (let j = 0; j < paletteSize; j++) {
                    const dSq = (r - pR[j])**2 + (g - pG[j])**2 + (b - pB[j])**2;
                    if (dSq < minDistSq) { minDistSq = dSq; pIdx = j; }
                }
                colorToIdxCache.set(key, pIdx!);
            }
            const pxIdx = i >> 2;
            lowResIdxMap[pxIdx] = pIdx!;
            if (nativeAlpha) nativeAlpha[pxIdx] = nativePixelData[i+3];
        }
        console.log(`[WORKER] Phase 1: ${Math.round(performance.now() - p1Start)}ms`);

        // --- PHASE 2: SPARSE BLEED GUARD (Activity Mask + Color Tracking) ---
        if (edgeProtection > 0 && !disablePostProcessing) {
            const p2Start = performance.now();
            const tempIdxMap = new Int16Array(lowResIdxMap.length);
            const activeMask = new Uint8Array(lowResIdxMap.length);
            const localCounts = new Uint32Array(paletteSize);
            const foundColors = new Uint16Array(paletteSize);
            const stiffness = 1.0 - (vertexInertia / 100) * 0.8;
            const radius = edgeProtection > 85 ? 5 : edgeProtection > 66 ? 3 : Math.max(1, Math.round((edgeProtection / 100) * 3));
            const iters = edgeProtection > 85 ? 5 : edgeProtection > 66 ? 3 : Math.max(1, Math.round((edgeProtection / 100) * 4));

            for (let iter = 0; iter < iters; iter++) {
                // Activity Pass: Only check 1px neighbors to find edges
                for (let y = 1; y < nativeHeight - 1; y++) {
                    const rOff = y * nativeWidth;
                    for (let x = 1; x < nativeWidth - 1; x++) {
                        const i = rOff + x, c = lowResIdxMap[i];
                        if (c !== lowResIdxMap[i-1] || c !== lowResIdxMap[i+1] || c !== lowResIdxMap[i-nativeWidth] || c !== lowResIdxMap[i+nativeWidth]) {
                            activeMask[i] = 1;
                        } else {
                            activeMask[i] = 0; tempIdxMap[i] = c;
                        }
                    }
                }

                for (let y = 0; y < nativeHeight; y++) {
                    const rOff = y * nativeWidth;
                    const yS = Math.max(0, y - radius), yE = Math.min(nativeHeight - 1, y + radius);
                    for (let x = 0; x < nativeWidth; x++) {
                        const idx = rOff + x;
                        if (activeMask[idx] === 0) continue;

                        const xS = Math.max(0, x - radius), xE = Math.min(nativeWidth - 1, x + radius);
                        let foundCount = 0;
                        for (let ny = yS; ny <= yE; ny++) {
                            const nRow = ny * nativeWidth;
                            for (let nx = xS; nx <= xE; nx++) {
                                const nIdx = lowResIdxMap[nRow + nx];
                                if (localCounts[nIdx] === 0) foundColors[foundCount++] = nIdx;
                                localCounts[nIdx]++;
                            }
                        }

                        let m1 = 0, m1c = 0, m2 = 0, m2c = 0, m3 = 0, m3c = 0;
                        for (let j = 0; j < foundCount; j++) {
                            const pIdx = foundColors[j], c = localCounts[pIdx];
                            if (c > m1c) { m3 = m2; m3c = m2c; m2 = m1; m2c = m1c; m1 = pIdx; m1c = c; }
                            else if (c > m2c) { m3 = m2; m3c = m2c; m2 = pIdx; m2c = c; }
                            else if (c > m3c) { m3 = pIdx; m3c = c; }
                            localCounts[pIdx] = 0; // Clear for next pixel
                        }

                        if (m1 !== m2 && m2 !== m3) {
                            const d13Sq = (pR[m1]-pR[m3])**2 + (pG[m1]-pG[m3])**2 + (pB[m1]-pB[m3])**2;
                            const d12Sq = (pR[m1]-pR[m2])**2 + (pG[m1]-pG[m2])**2 + (pB[m1]-pB[m2])**2;
                            const d23Sq = (pR[m3]-pR[m2])**2 + (pG[m3]-pG[m2])**2 + (pB[m3]-pB[m2])**2;
                            // Betweenness Check
                            if (d12Sq + d23Sq + 2*Math.sqrt(d12Sq * d23Sq) < d13Sq * 1.21) { m2 = m3; m2c = m3c; }
                        }
                        if (m2c < ((yE-yS+1)*(xE-xS+1)) * 0.10) m2 = m1;

                        const cur = lowResIdxMap[idx], sI = idx << 2;
                        let e1 = (nativePixelData[sI]-pR[m1])**2 + (nativePixelData[sI+1]-pG[m1])**2 + (nativePixelData[sI+2]-pB[m1])**2;
                        let e2 = (nativePixelData[sI]-pR[m2])**2 + (nativePixelData[sI+1]-pG[m2])**2 + (nativePixelData[sI+2]-pB[m2])**2;
                        if (cur === m1) e1 *= stiffness; else if (cur === m2) e2 *= stiffness;
                        tempIdxMap[idx] = e1 < e2 ? m1 : m2;
                    }
                }
                lowResIdxMap.set(tempIdxMap);
            }
            console.log(`[WORKER] Phase 2: ${Math.round(performance.now() - p2Start)}ms`);
        }

        // --- PHASE 3: RECONSTRUCTION (LUT Optimized) ---
        const p3Start = performance.now();
        const wScale = targetUpscale * 4;
        const sScale = (nativeWidth * wScale * nativeHeight * wScale) > 10000000 ? Math.sqrt(10000000 / (nativeWidth * nativeHeight)) : wScale;
        const fWWidth = Math.round(nativeWidth * sScale), fWHeight = Math.round(nativeHeight * sScale);

        const wCanvas = new OffscreenCanvas(fWWidth, fWHeight);
        const wCtx = wCanvas.getContext('2d', { willReadFrequently: true });
        wCtx!.drawImage(nativeCanvas, 0, 0, fWWidth, fWHeight);
        const hResData = wCtx!.getImageData(0, 0, fWWidth, fWHeight).data;
        const outData = new Uint8ClampedArray(hResData.length);

        const pTR = new Uint8Array(paletteSize), pTG = new Uint8Array(paletteSize), pTB = new Uint8Array(paletteSize);
        const isTint = recolorMode === 'tint' && tintOverrides;
        for (let i = 0; i < paletteSize; i++) {
            const p = palette[i];
            let r = p.r, g = p.g, b = p.b;
            if (isTint && tintOverrides?.[p.id] !== undefined) {
                const group = parameters.colorGroups?.find(gr => gr.id === p.id);
                const tinted = applyTintRGB(r, g, b, group?.baseHue ?? 0, tintOverrides[p.id]);
                r = tinted.r; g = tinted.g; b = tinted.b;
            } else if (p.targetHex) {
                const trgb = hexToRgb(p.targetHex);
                if (trgb) { r = trgb.r; g = trgb.g; b = trgb.b; }
            }
            pTR[i] = r; pTG[i] = g; pTB[i] = b;
        }

        const intensity = (disablePostProcessing ? 0 : smoothingLevels) / 100;
        const k = 28 * (1 - intensity) + 8 * intensity, dz = 0.15 * (1 - intensity);
        const sigmoidLUT = new Float32Array(1025);
        const s0 = 1 / (1 + Math.exp(-k * -0.5)), s1 = 1 / (1 + Math.exp(-k * 0.5));
        for (let i = 0; i <= 1024; i++) {
            let t = i / 1024;
            if (t < dz) t = 0; else if (t > (1 - dz)) t = 1;
            sigmoidLUT[i] = ((1 / (1 + Math.exp(-k * (t - 0.5)))) - s0) / (s1 - s0);
        }

        const aI = (alphaSmoothness || 0) / 100;
        const aSigmoidLUT = new Float32Array(256);
        const ka = 20 * (1 - aI) + 2 * aI, as0 = 1 / (1 + Math.exp(-ka * -0.5)), as1 = 1 / (1 + Math.exp(-ka * 0.5));
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            aSigmoidLUT[i] = ((1 / (1 + Math.exp(-ka * (t - 0.5)))) - as0) / (as1 - as0);
        }

        const rw = new Float32Array(paletteSize), rAdj = new Uint8Array(paletteSize);
        const uC = new Uint16Array(paletteSize), sC = new Uint16Array(paletteSize);
        const sX = fWWidth / nativeWidth, sY = fWHeight / nativeHeight;

        for (let y = 0; y < fWHeight; y++) {
            const ly = Math.min(nativeHeight - 1, (y / sY) | 0), nativeRow = ly * nativeWidth;
            for (let x = 0; x < fWWidth; x++) {
                const lx = Math.min(nativeWidth - 1, (x / sX) | 0), oIdx = (y * fWWidth + x) << 2;
                rw.fill(0);
                let ucLen = 0;
                const y0 = Math.max(0, ly - 2), y1 = Math.min(nativeHeight - 1, ly + 2);
                const x0 = Math.max(0, lx - 2), x1 = Math.min(nativeWidth - 1, lx + 2);
                for (let ny = y0; ny <= y1; ny++) {
                    const dy = Math.abs(ny - ly), nRow = ny * nativeWidth;
                    for (let nx = x0; nx <= x1; nx++) {
                        const nIdx = lowResIdxMap[nRow + nx];
                        if (rw[nIdx] === 0) uC[ucLen++] = nIdx;
                        rw[nIdx] += (Math.abs(nx - lx) > 1 || dy > 1) ? 0.2 : (Math.abs(nx - lx) > 0 || dy > 0) ? 0.5 : 1.0;
                    }
                }

                if (ucLen === 1) {
                    const id = uC[0]; outData[oIdx] = pTR[id]; outData[oIdx+1] = pTG[id]; outData[oIdx+2] = pTB[id];
                    outData[oIdx+3] = nativeAlpha ? (aI === 0 ? nativeAlpha[nativeRow + lx] : (aSigmoidLUT[hResData[oIdx+3]] * 255) | 0) : 255;
                    continue;
                }

                const rR = hResData[oIdx], rG = hResData[oIdx+1], rB = hResData[oIdx+2];
                let scLen = 0;
                cand: for (let i = 0; i < ucLen; i++) {
                    const ci = uC[i], cr = pR[ci], cg = pG[ci], cb = pB[ci];
                    for (let j = 0; j < ucLen; j++) {
                        const ai = uC[j]; if (ai === ci) continue;
                        for (let k = 0; k < ucLen; k++) {
                            const bi = uC[k]; if (bi === ci || ai === bi) continue;
                            const dAB = (pR[ai]-pR[bi])**2 + (pG[ai]-pG[bi])**2 + (pB[ai]-pB[bi])**2;
                            const dAC = (pR[ai]-cr)**2 + (pG[ai]-cg)**2 + (pB[ai]-cb)**2;
                            const dBC = (pR[bi]-cr)**2 + (pG[bi]-cg)**2 + (pB[bi]-cb)**2;
                            if (dAC + dBC + 2*Math.sqrt(dAC*dBC) < dAB * 1.21 && dAB > 100 && rw[ai] > rw[ci] && rw[bi] > rw[ci]) continue cand;
                        }
                    }
                    sC[scLen++] = ci;
                }

                rAdj.fill(0);
                const y30 = Math.max(0, ly - 1), y31 = Math.min(nativeHeight - 1, ly + 1);
                const x30 = Math.max(0, lx - 1), x31 = Math.min(nativeWidth - 1, lx + 1);
                for (let ny = y30; ny <= y31; ny++) {
                    const row = ny * nativeWidth;
                    for (let nx = x30; nx <= x31; nx++) rAdj[lowResIdxMap[row + nx]] = 1;
                }

                let maxS = -Infinity, m1 = sC[0];
                for (let i = 0; i < scLen; i++) {
                    const idx = sC[i];
                    const score = (rw[idx] * 10) + (rAdj[idx] ? 0 : -1000) - ((rR-pR[idx])**2 + (rG-pG[idx])**2 + (rB-pB[idx])**2);
                    if (score > maxS) { maxS = score; m1 = idx; }
                }
                
                let m2 = m1, sM2 = -Infinity;
                for (let i = 0; i < scLen; i++) {
                    const idx = sC[i];
                    if (idx === m1) continue;
                    const score = (rw[idx] * 10) + (rAdj[idx] ? 0 : -1000) - ((rR-pR[idx])**2 + (rG-pG[idx])**2 + (rB-pB[idx])**2);
                    if (score > sM2) { sM2 = score; m2 = idx; }
                }
                if (sM2 <= -500) m2 = m1;

                const core = lowResIdxMap[nativeRow + lx];
                let isS = false;
                for (let i = 0; i < scLen; i++) if (sC[i] === core) { isS = true; break; }
                let bA = isS ? core : m1, bB = (bA === m1) ? m2 : m1;
                if (rw[bB] < 0.3) bB = bA;

                if (bA === bB || intensity === 0) {
                    const win = ((rR-pR[bA])**2+(rG-pG[bA])**2+(rB-pB[bA])**2 < (rR-pR[bB])**2+(rG-pG[bB])**2+(rB-pB[bB])**2) ? bA : bB;
                    outData[oIdx] = pTR[win]; outData[oIdx+1] = pTG[win]; outData[oIdx+2] = pTB[win];
                } else {
                    const c1r = pR[bA], c1g = pG[bA], c1b = pB[bA], dr = pR[bB]-c1r, dg = pG[bB]-c1g, db = pB[bB]-c1b, lSq = dr*dr+dg*dg+db*db;
                    let t = lSq > 0 ? Math.max(0, Math.min(1, ((rR-c1r)*dr+(rG-c1g)*dg+(rB-c1b)*db)/lSq)) : 0;
                    if (t > 0 && t < 1 && (t < 0.4 || t > 0.6)) {
                        const mr = (c1r+pR[bB])/2, mg = (c1g+pG[bB])/2, mb = (c1b+pB[bB])/2, rDSq = (c1r-mr)**2+(c1g-mg)**2+(c1b-mb)**2;
                        let ok = false, sRad = intensity > 0.7 ? 3 : 2;
                        search: for (let ny = -sRad; ny <= sRad; ny++) {
                            for (let nx = -sRad; nx <= sRad; nx++) {
                                if (nx === 0 && ny === 0) continue;
                                const nY = Math.max(0, Math.min(fWHeight-1, y+ny)), nX = Math.max(0, Math.min(fWWidth-1, x+nx)), nI = (nY*fWWidth+nX)<<2;
                                if ((hResData[nI]-mr)**2+(hResData[nI+1]-mg)**2+(hResData[nI+2]-mb)**2 < rDSq*(0.6+intensity*0.2)) { ok = true; break search; }
                            }
                        }
                        if (!ok) t = t < 0.5 ? 0 : 1;
                    }
                    if (t > 0 && t < 0.25 && (rR-c1r)**2+(rG-c1g)**2+(rB-c1b)**2 < lSq*(0.05*(1-intensity))) t = 0;
                    const fT = sigmoidLUT[(t * 1024) | 0];
                    outData[oIdx] = (pTR[bA] + fT * (pTR[bB]-pTR[bA])) | 0;
                    outData[oIdx+1] = (pTG[bA] + fT * (pTG[bB]-pTG[bA])) | 0;
                    outData[oIdx+2] = (pTB[bA] + fT * (pTB[bB]-pTB[bA])) | 0;
                }
                outData[oIdx+3] = nativeAlpha && hResData[oIdx+3] < 255 ? (aSigmoidLUT[hResData[oIdx+3]] * 255) | 0 : 255;
            }
        }
        console.log(`[WORKER] Phase 3: ${Math.round(performance.now() - p3Start)}ms`);

        wCtx!.putImageData(new ImageData(outData, fWWidth, fWHeight), 0, 0);
        const fCanvas = new OffscreenCanvas(Math.round(nativeWidth * targetUpscale), Math.round(nativeHeight * targetUpscale));
        fCanvas.getContext('2d')!.drawImage(wCanvas, 0, 0, fCanvas.width, fCanvas.height);
        console.log(`[WORKER] Total: ${Math.round(performance.now() - totalStart)}ms`);
        self.postMessage({ type: 'complete', result: await intelligentCompress(fCanvas, upscaleFactor === 'NS') });
    } catch (e: any) { self.postMessage({ type: 'complete', error: e.message }); }
};