import React, { useState } from 'react';
import { TintSettings, ColorInstance } from '../types';
import { hslToRgb, rgbToHex, applyTintToHex } from '../utils/colorUtils';

interface TintModalProps {
  groupId: string;
  baseHue: number;
  currentSettings: TintSettings | undefined;
  colorMembers: ColorInstance[];
  onChange: (settings: TintSettings | null) => void;
  onClose: () => void;
}

export const TintModal: React.FC<TintModalProps> = ({
  groupId, baseHue, currentSettings, colorMembers, onChange, onClose
}) => {
  // Initialize with current settings or defaults
  const [hue, setHue] = useState(currentSettings?.hue ?? Math.round(baseHue));
  const [saturation, setSaturation] = useState(currentSettings?.saturation ?? 0);
  const [lightness, setLightness] = useState(currentSettings?.lightness ?? 0);
  const [hueForce, setHueForce] = useState(currentSettings?.hueForce ?? 100);
  const [saturationForce, setSaturationForce] = useState(currentSettings?.saturationForce ?? 100);
  const [lightnessForce, setLightnessForce] = useState(currentSettings?.lightnessForce ?? 100);

  // Preview the tinted color
  const previewHsl = {
    h: hue,
    s: Math.max(0, Math.min(100, 70 + saturation * 0.3)),
    l: Math.max(0, Math.min(100, 50 + lightness * 0.5))
  };
  const previewRgb = hslToRgb(previewHsl.h, previewHsl.s, previewHsl.l);
  const previewHex = rgbToHex(previewRgb.r, previewRgb.g, previewRgb.b);

  // Original color preview
  const originalRgb = hslToRgb(baseHue, 70, 50);
  const originalHex = rgbToHex(originalRgb.r, originalRgb.g, originalRgb.b);

  // Function to apply tint to a color
  const applyTintToColor = (hex: string): string => {
    return applyTintToHex(hex, baseHue, {
      hue, saturation, lightness, hueForce, saturationForce, lightnessForce
    });
  };

  const handleApply = () => {
    onChange({ hue, saturation, lightness, hueForce, saturationForce, lightnessForce });
    onClose();
  };

  const handleReset = () => {
    onChange(null);
    onClose();
  };

  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md md:max-w-2xl flex flex-col overflow-hidden max-h-[90vh]" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Tint Settings</h3>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center hover:bg-slate-100 hover:text-slate-600 transition-colors">
          <i className="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 scrollbar-thin">
        <div className="space-y-4">
          {/* Compact Color Preview - Original | Tinted side by side */}
          <div className="grid grid-cols-2 gap-2">
            {/* Original Colors */}
            <div className="space-y-1">
              <div className="text-[9px] font-bold uppercase text-slate-400 text-center">Original</div>
              <div className="flex gap-0.5 h-12 rounded-lg overflow-hidden border border-slate-200 shadow-inner">
                {colorMembers && colorMembers.length > 0 ? (
                  colorMembers.slice(0, 12).map((color, idx) => (
                    <div
                      key={idx}
                      className="flex-1"
                      style={{ backgroundColor: color.hex }}
                      title={color.hex}
                    />
                  ))
                ) : (
                  <div className="flex-1" style={{ backgroundColor: originalHex }} />
                )}
              </div>
            </div>

            {/* Tinted Colors */}
            <div className="space-y-1">
              <div className="text-[9px] font-bold uppercase text-slate-400 text-center">Tinted</div>
              <div className="flex gap-0.5 h-12 rounded-lg overflow-hidden border border-slate-200 shadow-inner">
                {colorMembers && colorMembers.length > 0 ? (
                  colorMembers.slice(0, 12).map((color, idx) => (
                    <div
                      key={idx}
                      className="flex-1"
                      style={{ backgroundColor: applyTintToColor(color.hex) }}
                      title={applyTintToColor(color.hex)}
                    />
                  ))
                ) : (
                  <div className="flex-1" style={{ backgroundColor: previewHex }} />
                )}
              </div>
            </div>
          </div>

          {/* Unified Hue Picker - 1D rainbow */}
          <div className="space-y-2">

            <div className="text-[11px] font-bold uppercase text-slate-600 tracking-wide">Hue</div>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 w-12">Value</span>
                <div className="flex-1 h-5 flex items-center min-w-0">
                  <input
                    type="range" min="0" max="360" step="1" value={hue}
                    onChange={(e) => setHue(Math.max(0, Math.min(360, parseInt(e.target.value) || 0)))}
                    className="custom-slider"
                    style={{ background: 'linear-gradient(to right, hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%), hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%))' }}
                  />
                </div>
                <input
                  type="number" min="0" max="360" value={hue}
                  onChange={(e) => setHue(Math.max(0, Math.min(360, parseInt(e.target.value) || 0)))}
                  className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 w-12">Strength</span>
                <div className="flex-1 h-5 flex items-center min-w-0">
                  <input
                    type="range" min="0" max="100" step="1" value={hueForce}
                    onChange={(e) => setHueForce(parseInt(e.target.value))}
                    className="custom-slider"
                  />
                </div>
                <input
                  type="number" min="0" max="100" value={hueForce}
                  onChange={(e) => setHueForce(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                  className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>

          {/* Saturation */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase text-slate-600 tracking-wide">Saturation</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 w-12">Value</span>
                <div className="flex-1 h-5 flex items-center min-w-0">
                  <input
                    type="range" min="-100" max="100" step="1" value={saturation}
                    onChange={(e) => setSaturation(parseInt(e.target.value))}
                    className="custom-slider"
                  />
                </div>
                <input
                  type="number" min="-100" max="100" value={saturation}
                  onChange={(e) => setSaturation(Math.max(-100, Math.min(100, parseInt(e.target.value) || 0)))}
                  className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 w-12">Strength</span>
                <div className="flex-1 h-5 flex items-center min-w-0">
                  <input
                    type="range" min="0" max="100" step="1" value={saturationForce}
                    onChange={(e) => setSaturationForce(parseInt(e.target.value))}
                    className="custom-slider"
                  />
                </div>
                <input
                  type="number" min="0" max="100" value={saturationForce}
                  onChange={(e) => setSaturationForce(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                  className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>

          {/* Lightness */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase text-slate-600 tracking-wide">Lightness</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 w-12">Value</span>
                <div className="flex-1 h-5 flex items-center min-w-0">
                  <input
                    type="range" min="-100" max="100" step="1" value={lightness}
                    onChange={(e) => setLightness(parseInt(e.target.value))}
                    className="custom-slider"
                  />
                </div>
                <input
                  type="number" min="-100" max="100" value={lightness}
                  onChange={(e) => setLightness(Math.max(-100, Math.min(100, parseInt(e.target.value) || 0)))}
                  className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 w-12">Strength</span>
                <div className="flex-1 h-5 flex items-center min-w-0">
                  <input
                    type="range" min="0" max="100" step="1" value={lightnessForce}
                    onChange={(e) => setLightnessForce(parseInt(e.target.value))}
                    className="custom-slider"
                  />
                </div>
                <input
                  type="number" min="0" max="100" value={lightnessForce}
                  onChange={(e) => setLightnessForce(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                  className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex items-center gap-3">
        {currentSettings && (
          <button
            onClick={handleReset}
            className="h-11 px-4 bg-white text-red-500 border border-red-100 rounded-xl font-bold uppercase tracking-widest text-[9px] shadow-sm active:scale-[0.98] transition-all hover:bg-red-50 flex items-center justify-center gap-2 whitespace-nowrap"
            title="Remove tint from this group"
          >
            <i className="fa-solid fa-times"></i> Remove Tint
          </button>
        )}
        <button
          onClick={handleApply}
          className="flex-1 bg-[#333] text-white rounded-xl h-11 font-bold uppercase tracking-widest text-[11px] shadow-lg active:scale-[0.98] transition-all hover:bg-black flex items-center justify-center gap-2"
        >
          <i className="fa-solid fa-check"></i> Apply Tint
        </button>
      </div>
    </div >
  );
};
