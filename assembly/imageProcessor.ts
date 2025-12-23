/// <reference types="assemblyscript/std/assembly" />

// -- MEMORY & GLOBALS --
const MAX_PALETTE_SIZE: i32 = 4096; 
// Use f64 for buffers to match JS double precision
const countBuffer = new Float64Array(MAX_PALETTE_SIZE); 
const candidates = new Int32Array(25); 
const weights = new Float64Array(25);  
const candidateStatus = new Int8Array(25); // 1 = Valid, 0 = Artifact

// -- MATH UTILS (Updated to f64) --

// @ts-ignore
@inline
function getDistSq(r1: u8, g1: u8, b1: u8, r2: u8, g2: u8, b2: u8): f64 {
  const dr = f64(r1) - f64(r2);
  const dg = f64(g1) - f64(g2);
  const db = f64(b1) - f64(b2);
  return dr * dr + dg * dg + db * db;
}

// @ts-ignore
@inline
function getDist(r1: u8, g1: u8, b1: u8, r2: u8, g2: u8, b2: u8): f64 {
  return Math.sqrt(getDistSq(r1, g1, b1, r2, g2, b2));
}

function findClosestPaletteIndex(r: u8, g: u8, b: u8, palettePtr: usize, paletteCount: i32): i32 {
  let minDist: f64 = f64.MAX_VALUE;
  let idx: i32 = 0;
  for (let i = 0; i < paletteCount; i++) {
    const pr = load<u8>(palettePtr + usize(i * 3));
    const pg = load<u8>(palettePtr + usize(i * 3 + 1));
    const pb = load<u8>(palettePtr + usize(i * 3 + 2));
    const dist = getDistSq(r, g, b, pr, pg, pb);
    if (dist < minDist) { minDist = dist; idx = i; }
  }
  return idx;
}

// --- PHASE 1 & 2: LOW RES SOLVE ---

