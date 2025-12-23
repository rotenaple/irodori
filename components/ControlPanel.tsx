
import React, { useState } from 'react';
import { ColorGroup } from '../types';

// Moved outside and explicitly typed to resolve children property inference issues
interface InfoBoxProps {
  children: React.ReactNode;
}

// Fix: Moved InfoBox outside of ControlPanel and used React.FC to ensure proper children type inference
const InfoBox: React.FC<InfoBoxProps> = ({ children }) => (
  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm leading-relaxed text-slate-600 mt-2 shadow-sm">
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
  setHoveredGroupId: (id: string | null) => void;
  totalSamples: number;

  paletteLength: number;

  disableScaling: boolean;
  setDisableScaling: (v: boolean) => void;
  disablePostProcessing: boolean;
  setDisablePostProcessing: (v: boolean) => void;
  disableRecoloring: boolean;
  setDisableRecoloring: (v: boolean) => void;
  isSvg: boolean;
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
  onMergeGroups, onRecomputeGroups, setHoveredColor, setHoveredGroupId,
  totalSamples,
  disableScaling, setDisableScaling,
  disablePostProcessing, setDisablePostProcessing,
  disableRecoloring, setDisableRecoloring,
  isSvg
}) => {
  const [activeInfo, setActiveInfo] = useState<string | null>(null);

  const toggleInfo = (key: string) => setActiveInfo(activeInfo === key ? null : key);

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

          return (
            <div
              key={id}
              className={`p-1 rounded-xl border flex flex-col gap-1 transition-all group/row ${isEnabled ? 'bg-white border-[#333]/10 shadow-sm' : 'bg-slate-50 border-transparent opacity-50 hover:opacity-80'}`}
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

                {/* Quick Merge Action (Simple version: click icon to select target or just a simple dropdown) */}
                <div className="relative group/merge">
                  <button className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-[#33569a] transition-colors">
                    <i className="fa-solid fa-layer-group text-[9px]"></i>
                  </button>
                  <div className="absolute right-0 top-full mt-1 hidden group-hover/merge:flex flex-col bg-white border border-slate-200 rounded-lg shadow-xl z-[100] min-w-[120px] p-1">
                    <div className="text-[8px] font-bold uppercase text-slate-400 px-2 py-1">Merge into...</div>
                    {colorGroups.filter(g => g.id !== id).map(target => (
                      <button
                        key={target.id}
                        onClick={() => onMergeGroups(id, target.id)}
                        className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded transition-colors text-left"
                      >
                        <div className="w-3 h-3 rounded-full border border-black/5" style={{ backgroundColor: selectedInGroup[target.id] || target.members[0].hex }} />
                        <span className="text-[9px] font-medium text-slate-600 truncate">Group {target.id.split('-')[1]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {isManual && (
                  <button onClick={() => onRemoveManualLayer(id)} className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors shrink-0">
                    <i className="fa-solid fa-times text-[9px]"></i>
                  </button>
                )}
              </div>

              {members.length > 1 && (
                <div className="flex flex-wrap gap-1 px-5 pb-1">
                  {members.sort((a, b) => b.count - a.count).map(member => {
                    const memberPercent = totalSamples > 0 ? ((member.count / totalSamples) * 100).toFixed(1) : '0';
                    return (
                      <div
                        key={member.hex}
                        className="w-4 h-4 rounded-full border border-black/5 relative group/member cursor-pointer"
                        style={{ backgroundColor: member.hex }}
                        onMouseEnter={() => setHoveredColor(member.hex)}
                        onMouseLeave={() => setHoveredColor(null)}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover/member:flex flex-col items-center bg-[#333] text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-lg z-50 whitespace-nowrap">
                          <span>{memberPercent}%</span>
                          <div className="absolute top-full border-4 border-transparent border-t-[#333]"></div>
                        </div>

                        <button
                          onClick={(e) => { e.stopPropagation(); onMoveColor(member.hex, id, 'new'); }}
                          className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-white shadow-md border border-slate-100 rounded-[4px] px-1 text-[7px] font-bold text-[#33569a] opacity-0 group-hover/member:opacity-100 transition-opacity z-20 whitespace-nowrap"
                        >
                          Ungroup
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
