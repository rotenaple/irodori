import React, { useState, useRef, useEffect, useMemo } from 'react';
import { PaletteColor, ProcessingState, ColorGroup, ColorInstance } from './types';
import {
  rgbToHex,
  hexToRgb,
  findClosestColor,
  extractColorGroups,
  extractSvgColors,
  recolorSvg,
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
  const [isSvg, setIsSvg] = useState<boolean>(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);

  const [smoothingLevels, setSmoothingLevels] = useState<number>(50);
  const [upscaleFactor, setUpscaleFactor] = useState<number | 'NS'>('NS');
  const [denoiseRadius, setDenoiseRadius] = useState<number>(0);
  const [edgeProtection, setEdgeProtection] = useState<number>(50);
  const [vertexInertia, setVertexInertia] = useState<number>(100);
  const [disableRecoloring, setDisableRecoloring] = useState<boolean>(false);
  const [disablePostProcessing, setDisablePostProcessing] = useState<boolean>(false);
  const [disableScaling, setDisableScaling] = useState<boolean>(false);

  const [processingState, setProcessingState] = useState<'idle' | 'processing' | 'completed'>('idle');
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'original' | 'processed'>('original');
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [processedSize, setProcessedSize] = useState<number>(0);

  const [editTarget, setEditTarget] = useState<{ id: string, type: 'original' | 'recolor' } | null>(null);
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [fullColorList, setFullColorList] = useState<ColorInstance[]>([]);
  const [totalSamples, setTotalSamples] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceImageRef = useRef<HTMLImageElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOriginalFileName(file.name);
      setOriginalSize(file.size);
      const isFileSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
      setIsSvg(isFileSvg);

      if (isFileSvg) {
        const textReader = new FileReader();
        textReader.onload = (event) => {
          setSvgContent(event.target?.result as string);
        };
        textReader.readAsText(file);

        // Disable scaling and post-processing for SVGs automatically
        setDisableScaling(true);
        setDisablePostProcessing(true);
      } else {
        setSvgContent(null);
      }

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
        let drawWidth = img.width;
        let drawHeight = img.height;

        if (isSvg && (drawWidth === 0 || drawHeight === 0 || drawWidth < 100)) {
          const aspect = img.naturalWidth / img.naturalHeight || 1;
          drawWidth = 2000;
          drawHeight = 2000 / aspect;
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = drawWidth;
        tempCanvas.height = drawHeight;
        const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
          const imageData = ctx.getImageData(0, 0, drawWidth, drawHeight);

          let extractionResult;
          if (isSvg && svgContent) {
            extractionResult = extractSvgColors(svgContent);
          } else {
            extractionResult = extractColorGroups(imageData);
          }

          // Store the full set of unique colors for recomputation
          const allFoundColors: ColorInstance[] = [];
          extractionResult.groups.forEach((g: ColorGroup) => allFoundColors.push(...g.members));
          setFullColorList(allFoundColors);
          setTotalSamples(extractionResult.totalSamples);

          // Initialize with default grouping
          const initialGroups = extractionResult.groups.slice(0, 10).map((g: ColorGroup) => ({
            ...g,
            representativeHex: g.members[0].hex
          }));
          setColorGroups(initialGroups);

          const initialSelections: Record<string, string> = {};
          const initialEnabled = new Set<string>();
          initialGroups.slice(0, 6).forEach((g: ColorGroup) => {
            initialSelections[g.id] = g.representativeHex!;
            initialEnabled.add(g.id);
          });
          setSelectedInGroup(initialSelections);
          setEnabledGroups(initialEnabled);
        }

        if (canvasRef.current) {
          canvasRef.current.width = drawWidth;
          canvasRef.current.height = drawHeight;
          const mainCtx = canvasRef.current.getContext('2d');
          if (mainCtx) mainCtx.drawImage(img, 0, 0, drawWidth, drawHeight);
        }
      };
    }
  }, [image, isSvg, svgContent]);

  const moveColorToGroup = (colorHex: string, sourceGroupId: string, targetGroupId: string | 'new') => {
    setColorGroups(prev => {
      let colorToMove: ColorInstance | undefined;

      const nextGroups = prev.map(g => {
        if (g.id === sourceGroupId) {
          colorToMove = g.members.find(m => m.hex === colorHex);
          const members = g.members.filter(m => m.hex !== colorHex);
          const totalCount = members.reduce((sum, m) => sum + m.count, 0);
          return {
            ...g,
            members,
            totalCount
          };
        }
        return g;
      }).filter(g => g.members.length > 0 || manualLayerIds.includes(g.id));

      if (!colorToMove) return prev;

      if (targetGroupId === 'new') {
        const newGroup: ColorGroup = {
          id: `group-${Math.random().toString(36).substr(2, 5)}`,
          members: [colorToMove],
          totalCount: colorToMove.count,
          representativeHex: colorToMove.hex
        };
        setEnabledGroups(prevEnabled => new Set(prevEnabled).add(newGroup.id));
        setSelectedInGroup(prevSelected => ({ ...prevSelected, [newGroup.id]: colorToMove!.hex }));
        return [...nextGroups, newGroup];
      } else {
        return nextGroups.map(g => {
          if (g.id === targetGroupId) {
            const members = [...g.members, colorToMove!];
            return {
              ...g,
              members,
              totalCount: members.reduce((sum, m) => sum + m.count, 0)
            };
          }
          return g;
        });
      }
    });
  };

  const mergeGroups = (sourceGroupId: string, targetGroupId: string) => {
    if (sourceGroupId === targetGroupId) return;
    setColorGroups(prev => {
      const sourceGroup = prev.find(g => g.id === sourceGroupId);
      if (!sourceGroup) return prev;

      return prev.map(g => {
        if (g.id === targetGroupId) {
          const members = [...g.members, ...sourceGroup.members];
          return {
            ...g,
            members,
            totalCount: members.reduce((sum, m) => sum + m.count, 0)
          };
        }
        return g;
      }).filter(g => g.id !== sourceGroupId);
    });
    setEnabledGroups(prev => {
      const next = new Set(prev);
      next.delete(sourceGroupId);
      return next;
    });
  };

  const recomputeGroups = () => {
    if (fullColorList.length === 0 || colorGroups.length === 0) return;

    setColorGroups(prev => {
      const representatives = prev.map(g => {
        const hex = selectedInGroup[g.id] || g.representativeHex || (g.members[0]?.hex) || '#000000';
        return { id: g.id, rgb: hexToRgb(hex)! };
      });

      const newGroups = prev.map(g => ({ ...g, members: [] as ColorInstance[], totalCount: 0 }));

      fullColorList.forEach(color => {
        let minDistance = Infinity;
        let targetGroupId = representatives[0].id;

        representatives.forEach(rep => {
          const dist = getColorDistance(color.rgb, rep.rgb);
          if (dist < minDistance) {
            minDistance = dist;
            targetGroupId = rep.id;
          }
        });

        const targetGroup = newGroups.find(g => g.id === targetGroupId);
        if (targetGroup) {
          targetGroup.members.push(color);
          targetGroup.totalCount += color.count;
        }
      });

      return newGroups.filter(g => g.members.length > 0 || manualLayerIds.includes(g.id));
    });
  };

  const palette = useMemo(() => {
    const p: PaletteColor[] = [];
    enabledGroups.forEach(id => {
      const baseHex = selectedInGroup[id];
      const targetHex = colorOverrides[id];
      const rgb = hexToRgb(baseHex);
      if (rgb) p.push({
        ...rgb,
        hex: baseHex,
        id,
        targetHex: targetHex
      });
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
    if (!image || (!disableRecoloring && palette.length === 0) || !sourceImageRef.current || !workerRef.current) return;
    setProcessingState('processing');

    // Give UI a moment to update state
    await new Promise(resolve => setTimeout(resolve, 50));

    if (isSvg && svgContent) {
      try {
        const recoloredSvgContent = recolorSvg(svgContent, colorGroups, colorOverrides);
        const blob = new Blob([recoloredSvgContent], { type: 'image/svg+xml' });
        setProcessedSize(blob.size);
        setProcessedImage(URL.createObjectURL(blob));
        setProcessingState('completed');
        setActiveTab('processed');
      } catch (err) {
        console.error("Failed to process SVG:", err);
        setProcessingState('idle');
      }
      return;
    }

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
          disablePostProcessing,
          disableRecoloring,
          disableScaling,
          palette,
          colorGroups,
          enabledGroups: Array.from(enabledGroups),
          selectedInGroup,
          smoothingLevels,
          vertexInertia
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

      if (isSvg) {
        link.download = `${baseName}-irodori.svg`;
      } else {
        link.download = `${baseName}-irodori.png`;
      }

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
              vertexInertia={vertexInertia} setVertexInertia={setVertexInertia}
              image={image} onImageUpload={handleImageUpload}
              colorGroups={colorGroups} manualLayerIds={manualLayerIds}
              selectedInGroup={selectedInGroup} enabledGroups={enabledGroups} setEnabledGroups={setEnabledGroups}
              colorOverrides={colorOverrides}
              onAddManualLayer={() => addManualLayer()}
              onRemoveManualLayer={removeManualLayer}
              onEditTarget={(id, type) => setEditTarget({ id, type })}
              onMoveColor={moveColorToGroup}
              onMergeGroups={mergeGroups}
              onRecomputeGroups={recomputeGroups}
              setHoveredColor={setHoveredColor}
              setHoveredGroupId={setHoveredGroupId}
              totalSamples={totalSamples}
              paletteLength={palette.length}
              disableScaling={disableScaling}
              setDisableScaling={setDisableScaling}
              disablePostProcessing={disablePostProcessing}
              setDisablePostProcessing={setDisablePostProcessing}
              disableRecoloring={disableRecoloring}
              setDisableRecoloring={setDisableRecoloring}
              isSvg={isSvg}
            />
          </div>

          {/* Action Footer */}
          <div className="px-4 md:px-6 py-4 z-20">
            <div className="flex flex-row gap-2">
              <button
                onClick={processImage}
                disabled={!image || (!disableRecoloring && palette.length === 0) || processingState === 'processing'}
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
              hoveredColor={hoveredColor}
              hoveredGroupId={hoveredGroupId}
              colorGroups={colorGroups}
              isSvg={isSvg}
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
            suggestions={editTarget.type === 'original' ? colorGroups.find(g => g.id === editTarget.id)?.members : []}
            showNoneOption={editTarget.type === 'recolor'}
            onChange={(hex) => {
              if (editTarget.type === 'original') {
                setSelectedInGroup(prev => ({ ...prev, [editTarget.id]: hex }));
              } else {
                if (hex === '') {
                  setColorOverrides(prev => {
                    const next = { ...prev };
                    delete next[editTarget.id];
                    return next;
                  });
                } else {
                  setColorOverrides(prev => ({ ...prev, [editTarget.id]: hex }));
                }
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