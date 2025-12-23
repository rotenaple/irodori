import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { formatSize } from '../utils/formatUtils';
import { rgbToHex } from '../utils/colorUtils';
import { ColorGroup } from '../types';

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
  onClearMobileView
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

  // Ref for the outer flexible container (the gray area)
  const parentRef = useRef<HTMLDivElement>(null);
  // Ref for the tight wrapper around the image
  const containerRef = useRef<HTMLDivElement>(null);

  const targetPosRef = useRef<{ x: number, y: number } | null>(null);
  const currentPosRef = useRef<{ x: number, y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Layout state to perfectly fit the image wrapper
  const [layoutDims, setLayoutDims] = useState<{ width: number, height: number } | null>(null);
  const [activeImageDims, setActiveImageDims] = useState<{ width: number, height: number } | null>(null);

  // 1. Load Processed Image to Canvas
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

  // 2. Track Original Image Dims (FIXED: Load image object directly)
  useEffect(() => {
    if (activeTab === 'original' && image) {
      const img = new Image();
      img.src = image;
      img.onload = () => {
        // Get dimensions directly from the source string
        // This ensures we have dimensions even if the canvas hasn't painted yet
        let w = img.width;
        let h = img.height;

        // Fallback for weird SVG loading states
        if (w === 0 || h === 0) {
          w = img.naturalWidth || 800;
          h = img.naturalHeight || 600;
        }

        setActiveImageDims({ width: w, height: h });
      };
    }
  }, [image, activeTab]);

  // 3. Calculation Layout Logic
  useLayoutEffect(() => {
    if (!parentRef.current || !activeImageDims) return;

    const calculateLayout = () => {
      if (!parentRef.current || !activeImageDims) return;

      const pW = parentRef.current.clientWidth;
      const pH = parentRef.current.clientHeight;

      // Effective available space
      const availW = pW - (window.innerWidth >= 768 ? 32 : 0);
      const availH = pH - (window.innerWidth >= 768 ? 32 : 0);

      const { width: imgW, height: imgH } = activeImageDims;
      if (!imgW || !imgH) return;

      const imgAspect = imgW / imgH;
      const parentAspect = availW / availH;

      let renderW, renderH;

      if (imgAspect > parentAspect) {
        // Image is wider than container (relative to aspect) -> Constrain by Width
        renderW = availW;
        renderH = availW / imgAspect;
      } else {
        // Image is taller -> Constrain by Height
        renderH = availH;
        renderW = availH * imgAspect;
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
        className="relative flex-1 min-h-[150px] md:min-h-[400px] overflow-hidden group flex items-center justify-center p-0 md:p-4 bg-dots"
      >
        {!image ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center opacity-10">
            <i className="fa-solid fa-flag text-6xl mb-6"></i>
            <h3 className="tracking-widest text-base uppercase font-bold">Waiting for source</h3>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div
              ref={containerRef}
              className="relative shadow-sm transition-all duration-75 ease-linear"
              style={{
                width: layoutDims?.width,
                height: layoutDims?.height
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <canvas
                ref={canvasRef}
                onClick={() => magnifierPos && setMagnifierPos(p => p ? { ...p, locked: !p.locked } : null)}
                className={`w-full h-full object-contain ${activeTab === 'original' && !isSvg ? 'block' : 'hidden'} cursor-crosshair`}
              />
              {image && isSvg && activeTab === 'original' && (
                <img
                  src={image}
                  onClick={() => magnifierPos && setMagnifierPos(p => p ? { ...p, locked: !p.locked } : null)}
                  alt="Original"
                  className="w-full h-full object-contain cursor-crosshair"
                />
              )}
              {processedImage && activeTab === 'processed' && (
                <img
                  src={processedImage}
                  onClick={() => magnifierPos && setMagnifierPos(p => p ? { ...p, locked: !p.locked } : null)}
                  alt="Cleaned"
                  className="w-full h-full object-contain cursor-crosshair"
                />
              )}

              {/* Highlight Palette Overlay */}
              {(hoveredColor || hoveredGroupId) && activeTab === 'original' && canvasRef.current && (
                <HighlightOverlay
                  sourceCanvas={canvasRef.current}
                  hoveredColor={hoveredColor}
                  hoveredGroupId={hoveredGroupId}
                  colorGroups={colorGroups}
                />
              )}

              {/* Floating Dismiss Button - Positioned relative to the image edges */}
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

// --- Highlight Overlay Component ---
interface HighlightOverlayProps {
  sourceCanvas: HTMLCanvasElement;
  hoveredColor: string | null;
  hoveredGroupId: string | null;
  colorGroups: ColorGroup[];
}

const HighlightOverlay: React.FC<HighlightOverlayProps> = ({ sourceCanvas, hoveredColor, hoveredGroupId, colorGroups }) => {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [matchedPixelCount, setMatchedPixelCount] = useState(0);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !sourceCanvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    canvas.width = width;
    canvas.height = height;

    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) return;

    const imageData = sourceCtx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const outputImageData = ctx.createImageData(width, height);
    const outputData = outputImageData.data;

    const highlightSet = new Set<string>();
    if (hoveredColor) {
      highlightSet.add(hoveredColor.toLowerCase());
    } else if (hoveredGroupId) {
      const group = colorGroups.find(g => g.id === hoveredGroupId);
      group?.members.forEach(m => highlightSet.add(m.hex.toLowerCase()));
    }


    if (highlightSet.size === 0) return;

    let matchCount = 0;

    let avgBrightness = 0;
    let sampleCount = 0;

    for (let i = 0; i < data.length && sampleCount < 100; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const hex = rgbToHex(r, g, b);

      if (highlightSet.has(hex)) {
        avgBrightness += (r * 0.299 + g * 0.587 + b * 0.114);
        sampleCount++;
      }
    }

    avgBrightness = sampleCount > 0 ? avgBrightness / sampleCount : 128;

    const useViolet = avgBrightness > 128;
    const overlayR = useViolet ? 138 : 255;
    const overlayG = useViolet ? 43 : 215;
    const overlayB = useViolet ? 226 : 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const hex = rgbToHex(r, g, b);

      if (highlightSet.has(hex)) {
        outputData[i] = r;
        outputData[i + 1] = g;
        outputData[i + 2] = b;
        outputData[i + 3] = 255;
        matchCount++;
      } else {
        const grey = (r * 0.299 + g * 0.587 + b * 0.114) * 0.4;
        outputData[i] = Math.round(grey * 0.7 + overlayR * 0.3);
        outputData[i + 1] = Math.round(grey * 0.7 + overlayG * 0.3);
        outputData[i + 2] = Math.round(grey * 0.7 + overlayB * 0.3);
        outputData[i + 3] = 255;
      }
    }

    ctx.putImageData(outputImageData, 0, 0);
    setMatchedPixelCount(matchCount);
  }, [sourceCanvas, hoveredColor, hoveredGroupId, colorGroups]);

  const totalPixels = sourceCanvas.width * sourceCanvas.height;
  const showZoomHint = matchedPixelCount > 0 && matchedPixelCount < totalPixels * 0.001;

  return (
    <>
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
      />
      {showZoomHint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#33569a] text-white px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-lg z-20 flex items-center gap-2 animate-pulse-fast">
          <i className="fa-solid fa-search-plus"></i>
          <span>Small area - {matchedPixelCount} pixels</span>
        </div>
      )}
    </>
  );
};