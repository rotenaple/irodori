
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { rgbToHex, hexToRgb, HTML_COLORS } from '../utils/colorUtils';
import { PALETTES } from '../constants/palettes';

interface ColorPickerModalProps {
  currentHex: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  title: string;
  mode: 'spectrum' | 'sampled';
  suggestions?: string[];
}

export const ColorPickerModal: React.FC<ColorPickerModalProps> = ({ currentHex, onChange, onClose, title, mode, suggestions = [] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paletteTab, setPaletteTab] = useState<'classic' | 'bright'>('classic');

  useEffect(() => {
    if (mode !== 'spectrum') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    for (let x = 0; x < width; x++) {
      const hue = (x / width) * 360;
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, `hsl(${hue}, 100%, 85%)`);
      grad.addColorStop(0.5, `hsl(${hue}, 100%, 50%)`);
      grad.addColorStop(1, `hsl(${hue}, 100%, 15%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, 1, height);
    }
  }, [mode]);

  const handleInteract = (e: React.MouseEvent | React.TouchEvent) => {
    if (mode !== 'spectrum') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = Math.max(0, Math.min(canvas.width - 1, ((clientX - rect.left) / rect.width) * canvas.width));
    const y = Math.max(0, Math.min(canvas.height - 1, ((clientY - rect.top) / rect.height) * canvas.height));

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    onChange(rgbToHex(pixel[0], pixel[1], pixel[2]));
  };

  const rgb = hexToRgb(currentHex) || { r: 0, g: 0, b: 0 };

  const updateRGB = (channel: 'r' | 'g' | 'b', value: string) => {
    let num = parseInt(value);
    if (isNaN(num)) num = 0;
    const next = { ...rgb, [channel]: Math.max(0, Math.min(255, num)) };
    onChange(rgbToHex(next.r, next.g, next.b));
  };

  const processedSuggestions = useMemo(() => {
    if (mode !== 'sampled') return [];
    const uniqueHexes = Array.from(new Set(suggestions.map(s => s.toLowerCase())));
    return uniqueHexes.map(hex => ({
      hex,
      name: HTML_COLORS[hex] || null
    })).slice(0, 30);
  }, [mode, suggestions]);

  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md md:max-w-2xl lg:max-w-3xl flex flex-col overflow-hidden max-h-[90vh]" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">{title}</h3>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center hover:bg-slate-100 hover:text-slate-600 transition-colors">
          <i className="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
        {mode === 'spectrum' ? (
          <div className="space-y-6">
            <canvas
              ref={canvasRef} width={400} height={60}
              className="w-full h-20 rounded-xl border border-slate-200 cursor-crosshair shadow-sm"
              onMouseDown={handleInteract}
              onMouseMove={(e) => e.buttons === 1 && handleInteract(e)}
              onTouchMove={handleInteract}
            />

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg border border-slate-200 shadow-sm shrink-0" style={{ backgroundColor: currentHex }} />
                <div className="flex-1">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Hex Color</span>
                  <input
                    type="text" value={currentHex.toUpperCase()}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 font-mono text-sm text-slate-700 outline-none focus:border-[#33569a] transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-1">
                {(['r', 'g', 'b'] as const).map(c => (
                  <div key={c} className="flex items-center gap-3">
                    <span className="w-3 text-[10px] font-bold uppercase text-slate-400">{c}</span>
                    <div className="flex-1 h-6 flex items-center">
                      <input type="range" min="0" max="255" value={rgb[c]} onChange={(e) => updateRGB(c, e.target.value)} className="custom-slider" />
                    </div>
                    <input type="number" value={rgb[c]} onChange={(e) => updateRGB(c, e.target.value)} className="w-12 bg-white border border-slate-200 rounded-md py-0.5 text-center font-mono text-xs text-slate-600" />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex gap-1 bg-slate-100 p-1 rounded-lg inline-flex">
                <button onClick={() => setPaletteTab('classic')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${paletteTab === 'classic' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Classic</button>
                <button onClick={() => setPaletteTab('bright')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${paletteTab === 'bright' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Bright</button>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2 items-start">
                {PALETTES[paletteTab].map(p => (
                  <button key={p.hex} onClick={() => onChange(p.hex)} className={`group p-1.5 rounded-lg border transition-all h-full flex flex-col ${currentHex.toLowerCase() === p.hex.toLowerCase() ? 'border-slate-400 bg-slate-50 shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`} title={p.name}>
                    <div className="w-full aspect-square rounded-md shadow-sm border border-black/5 mb-1.5 shrink-0" style={{ backgroundColor: p.hex }} />
                    <div className="text-[9px] font-bold text-slate-500 text-center leading-3 uppercase w-full break-words">{p.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 italic">Select a color from the image palette.</p>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-8 gap-3">
              {processedSuggestions.map((s, idx) => (
                <button key={idx} onClick={() => onChange(s.hex)} className={`group p-1.5 rounded-xl border transition-all ${currentHex.toLowerCase() === s.hex.toLowerCase() ? 'border-[#333]/20 bg-slate-50 shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`} title={s.name || s.hex}>
                  <div className="w-full aspect-square rounded-lg mb-1 shadow-sm border border-black/5" style={{ backgroundColor: s.hex }} />
                  <div className="text-[9px] font-mono text-center text-slate-500 group-hover:text-slate-700 truncate">{s.name || s.hex.toUpperCase()}</div>
                </button>
              ))}
            </div>
            {processedSuggestions.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-xs border-2 border-dashed border-slate-100 rounded-xl">
                No matching colors found in source
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-5 border-t border-slate-100 bg-slate-50/50">
        <button onClick={onClose} className="w-full bg-[#333] text-white rounded-xl py-3 font-bold uppercase tracking-widest text-[11px] shadow-lg active:scale-[0.98] transition-all hover:bg-black flex items-center justify-center gap-2">
          <i className="fa-solid fa-check"></i> Apply Color
        </button>
      </div>
    </div>
  );
};