export function processLowRes(
  srcPtr: usize, width: i32, height: i32,
  palettePtr: usize, paletteCount: i32,
  edgeProtection: f64, vertexInertia: f64
): usize {
  const pixelCount = width * height;
  const idxMapPtr = heap.alloc(pixelCount * 2); 
  const safePalCount = i32(Math.min(f64(paletteCount), f64(MAX_PALETTE_SIZE)));
  
  // 1. Simple Matching
  for (let i = 0; i < pixelCount; i++) {
    const offset = usize(i * 4);
    const r = load<u8>(srcPtr + offset);
    const g = load<u8>(srcPtr + offset + 1);
    const b = load<u8>(srcPtr + offset + 2);
    const pIdx = findClosestPaletteIndex(r, g, b, palettePtr, safePalCount);
    store<i16>(idxMapPtr + usize(i * 2), i16(pIdx));
  }

  // 2. Edge Protection
  if (edgeProtection > 0.0) {
    let radius: i32 = i32(Math.max(1.0, Math.round((edgeProtection / 100.0) * 3.0)));
    let iterations: i32 = i32(Math.max(1.0, Math.round((edgeProtection / 100.0) * 4.0)));
    if (edgeProtection > 66.0) { radius = 3; iterations = 3; }
    if (edgeProtection > 85.0) { radius = 5; iterations = 5; }

    const tempMapPtr = heap.alloc(pixelCount * 2);
    memory.copy(tempMapPtr, idxMapPtr, pixelCount * 2);

    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 0; y < height; y++) {
        const yStart = i32(Math.max(0.0, f64(y - radius)));
        const yEnd = i32(Math.min(f64(height - 1), f64(y + radius)));

        for (let x = 0; x < width; x++) {
          const xStart = i32(Math.max(0.0, f64(x - radius)));
          const xEnd = i32(Math.min(f64(width - 1), f64(x + radius)));

          // Clear buffer
          for (let k = 0; k < safePalCount; k++) countBuffer[k] = 0.0;

          for (let ny = yStart; ny <= yEnd; ny++) {
            for (let nx = xStart; nx <= xEnd; nx++) {
              const nIdx = i32(load<i16>(idxMapPtr + usize(ny * width + nx) * 2));
              if (nIdx >= 0 && nIdx < safePalCount) countBuffer[nIdx] += 1.0;
            }
          }

          // Identify majors
          let m1 = 0, m2 = 0, m3 = 0; 
          let c1 = -1.0, c2 = -1.0, c3 = -1.0;

          for (let k = 0; k < safePalCount; k++) {
            const c = countBuffer[k];
            if (c > c1) { m3=m2; c3=c2; m2=m1; c2=c1; m1=k; c1=c; }
            else if (c > c2) { m3=m2; c3=c2; m2=k; c2=c; }
            else if (c > c3) { m3=k; c3=c; }
          }

          if (m1 != m2 && m2 != m3) {
             const d13 = getDist(
               load<u8>(palettePtr + usize(m1*3)), load<u8>(palettePtr + usize(m1*3+1)), load<u8>(palettePtr + usize(m1*3+2)),
               load<u8>(palettePtr + usize(m3*3)), load<u8>(palettePtr + usize(m3*3+1)), load<u8>(palettePtr + usize(m3*3+2))
             );
             const d12 = getDist(
               load<u8>(palettePtr + usize(m1*3)), load<u8>(palettePtr + usize(m1*3+1)), load<u8>(palettePtr + usize(m1*3+2)),
               load<u8>(palettePtr + usize(m2*3)), load<u8>(palettePtr + usize(m2*3+1)), load<u8>(palettePtr + usize(m2*3+2))
             );
             const d23 = getDist(
               load<u8>(palettePtr + usize(m3*3)), load<u8>(palettePtr + usize(m3*3+1)), load<u8>(palettePtr + usize(m3*3+2)),
               load<u8>(palettePtr + usize(m2*3)), load<u8>(palettePtr + usize(m2*3+1)), load<u8>(palettePtr + usize(m2*3+2))
             );
             if (d12 + d23 < d13 * 1.10) { m2 = m3; }
          }

          const totalWindow = f64((yEnd - yStart + 1) * (xEnd - xStart + 1));
          if (countBuffer[m2] < (totalWindow * 0.10)) m2 = m1;

          const currentIdx = i32(load<i16>(idxMapPtr + usize(y * width + x) * 2));
          let finalIdx: i16;

          if (currentIdx != m1 && currentIdx != m2) {
             const dist1 = getDistSq(load<u8>(palettePtr + usize(currentIdx*3)), load<u8>(palettePtr + usize(currentIdx*3+1)), load<u8>(palettePtr + usize(currentIdx*3+2)), load<u8>(palettePtr + usize(m1*3)), load<u8>(palettePtr + usize(m1*3+1)), load<u8>(palettePtr + usize(m1*3+2)));
             const dist2 = getDistSq(load<u8>(palettePtr + usize(currentIdx*3)), load<u8>(palettePtr + usize(currentIdx*3+1)), load<u8>(palettePtr + usize(currentIdx*3+2)), load<u8>(palettePtr + usize(m2*3)), load<u8>(palettePtr + usize(m2*3+1)), load<u8>(palettePtr + usize(m2*3+2)));
             finalIdx = i16(dist1 < dist2 ? m1 : m2);
          } else {
             const srcOff = usize(y * width + x) * 4;
             let err1 = getDistSq(load<u8>(srcPtr + srcOff), load<u8>(srcPtr + srcOff + 1), load<u8>(srcPtr + srcOff + 2), load<u8>(palettePtr + usize(m1*3)), load<u8>(palettePtr + usize(m1*3+1)), load<u8>(palettePtr + usize(m1*3+2)));
             let err2 = getDistSq(load<u8>(srcPtr + srcOff), load<u8>(srcPtr + srcOff + 1), load<u8>(srcPtr + srcOff + 2), load<u8>(palettePtr + usize(m2*3)), load<u8>(palettePtr + usize(m2*3+1)), load<u8>(palettePtr + usize(m2*3+2)));
             const stiffness = 1.0 - (vertexInertia / 100.0) * 0.8;
             if (currentIdx == m1) err1 *= stiffness;
             if (currentIdx == m2) err2 *= stiffness;
             finalIdx = i16(err1 < err2 ? m1 : m2);
          }
          store<i16>(tempMapPtr + usize(y * width + x) * 2, finalIdx);
        }
      }
      memory.copy(idxMapPtr, tempMapPtr, pixelCount * 2);
    }
    heap.free(tempMapPtr);
  }
  return idxMapPtr;
}

// --- PHASE 3: HIGH RES (Updated to f64 & Logic Parity) ---

