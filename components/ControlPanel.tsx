import React, { useState, useEffect } from 'react';
import { ColorGroup } from '../types';

// InfoBox component for tooltips
interface InfoBoxProps {
  children: React.ReactNode;
}

const InfoBox: React.FC<InfoBoxProps> = ({ children }) => (
  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm leading-relaxed text-slate-600 mt-2 shadow-sm animate-in fade-in zoom-in duration-200">
    {children}
  </div>
);

interface ControlPanelProps {
  upscaleFactor: number | 'NS';
  setUpscaleFactor: (v: number | 'NS') => void;
  denoiseRadius: number;
  setDenoiseRadius: (v: number) => void;
  smoothingLevels: number;
  setSmoothingLevels: (v: number) => void;
  vertexInertia: number;
  setVertexInertia: (v: number) => void;
  edgeProtection: number;
  setEdgeProtection: (v: number) => void;

  image: string | null;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  colorGroups: ColorGroup[];
  manualLayerIds: string[];
  selectedInGroup: Record<string, string>;
  enabledGroups: Set<string>;
  setEnabledGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  colorOverrides: Record<string, string>;

  onAddManualLayer: () => void;
  onRemoveManualLayer: (id: string) => void;
  onEditTarget: (id: string, type: 'original' | 'recolor') => void;
  onMoveColor: (colorHex: string, sourceGroupId: string, targetGroupId: string | 'new') => void;
  onMergeGroups: (sourceGroupId: string, targetGroupId: string) => void;
  onRecomputeGroups: () => void;
  setHoveredColor: (hex: string | null) => void;
  hoveredGroupId: string | null;
  setHoveredGroupId: (id: string | null) => void;
  draggedItem: { type: 'color' | 'group', colorHex?: string, groupId: string } | null;
  setDraggedItem: (item: { type: 'color' | 'group', colorHex?: string, groupId: string } | null) => void;
  totalSamples: number;

  paletteLength: number;

  disableScaling: boolean;
  setDisableScaling: (v: boolean) => void;
  disablePostProcessing: boolean;
  setDisablePostProcessing: (v: boolean) => void;
  disableRecoloring: boolean;
  setDisableRecoloring: (v: boolean) => void;
  isSvg: boolean;

