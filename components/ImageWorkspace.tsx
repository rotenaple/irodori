import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { formatSize } from '../utils/formatUtils';
import { rgbToHex, hexToRgb } from '../utils/colorUtils';
import { ColorGroup, PixelArtConfig } from '../types';

interface ImageWorkspaceProps {
  image: string | null;
  processedImage: string | null;
  activeTab: 'original' | 'processed';
  setActiveTab: (t: 'original' | 'processed') => void;
  originalSize: number;
  processedSize: number;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onAddFromMagnifier: (hex: string) => void;
  hoveredColor: string | null;
  hoveredGroupId: string | null;
  colorGroups: ColorGroup[];
  isSvg: boolean;
  mobileViewTarget: { id: string, type: 'group' | 'color' } | null;
  onClearMobileView: () => void;
  pixelArtConfig: PixelArtConfig;
}

const MAGNIFIER_SIZE = 245;
const ZOOM_PIXELS = 35;
const VISUAL_PIXEL_SIZE = MAGNIFIER_SIZE / ZOOM_PIXELS;

export const ImageWorkspace: React.FC<ImageWorkspaceProps> = ({
  image, processedImage, activeTab, setActiveTab,
  originalSize, processedSize, canvasRef, onAddFromMagnifier,
  hoveredColor, hoveredGroupId, colorGroups,
  isSvg,
  mobileViewTarget,
  onClearMobileView,
  pixelArtConfig
}) => {
  const [magnifierPos, setMagnifierPos] = useState<{
    screenX: number,
    screenY: number,
    locked: boolean,
    hex: string,
    px: number,
    py: number,
    sourceWidth: number,
    sourceHeight: number
  } | null>(null);

  const processedCanvasRef = useRef<HTMLCanvasElement>(null);

  // Ref for the outer flexible container
  const parentRef = useRef<HTMLDivElement>(null);
  // Ref for the tight wrapper around the image
  const containerRef = useRef<HTMLDivElement>(null);

  // CACHE: Store the raw pixel data
  const cachedSourceDataRef = useRef<Uint32Array | null>(null);
  const cachedDimensionsRef = useRef<{ w: number, h: number } | null>(null);

  const targetPosRef = useRef<{ x: number, y: number } | null>(null);
  const currentPosRef = useRef<{ x: number, y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const [layoutDims, setLayoutDims] = useState<{ width: number, height: number } | null>(null);
  const [activeImageDims, setActiveImageDims] = useState<{ width: number, height: number } | null>(null);

  // 1. Load Processed Image
  useEffect(() => {
    if (processedImage && processedCanvasRef.current) {
      const img = new Image();
      img.src = processedImage;
      img.onload = () => {
        const canvas = processedCanvasRef.current;
        if (canvas) {
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d')?.drawImage(img, 0, 0);

          if (activeTab === 'processed') {
            setActiveImageDims({ width: img.width, height: img.height });
          }
        }
      };
    }
  }, [processedImage, activeTab]);

  // 2. Track Original Image Dims & Cache Data
  useEffect(() => {
    if (activeTab === 'original' && image) {
      const img = new Image();
      img.src = image;
      img.onload = () => {
        let w = img.width;
        let h = img.height;

        if (w === 0 || h === 0) {
          w = img.naturalWidth || 800;
          h = img.naturalHeight || 600;
        }

        setActiveImageDims({ width: w, height: h });

        if (!isSvg) {
          const offCanvas = document.createElement('canvas');
          offCanvas.width = w;
          offCanvas.height = h;
          const ctx = offCanvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, w, h);
            // Store as Uint32 for fast copying
            cachedSourceDataRef.current = new Uint32Array(imageData.data.buffer);
            cachedDimensionsRef.current = { w, h };
          }
        }
      };
    } else {
      cachedSourceDataRef.current = null;
    }
  }, [image, activeTab, isSvg]);

  // 3. Layout Logic
  useLayoutEffect(() => {
    if (!parentRef.current || !activeImageDims) return;

    const calculateLayout = () => {
      if (!parentRef.current || !activeImageDims) return;

      const pW = parentRef.current.clientWidth;
      const pH = parentRef.current.clientHeight;
      const isMobile = window.innerWidth < 768;
      const availW = pW - (isMobile ? 0 : 32);
      const availH = pH - (isMobile ? 0 : 32);

      const { width: imgW, height: imgH } = activeImageDims;
      if (!imgW || !imgH) return;

      const imgAspect = imgW / imgH;
      const parentAspect = availW / availH;

      let renderW, renderH;

      if (isMobile) {
        // Mobile: Maximize width, let height grow (scroll)
        renderW = availW;
        renderH = availW / imgAspect;
      } else {
        // Desktop: Contain within available space
        if (imgAspect > parentAspect) {
          renderW = availW;
          renderH = availW / imgAspect;
        } else {
          renderH = availH;
          renderW = availH * imgAspect;
        }
      }

      setLayoutDims({ width: renderW, height: renderH });
    };

    calculateLayout();

    const observer = new ResizeObserver(calculateLayout);
    observer.observe(parentRef.current);

    return () => observer.disconnect();
  }, [activeImageDims]);


  // Cleanup animation frame
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const updateMagnifierState = useCallback((params: {
    screenX: number,
    screenY: number,
    container: HTMLDivElement,
    sourceCanvas: HTMLCanvasElement
  }) => {
    const { screenX, screenY, container, sourceCanvas } = params;

    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;

    const scale = Math.min(cw / sw, ch / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;

    const relMouseX = screenX - rect.left - ox;
    const relMouseY = screenY - rect.top - oy;

    const px = Math.floor(relMouseX / scale);
    const py = Math.floor(relMouseY / scale);

    if (px >= 0 && px < sw && py >= 0 && py < sh) {
      let currentHex = '';
      const pixel = sourceCanvas.getContext('2d', { willReadFrequently: true })?.getImageData(px, py, 1, 1).data;
      if (pixel) currentHex = rgbToHex(pixel[0], pixel[1], pixel[2]);

      return {
        screenX,
        screenY,
        locked: false,
        hex: currentHex,
        px,
        py,
        sourceWidth: sw,
        sourceHeight: sh
      };
    }
    return null;
  }, []);

  const animate = useCallback(() => {
    if (!targetPosRef.current || !containerRef.current) return;

    if (!currentPosRef.current) {
      currentPosRef.current = { ...targetPosRef.current };
    }

    const target = targetPosRef.current;
    const current = currentPosRef.current;

    const lerpFactor = 0.15;
    const dx = target.x - current.x;
    const dy = target.y - current.y;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      current.x = target.x;
      current.y = target.y;
    } else {
      current.x += dx * lerpFactor;
      current.y += dy * lerpFactor;
    }

    const container = containerRef.current;
    const sourceCanvas = activeTab === 'original' ? canvasRef.current : processedCanvasRef.current;

    if (container && sourceCanvas) {
      const newState = updateMagnifierState({
        screenX: current.x,
        screenY: current.y,
        container,
        sourceCanvas
      });

      setMagnifierPos(prev => {
        if (prev?.locked) return prev;
        return newState;
      });
    }

    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
      rafRef.current = requestAnimationFrame(animate);
    } else {
      rafRef.current = null;
    }
  }, [activeTab, canvasRef, updateMagnifierState]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (magnifierPos?.locked) return;
    targetPosRef.current = { x: e.clientX, y: e.clientY };
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(animate);
    }
  }, [magnifierPos?.locked, animate]);

  const handleMouseLeave = useCallback(() => {
    if (!magnifierPos?.locked) {
      setMagnifierPos(null);
      targetPosRef.current = null;
      currentPosRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [magnifierPos?.locked]);

  const handleAdd = () => {
    if (magnifierPos) {
      onAddFromMagnifier(magnifierPos.hex);
    }
  };

  const getMagnifierBackgroundSize = () => {
    if (!magnifierPos) return '0 0';
    return `${magnifierPos.sourceWidth * VISUAL_PIXEL_SIZE}px ${magnifierPos.sourceHeight * VISUAL_PIXEL_SIZE}px`;
  };

  const getMagnifierBackgroundPosition = () => {
    if (!magnifierPos) return '0 0';
    const centerXInZoom = (magnifierPos.px + 0.5) * VISUAL_PIXEL_SIZE;
    const centerYInZoom = (magnifierPos.py + 0.5) * VISUAL_PIXEL_SIZE;
    const offsetX = (MAGNIFIER_SIZE / 2) - centerXInZoom;
    const offsetY = (MAGNIFIER_SIZE / 2) - centerYInZoom;
    return `${offsetX}px ${offsetY}px`;
  };

  const magnifierCoords = (() => {
    if (!magnifierPos) return null;
    let left = magnifierPos.screenX - (MAGNIFIER_SIZE / 2);
    let top = magnifierPos.screenY - (MAGNIFIER_SIZE + 40);

    const padding = 20;
    if (left < padding) left = padding;
    if (left + MAGNIFIER_SIZE > window.innerWidth - padding) left = window.innerWidth - MAGNIFIER_SIZE - padding;
    if (top < padding) top = magnifierPos.screenY + 40;
    if (top + MAGNIFIER_SIZE > window.innerHeight - padding) top = window.innerHeight - MAGNIFIER_SIZE - padding;

    return { top, left };
  })();

  const isHighlighActive = (hoveredColor || hoveredGroupId || mobileViewTarget) && activeTab === 'original' && !isSvg;

  return (
    <div className="flex flex-col gap-2 md:gap-1.5 w-full h-auto md:h-full min-h-0">
      <div className="flex items-center justify-between px-1 pt-1 pb-2 md:pb-1.5 border-b border-[#333]/5">
        <div className="flex bg-[#EBEBEB] p-1 rounded-xl gap-1">
          <button
            onClick={() => setActiveTab('original')}
            className={`px-3 md:px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${activeTab === 'original' ? 'bg-white text-[#333] shadow-sm' : 'text-[#333] hover:bg-black/5'}`}
          >
            Original
          </button>
          <button
            onClick={() => setActiveTab('processed')}
            disabled={!processedImage}
            className={`px-3 md:px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${activeTab === 'processed' ? 'bg-white text-[#333] shadow-sm' : 'text-[#333] hover:bg-black/5 disabled:opacity-30'}`}
          >
            Processed
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right font-mono text-xs leading-tight">
            <div className="text-slate-400 font-bold tracking-tight mb-0.5 text-[10px]">FILE SIZE</div>
            <div className="flex items-center justify-end gap-2">
              <span className="font-semibold">{formatSize(originalSize)}</span>
              {processedSize > 0 && (
                <>
                  <i className="fa-solid fa-arrow-right text-xs text-[#33569a]"></i>
                  <span className="text-[#33569a] font-bold">{formatSize(processedSize)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={parentRef}
        className="relative flex-1 min-h-[150px] md:min-h-[400px] overflow-y-auto md:overflow-hidden group flex p-0 md:p-4 mb-16 bg-dots"
      >
        {!image ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center opacity-10">
            <i className="fa-solid fa-flag text-6xl mb-6"></i>
            <h3 className="tracking-widest text-base uppercase font-bold">Waiting for source</h3>
          </div>
        ) : (
          <div className="w-full min-h-full flex">
            <div
              ref={containerRef}
              className="relative shadow-sm transition-all duration-75 ease-linear m-auto"
              style={{
                width: layoutDims?.width,
                height: layoutDims?.height
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {/* Layer 1: Base Canvas (Visible) */}
              <canvas
                ref={canvasRef}
                onClick={() => magnifierPos && setMagnifierPos(p => p ? { ...p, locked: !p.locked } : null)}
                className={`w-full h-full object-contain ${activeTab === 'original' && !isSvg ? 'block' : 'hidden'} cursor-crosshair relative z-0`}
              />

              {/* Images for fallback/processed tabs */}
              {image && isSvg && activeTab === 'original' && (
                <img
                  src={image}
                  onClick={() => magnifierPos && setMagnifierPos(p => p ? { ...p, locked: !p.locked } : null)}
                  alt="Original"
                  className="w-full h-full object-contain cursor-crosshair relative z-0"
                />
              )}
              {processedImage && activeTab === 'processed' && (
                <img
                  src={processedImage}
                  onClick={() => magnifierPos && setMagnifierPos(p => p ? { ...p, locked: !p.locked } : null)}
                  alt="Cleaned"
                  className="w-full h-full object-contain cursor-crosshair relative z-0"
                />
              )}

              {/* Layer 2: Highlight Overlay (Handles dynamic color contrast) */}
              {isHighlighActive && cachedSourceDataRef.current && (
                <HighlightOverlay
                  sourceData={cachedSourceDataRef.current}
                  width={cachedDimensionsRef.current?.w || 0}
                  height={cachedDimensionsRef.current?.h || 0}
                  hoveredColor={hoveredColor}
                  hoveredGroupId={hoveredGroupId}
                  colorGroups={colorGroups}
                  mobileViewTarget={mobileViewTarget}
                />
              )}

              {/* Layer 3: Pixel Art Grid Overlay */}
              {pixelArtConfig.enabled
                && pixelArtConfig.showGrid
                && activeTab === 'original'
                && activeImageDims
                && activeImageDims.width > 0
                && activeImageDims.height > 0
                && layoutDims?.width
                && layoutDims?.height
                && (
                  <GridOverlay
                    width={layoutDims.width}
                    height={layoutDims.height}
                    imageWidth={activeImageDims.width}
                    imageHeight={activeImageDims.height}
                    config={pixelArtConfig}
                  />
                )}

              {/* Floating Dismiss Button */}
              {mobileViewTarget && (
                <button
                  onClick={onClearMobileView}
                  className="md:hidden absolute top-4 right-4 z-[60] bg-white/80 backdrop-blur-sm shadow-xl border border-black/10 text-black px-3 py-1.5 rounded-full font-bold text-[10px] uppercase tracking-wider flex items-center gap-2 hover:bg-black hover:text-white transition-all active:scale-95 animate-in fade-in zoom-in duration-200"
                >
                  <i className="fa-solid fa-eye-slash"></i>
                  <span>Clear</span>
                </button>
              )}
            </div>

            {magnifierPos && magnifierCoords && (
              <div
                className={`pointer-events-auto border-4 border-white rounded-full shadow-2xl overflow-hidden bg-white transition-all ${magnifierPos.locked ? 'ring-4 ring-[#33569a] scale-105' : ''}`}
                style={{
                  position: 'fixed',
                  top: `${magnifierCoords.top}px`,
                  left: `${magnifierCoords.left}px`,
                  width: `${MAGNIFIER_SIZE}px`,
                  height: `${MAGNIFIER_SIZE}px`,
                  zIndex: 150
                }}
              >
                <div className="absolute inset-0" style={{
                  backgroundImage: `url(${activeTab === 'original' ? image : processedImage})`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: getMagnifierBackgroundSize(),
                  backgroundPosition: getMagnifierBackgroundPosition(),
                  imageRendering: 'pixelated'
                }} />

                <div className="absolute inset-0 pointer-events-none opacity-[0.05]" style={{
                  backgroundImage: `linear-gradient(to right, #333 1px, transparent 1px), linear-gradient(to bottom, #333 1px, transparent 1px)`,
                  backgroundSize: `${VISUAL_PIXEL_SIZE}px ${VISUAL_PIXEL_SIZE}px`,
                  backgroundPosition: `${(MAGNIFIER_SIZE / 2) - (VISUAL_PIXEL_SIZE / 2)}px ${(MAGNIFIER_SIZE / 2) - (VISUAL_PIXEL_SIZE / 2)}px`
                }} />

                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="border-2 border-[#33569a] rounded-none shadow-[0_0_0_999px_rgba(255,255,255,0.1)]" style={{ width: `${VISUAL_PIXEL_SIZE}px`, height: `${VISUAL_PIXEL_SIZE}px` }} />
                </div>

                {magnifierPos.locked && (
                  <>
                    <button
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); setMagnifierPos(null); }}
                      className="absolute top-3 right-1/2 translate-x-1/2 w-8 h-8 bg-[#333] text-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                    >
                      <i className="fa-solid fa-xmark text-sm"></i>
                    </button>
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full border border-black/10 shadow-xl">
                      <div className="w-4 h-4 rounded-full border border-black/10 shadow-inner" style={{ backgroundColor: magnifierPos.hex }} />
                      <span className="text-sm font-bold font-mono text-[#333]">{magnifierPos.hex.toUpperCase()}</span>
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleAdd(); }}
                        className="ml-1 text-[#33569a] hover:opacity-70 transition-opacity"
                        title="Sample"
                      >
                        <i className="fa-solid fa-plus-circle text-lg"></i>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <canvas ref={processedCanvasRef} className="hidden" />
    </div>
  );
};

// --- OPTIMIZED OVERLAY COMPONENT ---
interface HighlightOverlayProps {
  sourceData: Uint32Array;
  width: number;
  height: number;
  hoveredColor: string | null;
  hoveredGroupId: string | null;
  colorGroups: ColorGroup[];
  mobileViewTarget: { id: string, type: 'group' | 'color' } | null;
}

const HighlightOverlay: React.FC<HighlightOverlayProps> = ({
  sourceData, width, height, hoveredColor, hoveredGroupId, colorGroups, mobileViewTarget
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [matchedCount, setMatchedCount] = useState(0);

  // Helper buffer to convert RGBA components to the system's native 32-bit integer format
  const intBuffer = useRef(new ArrayBuffer(4));
  const intView8 = useRef(new Uint8ClampedArray(intBuffer.current));
  const intView32 = useRef(new Uint32Array(intBuffer.current));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const targetSet = new Set<number>();

    // Stats for dynamic color calculation
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let count = 0;

    const activeColor = mobileViewTarget?.type === 'color' ? mobileViewTarget.id : hoveredColor;
    const activeGroup = mobileViewTarget?.type === 'group' ? mobileViewTarget.id : hoveredGroupId;

    const addTargetColor = (hex: string) => {
      const rgb = hexToRgb(hex);
      if (rgb) {
        // Accumulate for avg calculation
        totalR += rgb.r;
        totalG += rgb.g;
        totalB += rgb.b;
        count++;

        // Write bytes to buffer to get correct Int32
        intView8.current[0] = rgb.r;
        intView8.current[1] = rgb.g;
        intView8.current[2] = rgb.b;
        intView8.current[3] = 255;
        targetSet.add(intView32.current[0]);
      }
    };

    if (activeColor) {
      addTargetColor(activeColor);
    } else if (activeGroup) {
      const group = colorGroups.find(g => g.id === activeGroup);
      group?.members.forEach(m => addTargetColor(m.hex));
    }

    if (targetSet.size === 0) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    // --- Dynamic Mask Color Calculation ---
    // Calculates complementary color with adjusted saturation/lightness
    const avgR = totalR / count;
    const avgG = totalG / count;
    const avgB = totalB / count;

    // Convert RGB to HSL
    const rNorm = avgR / 255, gNorm = avgG / 255, bNorm = avgB / 255;
    const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
        case gNorm: h = (bNorm - rNorm) / d + 2; break;
        case bNorm: h = (rNorm - gNorm) / d + 4; break;
      }
      h /= 6;
    }

    let overlayH, overlayS, overlayL;

    // Special handling for Greys (Low saturation targets)
    if (s < 0.15) {
      // If target is Light Grey/White -> Mask is Dark Slate
      // If target is Dark Grey/Black -> Mask is Cream/Off-White
      if (l > 0.5) {
        overlayH = 220 / 360;
        overlayS = 0.20;
        overlayL = 0.20;
      } else {
        overlayH = 45 / 360;
        overlayS = 0.20;
        overlayL = 0.85;
      }
    } else {
      // Color Target -> Complementary Hue
      overlayH = (h + 0.5) % 1;
      overlayS = 0.25; // Tone down saturation
      overlayL = l > 0.5 ? 0.2 : 0.85; // Invert lightness for contrast
    }

    // Convert back to RGB for display
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = overlayL < 0.5 ? overlayL * (1 + overlayS) : overlayL + overlayS - overlayL * overlayS;
    const p = 2 * overlayL - q;
    const rOut = hue2rgb(p, q, overlayH + 1 / 3);
    const gOut = hue2rgb(p, q, overlayH);
    const bOut = hue2rgb(p, q, overlayH - 1 / 3);

    // Set buffer to the calculated overlay color
    intView8.current[0] = Math.round(rOut * 255);
    intView8.current[1] = Math.round(gOut * 255);
    intView8.current[2] = Math.round(bOut * 255);
    intView8.current[3] = 200; // ~80% Opacity

    const fillColorInt = intView32.current[0];

    // --- Fill & Punch ---
    const imageData = ctx.createImageData(width, height);
    const output32 = new Uint32Array(imageData.data.buffer);

    // Fill entire overlay with mask color
    output32.fill(fillColorInt);

    let matchCount = 0;

    // Iterate pixels and make matches transparent (punch holes)
    if (targetSet.size === 1) {
      const target = targetSet.values().next().value;
      for (let i = 0; i < sourceData.length; i++) {
        if (sourceData[i] === target) {
          output32[i] = 0;
          matchCount++;
        }
      }
    } else {
      for (let i = 0; i < sourceData.length; i++) {
        if (targetSet.has(sourceData[i])) {
          output32[i] = 0;
          matchCount++;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    setMatchedCount(matchCount);

  }, [sourceData, width, height, hoveredColor, hoveredGroupId, colorGroups, mobileViewTarget]);

  const showZoomHint = matchedCount > 0 && matchedCount < (width * height * 0.001);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none z-20"
      />
      {showZoomHint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#33569a] text-white px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-lg z-30 flex items-center gap-2 animate-pulse-fast">
          <i className="fa-solid fa-search-plus"></i>
          <span>Small area - {matchedCount} pixels</span>
        </div>
      )}
    </>
  );
};

interface GridOverlayProps {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  config: PixelArtConfig;
}

const GridOverlay: React.FC<GridOverlayProps> = ({ width, height, imageWidth, imageHeight, config }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI fix
    const dpr = window.devicePixelRatio || 1;
    // Align canvas size to physical pixels for sharpness
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    // Reset transform for drawing
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Calculate grid cell size in screen pixels
    const scaleX = width / imageWidth;
    const scaleY = height / imageHeight;

    const stepX = config.pixelWidth * scaleX;
    const stepY = config.pixelHeight * scaleY;

    // Minimum visual size threshold to prevent moire/mess
    if (stepX < 4 || stepY < 4) return;

    const startOffsetX = (config.offsetX * scaleX) % stepX;
    const startOffsetY = (config.offsetY * scaleY) % stepY;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'; // Subtle dark lines
    ctx.lineWidth = 1 / dpr; // True 1px line regardless of scale

    // Draw verticals
    for (let x = startOffsetX; x <= width; x += stepX) {
      const xPos = Math.floor(x * dpr) / dpr + (0.5 / dpr);
      if (xPos < width) {
        ctx.moveTo(xPos, 0);
        ctx.lineTo(xPos, height);
      }
    }

    // Draw horizontals
    for (let y = startOffsetY; y <= height; y += stepY) {
      const yPos = Math.floor(y * dpr) / dpr + (0.5 / dpr);
      if (yPos < height) {
        ctx.moveTo(0, yPos);
        ctx.lineTo(width, yPos);
      }
    }

    ctx.stroke();

  }, [width, height, imageWidth, imageHeight, config]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="absolute inset-0 pointer-events-none z-10"
    />
  );
};