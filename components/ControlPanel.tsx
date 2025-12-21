
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
  
  paletteLength: number;
  
  skipColorCleanup: boolean;
  setSkipColorCleanup: (v: boolean) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  upscaleFactor, setUpscaleFactor,
  denoiseRadius, setDenoiseRadius,
  smoothingLevels, setSmoothingLevels,
  edgeProtection, setEdgeProtection,
  image, onImageUpload, colorGroups, manualLayerIds,
  selectedInGroup, enabledGroups, setEnabledGroups, colorOverrides,
  onAddManualLayer, onRemoveManualLayer, onEditTarget,
  paletteLength,
  skipColorCleanup, setSkipColorCleanup
}) => {
  const [activeInfo, setActiveInfo] = useState<string | null>(null);

  const toggleInfo = (key: string) => setActiveInfo(activeInfo === key ? null : key);

  return (
    <div className="flex flex-col gap-8 pb-8">
      {/* Upload Section */}
      <div className="border-b border-[#333]/10 pb-8">
        <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-all group relative overflow-hidden ${image ? 'border-[#333]/10 bg-white hover:border-[#333]/30' : 'border-[#33569a]/30 bg-[#33569a]/5 hover:bg-[#33569a]/10 hover:border-[#33569a]/50'}`}>
            <div className="flex flex-col items-center gap-3 z-10">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${image ? 'bg-[#333]/5 text-[#333]/40 group-hover:bg-[#333]/10' : 'bg-[#33569a]/10 text-[#33569a] group-hover:bg-[#33569a]/20'}`}>
                   <i className={`fa-solid ${image ? 'fa-arrow-rotate-right' : 'fa-upload'} text-xl`}></i>
                </div>
                <span className={`text-sm font-bold uppercase tracking-widest transition-colors ${image ? 'text-[#333]/40 group-hover:text-[#333]/60' : 'text-[#33569a] group-hover:text-[#33569a]/80'}`}>
                  {image ? 'Replace Flag' : 'Upload Flag'}
                </span>
            </div>
            <input type="file" className="hidden" accept="image/*" onChange={onImageUpload} />
        </label>
      </div>

      {/* Parameters Group */}
      <div className="space-y-6">
        
        {/* Cleanup Toggle */}
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-center justify-between">
           <div className="flex flex-col">
             <span className="text-sm font-bold text-[#333] uppercase tracking-wide">Bypass Color Cleanup</span>
             <span className="text-xs text-slate-500">Resize & Re-encode only</span>
           </div>
           <div className="relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in">
                <input 
                    type="checkbox" 
                    name="toggle" 
                    id="toggle" 
                    checked={skipColorCleanup} 
                    onChange={(e) => setSkipColorCleanup(e.target.checked)}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer border-[#333]/20 checked:border-[#333] checked:right-0 right-6 transition-all"
                />
                <label htmlFor="toggle" className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer transition-colors ${skipColorCleanup ? 'bg-[#333]' : 'bg-slate-300'}`}></label>
           </div>
        </div>

        {/* Target Scale */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm font-bold text-[#333] uppercase tracking-wide">
            <div className="flex items-center gap-2">
              <span>Target Scale</span>
              <button onClick={() => toggleInfo('scale')} className="text-[#33569a] hover:opacity-70 px-1"><i className="fa-solid fa-circle-info"></i></button>
            </div>
            <span className="font-mono text-[#33569a] bg-[#33569a]/10 px-1.5 py-0.5 rounded text-sm">{upscaleFactor === 'NS' ? 'AUTO' : `${upscaleFactor}X`}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 4].map(f => (
              <button key={f} onClick={() => setUpscaleFactor(f as number)} className={`px-2 py-2 rounded-lg text-sm font-bold uppercase transition-all border ${upscaleFactor === f ? 'bg-[#333] text-white border-[#333] shadow-md' : 'bg-white text-[#333] border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>{f}X</button>
            ))}
            <button onClick={() => setUpscaleFactor('NS')} className={`px-2 py-2 rounded-lg text-sm font-bold uppercase transition-all border ${upscaleFactor === 'NS' ? 'bg-[#333] text-white border-[#333] shadow-md' : 'bg-white text-[#333] border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>NS</button>
          </div>
          {activeInfo === 'scale' && (
            <InfoBox>
              Auto-scales to NationStates standard sizes:<br/>
              • A-ratio: 535x355px<br/>
              • B-ratio: 568x321px
            </InfoBox>
          )}
        </div>

        {/* Denoise */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm font-bold text-[#333] uppercase tracking-wide">
            <div className="flex items-center gap-2">
              <span>Denoise</span>
              <button onClick={() => toggleInfo('denoise')} className="text-[#33569a] hover:opacity-70 px-1"><i className="fa-solid fa-circle-info"></i></button>
            </div>
            <span className="text-[#33569a] font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-sm">{denoiseRadius === 0 ? "OFF" : denoiseRadius + "px"}</span>
          </div>
          <input type="range" min="0" max="3" step="1" value={denoiseRadius} onChange={(e) => setDenoiseRadius(parseInt(e.target.value))} className="custom-slider" />
          {activeInfo === 'denoise' && (
            <InfoBox>
              Applies a median filter to remove JPEG artifacts and noise speckles before processing colors.
            </InfoBox>
          )}
        </div>

        {/* Bleed Guard */}
        <div className={`space-y-2 transition-opacity ${skipColorCleanup ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="flex justify-between items-center text-sm font-bold text-[#333] uppercase tracking-wide">
            <div className="flex items-center gap-2">
              <span>Bleed Guard</span>
              <button onClick={() => toggleInfo('bleed')} className="text-[#33569a] hover:opacity-70 px-1"><i className="fa-solid fa-circle-info"></i></button>
            </div>
            <span className="text-[#33569a] font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-sm">{edgeProtection === 0 ? "OFF" : edgeProtection + "%"}</span>
          </div>
          <input type="range" min="0" max="100" step="10" value={edgeProtection} onChange={(e) => setEdgeProtection(parseInt(e.target.value))} className="custom-slider" />
          {activeInfo === 'bleed' && (
            <InfoBox>
              Prevents colors from bleeding into each other at boundaries. Higher values keep edges sharper but may leave jagged lines.
            </InfoBox>
          )}
        </div>

        {/* Sub-Pixel */}
        <div className={`space-y-2 transition-opacity ${skipColorCleanup ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="flex justify-between items-center text-sm font-bold text-[#333] uppercase tracking-wide">
            <div className="flex items-center gap-2">
              <span>Sub-Pixel</span>
              <button onClick={() => toggleInfo('subpixel')} className="text-[#33569a] hover:opacity-70 px-1"><i className="fa-solid fa-circle-info"></i></button>
            </div>
            <span className="text-[#33569a] font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-sm">{smoothingLevels === 0 ? "OFF" : smoothingLevels === 1 ? "OPT" : "ULT"}</span>
          </div>
          <input type="range" min="0" max="2" step="1" value={smoothingLevels} onChange={(e) => setSmoothingLevels(parseInt(e.target.value))} className="custom-slider" />
          {activeInfo === 'subpixel' && (
            <InfoBox>
              Adds anti-aliasing to smooth out jagged edges. 
              <br/>• OPT: Standard smoothing
              <br/>• ULT: Ultra-fine blending
            </InfoBox>
          )}
        </div>
      </div>

      <div className={`border-t border-[#333]/10 pt-6 transition-opacity duration-300 ${skipColorCleanup ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base uppercase font-bold text-[#333] m-0 tracking-wide">Color Mapping</h3>
            <button onClick={onAddManualLayer} className="text-sm font-bold uppercase px-3 py-1 bg-white border border-[#333]/10 rounded-lg hover:bg-slate-50 transition-colors shadow-sm text-[#33569a]">
              <i className="fa-solid fa-plus mr-1"></i> Add
            </button>
          </div>
          <p className="text-sm text-slate-500 leading-normal">
            Map source colors (left) to clean target colors (right). Uncheck to exclude noise.
          </p>
        </div>
        
        <div className="flex flex-col gap-2 pr-1">
          {!image && <p className="text-sm italic text-slate-400 text-center py-8 uppercase tracking-widest border border-dashed border-slate-200 rounded-xl">Import to extract colors</p>}
          {[...colorGroups, ...manualLayerIds.map(id => ({ id, isManual: true }))].map(item => {
             const id = (item as any).id;
             const isManual = (item as any).isManual;
             const isEnabled = enabledGroups.has(id);
             const currentOriginal = selectedInGroup[id] || (item as ColorGroup).members?.[0].hex || '#ffffff';
             const targetRecolor = colorOverrides[id];
             
             return (
              <div key={id} className={`p-2 rounded-xl border flex items-center gap-3 transition-all group ${isEnabled ? 'bg-white border-[#333]/10 shadow-sm' : 'bg-slate-50 border-transparent opacity-50 hover:opacity-80'}`}>
                <input type="checkbox" checked={isEnabled} onChange={() => {
                  setEnabledGroups(prev => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }} className="w-4 h-4 rounded border-slate-300 accent-[#333] cursor-pointer shrink-0" />

                <div className="flex-1 flex items-center gap-3 min-w-0">
                  {/* Source Color - Takes available space */}
                  <button 
                    onClick={() => onEditTarget(id, 'original')} 
                    className="flex-1 h-9 rounded-lg border border-black/5 shadow-inner relative group overflow-hidden transition-transform active:scale-[0.98]" 
                    style={{ backgroundColor: currentOriginal }} 
                    title="Source Color - Click to edit"
                  >
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/10 transition-opacity">
                        <span className="text-[10px] font-mono font-bold text-white drop-shadow-md bg-black/30 px-1.5 py-0.5 rounded backdrop-blur-[1px]">{currentOriginal.toUpperCase()}</span>
                    </div>
                  </button>

                  <i className="fa-solid fa-chevron-right text-xs text-slate-300 shrink-0"></i>

                  {/* Target Color - Fixed size compact */}
                  <button 
                    onClick={() => onEditTarget(id, 'recolor')} 
                    className={`w-9 h-9 rounded-lg border shrink-0 transition-all flex items-center justify-center active:scale-[0.98] ${targetRecolor ? 'border-[#333]/20 shadow-sm' : 'border-dashed border-slate-300 hover:border-slate-400 bg-slate-50'}`} 
                    style={{ backgroundColor: targetRecolor || 'transparent' }} 
                    title="Target Color (Optional)"
                  >
                    {!targetRecolor && <i className="fa-solid fa-eye-dropper text-xs text-slate-300"></i>}
                  </button>
                </div>

                {isManual && (
                  <button onClick={() => onRemoveManualLayer(id)} className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors shrink-0">
                    <i className="fa-solid fa-times text-xs"></i>
                  </button>
                )}
              </div>
             );
          })}
        </div>
      </div>
    </div>
  );
};
