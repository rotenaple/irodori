import React, { useState, useEffect, useRef } from 'react';
import { ColorGroup, PixelArtConfig } from '../types';
import { DualNumberInput } from './DualNumberInput';

// --- Reusable UI Components ---

const ExpandableInfoBox: React.FC<{ isOpen: boolean; children: React.ReactNode }> = ({ isOpen, children }) => (
  <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${
    isOpen ? 'grid-rows-[1fr] opacity-100 mb-2' : 'grid-rows-[0fr] opacity-0 mb-0'
  }`}>
    <div className="overflow-hidden">
      <div className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg text-sm leading-relaxed text-slate-600 shadow-sm">
        {children}
      </div>
    </div>
  </div>
);

interface SectionHeaderProps {
  title: string;
  isEnabled?: boolean;
  onToggleEnabled?: () => void;
  toggleDisabled?: boolean;
  infoKey?: string;
  isInfoActive?: boolean;
  onInfoToggle?: () => void;
  rightElement?: React.ReactNode;
  disabledStyle?: boolean;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ 
  title, isEnabled, onToggleEnabled, toggleDisabled, infoKey, isInfoActive, onInfoToggle, rightElement, disabledStyle 
}) => (
  <div className="flex items-center gap-2 mb-2 border-b border-[#333]/5 pb-1">
    {onToggleEnabled && (
      <button 
        onClick={toggleDisabled ? undefined : onToggleEnabled}
        disabled={toggleDisabled}
        className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out shrink-0 ${
          toggleDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        } ${isEnabled ? 'bg-slate-600' : 'bg-slate-300'}`}
      >
        <div className={`w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform duration-200 ${isEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    )}
    
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <h3 className={`text-[11px] font-bold uppercase tracking-widest truncate ${disabledStyle ? 'text-gray-300' : 'text-gray-600'}`}>
        {title}
      </h3>
      {infoKey && onInfoToggle && (
        <button 
          onClick={onInfoToggle} 
          className={`transition-colors ${isInfoActive ? 'text-[#33569a]' : disabledStyle ? 'text-slate-300' : 'text-[#333]/40 hover:text-[#33569a]'}`}
        >
          <i className="fa-solid fa-circle-info"></i>
        </button>
      )}
    </div>

    {rightElement && <div className="shrink-0">{rightElement}</div>}
  </div>
);

interface SliderControlProps {
  label: string;
  value: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
  infoKey: string;
  description: string;
  isInfoOpen: boolean;
  onInfoToggle: () => void;
  unit?: string;
}

const SliderControl: React.FC<SliderControlProps> = ({ 
  label, value, max, step, onChange, infoKey, description, isInfoOpen, onInfoToggle, unit 
}) => {
  const displayUnit = unit !== undefined ? unit : (max > 10 ? "%" : "px");

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center text-[10px] font-bold text-[#333] uppercase tracking-wide">
        <div className="flex items-center gap-2">
          <span>{label}</span>
          <button 
            onClick={onInfoToggle} 
            className={`px-1 transition-colors ${isInfoOpen ? 'text-[#33569a]' : 'text-[#33569a]/70 hover:text-[#33569a]'}`}
          >
            <i className="fa-solid fa-circle-info"></i>
          </button>
        </div>
        <span className="text-[#33569a] font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-[10px]">
          {value === 0 ? "OFF" : `${value}${displayUnit}`}
        </span>
      </div>
      <ExpandableInfoBox isOpen={isInfoOpen}>{description}</ExpandableInfoBox>
      <input 
        type="range" min="0" max={max} step={step} value={value} 
        onChange={(e) => onChange(parseInt(e.target.value))} 
        className="custom-slider" 
      />
    </div>
  );
};

// --- Main Component ---

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
  colorGroupingDistance: number;
  setColorGroupingDistance: (v: number) => void;
  alphaSmoothness: number;
  setAlphaSmoothness: (v: number) => void;
  hasTransparency: boolean;
  preserveTransparency: boolean;
  setPreserveTransparency: (v: boolean) => void;
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
  mobileViewTarget: { id: string, type: 'group' | 'color' } | null;
  onMobileViewToggle: (id: string, type: 'group' | 'color') => void;
  pixelArtConfig: PixelArtConfig;
  setPixelArtConfig: (v: PixelArtConfig | ((prev: PixelArtConfig) => PixelArtConfig)) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  upscaleFactor, setUpscaleFactor, denoiseRadius, setDenoiseRadius, smoothingLevels, setSmoothingLevels,
  vertexInertia, setVertexInertia, edgeProtection, setEdgeProtection, colorGroupingDistance, setColorGroupingDistance,
  alphaSmoothness, setAlphaSmoothness, hasTransparency, preserveTransparency, setPreserveTransparency,
  image, onImageUpload,
  colorGroups, manualLayerIds, selectedInGroup, enabledGroups, setEnabledGroups, colorOverrides,
  onAddManualLayer, onRemoveManualLayer, onEditTarget, onMoveColor, onMergeGroups, onRecomputeGroups,
  setHoveredColor, hoveredGroupId, setHoveredGroupId, draggedItem, setDraggedItem, totalSamples,
  paletteLength,
  disableScaling, setDisableScaling, disablePostProcessing, setDisablePostProcessing,
  disableRecoloring, setDisableRecoloring, isSvg, mobileViewTarget, onMobileViewToggle,
  pixelArtConfig, setPixelArtConfig
}) => {
  const [activeInfos, setActiveInfos] = useState<Set<string>>(new Set());
  const [mobilePopup, setMobilePopup] = useState<{ groupId: string, colorHex: string, percent: string } | null>(null);
  const [expandedSubcolors, setExpandedSubcolors] = useState<Set<string>>(new Set());
  const [subcolorLimit, setSubcolorLimit] = useState(16);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggleInfo = (key: string) => {
    setActiveInfos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSubcolorExpansion = (groupId: string) => {
    setExpandedSubcolors(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const isTouchDevice = typeof window !== 'undefined' && 'ontouchstart' in window;

  useEffect(() => {
    if (isSvg) {
      setDisablePostProcessing(true);
      setDisableScaling(true);
    } else if (image) {
      setDisablePostProcessing(false);
      setDisableScaling(false);
    }
  }, [image, isSvg, setDisablePostProcessing, setDisableScaling]);

  useEffect(() => {
    if (!panelRef.current) return;
    const calculateLimit = () => {
      if (!panelRef.current) return;
      const availableWidth = panelRef.current.clientWidth - 52;
      const itemsPerRow = Math.floor(availableWidth / 24);
      setSubcolorLimit(Math.max(12, itemsPerRow * 2));
    };
    calculateLimit();
    const observer = new ResizeObserver(calculateLimit);
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
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

  const cleanupControls = [
    { label: 'Remove Noise', val: denoiseRadius, set: setDenoiseRadius, max: 3, step: 1, info: 'denoise', desc: 'Removes grain and compression artifacts.' },
    { label: 'Edge Crispness', val: edgeProtection, set: setEdgeProtection, max: 100, step: 10, info: 'bleed', desc: 'Tightens color boundaries.' },
    { label: 'Corner Protection', val: vertexInertia, set: setVertexInertia, max: 100, step: 10, info: 'inertia', desc: 'Preserves sharp vertices.' },
    { label: 'Edge Smoothing', val: smoothingLevels, set: setSmoothingLevels, max: 100, step: 5, info: 'subpixel', desc: 'Applies anti-aliasing.' }
  ];

  return (
    <div ref={panelRef} className="flex flex-col gap-6 pb-0">
      
      {/* 1. Upload Section */}
      <div className="border-b border-[#333]/10 pb-3">
        <label className={`flex flex-col items-center justify-center w-full h-14 border-2 border-dashed rounded-xl cursor-pointer transition-all group relative overflow-hidden ${image ? 'border-[#333]/10 bg-white hover:border-[#333]/30' : 'border-[#33569a]/30 bg-[#33569a]/5 hover:bg-[#33569a]/10 hover:border-[#33569a]/50'}`}>
          <div className="flex flex-row items-center gap-3 z-10">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${image ? 'bg-[#333]/5 text-[#333]/40 group-hover:bg-[#333]/10' : 'bg-[#33569a]/10 text-[#33569a] group-hover:bg-[#33569a]/20'}`}>
              <i className={`fa-solid ${image ? 'fa-arrow-rotate-right' : 'fa-upload'} text-sm`}></i>
            </div>
            <span className={`text-[11px] font-bold uppercase tracking-widest transition-colors ${image ? 'text-[#333]/40 group-hover:text-[#333]/60' : 'text-[#33569a] group-hover:text-[#33569a]/80'}`}>{image ? 'Replace Flag' : 'Upload Flag'}</span>
          </div>
          <input type="file" className="hidden" accept="image/*" onChange={onImageUpload} />
        </label>
      </div>

      {/* 2. Output Size Section */}
      <div className="flex flex-col gap-0.25">
        <SectionHeader 
          title="Output Size"
          disabledStyle={disableScaling}
          infoKey="scale"
          isInfoActive={activeInfos.has('scale')}
          onInfoToggle={() => toggleInfo('scale')}
          rightElement={
            <span className={`font-mono bg-[#33569a]/10 px-1.5 py-0.5 rounded text-[10px] ${disableScaling ? 'text-slate-300' : 'text-[#33569a]'}`}>
              {upscaleFactor === 'NS' ? 'AUTO' : `${upscaleFactor}X`}
            </span>
          }
        />

        <ExpandableInfoBox isOpen={activeInfos.has('scale')}>
          {isSvg ? (
            <><div className="flex items-center gap-2 text-amber-600 font-bold mb-1"><i className="fa-solid fa-triangle-exclamation"></i><span>SVG detected</span></div>Scaling is disabled; SVGs maintain infinite resolution.</>
          ) : pixelArtConfig.enabled ? (
            <><div className="flex items-center gap-2 text-blue-600 font-bold mb-1"><i className="fa-solid fa-cube"></i><span>Pixel Art Mode Active</span></div>Scale value is used as maximum dimension. The largest integer scale that fits will be applied.</>  ) : (
            "Resizes to NationStates dimensions (535x355px or 321x568px), with automatic further compression if file size exceeds 150kb."
          )}
        </ExpandableInfoBox>

        <div className={`grid grid-cols-4 gap-1.5 transition-opacity ${disableScaling ? 'opacity-40 pointer-events-none' : ''}`}>
          {[1, 2, 4].map(f => (
            <button key={f} onClick={() => setUpscaleFactor(f as number)} className={`px-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-all border ${upscaleFactor === f ? 'bg-[#333] text-white border-[#333] shadow-md' : 'bg-white text-[#333] border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>{f}X</button>
          ))}
          <button onClick={() => setUpscaleFactor('NS')} className={`px-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-all border ${upscaleFactor === 'NS' ? 'bg-[#333] text-white border-[#333] shadow-md' : 'bg-white text-[#333] border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>Auto</button>
        </div>
      </div>

      {/* 3. Cleanup & Quality Section */}
      <div className="space-y-2">
        <SectionHeader 
          title="Cleanup & Quality"
          isEnabled={!disablePostProcessing}
          onToggleEnabled={() => setDisablePostProcessing(!disablePostProcessing)}
          toggleDisabled={isSvg || pixelArtConfig.enabled}
          disabledStyle={disablePostProcessing || isSvg || pixelArtConfig.enabled}
          infoKey={(isSvg || pixelArtConfig.enabled) ? 'disabled-pp' : undefined}
          isInfoActive={activeInfos.has('disabled-pp')}
          onInfoToggle={(isSvg || pixelArtConfig.enabled) ? () => toggleInfo('disabled-pp') : undefined}
        />

        {(isSvg || pixelArtConfig.enabled) && (
          <ExpandableInfoBox isOpen={activeInfos.has('disabled-pp')}>
            {isSvg ? (
              <><div className="flex items-center gap-2 text-amber-600 font-bold mb-1"><i className="fa-solid fa-triangle-exclamation"></i><span>SVG detected</span></div>Processing is disabled to preserve original vector precision.</>
            ) : (
              <><div className="flex items-center gap-2 text-blue-600 font-bold mb-1"><i className="fa-solid fa-cube"></i><span>Pixel Art Mode Active</span></div>Post-processing is disabled to maintain sharp pixel boundaries and avoid anti-aliasing.</>
            )}
          </ExpandableInfoBox>
        )}

        <div className={`space-y-2 transition-opacity ${disablePostProcessing || pixelArtConfig.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
          {cleanupControls.map(ctrl => (
            <SliderControl
              key={ctrl.label}
              label={ctrl.label}
              value={ctrl.val}
              onChange={ctrl.set}
              max={ctrl.max}
              step={ctrl.step}
              infoKey={ctrl.info}
              description={ctrl.desc}
              isInfoOpen={activeInfos.has(ctrl.info)}
              onInfoToggle={() => toggleInfo(ctrl.info)}
            />
          ))}
        </div>
      </div>

      {/* 4. Transparency Section */}
      {image && hasTransparency && !isSvg && (
        <div className="space-y-2">
          <SectionHeader 
            title="Transparency"
            isEnabled={preserveTransparency}
            onToggleEnabled={() => setPreserveTransparency(!preserveTransparency)}
            disabledStyle={!preserveTransparency}
            infoKey="transparency"
            isInfoActive={activeInfos.has('transparency')}
            onInfoToggle={() => toggleInfo('transparency')}
          />

          <ExpandableInfoBox isOpen={activeInfos.has('transparency')}>
            Controls how transparent areas are handled during processing.
          </ExpandableInfoBox>

          <div className={`transition-opacity ${!preserveTransparency ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="space-y-2">
              <SliderControl
                label="Alpha Smoothing"
                value={alphaSmoothness}
                max={100}
                step={5}
                onChange={setAlphaSmoothness}
                infoKey="alpha"
                description="Controls transparency edge smoothing. 0% = sharp edges (preserves exact alpha), 100% = smooth edges (interpolated alpha)."
                isInfoOpen={activeInfos.has('alpha')}
                onInfoToggle={() => toggleInfo('alpha')}
              />
            </div>
          </div>
        </div>
      )}

      {/* 5. Pixel Art Mode Section */}
      {image && !isSvg && (
        <div className="space-y-2">
          <SectionHeader 
            title="Pixel Art Mode"
            isEnabled={pixelArtConfig.enabled}
            onToggleEnabled={() => {
              const willEnable = !pixelArtConfig.enabled;
              setPixelArtConfig(prev => ({ ...prev, enabled: willEnable }));
              if (willEnable && colorGroupingDistance > 15) {
                setColorGroupingDistance(10);
              }
            }}
            infoKey="pixelart"
            isInfoActive={activeInfos.has('pixelart')}
            onInfoToggle={() => toggleInfo('pixelart')}
          />

          <ExpandableInfoBox isOpen={activeInfos.has('pixelart')}>
            Reduces image to distinct pixels by sampling majority color in each block.
          </ExpandableInfoBox>
            
          {pixelArtConfig.enabled && (
            <div className="space-y-2">
              {/* Pixel Size */}
              <DualNumberInput
                label="Pixel Size"
                value1={pixelArtConfig.pixelWidth}
                value2={pixelArtConfig.pixelHeight}
                min1={1}
                max1={32}
                min2={1}
                max2={32}
                locked={pixelArtConfig.lockAspect}
                onValue1Change={(val) => setPixelArtConfig(prev => ({
                  ...prev,
                  pixelWidth: val,
                  pixelHeight: prev.lockAspect ? val : prev.pixelHeight
                }))}
                onValue2Change={(val) => setPixelArtConfig(prev => ({
                  ...prev,
                  pixelHeight: val,
                  pixelWidth: prev.lockAspect ? val : prev.pixelWidth
                }))}
                onLockToggle={() => setPixelArtConfig(prev => ({
                  ...prev,
                  lockAspect: !prev.lockAspect,
                  pixelHeight: !prev.lockAspect ? prev.pixelWidth : prev.pixelHeight
                }))}
                infoKey="pixelsize"
                isInfoOpen={activeInfos.has('pixelsize')}
                onInfoToggle={() => toggleInfo('pixelsize')}
                infoContent={
                  <ExpandableInfoBox isOpen={activeInfos.has('pixelsize')}>
                    Set the width and height of each pixel block in pixels. Lock aspect ratio to maintain square pixels.
                  </ExpandableInfoBox>
                }
              />

              {/* Offset Controls */}
              {(pixelArtConfig.pixelWidth > 1 || pixelArtConfig.pixelHeight > 1) && (
                <div className="space-y-2 mt-2">
                  <DualNumberInput
                    label="Offset"
                    value1={pixelArtConfig.offsetX}
                    value2={pixelArtConfig.offsetY}
                    min1={0}
                    max1={pixelArtConfig.pixelWidth - 1}
                    min2={0}
                    max2={pixelArtConfig.pixelHeight - 1}
                    locked={pixelArtConfig.lockOffset}
                    onValue1Change={(val) => setPixelArtConfig(prev => ({
                      ...prev,
                      offsetX: val,
                      offsetY: prev.lockOffset ? val : prev.offsetY
                    }))}
                    onValue2Change={(val) => setPixelArtConfig(prev => ({
                      ...prev,
                      offsetY: val
                    }))}
                    onLockToggle={() => setPixelArtConfig(prev => ({
                      ...prev,
                      lockOffset: !prev.lockOffset,
                      offsetY: !prev.lockOffset ? prev.offsetX : prev.offsetY
                    }))}
                    infoKey="offset"
                    isInfoOpen={activeInfos.has('offset')}
                    onInfoToggle={() => toggleInfo('offset')}
                    infoContent={
                      <ExpandableInfoBox isOpen={activeInfos.has('offset')}>
                        Fine-tune pixel grid alignment using horizontal (X) and vertical (Y) offsets. Values range from 0 to the pixel size minus 1.
                      </ExpandableInfoBox>
                    }
                    lockTitle="Lock offsets"
                    unlockTitle="Unlock offsets"
                  />
                </div>
              )}

              {/* Show Grid Checkbox */}
              <label className="flex items-center gap-2 text-[10px] text-[#333] cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={pixelArtConfig.showGrid}
                  onChange={(e) => setPixelArtConfig(prev => ({ ...prev, showGrid: e.target.checked }))}
                  className="w-3 h-3"
                />
                <span className="font-bold uppercase tracking-wide">Show Grid Overlay</span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* 6. Color Mapping Section */}
      <div className="px-0.5">
        <SectionHeader 
          title="Color Mapping"
          isEnabled={!disableRecoloring}
          onToggleEnabled={() => setDisableRecoloring(!disableRecoloring)}
          disabledStyle={disableRecoloring}
          rightElement={
            <div className="flex items-center gap-1">
              <button onClick={onRecomputeGroups} disabled={disableRecoloring || colorGroups.length === 0} className={`text-[9px] font-bold uppercase px-1.5 py-0.5 bg-white border border-[#333]/10 rounded-lg hover:bg-slate-50 transition-colors shadow-sm text-[#33569a] ${disableRecoloring ? 'opacity-50 cursor-not-allowed' : ''}`}><i className="fa-solid fa-arrows-rotate mr-1"></i> Recompute</button>
              <button onClick={onAddManualLayer} disabled={disableRecoloring} className={`text-[9px] font-bold uppercase px-1.5 py-0.5 bg-white border border-[#333]/10 rounded-lg hover:bg-slate-50 transition-colors shadow-sm text-[#33569a] ${disableRecoloring ? 'opacity-50 cursor-not-allowed' : ''}`}><i className="fa-solid fa-plus mr-1"></i> Add</button>
            </div>
          }
        />
        
        <div className={`transition-opacity ${disableRecoloring ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="mb-2">
             <SliderControl
                label="Color Grouping"
                value={colorGroupingDistance}
                max={100}
                step={5}
                onChange={setColorGroupingDistance}
                infoKey="grouping"
                description="Controls how similar colors must be to group together. Lower values create more groups with tighter color ranges; higher values merge similar colors into fewer groups."
                isInfoOpen={activeInfos.has('grouping')}
                onInfoToggle={() => toggleInfo('grouping')}
                unit="" 
              />
          </div>
          <p className="text-[10px] text-slate-500 leading-tight">Choose which colors to keep. Ungroup colors to separate them, or drag onto another group to merge.</p>
        </div>
      </div>

      {/* 7. Color Groups List */}
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
          const isGroupViewActive = mobileViewTarget?.id === id && mobileViewTarget?.type === 'group';
          const isSubcolorsExpanded = expandedSubcolors.has(id);
          const sortedMembers = [...members].sort((a, b) => b.count - a.count);
          const visibleMembers = isSubcolorsExpanded ? sortedMembers : sortedMembers.slice(0, subcolorLimit);
          const hiddenCount = sortedMembers.length - subcolorLimit;

          return (
            <div key={id} className={`p-1 rounded-xl border flex flex-col gap-1 transition-all group/row ${isEnabled ? 'bg-white border-[#333]/10 shadow-sm' : 'bg-slate-50 border-transparent opacity-50 hover:opacity-80'} ${isDropTarget ? 'ring-2 ring-[#33569a] bg-[#33569a]/5' : ''} ${isGroupViewActive ? 'ring-2 ring-[#33569a]/50 bg-blue-50' : ''}`}
              draggable={!isManual}
              onDragStart={(e) => { if (!isManual) { setDraggedItem({ type: 'group', groupId: id }); e.dataTransfer.effectAllowed = 'move'; } }}
              onDragEnd={() => setDraggedItem(null)}
              onDragOver={(e) => { if (draggedItem && draggedItem.groupId !== id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
              onDrop={(e) => { e.preventDefault(); if (!draggedItem) return; if (draggedItem.type === 'color' && draggedItem.colorHex) onMoveColor(draggedItem.colorHex, draggedItem.groupId, id); else if (draggedItem.type === 'group') onMergeGroups(draggedItem.groupId, id); setDraggedItem(null); }}
              onMouseEnter={() => setHoveredGroupId(id)}
              onMouseLeave={() => setHoveredGroupId(null)}
            >
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={isEnabled} onChange={() => { setEnabledGroups(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }} className="w-3 h-3 rounded border-slate-300 accent-[#333] cursor-pointer shrink-0" />
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <button onClick={() => onEditTarget(id, 'original')} className="flex-1 h-6 rounded-lg border border-black/5 shadow-inner relative group/btn overflow-hidden transition-transform active:scale-[0.98]" style={{ backgroundColor: currentOriginal }} title={`Group Area: ${groupPercent}% - Click to change anchor color`}>
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/btn:opacity-100 bg-black/10 transition-opacity"><span className="text-[8px] font-mono font-bold text-white drop-shadow-md bg-black/30 px-1 py-0.5 rounded backdrop-blur-[1px]">{currentOriginal.toUpperCase()}</span></div>
                    <div className="absolute top-0 right-0 px-1 text-[7px] font-bold text-black/40 bg-white/40 rounded-bl-md backdrop-blur-[1px]">{groupPercent}%</div>
                  </button>
                  <i className="fa-solid fa-chevron-right text-[9px] text-slate-300 shrink-0"></i>
                  <button onClick={() => onEditTarget(id, 'recolor')} className={`w-6 h-6 rounded-lg border shrink-0 transition-all flex items-center justify-center active:scale-[0.98] ${targetRecolor ? 'border-[#333]/20 shadow-sm' : 'border-dashed border-slate-300 hover:border-slate-400 bg-slate-50'}`} style={{ backgroundColor: targetRecolor || 'transparent' }} title="Target Color (Optional)">{!targetRecolor && <i className="fa-solid fa-eye-dropper text-[9px] text-slate-300"></i>}</button>
                </div>
                <button onClick={(e) => { if (isTouchDevice) { e.stopPropagation(); onMobileViewToggle(id, 'group'); } else { setHoveredGroupId(hoveredGroupId === id ? null : id); } }} className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors shrink-0 ${(hoveredGroupId === id || isGroupViewActive) ? 'bg-[#33569a] text-white' : 'text-slate-300 hover:text-[#33569a] hover:bg-[#33569a]/10'}`} title="View in Image"><i className="fa-solid fa-eye text-[9px]"></i></button>
                {isTouchDevice && !isManual && (
                  <button onClick={(e) => { e.stopPropagation(); if (draggedItem && draggedItem.groupId !== id) { if (draggedItem.type === 'group') onMergeGroups(draggedItem.groupId, id); else if (draggedItem.colorHex) onMoveColor(draggedItem.colorHex, draggedItem.groupId, id); setDraggedItem(null); } else if (draggedItem?.groupId === id) setDraggedItem(null); else setDraggedItem({ type: 'group', groupId: id }); }} className={`w-5 h-5 flex items-center justify-center rounded-full transition-all shrink-0 ${draggedItem?.groupId === id ? 'bg-[#33569a] text-white scale-110' : draggedItem && draggedItem.groupId !== id ? 'bg-[#33569a]/10 text-[#33569a] ring-2 ring-[#33569a]/30' : 'text-slate-300 active:text-[#33569a]'}`} title={draggedItem?.groupId === id ? 'Tap to deselect' : draggedItem ? 'Tap to merge here' : 'Tap to select for moving'}><i className={`fa-solid ${draggedItem?.groupId === id ? 'fa-check' : draggedItem ? 'fa-arrow-down' : 'fa-grip-vertical'} text-[9px]`}></i></button>
                )}
                {isManual && <button onClick={() => onRemoveManualLayer(id)} className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors shrink-0"><i className="fa-solid fa-times text-[9px]"></i></button>}
              </div>
              {members.length > 1 && (
                <div className="flex flex-col gap-2 px-5 pb-1 relative">
                  <div className="flex flex-wrap gap-1">
                    {visibleMembers.map(member => {
                      const memberPercent = totalSamples > 0 ? ((member.count / totalSamples) * 100).toFixed(1) : '0';
                      const isPopupOpen = mobilePopup?.colorHex === member.hex && mobilePopup?.groupId === id;
                      const isSubcolorActive = mobileViewTarget?.id === member.hex && mobileViewTarget?.type === 'color';
                      return (
                        <div key={member.hex} className="relative">
                          <button draggable={!isTouchDevice} onDragStart={(e) => { setDraggedItem({ type: 'color', colorHex: member.hex, groupId: id }); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }} onDragEnd={() => setDraggedItem(null)} onClick={(e) => { e.stopPropagation(); if (isTouchDevice) setMobilePopup(isPopupOpen ? null : { groupId: id, colorHex: member.hex, percent: memberPercent }); else onMoveColor(member.hex, id, 'new'); }} onMouseEnter={() => !isTouchDevice && setHoveredColor(member.hex)} onMouseLeave={() => !isTouchDevice && setHoveredColor(null)} className={`subcolor-btn w-5 h-5 rounded-full border-2 transition-all hover:scale-110 active:scale-95 relative group/member ${isPopupOpen || isSubcolorActive ? 'border-[#33569a] ring-2 ring-[#33569a]/30' : 'border-black/10 hover:border-[#33569a]'} ${isTouchDevice ? 'cursor-pointer' : 'cursor-move'}`} style={{ backgroundColor: member.hex }} title={`${member.hex} (${memberPercent}%)`}>
                            {isSubcolorActive && <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-full animate-in zoom-in duration-200"><i className="fa-solid fa-check text-[8px] text-white drop-shadow-md"></i></div>}
                            {!isTouchDevice && <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/member:opacity-100 transition-opacity bg-black/20 rounded-full"><i className="fa-solid fa-grip-vertical text-[6px] text-white drop-shadow-md"></i></div>}
                          </button>
                          {isPopupOpen && (
                            <div className="mobile-color-popup absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-50 min-w-[120px]">
                              <div className="text-center mb-2"><div className="w-8 h-8 rounded-full mx-auto border-2 border-black/10 shadow-inner" style={{ backgroundColor: member.hex }}></div><div className="text-[9px] font-mono font-bold text-[#333] mt-1">{member.hex.toUpperCase()}</div><div className="text-[8px] text-slate-400">{memberPercent}%</div></div>
                              <div className="flex flex-col gap-1">
                                <button onClick={() => { onMobileViewToggle(member.hex, 'color'); setMobilePopup(null); }} className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg text-[9px] font-bold text-[#333] transition-colors"><i className="fa-solid fa-eye text-[#33569a]"></i><span>View in Image</span></button>
                                <button onClick={() => { onMoveColor(member.hex, id, 'new'); setMobilePopup(null); }} className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg text-[9px] font-bold text-[#333] transition-colors"><i className="fa-solid fa-arrow-up-right-from-square text-[#33569a]"></i><span>Ungroup Color</span></button>
                                <div className="border-t border-slate-100 pt-1 mt-1"><div className="text-[7px] uppercase text-slate-400 font-bold mb-1 px-2">Move to group</div>
                                  {colorGroups.filter(g => g.id !== id).slice(0, 4).map((target) => (
                                    <button key={target.id} onClick={() => { onMoveColor(member.hex, id, target.id); setMobilePopup(null); }} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded text-left w-full">
                                      <div className="w-3 h-3 rounded-full border border-black/5" style={{ backgroundColor: selectedInGroup[target.id] || target.members[0]?.hex }} />
                                      <span className="text-[8px] text-slate-600 truncate">Group {colorGroups.findIndex(g => g.id === target.id) + 1}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full"><div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-white"></div></div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {hiddenCount > 0 && !isSubcolorsExpanded && <button onClick={(e) => { e.stopPropagation(); toggleSubcolorExpansion(id); }} className="w-full py-1 text-[9px] font-bold text-slate-400 hover:text-[#33569a] bg-slate-50 hover:bg-slate-100 rounded transition-colors flex items-center justify-center gap-1"><i className="fa-solid fa-angle-down"></i> Show {hiddenCount} More</button>}
                  {isSubcolorsExpanded && sortedMembers.length > subcolorLimit && <button onClick={(e) => { e.stopPropagation(); toggleSubcolorExpansion(id); }} className="w-full py-1 text-[9px] font-bold text-slate-400 hover:text-[#33569a] bg-slate-50 hover:bg-slate-100 rounded transition-colors flex items-center justify-center gap-1"><i className="fa-solid fa-angle-up"></i> Show Less</button>}
                </div>
              )}
            </div>
          );
        })}
        {draggedItem && draggedItem.type === 'color' && (
          <div className="p-3 rounded-xl border-2 border-dashed border-[#33569a] bg-[#33569a]/5 flex items-center justify-center gap-2 text-[#33569a] font-bold text-[10px] uppercase tracking-wide transition-all hover:bg-[#33569a]/10" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={(e) => { e.preventDefault(); if (!draggedItem) return; if (draggedItem.type === 'color' && draggedItem.colorHex) { onMoveColor(draggedItem.colorHex, draggedItem.groupId, 'new'); } setDraggedItem(null); }}>
            <i className="fa-solid fa-plus-circle"></i><span>Drop here to create new group</span>
          </div>
        )}
      </div>
    </div>
  );
};