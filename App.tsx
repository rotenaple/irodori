import React, { useState, useRef, useEffect, useMemo } from 'react';
import { PaletteColor, ProcessingState, ColorGroup } from './types';
import {
  rgbToHex,
  hexToRgb,
  findClosestColor,
  extractColorGroups,
  blendColors,
  sigmoidSnap,
  applyMedianFilter,
  getColorDistance
} from './utils/colorUtils';
import { Header } from './components/Header';
import { ControlPanel } from './components/ControlPanel';
import { ImageWorkspace } from './components/ImageWorkspace';
import { ColorPickerModal } from './components/ColorPickerModal';

const App: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [colorGroups, setColorGroups] = useState<ColorGroup[]>([]);
  const [selectedInGroup, setSelectedInGroup] = useState<Record<string, string>>({});
  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(new Set());
  const [manualLayerIds, setManualLayerIds] = useState<string[]>([]);
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>({});

  const [smoothingLevels, setSmoothingLevels] = useState<number>(1);
  const [upscaleFactor, setUpscaleFactor] = useState<number | 'NS'>('NS');
  const [denoiseRadius, setDenoiseRadius] = useState<number>(1);
  const [edgeProtection, setEdgeProtection] = useState<number>(50);
  const [skipColorCleanup, setSkipColorCleanup] = useState<boolean>(false);

  const [processingState, setProcessingState] = useState<'idle' | 'processing' | 'completed'>('idle');
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'original' | 'processed'>('original');
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [processedSize, setProcessedSize] = useState<number>(0);

  const [editTarget, setEditTarget] = useState<{ id: string, type: 'original' | 'recolor' } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceImageRef = useRef<HTMLImageElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOriginalSize(file.size);
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result as string);
        setProcessedImage(null);
        setProcessingState('idle');
        setColorGroups([]);
        setSelectedInGroup({});
        setEnabledGroups(new Set());
        setManualLayerIds([]);
        setColorOverrides({});
        setActiveTab('original');
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (image && sourceImageRef.current) {
      const img = new Image();
      img.src = image;
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const result = extractColorGroups(imageData);
          setColorGroups(result.groups.slice(0, 10));

          const initialSelections: Record<string, string> = {};
          const initialEnabled = new Set<string>();
          result.groups.slice(0, 6).forEach(g => {
            initialSelections[g.id] = g.members[0].hex;
            initialEnabled.add(g.id);
          });
          setSelectedInGroup(initialSelections);
          setEnabledGroups(initialEnabled);
        }

        if (canvasRef.current) {
          canvasRef.current.width = img.width;
          canvasRef.current.height = img.height;
          const mainCtx = canvasRef.current.getContext('2d');
          if (mainCtx) mainCtx.drawImage(img, 0, 0);
        }
      };
    }
  }, [image]);

  const palette = useMemo(() => {
    const p: PaletteColor[] = [];
    enabledGroups.forEach(id => {
      const baseHex = selectedInGroup[id];
      const targetHex = colorOverrides[id] || baseHex;
      const rgb = hexToRgb(targetHex);
      if (rgb) p.push({ ...rgb, hex: targetHex, id });
    });
    return p;
  }, [selectedInGroup, enabledGroups, colorOverrides]);

  const processImage = async () => {
    if (!image || (!skipColorCleanup && palette.length === 0) || !sourceImageRef.current) return;
    setProcessingState('processing');
    await new Promise(resolve => setTimeout(resolve, 50));

    const img = sourceImageRef.current;
    const nativeWidth = img.naturalWidth;
    const nativeHeight = img.naturalHeight;

    let targetUpscale = 1;
    if (upscaleFactor === 'NS') {
      const longNative = Math.max(nativeWidth, nativeHeight);
      const shortNative = Math.min(nativeWidth, nativeHeight);
      const scaleA = Math.min(535 / longNative, 355 / shortNative);
      const scaleB = Math.min(568 / longNative, 321 / shortNative);
      targetUpscale = Math.max(scaleA, scaleB);
    } else {
      targetUpscale = upscaleFactor as number;
    }

    const nativeCanvas = document.createElement('canvas');
    nativeCanvas.width = nativeWidth;
    nativeCanvas.height = nativeHeight;
    const nCtx = nativeCanvas.getContext('2d', { willReadFrequently: true });
    if (!nCtx) return;
    nCtx.drawImage(img, 0, 0);

    let baseData = nCtx.getImageData(0, 0, nativeWidth, nativeHeight);
    if (denoiseRadius > 0) baseData = applyMedianFilter(baseData, denoiseRadius);
    nCtx.putImageData(baseData, 0, 0);

    // Bypass color quantization if requested
    if (skipColorCleanup) {
      const finalW = Math.round(nativeWidth * targetUpscale);
      const finalH = Math.round(nativeHeight * targetUpscale);

      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = finalW;
      finalCanvas.height = finalH;
      const fCtx = finalCanvas.getContext('2d');
      if (fCtx) {
        fCtx.imageSmoothingEnabled = true;
        fCtx.imageSmoothingQuality = 'high';
        fCtx.drawImage(nativeCanvas, 0, 0, finalW, finalH);

        finalCanvas.toBlob((blob) => {
          if (blob) {
            setProcessedSize(blob.size);
            setProcessedImage(URL.createObjectURL(blob));
            setProcessingState('completed');
            setActiveTab('processed');
          }
        }, 'image/png');
      }
      return;
    }

    const workspaceScale = targetUpscale * 4;
    const workspaceWidth = Math.round(nativeWidth * workspaceScale);
    const workspaceHeight = Math.round(nativeHeight * workspaceScale);

    const MAX_PIXELS = 10000000;
    const currentPixels = workspaceWidth * workspaceHeight;
    const safeScale = currentPixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (nativeWidth * nativeHeight)) : workspaceScale;

    const finalWorkspaceWidth = Math.round(nativeWidth * safeScale);
    const finalWorkspaceHeight = Math.round(nativeHeight * safeScale);

    const workspaceCanvas = document.createElement('canvas');
    workspaceCanvas.width = finalWorkspaceWidth;
    workspaceCanvas.height = finalWorkspaceHeight;
    const wCtx = workspaceCanvas.getContext('2d', { willReadFrequently: true });
    if (!wCtx) return;

    wCtx.imageSmoothingEnabled = true;
    wCtx.imageSmoothingQuality = 'high';
    wCtx.drawImage(nativeCanvas, 0, 0, finalWorkspaceWidth, finalWorkspaceHeight);

    const pixelData = wCtx.getImageData(0, 0, finalWorkspaceWidth, finalWorkspaceHeight).data;
    const matchPalette: PaletteColor[] = [];
    enabledGroups.forEach(id => {
      const hex = selectedInGroup[id];
      matchPalette.push({ ...hexToRgb(hex)!, hex, id });
    });

    const outputData = new Uint8ClampedArray(pixelData.length);
    let coreIdxMap = new Int16Array(finalWorkspaceWidth * finalWorkspaceHeight);

    for (let i = 0; i < pixelData.length; i += 4) {
      const pixel = { r: pixelData[i], g: pixelData[i + 1], b: pixelData[i + 2] };
      const closest = findClosestColor(pixel, matchPalette);
      coreIdxMap[i / 4] = matchPalette.findIndex(p => p.id === closest.id);
    }

    if (edgeProtection > 0) {
      let radius = 1;
      let iterations = 1;
      if (edgeProtection > 33) { radius = 2; iterations = 2; }
      if (edgeProtection > 66) { radius = 3; iterations = 3; }
      if (edgeProtection > 85) { radius = 4; iterations = 5; }

      let tempIdxMap = new Int16Array(coreIdxMap.length);
      for (let iter = 0; iter < iterations; iter++) {
        for (let y = 0; y < finalWorkspaceHeight; y++) {
          for (let x = 0; x < finalWorkspaceWidth; x++) {
            const idx = y * finalWorkspaceWidth + x;
            const counts: Record<number, number> = {};
            let maxCount = 0;
            let dominantIdx = coreIdxMap[idx];

            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const ny = y + dy;
                const nx = x + dx;
                if (ny >= 0 && ny < finalWorkspaceHeight && nx >= 0 && nx < finalWorkspaceWidth) {
                  const nIdx = coreIdxMap[ny * finalWorkspaceWidth + nx];
                  counts[nIdx] = (counts[nIdx] || 0) + 1;
                  if (counts[nIdx] > maxCount) {
                    maxCount = counts[nIdx];
                    dominantIdx = nIdx;
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

    for (let y = 0; y < finalWorkspaceHeight; y++) {
      for (let x = 0; x < finalWorkspaceWidth; x++) {
        const idx = y * finalWorkspaceWidth + x;
        const coreIdx = coreIdxMap[idx];
        let neighborIndices = new Set<number>();

        if (smoothingLevels > 0) {
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
        if (neighborIndices.size === 0 || smoothingLevels === 0) {
          finalColor = palette[coreIdx];
        } else {
          const currentPixel = { r: pixelData[idx * 4], g: pixelData[idx * 4 + 1], b: pixelData[idx * 4 + 2] };
          const candidates: PaletteColor[] = [matchPalette[coreIdx]];
          const steps = Math.pow(2, smoothingLevels) - 1;

          neighborIndices.forEach(ni => {
            candidates.push(matchPalette[ni]);
            const contrast = getColorDistance(matchPalette[coreIdx], matchPalette[ni]);
            const sharpFactor = contrast > 120 ? 18 : 10;
            for (let s = 1; s <= steps; s++) {
              const sr = sigmoidSnap(s / (steps + 1), sharpFactor);
              const b = blendColors(matchPalette[coreIdx], matchPalette[ni], sr);
              candidates.push({ ...b, hex: rgbToHex(b.r, b.g, b.b), id: `blend-${coreIdx}-${ni}-${s}` });
            }
          });

          const winner = findClosestColor(currentPixel, candidates, 0.8);
          if (winner.id.startsWith('blend-')) {
            const parts = winner.id.split('-');
            const i1 = parseInt(parts[1]), i2 = parseInt(parts[2]), s = parseInt(parts[3]);
            const b = blendColors(palette[i1], palette[i2], sigmoidSnap(s / (steps + 1), 12));
            finalColor = { ...b, hex: rgbToHex(b.r, b.g, b.b), id: winner.id };
          } else {
            finalColor = palette[matchPalette.findIndex(p => p.id === winner.id)];
          }
        }
        const outIdx = idx * 4;
        outputData[outIdx] = finalColor.r; outputData[outIdx + 1] = finalColor.g; outputData[outIdx + 2] = finalColor.b; outputData[outIdx + 3] = 255;
      }
    }

    wCtx.putImageData(new ImageData(outputData, finalWorkspaceWidth, finalWorkspaceHeight), 0, 0);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = Math.round(nativeWidth * targetUpscale);
    finalCanvas.height = Math.round(nativeHeight * targetUpscale);

    const fCtx = finalCanvas.getContext('2d');
    if (fCtx) {
      fCtx.fillStyle = '#000000';
      fCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
      fCtx.imageSmoothingEnabled = true;
      fCtx.imageSmoothingQuality = 'high';
      fCtx.drawImage(workspaceCanvas, 0, 0, finalCanvas.width, finalCanvas.height);

      finalCanvas.toBlob((blob) => {
        if (blob) {
          setProcessedSize(blob.size);
          setProcessedImage(URL.createObjectURL(blob));
          setProcessingState('completed');
          setActiveTab('processed');
        }
      }, 'image/png');
    }
  };

  const addManualLayer = (hex: string = '#ffffff') => {
    const id = `manual-${Math.random().toString(36).substr(2, 9)}`;
    setManualLayerIds(prev => [...prev, id]);
    setSelectedInGroup(prev => ({ ...prev, [id]: hex }));
    setEnabledGroups(prev => new Set(prev).add(id));
  };

  const removeManualLayer = (id: string) => {
    setManualLayerIds(prev => prev.filter(mid => mid !== id));
    setEnabledGroups(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const downloadImage = () => {
    if (processedImage) {
      const link = document.createElement('a');
      link.href = processedImage;
      link.download = 'irodori-result.png';
      link.click();
    }
  };

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <Header />

      {/* Main Container - Constrained Width but Full Height available */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto flex flex-col md:flex-row min-h-0">

        {/* Left Column: Control Panel */}
        <aside className="w-full md:w-96 lg:w-[420px] pl-4 md:pl-10 flex-none h-full border-r border-[#333]/5 bg-white overflow-hidden flex flex-col relative z-10">
          <div className="px-6 py-4 overflow-y-auto custom-scrollbar flex-1">
            <h2 className="text-[11px] font-bold uppercase tracking-widest mb-2 text-[#333]/40 border-b border-[#333]/5 pb-1">Configurations</h2>
            <ControlPanel
              upscaleFactor={upscaleFactor} setUpscaleFactor={setUpscaleFactor}
              denoiseRadius={denoiseRadius} setDenoiseRadius={setDenoiseRadius}
              smoothingLevels={smoothingLevels} setSmoothingLevels={setSmoothingLevels}
              edgeProtection={edgeProtection} setEdgeProtection={setEdgeProtection}
              image={image} onImageUpload={handleImageUpload}
              colorGroups={colorGroups} manualLayerIds={manualLayerIds}
              selectedInGroup={selectedInGroup} enabledGroups={enabledGroups} setEnabledGroups={setEnabledGroups}
              colorOverrides={colorOverrides}
              onAddManualLayer={() => addManualLayer()}
              onRemoveManualLayer={removeManualLayer}
              onEditTarget={(id, type) => setEditTarget({ id, type })}
              paletteLength={palette.length}
              skipColorCleanup={skipColorCleanup}
              setSkipColorCleanup={setSkipColorCleanup}
            />
          </div>

          {/* Action Footer */}
          <div className="px-6 py-4 z-20">
            <div className="flex flex-row gap-2">
              <button
                onClick={processImage}
                disabled={!image || (!skipColorCleanup && palette.length === 0) || processingState === 'processing'}
                className="flex-1 bg-[#333] text-white rounded-xl py-3 font-bold uppercase tracking-widest text-[12px] shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none hover:bg-black flex items-center justify-center gap-2"
              >
                {processingState === 'processing' ? (
                  <><i className="fa-solid fa-circle-notch fa-spin"></i></>
                ) : (
                  <><i className="fa-solid fa-wand-magic-sparkles"></i> Apply</>
                )}
              </button>

              {processedImage && (
                <button
                  onClick={downloadImage}
                  className="flex-1 bg-[#33569a] text-white rounded-xl py-3 font-bold uppercase tracking-widest text-[12px] shadow-lg active:scale-[0.98] transition-all hover:bg-[#25427a] flex items-center justify-center gap-2"
                >
                  <i className="fa-solid fa-download"></i> Download
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* Right Column: Workspace */}
        <section className="flex-1 h-full pt-2 pb-2 pr-6 md:pr-16 pl-6 flex flex-col bg-[#FAFAFA] min-w-0 border-l border-[#333]/5">
          <div className="flex-1 min-h-0">
            <ImageWorkspace
              image={image} processedImage={processedImage}
              activeTab={activeTab} setActiveTab={setActiveTab}
              originalSize={originalSize} processedSize={processedSize}
              canvasRef={canvasRef}
              onAddFromMagnifier={addManualLayer}
            />
          </div>
        </section>
      </main>

      {editTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm" onClick={() => setEditTarget(null)}>
          <ColorPickerModal
            title={editTarget.type === 'original' ? 'Source' : 'Target'}
            mode={editTarget.type === 'original' && !manualLayerIds.includes(editTarget.id) ? 'sampled' : 'spectrum'}
            currentHex={
              editTarget.type === 'original'
                ? (selectedInGroup[editTarget.id] || '#ffffff')
                : (colorOverrides[editTarget.id] || selectedInGroup[editTarget.id] || '#ffffff')
            }
            suggestions={editTarget.type === 'original' ? colorGroups.find(g => g.id === editTarget.id)?.members.map(m => m.hex) : []}
            onChange={(hex) => {
              if (editTarget.type === 'original') {
                setSelectedInGroup(prev => ({ ...prev, [editTarget.id]: hex }));
              } else {
                setColorOverrides(prev => ({ ...prev, [editTarget.id]: hex }));
              }
            }}
            onClose={() => setEditTarget(null)}
          />
        </div>
      )}

      <img ref={sourceImageRef} src={image || ''} className="hidden" alt="Source" />
    </div>
  );
};

export default App;