  // NEW: Mobile View Logic Props
  mobileViewTarget: { id: string, type: 'group' | 'color' } | null;
  onMobileViewToggle: (id: string, type: 'group' | 'color') => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  upscaleFactor, setUpscaleFactor,
  denoiseRadius, setDenoiseRadius,
  smoothingLevels, setSmoothingLevels,
  vertexInertia, setVertexInertia,
  edgeProtection, setEdgeProtection,
  image, onImageUpload, colorGroups, manualLayerIds,
  selectedInGroup, enabledGroups, setEnabledGroups, colorOverrides,
  onAddManualLayer, onRemoveManualLayer, onEditTarget, onMoveColor,
  onMergeGroups, onRecomputeGroups, setHoveredColor, hoveredGroupId, setHoveredGroupId,
  draggedItem, setDraggedItem,
  totalSamples,
  disableScaling, setDisableScaling,
  disablePostProcessing, setDisablePostProcessing,
  disableRecoloring, setDisableRecoloring,
  isSvg,
  mobileViewTarget,
  onMobileViewToggle
}) => {
  const [activeInfo, setActiveInfo] = useState<string | null>(null);
  const [mobilePopup, setMobilePopup] = useState<{ groupId: string, colorHex: string, percent: string } | null>(null);

  const toggleInfo = (key: string) => setActiveInfo(activeInfo === key ? null : key);

  // Detect if touch device
  const isTouchDevice = typeof window !== 'undefined' && 'ontouchstart' in window;

  // Close all dropdowns and mobile popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;

      // Close mobile popup
      if (mobilePopup && !target.closest('.mobile-color-popup') && !target.closest('.subcolor-btn')) {
        setMobilePopup(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [mobilePopup]);

  return (
    <div className="flex flex-col gap-2 pb-0">
      {/* Upload Section */}
      <div className="border-b border-[#333]/10 pb-3">
        <label className={`flex flex-col items-center justify-center w-full h-14 border-2 border-dashed rounded-xl cursor-pointer transition-all group relative overflow-hidden ${image ? 'border-[#333]/10 bg-white hover:border-[#333]/30' : 'border-[#33569a]/30 bg-[#33569a]/5 hover:bg-[#33569a]/10 hover:border-[#33569a]/50'}`}>
          <div className="flex flex-row items-center gap-3 z-10">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${image ? 'bg-[#333]/5 text-[#333]/40 group-hover:bg-[#333]/10' : 'bg-[#33569a]/10 text-[#33569a] group-hover:bg-[#33569a]/20'}`}>
              <i className={`fa-solid ${image ? 'fa-arrow-rotate-right' : 'fa-upload'} text-sm`}></i>
            </div>
            <span className={`text-[11px] font-bold uppercase tracking-widest transition-colors ${image ? 'text-[#333]/40 group-hover:text-[#333]/60' : 'text-[#33569a] group-hover:text-[#33569a]/80'}`}>
              {image ? 'Replace Flag' : 'Upload Flag'}
            </span>
          </div>
          <input type="file" className="hidden" accept="image/*" onChange={onImageUpload} />
        </label>
      </div>

      {/* Parameters Group */}
      <div className="space-y-2">

        {/* Target Scale */}
        <div className="space-y-0.5">
          <div className="flex justify-between items-center bg-slate-50 p-1 rounded-lg border border-slate-200 mb-1">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 ${disableScaling ? 'text-slate-400' : 'text-[#333]'}`}>Output Size</span>
              <button onClick={() => toggleInfo('scale')} className="text-[#33569a] hover:opacity-70"><i className="fa-solid fa-circle-info"></i></button>
            </div>
            <span className={`font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-[10px] ${disableScaling ? 'text-slate-400' : 'text-[#33569a]'}`}>{upscaleFactor === 'NS' ? 'AUTO' : `${upscaleFactor}X`}</span>
          </div>

          <div className={`grid grid-cols-4 gap-1.5 transition-opacity ${disableScaling ? 'opacity-40 pointer-events-none' : ''}`}>
            {[1, 2, 4].map(f => (
              <button key={f} onClick={() => setUpscaleFactor(f as number)} className={`px-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-all border ${upscaleFactor === f ? 'bg-[#333] text-white border-[#333] shadow-md' : 'bg-white text-[#333] border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>{f}X</button>
            ))}
            <button onClick={() => setUpscaleFactor('NS')} className={`px-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-all border ${upscaleFactor === 'NS' ? 'bg-[#333] text-white border-[#333] shadow-md' : 'bg-white text-[#333] border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>Auto</button>
          </div>
          {isSvg && activeInfo === 'scale' && (
            <InfoBox>
              <div className="flex items-center gap-2 text-amber-600 font-bold mb-1">
                <i className="fa-solid fa-triangle-exclamation"></i>
                <span>SVG detected</span>
              </div>
              Scaling is disabled; SVGs maintain infinite resolution.
            </InfoBox>
          )}
          {!isSvg && activeInfo === 'scale' && (
            <InfoBox>
              Resizes to NationStates dimensions (535x355px or 568x321px).
            </InfoBox>
          )}
        </div>

        {/* Post-Processing Group */}
        <div className="space-y-2 pt-2 border-t border-[#333]/10">
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
            <button
              onClick={() => setDisablePostProcessing(!disablePostProcessing)}
              className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${!disablePostProcessing ? 'bg-[#333]' : 'bg-slate-300'}`}
            >
              <div className={`w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform duration-200 ${!disablePostProcessing ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className={`text-[10px] font-bold uppercase tracking-wide ${disablePostProcessing ? 'text-slate-400' : 'text-[#333]'}`}>Cleanup & Quality</span>
            {isSvg && (
              <button onClick={() => toggleInfo('svg-pp')} className="text-amber-500 hover:opacity-70 ml-auto"><i className="fa-solid fa-circle-info"></i></button>
            )}
          </div>
          {isSvg && activeInfo === 'svg-pp' && (
            <InfoBox>
              <div className="flex items-center gap-2 text-amber-600 font-bold mb-1">
                <i className="fa-solid fa-triangle-exclamation"></i>
                <span>SVG detected</span>
              </div>
              Processing is disabled to preserve original vector precision.
            </InfoBox>
          )}

          <div className={`space-y-2 transition-opacity ${disablePostProcessing ? 'opacity-40 pointer-events-none' : ''}`}>
            {/* Denoise */}
            <div className="space-y-0.5">
              <div className="flex justify-between items-center text-[10px] font-bold text-[#333] uppercase tracking-wide">
                <div className="flex items-center gap-2">
                  <span>Remove Noise</span>
                  <button onClick={() => toggleInfo('denoise')} className="text-[#33569a] hover:opacity-70 px-1"><i className="fa-solid fa-circle-info"></i></button>
                </div>
                <span className="text-[#33569a] font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-[10px]">{denoiseRadius === 0 ? "OFF" : denoiseRadius + "px"}</span>
              </div>
              <input type="range" min="0" max="3" step="1" value={denoiseRadius} onChange={(e) => setDenoiseRadius(parseInt(e.target.value))} className="custom-slider" />
              {activeInfo === 'denoise' && (
                <InfoBox>
                  Removes grain and compression artifacts from the source image.
                </InfoBox>
              )}
            </div>

            {/* Bleed Guard */}
            <div className="space-y-0.5">
              <div className="flex justify-between items-center text-[10px] font-bold text-[#333] uppercase tracking-wide">
                <div className="flex items-center gap-2">
                  <span>Edge Crispness</span>
                  <button onClick={() => toggleInfo('bleed')} className="text-[#33569a] hover:opacity-70 px-1"><i className="fa-solid fa-circle-info"></i></button>
                </div>
                <span className="text-[#33569a] font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-[10px]">{edgeProtection === 0 ? "OFF" : edgeProtection + "%"}</span>
              </div>
              <input type="range" min="0" max="100" step="10" value={edgeProtection} onChange={(e) => setEdgeProtection(parseInt(e.target.value))} className="custom-slider" />
              {activeInfo === 'bleed' && (
                <InfoBox>
                  Tightens color boundaries. High values prevent bleeding but may increase jaggedness.
                </InfoBox>
              )}
            </div>

            {/* Vertex Inertia */}
            <div className="space-y-0.5">
              <div className="flex justify-between items-center text-[10px] font-bold text-[#333] uppercase tracking-wide">
                <div className="flex items-center gap-2">
                  <span>Corner Protection</span>
                  <button onClick={() => toggleInfo('inertia')} className="text-[#33569a] hover:opacity-70 px-1"><i className="fa-solid fa-circle-info"></i></button>
                </div>
                <span className="text-[#33569a] font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-[10px]">{vertexInertia === 0 ? "OFF" : vertexInertia + "%"}</span>
              </div>
              <input type="range" min="0" max="100" step="10" value={vertexInertia} onChange={(e) => setVertexInertia(parseInt(e.target.value))} className="custom-slider" />
              {activeInfo === 'inertia' && (
                <InfoBox>
                  Preserves sharp vertices. High values protect geometric details; low values favor curves.
                </InfoBox>
              )}
            </div>

            {/* Smooth Edges */}
            <div className="space-y-0.5">
              <div className="flex justify-between items-center text-[10px] font-bold text-[#333] uppercase tracking-wide">
                <div className="flex items-center gap-2">
                  <span>Edge Smoothing</span>
                  <button onClick={() => toggleInfo('subpixel')} className="text-[#33569a] hover:opacity-70 px-1"><i className="fa-solid fa-circle-info"></i></button>
                </div>
                <span className="text-[#33569a] font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-[10px]">{smoothingLevels === 0 ? "OFF" : smoothingLevels + "%"}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={smoothingLevels}
                onChange={(e) => setSmoothingLevels(parseInt(e.target.value))}
                className="custom-slider"
              />
              {activeInfo === 'subpixel' && (
                <InfoBox>
                  Applies anti-aliasing. High values produce softer transitions; low values keep edges crisp.
                </InfoBox>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-1.5 px-0.5">
        <div className="flex items-center justify-between mb-1 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDisableRecoloring(!disableRecoloring)}
              className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${!disableRecoloring ? 'bg-[#333]' : 'bg-slate-300'}`}
            >
              <div className={`w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform duration-200 ${!disableRecoloring ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <h3 className={`text-[10px] uppercase font-bold m-0 tracking-wide ${disableRecoloring ? 'text-slate-400' : 'text-[#333]'}`}>Color Mapping</h3>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onRecomputeGroups}
              disabled={disableRecoloring || colorGroups.length === 0}
              title="Reassign all image colors to nearest enabled group"
              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 bg-white border border-[#333]/10 rounded-lg hover:bg-slate-50 transition-colors shadow-sm text-[#33569a] ${disableRecoloring ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <i className="fa-solid fa-arrows-rotate mr-1"></i> Recompute
            </button>
            <button onClick={onAddManualLayer} disabled={disableRecoloring} className={`text-[9px] font-bold uppercase px-1.5 py-0.5 bg-white border border-[#333]/10 rounded-lg hover:bg-slate-50 transition-colors shadow-sm text-[#33569a] ${disableRecoloring ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <i className="fa-solid fa-plus mr-1"></i> Add
            </button>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 leading-tight">
          Choose which colors to keep. Ungroup colors to separate them, or drag onto another group to merge.
        </p>
      </div>

      <div className={`flex flex-col gap-1 pr-1 transition-opacity duration-300 ${disableRecoloring ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
        {!image && <p className="text-[10px] italic text-slate-400 text-center py-4 uppercase tracking-widest border border-dashed border-slate-200 rounded-xl">Import to extract colors</p>}
        {[...colorGroups, ...manualLayerIds.map(id => ({ id, isManual: true }))].map(item => {
          const id = (item as any).id;
          const isManual = (item as any).isManual;
          const isEnabled = enabledGroups.has(id);
          const group = item as ColorGroup;
          const currentOriginal = selectedInGroup[id] || group.members?.[0]?.hex || '#ffffff';
          const targetRecolor = colorOverrides[id];
          const members = group.members || [];

          const groupPercent = totalSamples > 0 ? ((group.totalCount / totalSamples) * 100).toFixed(1) : '0';
          const isDropTarget = draggedItem && draggedItem.groupId !== id;

          // Check for active mobile view states
          const isGroupViewActive = mobileViewTarget?.id === id && mobileViewTarget?.type === 'group';

          return (
            <div
              key={id}
              className={`p-1 rounded-xl border flex flex-col gap-1 transition-all group/row ${isEnabled ? 'bg-white border-[#333]/10 shadow-sm' : 'bg-slate-50 border-transparent opacity-50 hover:opacity-80'} ${isDropTarget ? 'ring-2 ring-[#33569a] bg-[#33569a]/5' : ''} ${isGroupViewActive ? 'ring-2 ring-[#33569a]/50 bg-blue-50' : ''}`}
              draggable={!isManual}
              onDragStart={(e) => {
                if (!isManual) {
                  setDraggedItem({ type: 'group', groupId: id });
                  e.dataTransfer.effectAllowed = 'move';
                }
              }}
              onDragEnd={() => setDraggedItem(null)}
              onDragOver={(e) => {
                if (draggedItem && draggedItem.groupId !== id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!draggedItem) return;

                if (draggedItem.type === 'color' && draggedItem.colorHex) {
                  onMoveColor(draggedItem.colorHex, draggedItem.groupId, id);
                } else if (draggedItem.type === 'group') {
                  onMergeGroups(draggedItem.groupId, id);
                }
                setDraggedItem(null);
              }}
              onMouseEnter={() => setHoveredGroupId(id)}
              onMouseLeave={() => setHoveredGroupId(null)}
            >
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={isEnabled} onChange={() => {
                  setEnabledGroups(prev => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }} className="w-3 h-3 rounded border-slate-300 accent-[#333] cursor-pointer shrink-0" />

                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => onEditTarget(id, 'original')}
                    className="flex-1 h-6 rounded-lg border border-black/5 shadow-inner relative group/btn overflow-hidden transition-transform active:scale-[0.98]"
                    style={{ backgroundColor: currentOriginal }}
                    title={`Group Area: ${groupPercent}% - Click to change anchor color`}
                  >
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/btn:opacity-100 bg-black/10 transition-opacity">
                      <span className="text-[8px] font-mono font-bold text-white drop-shadow-md bg-black/30 px-1 py-0.5 rounded backdrop-blur-[1px]">{currentOriginal.toUpperCase()}</span>
                    </div>
                    <div className="absolute top-0 right-0 px-1 text-[7px] font-bold text-black/40 bg-white/40 rounded-bl-md backdrop-blur-[1px]">{groupPercent}%</div>
                  </button>

                  <i className="fa-solid fa-chevron-right text-[9px] text-slate-300 shrink-0"></i>

                  <button
                    onClick={() => onEditTarget(id, 'recolor')}
                    className={`w-6 h-6 rounded-lg border shrink-0 transition-all flex items-center justify-center active:scale-[0.98] ${targetRecolor ? 'border-[#333]/20 shadow-sm' : 'border-dashed border-slate-300 hover:border-slate-400 bg-slate-50'}`}
                    style={{ backgroundColor: targetRecolor || 'transparent' }}
                    title="Target Color (Optional)"
                  >
                    {!targetRecolor && <i className="fa-solid fa-eye-dropper text-[9px] text-slate-300"></i>}
                  </button>
                </div>

                {/* View in Image button - Handles both Desktop Hover and Mobile Toggle */}
                <button
                  onClick={(e) => {
                    if (isTouchDevice) {
                      e.stopPropagation();
                      onMobileViewToggle(id, 'group');
                    } else {
                      setHoveredGroupId(hoveredGroupId === id ? null : id);
                    }
                  }}
                  className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors shrink-0 
                    ${(hoveredGroupId === id || isGroupViewActive) ? 'bg-[#33569a] text-white' : 'text-slate-300 hover:text-[#33569a] hover:bg-[#33569a]/10'}`}
                  title="View in Image"
                >
                  <i className="fa-solid fa-eye text-[9px]"></i>
                </button>

                {/* Mobile: Tap to select for merging */}
                {isTouchDevice && !isManual && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (draggedItem && draggedItem.groupId !== id) {
                        // There's a selection - merge into this group
                        if (draggedItem.type === 'group') {
                          onMergeGroups(draggedItem.groupId, id);
                        } else if (draggedItem.colorHex) {
                          onMoveColor(draggedItem.colorHex, draggedItem.groupId, id);
                        }
                        setDraggedItem(null);
                      } else if (draggedItem?.groupId === id) {
                        // Deselect
                        setDraggedItem(null);
                      } else {
                        // Select this group for moving
                        setDraggedItem({ type: 'group', groupId: id });
                      }
                    }}
                    className={`w-5 h-5 flex items-center justify-center rounded-full transition-all shrink-0 ${draggedItem?.groupId === id ? 'bg-[#33569a] text-white scale-110' : draggedItem && draggedItem.groupId !== id ? 'bg-[#33569a]/10 text-[#33569a] ring-2 ring-[#33569a]/30' : 'text-slate-300 active:text-[#33569a]'}`}
                    title={draggedItem?.groupId === id ? 'Tap to deselect' : draggedItem ? 'Tap to merge here' : 'Tap to select for moving'}
                  >
                    <i className={`fa-solid ${draggedItem?.groupId === id ? 'fa-check' : draggedItem ? 'fa-arrow-down' : 'fa-grip-vertical'} text-[9px]`}></i>
                  </button>
                )}

                {isManual && (
                  <button onClick={() => onRemoveManualLayer(id)} className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors shrink-0">
                    <i className="fa-solid fa-times text-[9px]"></i>
                  </button>
                )}
              </div>

              {members.length > 1 && (
                <div className="flex flex-wrap gap-1 px-5 pb-1 relative">
                  {members.sort((a, b) => b.count - a.count).map(member => {
                    const memberPercent = totalSamples > 0 ? ((member.count / totalSamples) * 100).toFixed(1) : '0';
                    const isPopupOpen = mobilePopup?.colorHex === member.hex && mobilePopup?.groupId === id;
                    // Check if this subcolor is the active persistent view target
                    const isSubcolorActive = mobileViewTarget?.id === member.hex && mobileViewTarget?.type === 'color';

                    return (
                      <div key={member.hex} className="relative">
                        <button
                          draggable={!isTouchDevice}
                          onDragStart={(e) => {
                            setDraggedItem({ type: 'color', colorHex: member.hex, groupId: id });
                            e.dataTransfer.effectAllowed = 'move';
                            e.stopPropagation();
                          }}
                          onDragEnd={() => setDraggedItem(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isTouchDevice) {
                              // Mobile: show popup for options
                              setMobilePopup(isPopupOpen ? null : { groupId: id, colorHex: member.hex, percent: memberPercent });
                            } else {
                              // Desktop: ungroup directly
                              onMoveColor(member.hex, id, 'new');
                            }
                          }}
                          onMouseEnter={() => !isTouchDevice && setHoveredColor(member.hex)}
                          onMouseLeave={() => !isTouchDevice && setHoveredColor(null)}
                          className={`subcolor-btn w-5 h-5 rounded-full border-2 transition-all hover:scale-110 active:scale-95 relative group/member 
                            ${isPopupOpen || isSubcolorActive ? 'border-[#33569a] ring-2 ring-[#33569a]/30' : 'border-black/10 hover:border-[#33569a]'} 
                            ${isTouchDevice ? 'cursor-pointer' : 'cursor-move'}`}
                          style={{ backgroundColor: member.hex }}
                          title={`${member.hex} (${memberPercent}%)`}
                        >
                          {/* Active Indicator Icon for Mobile View */}
                          {isSubcolorActive && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-full animate-in zoom-in duration-200">
                              <i className="fa-solid fa-check text-[8px] text-white drop-shadow-md"></i>
                            </div>
                          )}

                          {/* Drag indicator - desktop only */}
                          {!isTouchDevice && (
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/member:opacity-100 transition-opacity bg-black/20 rounded-full">
                              <i className="fa-solid fa-grip-vertical text-[6px] text-white drop-shadow-md"></i>
                            </div>
                          )}
                        </button>

                        {/* Mobile Popup */}
                        {isPopupOpen && (
                          <div className="mobile-color-popup absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-50 min-w-[120px]">
                            <div className="text-center mb-2">
                              <div className="w-8 h-8 rounded-full mx-auto border-2 border-black/10 shadow-inner" style={{ backgroundColor: member.hex }}></div>
                              <div className="text-[9px] font-mono font-bold text-[#333] mt-1">{member.hex.toUpperCase()}</div>
                              <div className="text-[8px] text-slate-400">{memberPercent}%</div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => {
                                  // Trigger the One-Way persistent view logic
                                  onMobileViewToggle(member.hex, 'color');
                                  setMobilePopup(null);
                                }}
                                className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg text-[9px] font-bold text-[#333] transition-colors"
                              >
                                <i className="fa-solid fa-eye text-[#33569a]"></i>
                                <span>View in Image</span>
                              </button>
                              <button
                                onClick={() => {
                                  onMoveColor(member.hex, id, 'new');
                                  setMobilePopup(null);
                                }}
                                className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg text-[9px] font-bold text-[#333] transition-colors"
                              >
                                <i className="fa-solid fa-arrow-up-right-from-square text-[#33569a]"></i>
                                <span>Ungroup Color</span>
                              </button>
                              <div className="border-t border-slate-100 pt-1 mt-1">
                                <div className="text-[7px] uppercase text-slate-400 font-bold mb-1 px-2">Move to group</div>
                                {colorGroups.filter(g => g.id !== id).slice(0, 4).map(target => (
                                  <button
                                    key={target.id}
                                    onClick={() => {
                                      onMoveColor(member.hex, id, target.id);
                                      setMobilePopup(null);
                                    }}
                                    className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded text-left w-full"
                                  >
                                    <div className="w-3 h-3 rounded-full border border-black/5" style={{ backgroundColor: selectedInGroup[target.id] || target.members[0]?.hex }} />
                                    <span className="text-[8px] text-slate-600 truncate">Group {target.id.split('-')[1]}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full">
                              <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-white"></div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* New Group Drop Zone */}
        {draggedItem && (
          <div
            className="p-3 rounded-xl border-2 border-dashed border-[#33569a] bg-[#33569a]/5 flex items-center justify-center gap-2 text-[#33569a] font-bold text-[10px] uppercase tracking-wide transition-all hover:bg-[#33569a]/10"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!draggedItem) return;

              if (draggedItem.type === 'color' && draggedItem.colorHex) {
                onMoveColor(draggedItem.colorHex, draggedItem.groupId, 'new');
              }
              setDraggedItem(null);
            }}
          >
            <i className="fa-solid fa-plus-circle"></i>
            <span>Drop here to create new group</span>
          </div>
        )}
      </div>
    </div>
  );
};