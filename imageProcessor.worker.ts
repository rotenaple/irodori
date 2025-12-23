import * as loader from "@assemblyscript/loader";

interface WasmExports {
  memory: WebAssembly.Memory;
  processLowRes(srcPtr: number, w: number, h: number, palPtr: number, palCount: number, edge: number, inertia: number): number;
  processHighRes(nw: number, nh: number, dw: number, dh: number, hrPtr: number, lrMapPtr: number, pPtr: number, oPtr: number, pCount: number, smooth: number): number;
  allocate(size: number): number;
  free(ptr: number): void;
}

let wasmModule: WasmExports | null = null;

async function loadWasm() {
  if (wasmModule) return wasmModule;
  const response = await fetch('/imageProcessor.wasm'); 
  const instance = await loader.instantiate<any>(response, {
    env: { abort: (_: any, __: any, line: number, col: number) => console.error(`AS Abort at ${line}:${col}`) }
  });
  return wasmModule = instance.exports as unknown as WasmExports;
}

function hexToRgb(hex: string) {
    // Basic safety check
    if (!hex || !hex.startsWith('#')) return { r: 0, g: 0, b: 0 };
    const bigint = parseInt(hex.replace('#', ''), 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

self.onmessage = async (e: MessageEvent) => {
    if (e.data.type !== 'process') return;
    const { imageBitmap, parameters } = e.data;
    
    try {
        const exports = await loadWasm();
        const { width: nw, height: nh } = imageBitmap;

        const nCanvas = new OffscreenCanvas(nw, nh);
        const nCtx = nCanvas.getContext('2d', { willReadFrequently: true })!;
        nCtx.drawImage(imageBitmap, 0, 0);
        // Important: Apply the same Denoise logic here if it was in the old code
        // (Old code had applyMedianFilter before scaling. If that's needed, it must be done in JS or ported to WASM)
        // For parity with Phase 1, we assume raw native data is passed.

        const nData = nCtx.getImageData(0, 0, nw, nh).data;

        // PARITY NOTE: In Old Code, 'palette' contained duplicates if 'colorGroups' was used.
        // WASM simply finds the closest mathematical match.
        // If strict ID mapping is required, parameters.palette passed here should be unique "target" centers.
        const pCount = parameters.palette.length;
        const mPal = new Uint8Array(pCount * 3);
        const oPal = new Uint8Array(pCount * 3);

        parameters.palette.forEach((p: any, i: number) => {
            const rgb = p.hex ? hexToRgb(p.hex) : { r: p.r, g: p.g, b: p.b };
            // If targetHex exists, use it for output, otherwise input color
            const trgb = p.targetHex ? hexToRgb(p.targetHex) : rgb;
            mPal.set([rgb.r, rgb.g, rgb.b], i * 3);
            oPal.set([trgb.r, trgb.g, trgb.b], i * 3);
        });

        // ... (Allocation and calls remain same) ...
        const srcPtr = exports.allocate(nData.length);
        new Uint8Array(exports.memory.buffer).set(nData, srcPtr);
        const mPalPtr = exports.allocate(mPal.length);
        new Uint8Array(exports.memory.buffer).set(mPal, mPalPtr);
        const oPalPtr = exports.allocate(oPal.length);
        new Uint8Array(exports.memory.buffer).set(oPal, oPalPtr);

        const lrMapPtr = exports.processLowRes(
             srcPtr, nw, nh, mPalPtr, pCount, 
             parameters.edgeProtection, parameters.vertexInertia
        );
        exports.free(srcPtr);

        // Scaling Calculation Parity
        let targetUpscale = 1;
        if (!parameters.disableScaling) {
            if (parameters.upscaleFactor === 'NS') {
                const longNative = Math.max(nw, nh);
                const shortNative = Math.min(nw, nh);
                const scaleA = Math.min(535 / longNative, 355 / shortNative);
                const scaleB = Math.min(568 / longNative, 321 / shortNative);
                targetUpscale = Math.max(scaleA, scaleB);
            } else {
                targetUpscale = parameters.upscaleFactor;
            }
        }
        
        const fw = Math.round(nw * targetUpscale);
        const fh = Math.round(nh * targetUpscale);

        const wCanvas = new OffscreenCanvas(fw, fh);
        const wCtx = wCanvas.getContext('2d', { willReadFrequently: true })!;
        // OLD CODE: Used imageSmoothingQuality = 'high'
        wCtx.imageSmoothingEnabled = true;
        wCtx.imageSmoothingQuality = 'high';
        wCtx.drawImage(nCanvas, 0, 0, fw, fh);
        
        const hData = wCtx.getImageData(0, 0, fw, fh).data;
        const hrPtr = exports.allocate(hData.length);
        new Uint8Array(exports.memory.buffer).set(hData, hrPtr);

        const resPtr = exports.processHighRes(
            nw, nh, fw, fh, hrPtr, lrMapPtr, mPalPtr, oPalPtr, pCount, parameters.smoothingLevels
        );

        // ... (Cleanup and Response remains same) ...
        const resView = new Uint8ClampedArray(exports.memory.buffer, resPtr, fw * fh * 4);
        const resImageData = new ImageData(new Uint8ClampedArray(resView), fw, fh);

        [mPalPtr, oPalPtr, lrMapPtr, hrPtr, resPtr].forEach(ptr => exports.free(ptr));

        wCtx.putImageData(resImageData, 0, 0);
        const blob = await wCanvas.convertToBlob({ type: 'image/png' });
        self.postMessage({ type: 'complete', result: blob });

    } catch (error: any) {
        // ... error handling
    }
};