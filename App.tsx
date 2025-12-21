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
  const [originalFileName, setOriginalFileName] = useState<string>('image');

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
      setOriginalFileName(file.name);
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

  // Worker reference
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize worker
    workerRef.current = new Worker(new URL('./imageProcessor.worker.ts', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (e: MessageEvent<import('./types').WorkerResponse>) => {
      const { type, result, error } = e.data;
      if (type === 'complete') {
        if (result) {
          setProcessedSize(result.size);
          setProcessedImage(URL.createObjectURL(result));
          setProcessingState('completed');
          setActiveTab('processed');
        } else if (error) {
          console.error("Worker error:", error);
          setProcessingState('idle'); // or error state
          alert(`Error processing image: ${error}`);
        }
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const processImage = async () => {
    if (!image || (!skipColorCleanup && palette.length === 0) || !sourceImageRef.current || !workerRef.current) return;
    setProcessingState('processing');

    // Give UI a moment to update state
    await new Promise(resolve => setTimeout(resolve, 50));

    const img = sourceImageRef.current;

    // Create ImageBitmap to transfer to worker
    // Note: This is faster than structured cloning ImageData but requires everything to be async
    try {
      const imageBitmap = await createImageBitmap(img);

      workerRef.current.postMessage({
        type: 'process',
        imageBitmap,
        parameters: {
          upscaleFactor,
          denoiseRadius,
          edgeProtection,
          skipColorCleanup,
          scaling: 1, // Not strictly used in new logic, but kept for type compat if needed
          palette,
          enabledGroups: Array.from(enabledGroups),
          selectedInGroup,
          smoothingLevels
        }
      }, [imageBitmap]); // Transfer the bitmap
    } catch (err) {
      console.error("Failed to start worker:", err);
      setProcessingState('idle');
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

      // Extract basename and append suffix
      const dotIndex = originalFileName.lastIndexOf('.');
      const baseName = dotIndex !== -1 ? originalFileName.substring(0, dotIndex) : originalFileName;
      link.download = `${baseName}-irodori.png`;

      link.click();
    }
  };

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <Header />

      {/* Main Container - Constrained Width but Full Height available */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-hidden">

        {/* Left Column: Control Panel */}
        <aside className="w-full md:w-96 lg:w-[420px] px-0 md:pl-10 flex-none md:h-full border-r border-[#333]/5 bg-white flex flex-col relative z-10">
          <div className="px-4 md:px-6 py-4 overflow-y-auto md:overflow-y-auto custom-scrollbar flex-1 min-h-[400px] md:min-h-0">
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
          <div className="px-4 md:px-6 py-4 z-20">
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
        <section className="flex-1 md:h-full pt-1 pb-10 px-4 md:pt-2 md:pb-2 md:pr-16 md:pl-6 flex flex-col bg-[#FAFAFA] min-w-0 border-l border-[#333]/5 min-h-[200px] md:min-h-0">
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