export function processHighRes(
  nativeWidth: i32, nativeHeight: i32,
  destWidth: i32, destHeight: i32,
  highResPtr: usize, 
  lowResIdxMapPtr: usize,
  palettePtr: usize,
  outputPalettePtr: usize,
  paletteCount: i32,
  smoothingLevels: f64
): usize {
  const destLen = destWidth * destHeight * 4;
  const outputPtr = heap.alloc(destLen);
  const safePalCount = i32(Math.min(f64(paletteCount), f64(MAX_PALETTE_SIZE)));
  const scaleX = f64(destWidth) / f64(nativeWidth);
  const scaleY = f64(destHeight) / f64(nativeHeight);

  // Constants (f64)
  const intensity = smoothingLevels / 100.0;
  const deadzone = 0.15 * (1.0 - intensity);
  const blipSensitivity = 0.05 * (1.0 - intensity);
  const kSig = 28.0 * (1.0 - intensity) + 8.0 * intensity;
  const s0 = 1.0 / (1.0 + Math.exp(-kSig * -0.5));
  const s1 = 1.0 / (1.0 + Math.exp(-kSig * 0.5));
  const sDiff = s1 - s0;

  for (let y = 0; y < destHeight; y++) {
    // Parity: floor calculation
    const ly = i32(Math.min(f64(nativeHeight - 1), Math.floor(f64(y) / scaleY)));
    
    for (let x = 0; x < destWidth; x++) {
      const lx = i32(Math.min(f64(nativeWidth - 1), Math.floor(f64(x) / scaleX)));
      const outIdx = usize(y * destWidth + x) * 4;
      
      const r = load<u8>(highResPtr + outIdx);
      const g = load<u8>(highResPtr + outIdx + 1);
      const b = load<u8>(highResPtr + outIdx + 2);

      // --- 1. Neighborhood Weighting ---
      for (let k = 0; k < safePalCount; k++) countBuffer[k] = 0.0;
      
      const yMin = i32(Math.max(0.0, f64(ly - 2))), yMax = i32(Math.min(f64(nativeHeight - 1), f64(ly + 2)));
      const xMin = i32(Math.max(0.0, f64(lx - 2))), xMax = i32(Math.min(f64(nativeWidth - 1), f64(lx + 2)));

      for (let ny = yMin; ny <= yMax; ny++) {
        const dy = Math.abs(ny - ly);
        for (let nx = xMin; nx <= xMax; nx++) {
          const dx = Math.abs(nx - lx);
          const nIdx = i32(load<i16>(lowResIdxMapPtr + usize(ny * nativeWidth + nx) * 2));
          
          let w = 1.0;
          if (dx > 0 || dy > 0) w = 0.5;
          if (dx > 1 || dy > 1) w = 0.2;

          if (nIdx >= 0 && nIdx < safePalCount) countBuffer[nIdx] += w;
        }
      }

      let cCount = 0;
      for (let k = 0; k < safePalCount; k++) {
        if (countBuffer[k] > 0.0 && cCount < 25) { 
          candidates[cCount] = k; 
          weights[cCount] = countBuffer[k]; 
          candidateStatus[cCount] = 1; 
          cCount++; 
        }
      }

      // --- 2. Structural Filter ---
      for (let i = 0; i < cCount; i++) {
        const cIdx = candidates[i];
        const wC = weights[i];

        for (let j = 0; j < cCount; j++) {
           if (i == j) continue;
           for (let k = 0; k < cCount; k++) {
              if (k == i || k == j) continue;
              
              const aIdx = candidates[j];
              const bIdx = candidates[k];
              const wA = weights[j];
              const wB = weights[k];

              const dAB = getDist(
                 load<u8>(palettePtr+usize(aIdx*3)), load<u8>(palettePtr+usize(aIdx*3+1)), load<u8>(palettePtr+usize(aIdx*3+2)),
                 load<u8>(palettePtr+usize(bIdx*3)), load<u8>(palettePtr+usize(bIdx*3+1)), load<u8>(palettePtr+usize(bIdx*3+2))
              );
              
              if (dAB > 10.0 && wA > wC && wB > wC) {
                 const dAC = getDist(
                   load<u8>(palettePtr+usize(aIdx*3)), load<u8>(palettePtr+usize(aIdx*3+1)), load<u8>(palettePtr+usize(aIdx*3+2)),
                   load<u8>(palettePtr+usize(cIdx*3)), load<u8>(palettePtr+usize(cIdx*3+1)), load<u8>(palettePtr+usize(cIdx*3+2))
                 );
                 const dBC = getDist(
                   load<u8>(palettePtr+usize(bIdx*3)), load<u8>(palettePtr+usize(bIdx*3+1)), load<u8>(palettePtr+usize(bIdx*3+2)),
                   load<u8>(palettePtr+usize(cIdx*3)), load<u8>(palettePtr+usize(cIdx*3+1)), load<u8>(palettePtr+usize(cIdx*3+2))
                 );
                 
                 if (dAC + dBC < dAB * 1.10) {
                    candidateStatus[i] = 0; // Artifact detected
                 }
              }
           }
        }
      }

      // --- 3. Identify Majors with Score ---
      let m1 = candidates[0]; 
      let m2 = candidates[0];
      let s1 = -999999.0; 
      let s2 = -999999.0;

      for (let i = 0; i < cCount; i++) {
        // PARITY: In JS, filtered candidates are removed from list. 
        // Here we skip them unless it's the only option.
        if (candidateStatus[i] == 0 && cCount > 1) continue; 
        
        const cIdx = candidates[i];
        const err = getDistSq(r, g, b, load<u8>(palettePtr + usize(cIdx * 3)), load<u8>(palettePtr + usize(cIdx * 3 + 1)), load<u8>(palettePtr + usize(cIdx * 3 + 2)));
        
        let adj = false;
        const ayMin = i32(Math.max(0.0, f64(ly - 1))), ayMax = i32(Math.min(f64(nativeHeight - 1), f64(ly + 1)));
        const axMin = i32(Math.max(0.0, f64(lx - 1))), axMax = i32(Math.min(f64(nativeWidth - 1), f64(lx + 1)));
        
        for (let ay = ayMin; ay <= ayMax; ay++) {
            for (let ax = axMin; ax <= axMax; ax++) {
                if (i32(load<i16>(lowResIdxMapPtr + usize(ay * nativeWidth + ax) * 2)) == cIdx) { adj = true; break; }
            }
            if (adj) break;
        }

        const score = (weights[i] * 10.0) + (adj ? 0.0 : -1000.0) - Math.sqrt(err);
        
        if (score > s1) { m2 = m1; s2 = s1; m1 = cIdx; s1 = score; }
        else if (score > s2) { m2 = cIdx; s2 = score; }
      }

      // PARITY FIX: JS check `if (scoredStructural[1].score > -500)`
      if (s2 <= -500.0) { m2 = m1; }

      // --- 4. Resolve Pair ---
      const coreIdx = i32(load<i16>(lowResIdxMapPtr + usize(ly * nativeWidth + lx) * 2));
      let isCoreStructural = true;
      for (let i = 0; i < cCount; i++) {
          if (candidates[i] == coreIdx && candidateStatus[i] == 0) { isCoreStructural = false; break; }
      }

      let bA: i32, bB: i32;
      
      if (!isCoreStructural) {
          bA = m1; bB = m2;
      } else {
          bA = coreIdx;
          bB = (coreIdx == m1) ? m2 : m1;
      }

      if (countBuffer[bB] < 0.3) bB = bA;

      // --- 5. Smoothing & Output ---
      let rF: u8, gF: u8, bF: u8;

      if (bA == bB || smoothingLevels == 0.0) {
        const d1 = getDistSq(r, g, b, load<u8>(palettePtr+usize(bA*3)), load<u8>(palettePtr+usize(bA*3+1)), load<u8>(palettePtr+usize(bA*3+2)));
        const d2 = getDistSq(r, g, b, load<u8>(palettePtr+usize(bB*3)), load<u8>(palettePtr+usize(bB*3+1)), load<u8>(palettePtr+usize(bB*3+2)));
        const win = (d1 < d2) ? bA : bB;
        rF = load<u8>(outputPalettePtr + usize(win*3)); gF = load<u8>(outputPalettePtr + usize(win*3+1)); bF = load<u8>(outputPalettePtr + usize(win*3+2));
      } else {
         const mR1 = f64(load<u8>(palettePtr + usize(bA*3))), mG1 = f64(load<u8>(palettePtr + usize(bA*3+1))), mB1 = f64(load<u8>(palettePtr + usize(bA*3+2)));
         const dr = f64(load<u8>(palettePtr+usize(bB*3))) - mR1, dg = f64(load<u8>(palettePtr+usize(bB*3+1))) - mG1, db = f64(load<u8>(palettePtr+usize(bB*3+2))) - mB1;
         const pr = f64(r) - mR1, pg = f64(g) - mG1, pb = f64(b) - mB1;
         const lSq = dr*dr + dg*dg + db*db;
         let t: f64 = (lSq > 0.0) ? Math.max(0.0, Math.min(1.0, (pr*dr + pg*dg + pb*db) / lSq)) : 0.0;
         
         // 5a. Orphan
         let isOrphan = false;
         if (t > 0.0 && t < 1.0) {
             const fringeWindow = 0.4 * (1.0 - intensity * 0.5);
             if (t < fringeWindow || t > (1.0 - fringeWindow)) {
                 const midR = (mR1 + f64(load<u8>(palettePtr+usize(bB*3)))) / 2.0;
                 const midG = (mG1 + f64(load<u8>(palettePtr+usize(bB*3+1)))) / 2.0;
                 const midB = (mB1 + f64(load<u8>(palettePtr+usize(bB*3+2)))) / 2.0;
                 const midDistRefSq = (mR1 - midR)**2 + (mG1 - midG)**2 + (mB1 - midB)**2;
                 
                 let hasMidNeighbor = false;
                 const rad = intensity > 0.7 ? 3 : 2;
                 for(let nyOff = -rad; nyOff <= rad; nyOff++) {
                     for(let nxOff = -rad; nxOff <= rad; nxOff++) {
                         if(nxOff==0 && nyOff==0) continue;
                         const nY = i32(Math.max(0.0, Math.min(f64(destHeight-1), f64(y + nyOff))));
                         const nX = i32(Math.max(0.0, Math.min(f64(destWidth-1), f64(x + nxOff))));
                         const nOff = usize(nY * destWidth + nX) * 4;
                         // Read from scaled source
                         const nr = f64(load<u8>(highResPtr + nOff));
                         const ng = f64(load<u8>(highResPtr + nOff + 1));
                         const nb = f64(load<u8>(highResPtr + nOff + 2));
                         
                         const nDistMidSq = (nr - midR)**2 + (ng - midG)**2 + (nb - midB)**2;
                         const simThresh = 0.6 + (intensity * 0.2);
                         if (nDistMidSq < midDistRefSq * simThresh) { hasMidNeighbor = true; break; }
                     }
                     if(hasMidNeighbor) break;
                 }
                 if (!hasMidNeighbor) isOrphan = true;
             }
         }
         if (isOrphan) t = (t < 0.5) ? 0.0 : 1.0;

         // 5b. Blip
         if (t > 0.0 && t < 0.25) {
             const noiseDistSq = (f64(r) - mR1)**2 + (f64(g) - mG1)**2 + (f64(b) - mB1)**2;
             if (noiseDistSq < lSq * blipSensitivity) t = 0.0;
         }

         // 5c. Deadzone & Sigmoid
         if (t < deadzone) t = 0.0;
         if (t > (1.0 - deadzone)) t = 1.0;

         const rawS = 1.0 / (1.0 + Math.exp(-kSig * (t - 0.5)));
         const fT = (rawS - s0) / sDiff;

         // PARITY: Explicit Rounding
         rF = u8(Math.round(f64(load<u8>(outputPalettePtr+usize(bA*3))) + fT * (f64(load<u8>(outputPalettePtr+usize(bB*3))) - f64(load<u8>(outputPalettePtr+usize(bA*3))))));
         gF = u8(Math.round(f64(load<u8>(outputPalettePtr+usize(bA*3+1))) + fT * (f64(load<u8>(outputPalettePtr+usize(bB*3+1))) - f64(load<u8>(outputPalettePtr+usize(bA*3+1))))));
         bF = u8(Math.round(f64(load<u8>(outputPalettePtr+usize(bA*3+2))) + fT * (f64(load<u8>(outputPalettePtr+usize(bB*3+2))) - f64(load<u8>(outputPalettePtr+usize(bA*3+2))))));
      }
      
      store<u8>(outputPtr + outIdx, rF); 
      store<u8>(outputPtr + outIdx + 1, gF); 
      store<u8>(outputPtr + outIdx + 2, bF); 
      store<u8>(outputPtr + outIdx + 3, 255);
    }
  }
  return outputPtr;
}

export function allocate(size: i32): usize { return heap.alloc(size); }
export function free(ptr: usize): void { heap.free(ptr); }