import React, { useState, useEffect, useRef } from 'react';
import { ColorGroup, PixelArtConfig, RecolorMode, TintSettings, Supergroup } from '../types';
import { DualNumberInput } from './DualNumberInput';
import { hslToRgb, rgbToHex } from '../utils/colorUtils';

// --- Reusable UI Components ---

const ExpandableInfoBox: React.FC<{ isOpen: boolean; children: React.ReactNode }> = ({ isOpen, children }) => (
  <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100 mb-2' : 'grid-rows-[0fr] opacity-0 mb-0'
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
        className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out shrink-0 ${toggleDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
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
  imageDimensions: { width: number, height: number } | null;
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
  // recolorMode: RecolorMode; // Removed
  // setRecolorMode: (v: RecolorMode) => void; // Removed
  tintOverrides: Record<string, TintSettings>;
  setTintOverrides: React.Dispatch<React.SetStateAction<Record<string, TintSettings>>>;
  setTintModalGroupId: (id: string | null) => void;
  supergroups: Supergroup[];
  setSupergroups: React.Dispatch<React.SetStateAction<Supergroup[]>>;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  upscaleFactor, setUpscaleFactor, denoiseRadius, setDenoiseRadius, smoothingLevels, setSmoothingLevels,
  vertexInertia, setVertexInertia, edgeProtection, setEdgeProtection, colorGroupingDistance, setColorGroupingDistance,
  alphaSmoothness, setAlphaSmoothness, hasTransparency, preserveTransparency, setPreserveTransparency,
  image, onImageUpload, imageDimensions,
  colorGroups, manualLayerIds, selectedInGroup, enabledGroups, setEnabledGroups, colorOverrides,
  onAddManualLayer, onRemoveManualLayer, onEditTarget, onMoveColor, onMergeGroups, onRecomputeGroups,
  setHoveredColor, hoveredGroupId, setHoveredGroupId, draggedItem, setDraggedItem, totalSamples,
  paletteLength,
  disableScaling, setDisableScaling, disablePostProcessing, setDisablePostProcessing,
  disableRecoloring, setDisableRecoloring, isSvg, mobileViewTarget, onMobileViewToggle,
  pixelArtConfig, setPixelArtConfig,
  /* recolorMode, setRecolorMode, */ tintOverrides, setTintOverrides, setTintModalGroupId,
  supergroups, setSupergroups
}) => {
  const [activeInfos, setActiveInfos] = useState<Set<string>>(new Set());
  const [mobilePopup, setMobilePopup] = useState<{ groupId: string, colorHex: string, percent: string } | null>(null);
  const [expandedSubcolors, setExpandedSubcolors] = useState<Set<string>>(new Set());
  const [subcolorLimit, setSubcolorLimit] = useState(16);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [pixelSizeMode, setPixelSizeMode] = useState<'size' | 'resolution'>('size');
  const panelRef = useRef<HTMLDivElement>(null);

  const maxPixelSize = imageDimensions 
    ? Math.max(32, Math.floor(Math.min(imageDimensions.width, imageDimensions.height) / 4)) 
    : 32;

  useEffect(() => {
    if (pixelArtConfig.enabled) {
      if (pixelArtConfig.pixelWidth > maxPixelSize || pixelArtConfig.pixelHeight > maxPixelSize) {
        setPixelArtConfig(prev => ({
          ...prev,
          pixelWidth: Math.min(prev.pixelWidth, maxPixelSize),
          pixelHeight: Math.min(prev.pixelHeight, maxPixelSize)
        }));
      }
    }
  }, [maxPixelSize, pixelArtConfig.enabled, pixelArtConfig.pixelWidth, pixelArtConfig.pixelHeight, setPixelArtConfig]);

  const createSupergroup = (groupIds: string[]) => {
    if (groupIds.length < 2) return;
    const newSupergroup: Supergroup = {
      id: `super-${Math.random().toString(36).substr(2, 9)}`,
      label: `Group ${supergroups.length + 1}`,
      memberGroupIds: groupIds,
      // tint: undefined // Start with no tint
    };
    setSupergroups(prev => [...prev, newSupergroup]);
  };

  const ungroupFromSupergroup = (groupId: string) => {
    setSupergroups(prev => {
      const next = prev.map(sg => ({
        ...sg,
        memberGroupIds: sg.memberGroupIds.filter(id => id !== groupId)
      })).filter(sg => sg.memberGroupIds.length >= 2); // Disband if < 2
      return next;
    });
  };

  const toggleGroupSelection = (id: string) => {
    setEnabledGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      // Account for padding (panel p-4=32px, group p-2=16px, subcolor pl-7=28px) -> ~76px
      const availableWidth = panelRef.current.clientWidth - 50;
      // Item width 12px + gap 2px = 14px
      const itemsPerRow = Math.floor(availableWidth / 14);
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
  }, [mobilePopup]);

  const addToSupergroup = (supergroupId: string, groupId: string) => {
    setSupergroups(prev => prev.map(sg => {
      if (sg.id === supergroupId && !sg.memberGroupIds.includes(groupId)) {
        return { ...sg, memberGroupIds: [...sg.memberGroupIds, groupId] };
      }
      return sg;
    }));
  };

  const renderGroupItem = (group: any, isSupergroupMember = false) => {
    const isSelected = enabledGroups.has(group.id);
    const isHovered = hoveredGroupId === group.id;
    const isManual = group.isManual;
    const mainColor = isManual ? '#ffffff' : (group.representativeHex || '#000000');
    const overrideColor = colorOverrides[group.id];
    const displayColor = overrideColor || mainColor;
    const isDragOver = dragOverGroupId === group.id;
    const isBeingDragged = draggedItem?.type === 'group' && draggedItem.groupId === group.id;
    
    return (
      <div
        key={group.id}
        className={`
          group relative flex flex-col gap-1 p-2 rounded-lg border transition-all duration-200
          ${isSelected 
            ? 'bg-blue-50/50 border-blue-200 shadow-sm' 
            : isHovered
              ? 'bg-white border-gray-300 shadow-sm'
              : 'bg-gray-50/50 border-gray-200 hover:border-gray-300'
          }
          ${isSupergroupMember ? 'ml-0' : ''}
          ${isBeingDragged ? 'opacity-50' : ''}
        `}
        onMouseEnter={() => setHoveredGroupId(group.id)}
        onMouseLeave={() => setHoveredGroupId(null)}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', group.id);
          e.dataTransfer.effectAllowed = 'move';
          setDraggedItem({ type: 'group', groupId: group.id });
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (draggedItem?.type === 'group' && draggedItem.groupId !== group.id) {
            setDragOverGroupId(group.id);
          }
        }}
        onDragLeave={() => setDragOverGroupId(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverGroupId(null);
          // Drop logic is handled by the specific drop zones below
        }}
      >
        {/* Drag Overlay for Merge/Group */}
        {isDragOver && draggedItem?.type === 'group' && draggedItem.groupId !== group.id && (
          <div className="absolute inset-0 z-20 flex flex-col rounded-lg overflow-hidden bg-white/90 backdrop-blur-sm border-2 border-blue-400 shadow-lg">
            <div 
              className="flex-1 flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer border-b border-blue-200"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (draggedItem.type === 'group') {
                  onMergeGroups(draggedItem.groupId, group.id);
                  setDraggedItem(null);
                  setDragOverGroupId(null);
                }
              }}
            >
              <i className="fa-solid fa-object-group text-blue-600"></i>
              <span className="text-[10px] font-bold uppercase text-blue-700">Merge</span>
            </div>
            {!isSupergroupMember && (
              <div 
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 transition-colors cursor-pointer"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggedItem.type === 'group') {
                    createSupergroup([draggedItem.groupId, group.id]);
                    setDraggedItem(null);
                    setDragOverGroupId(null);
                  }
                }}
              >
                <i className="fa-solid fa-layer-group text-indigo-600"></i>
                <span className="text-[10px] font-bold uppercase text-indigo-700">Group</span>
              </div>
            )}
          </div>
        )}

        {/* Group Header */}
        <div className="flex items-center gap-2 mb-1">
          {/* Selection Checkbox */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleGroupSelection(group.id);
            }}
            className={`
              w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0
              ${isSelected 
                ? 'bg-blue-500 border-blue-500 text-white' 
                : 'bg-white border-gray-300 hover:border-blue-400 text-transparent'
              }
            `}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </button>

          {/* Canonical Color Bar */}
          <button 
            onClick={() => onEditTarget(group.id, 'original')}
            className={`
              flex-1 h-8 rounded-md shadow-sm border border-black/5 relative overflow-hidden group/bar
              transition-transform active:scale-[0.99]
              ${isManual ? 'bg-transparent border-dashed border-gray-400' : ''}
            `}
            style={!isManual || (isManual && selectedInGroup[group.id]) ? { backgroundColor: isManual ? selectedInGroup[group.id] : mainColor } : undefined}
            title="Set Canonical Color (Source)"
          >
              <div className="absolute inset-0 flex items-center justify-between px-2">
                <span className="font-mono text-[10px] font-bold text-white/90 drop-shadow-md uppercase">
                  {isManual ? 'Manual' : mainColor}
                </span>
                
                {!isManual && totalSamples > 0 && (
                  <span className="bg-black/20 backdrop-blur-[1px] text-white text-[9px] font-medium px-1.5 py-0.5 rounded-full">
                    {((group.totalCount / totalSamples) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
          </button>

          {/* Arrow */}
          <i className="fa-solid fa-chevron-right text-slate-300 text-[10px]"></i>

          {/* Recolor Button (Target) */}
          <button
            onClick={() => onEditTarget(group.id, 'recolor')}
            className={`
              w-8 h-8 rounded-md flex items-center justify-center transition-all active:scale-95 shadow-sm border border-black/5
              ${overrideColor ? 'ring-2 ring-offset-1 ring-blue-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-600'}
            `}
            style={overrideColor ? { backgroundColor: overrideColor } : undefined}
            title={overrideColor ? `Override: ${overrideColor}\nClick to change` : "Set Recolor Override"}
          >
            {!overrideColor && <i className="fa-solid fa-eye-dropper text-xs"></i>}
            {overrideColor && (
                <span className="font-mono text-[9px] font-bold text-white/90 drop-shadow-md uppercase">
                  {overrideColor.replace('#', '')}
                </span>
            )}
          </button>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {isSupergroupMember && (
              <button
                onClick={() => ungroupFromSupergroup(group.id)}
                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Remove from Supergroup"
              >
                <i className="fa-solid fa-arrow-right-from-bracket text-[10px]"></i>
              </button>
            )}
            {isManual && (
              <button
                onClick={() => onRemoveManualLayer(group.id)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Delete Manual Group"
              >
                <i className="fa-solid fa-trash text-[10px]"></i>
              </button>
            )}
          </div>
        </div>

        {/* Color Swatches */}
        {!isManual && group.members && group.members.length > 0 && (
          <div className="pl-7">
            <div className="flex flex-wrap gap-0.5">
              {group.members.slice(0, expandedSubcolors.has(group.id) ? undefined : subcolorLimit).map((member: any) => (
                <div
                  key={member.hex}
                  className="w-3 h-3 rounded-full border border-black/5 shadow-sm cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
                  style={{ backgroundColor: member.hex }}
                  title={`${member.hex} (${member.count} pixels)\nDrag to ungroup`}
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', member.hex);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedItem({ type: 'color', colorHex: member.hex, groupId: group.id });
                    e.stopPropagation();
                  }}
                />
              ))}
            </div>
            {group.members.length > subcolorLimit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSubcolorExpansion(group.id);
                }}
                className="text-[9px] font-bold text-slate-400 hover:text-slate-600 mt-1 flex items-center gap-1"
              >
                {expandedSubcolors.has(group.id) ? (
                  <><i className="fa-solid fa-chevron-up"></i> Show Less</>
                ) : (
                  <><i className="fa-solid fa-chevron-down"></i> See All ({group.members.length - 14} more)</>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

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
            <><div className="flex items-center gap-2 text-blue-600 font-bold mb-1"><i className="fa-solid fa-cube"></i><span>Pixel Art Mode Active</span></div> Scale value is used as maximum dimension. The largest integer scale that fits will be applied.</>) : (
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
                label="Grid Settings"
                value1={pixelSizeMode === 'resolution' && imageDimensions 
                  ? Math.round(imageDimensions.width / pixelArtConfig.pixelWidth) 
                  : pixelArtConfig.pixelWidth}
                value2={pixelSizeMode === 'resolution' && imageDimensions 
                  ? Math.round(imageDimensions.height / pixelArtConfig.pixelHeight) 
                  : pixelArtConfig.pixelHeight}
                min1={1}
                max1={pixelSizeMode === 'resolution' && imageDimensions ? imageDimensions.width : maxPixelSize}
                min2={1}
                max2={pixelSizeMode === 'resolution' && imageDimensions ? imageDimensions.height : maxPixelSize}
                locked={pixelArtConfig.lockAspect}
                headerRight={
                  <div className="flex bg-slate-200 rounded p-0.5 gap-0.5">
                    <button
                      onClick={() => {
                        setPixelSizeMode('size');
                        setPixelArtConfig(prev => ({
                          ...prev,
                          pixelWidth: Math.max(1, Math.round(prev.pixelWidth)),
                          pixelHeight: Math.max(1, Math.round(prev.pixelHeight))
                        }));
                      }}
                      className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors ${
                        pixelSizeMode === 'size' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-600'
                      }`}
                      title="Step by Pixel Size"
                    >
                      PX
                    </button>
                    <button
                      onClick={() => {
                        setPixelSizeMode('resolution');
                        if (imageDimensions) {
                          setPixelArtConfig(prev => {
                            const resW = Math.round(imageDimensions.width / prev.pixelWidth);
                            const resH = Math.round(imageDimensions.height / prev.pixelHeight);
                            const newW = imageDimensions.width / Math.max(1, resW);
                            const newH = imageDimensions.height / Math.max(1, resH);
                            return {
                              ...prev,
                              pixelWidth: newW,
                              pixelHeight: newH
                            };
                          });
                        }
                      }}
                      className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors ${
                        pixelSizeMode === 'resolution' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-600'
                      }`}
                      title="Step by Resolution"
                    >
                      RES
                    </button>
                  </div>
                }
                onValue1Change={(val) => {
                  if (pixelSizeMode === 'resolution' && imageDimensions) {
                    // val is target resolution
                    const targetRes = Math.max(1, val);
                    const newPixelWidth = imageDimensions.width / targetRes;
                    setPixelArtConfig(prev => {
                      const newPixelHeight = prev.lockAspect ? newPixelWidth : prev.pixelHeight;
                      const maxOffsetX = Math.max(0, newPixelWidth - 1);
                      const maxOffsetY = Math.max(0, newPixelHeight - 1);
                      return {
                        ...prev,
                        pixelWidth: newPixelWidth,
                        pixelHeight: newPixelHeight,
                        offsetX: Math.min(prev.offsetX, maxOffsetX),
                        offsetY: Math.min(prev.offsetY, maxOffsetY),
                      };
                    });
                  } else {
                    setPixelArtConfig(prev => {
                      const newPixelWidth = val;
                      const newPixelHeight = prev.lockAspect ? val : prev.pixelHeight;
                      const maxOffsetX = Math.max(0, newPixelWidth - 1);
                      const maxOffsetY = Math.max(0, newPixelHeight - 1);
                      return {
                        ...prev,
                        pixelWidth: newPixelWidth,
                        pixelHeight: newPixelHeight,
                        offsetX: Math.min(prev.offsetX, maxOffsetX),
                        offsetY: Math.min(prev.offsetY, maxOffsetY),
                      };
                    });
                  }
                }}
                onValue2Change={(val) => {
                  if (pixelSizeMode === 'resolution' && imageDimensions) {
                    // val is target resolution
                    const targetRes = Math.max(1, val);
                    const newPixelHeight = imageDimensions.height / targetRes;
                    setPixelArtConfig(prev => {
                      const newPixelWidth = prev.lockAspect ? newPixelHeight : prev.pixelWidth;
                      const maxOffsetX = Math.max(0, newPixelWidth - 1);
                      const maxOffsetY = Math.max(0, newPixelHeight - 1);
                      return {
                        ...prev,
                        pixelHeight: newPixelHeight,
                        pixelWidth: newPixelWidth,
                        offsetX: Math.min(prev.offsetX, maxOffsetX),
                        offsetY: Math.min(prev.offsetY, maxOffsetY),
                      };
                    });
                  } else {
                    setPixelArtConfig(prev => {
                      const newPixelHeight = val;
                      const newPixelWidth = prev.lockAspect ? val : prev.pixelWidth;
                      const maxOffsetX = Math.max(0, newPixelWidth - 1);
                      const maxOffsetY = Math.max(0, newPixelHeight - 1);
                      return {
                        ...prev,
                        pixelHeight: newPixelHeight,
                        pixelWidth: newPixelWidth,
                        offsetX: Math.min(prev.offsetX, maxOffsetX),
                        offsetY: Math.min(prev.offsetY, maxOffsetY),
                      };
                    });
                  }
                }}
                onIncrement1={pixelSizeMode === 'resolution' ? () => {
                  if (!imageDimensions) return;
                  const currentRes = Math.round(imageDimensions.width / pixelArtConfig.pixelWidth);
                  const targetRes = currentRes + 1;
                  const newVal = Math.max(1, imageDimensions.width / targetRes);
                  setPixelArtConfig(prev => {
                    const newPixelWidth = newVal;
                    const newPixelHeight = prev.lockAspect ? newVal : prev.pixelHeight;
                    const maxOffsetX = Math.max(0, newPixelWidth - 1);
                    const maxOffsetY = Math.max(0, newPixelHeight - 1);
                    return {
                      ...prev,
                      pixelWidth: newPixelWidth,
                      pixelHeight: newPixelHeight,
                      offsetX: Math.min(prev.offsetX, maxOffsetX),
                      offsetY: Math.min(prev.offsetY, maxOffsetY),
                    };
                  });
                } : undefined}
                onDecrement1={pixelSizeMode === 'resolution' ? () => {
                  if (!imageDimensions) return;
                  const currentRes = Math.round(imageDimensions.width / pixelArtConfig.pixelWidth);
                  const targetRes = Math.max(1, currentRes - 1);
                  const newVal = Math.max(1, imageDimensions.width / targetRes);
                  setPixelArtConfig(prev => {
                    const newPixelWidth = newVal;
                    const newPixelHeight = prev.lockAspect ? newVal : prev.pixelHeight;
                    const maxOffsetX = Math.max(0, newPixelWidth - 1);
                    const maxOffsetY = Math.max(0, newPixelHeight - 1);
                    return {
                      ...prev,
                      pixelWidth: newPixelWidth,
                      pixelHeight: newPixelHeight,
                      offsetX: Math.min(prev.offsetX, maxOffsetX),
                      offsetY: Math.min(prev.offsetY, maxOffsetY),
                    };
                  });
                } : undefined}
                onIncrement2={pixelSizeMode === 'resolution' ? () => {
                  if (!imageDimensions) return;
                  const currentRes = Math.round(imageDimensions.height / pixelArtConfig.pixelHeight);
                  const targetRes = currentRes + 1;
                  const newVal = Math.max(1, imageDimensions.height / targetRes);
                  setPixelArtConfig(prev => {
                    const newPixelHeight = newVal;
                    const newPixelWidth = prev.lockAspect ? newVal : prev.pixelWidth;
                    const maxOffsetX = Math.max(0, newPixelWidth - 1);
                    const maxOffsetY = Math.max(0, newPixelHeight - 1);
                    return {
                      ...prev,
                      pixelWidth: newPixelWidth,
                      pixelHeight: newPixelHeight,
                      offsetX: Math.min(prev.offsetX, maxOffsetX),
                      offsetY: Math.min(prev.offsetY, maxOffsetY),
                    };
                  });
                } : undefined}
                onDecrement2={pixelSizeMode === 'resolution' ? () => {
                  if (!imageDimensions) return;
                  const currentRes = Math.round(imageDimensions.height / pixelArtConfig.pixelHeight);
                  const targetRes = Math.max(1, currentRes - 1);
                  const newVal = Math.max(1, imageDimensions.height / targetRes);
                  setPixelArtConfig(prev => {
                    const newPixelHeight = newVal;
                    const newPixelWidth = prev.lockAspect ? newVal : prev.pixelWidth;
                    const maxOffsetX = Math.max(0, newPixelWidth - 1);
                    const maxOffsetY = Math.max(0, newPixelHeight - 1);
                    return {
                      ...prev,
                      pixelWidth: newPixelWidth,
                      pixelHeight: newPixelHeight,
                      offsetX: Math.min(prev.offsetX, maxOffsetX),
                      offsetY: Math.min(prev.offsetY, maxOffsetY),
                    };
                  });
                } : undefined}

                onLockToggle={() => setPixelArtConfig(prev => {
                  const newLockAspect = !prev.lockAspect;
                  const newPixelWidth = prev.pixelWidth;
                  const newPixelHeight = newLockAspect ? prev.pixelWidth : prev.pixelHeight;
                  const maxOffsetX = Math.max(0, newPixelWidth - 1);
                  const maxOffsetY = Math.max(0, newPixelHeight - 1);
                  return {
                    ...prev,
                    lockAspect: newLockAspect,
                    pixelHeight: newPixelHeight,
                    offsetX: Math.min(prev.offsetX, maxOffsetX),
                    offsetY: Math.min(prev.offsetY, maxOffsetY),
                  };
                })}
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
                    onLockToggle={() => setPixelArtConfig(prev => {
                      const newLockOffset = !prev.lockOffset;
                      return {
                        ...prev,
                        lockOffset: newLockOffset,
                        offsetY: newLockOffset ? prev.offsetX : prev.offsetY,
                      };
                    })}
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
          <p className="text-[10px] text-slate-500 leading-tight">
            Drag groups onto each other to merge or create supergroups. Drag colors between groups to reorganize.
          </p>
        </div>
      </div>

      {/* 7. Color Groups List */}
      <div 
        className={`flex flex-col gap-1 pr-1 transition-opacity duration-300 ${disableRecoloring ? 'opacity-40 pointer-events-none grayscale' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (draggedItem?.type === 'group') {
            ungroupFromSupergroup(draggedItem.groupId);
            setDraggedItem(null);
          }
        }}
      >
        {!image && <p className="text-[10px] italic text-slate-400 text-center py-4 uppercase tracking-widest border border-dashed border-slate-200 rounded-xl">Import to extract colors</p>}
        {/* Supergroups */}
        {supergroups.map(sg => {
          const tintPreviewHex = sg.tint ? (() => {
            const s = Math.max(0, Math.min(100, 70 + (sg.tint.saturation || 0) * 0.3));
            const l = Math.max(0, Math.min(100, 50 + (sg.tint.lightness || 0) * 0.5));
            const rgb = hslToRgb(sg.tint.hue, s, l);
            return rgbToHex(rgb.r, rgb.g, rgb.b);
          })() : null;

          return (
            <div key={sg.id} className="border rounded-xl p-1 bg-slate-50/50 mb-1 border-slate-200">
              <div className="flex items-center gap-2 mb-1 px-1">
                <div className="flex-1 text-[10px] font-bold uppercase text-slate-400 tracking-widest">Supergroup</div>
                <button
                  onClick={() => setTintModalGroupId(sg.id)}
                  className={`w-6 h-6 rounded-lg border shrink-0 transition-all flex items-center justify-center active:scale-[0.98] shadow-sm ${tintPreviewHex ? 'border-[#333]/20' : 'bg-slate-100 border-slate-200'}`}
                  style={{ backgroundColor: tintPreviewHex || 'transparent' }}
                  title={tintPreviewHex ? `Supergroup Tint: ${sg.tint!.hue}°` : "Set Supergroup Tint"}
                >
                  <i className={`fa-solid fa-droplet text-[9px] ${tintPreviewHex ? 'text-white drop-shadow-md' : 'text-slate-300'}`}></i>
                </button>
              </div>
              <div className="pl-2 border-l-2 border-slate-200 flex flex-col gap-1">
                {sg.memberGroupIds.map(gid => {
                  const group = colorGroups.find(g => g.id === gid);
                  if (!group) return null;
                  return renderGroupItem(group, true);
                })}
                {/* Drop Zone for Adding to Supergroup */}
                <div 
                  className={`
                    h-8 rounded-lg border-2 border-dashed border-indigo-200 bg-indigo-50/50 
                    flex items-center justify-center gap-2 text-indigo-400 font-bold text-[10px] uppercase tracking-wide
                    transition-all
                    ${draggedItem?.type === 'group' && !sg.memberGroupIds.includes(draggedItem.groupId) ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden py-0 border-0'}
                  `}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation(); // Stop propagation to prevent parent drop zones from firing
                    if (draggedItem?.type === 'group') {
                      addToSupergroup(sg.id, draggedItem.groupId);
                      setDraggedItem(null);
                    }
                  }}
                >
                  <i className="fa-solid fa-plus"></i> Add Group
                </div>
              </div>
            </div>
          );
        })}

        {/* Standalone Groups */}
        {[...colorGroups, ...manualLayerIds.map(id => ({ id, isManual: true }))].filter(item => !supergroups.some(sg => sg.memberGroupIds.includes((item as any).id))).map(item => renderGroupItem(item))}
        {draggedItem && draggedItem.type === 'color' && (
          <div className="p-3 rounded-xl border-2 border-dashed border-[#33569a] bg-[#33569a]/5 flex items-center justify-center gap-2 text-[#33569a] font-bold text-[10px] uppercase tracking-wide transition-all hover:bg-[#33569a]/10" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={(e) => { e.preventDefault(); if (!draggedItem) return; if (draggedItem.type === 'color' && draggedItem.colorHex) { onMoveColor(draggedItem.colorHex, draggedItem.groupId, 'new'); } setDraggedItem(null); }}>
            <i className="fa-solid fa-plus-circle"></i><span>Drop here to create new group</span>
          </div>
        )}
      </div>
    </div>
  );
};