
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
    <div className="bg-white border-4 border-[#333] rounded-[3rem] p-8 shadow-[0_40px_80px_rgba(0,0,0,0.3)] w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-8">
        <h3>{title}</h3>
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#EBEBEB] text-[#333] flex items-center justify-center hover:bg-[#333] hover:text-[#EBEBEB] transition-colors">
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-4 space-y-8">
        {mode === 'spectrum' ? (
          <>
            <canvas 
              ref={canvasRef} width={800} height={100} 
              className="w-full h-24 rounded-2xl border border-[#333] cursor-crosshair"
              onMouseDown={handleInteract}
              onMouseMove={(e) => e.buttons === 1 && handleInteract(e)}
              onTouchMove={handleInteract}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-[#EBEBEB] p-8 rounded-3xl">
              <div className="flex flex-col items-center gap-4">
                <div className="w-full h-32 rounded-2xl border-2 border-[#333] shadow-md" style={{ backgroundColor: currentHex }} />
                <input 
                  type="text" value={currentHex.toUpperCase()} 
                  onChange={(e) => onChange(e.target.value)}
                  className="bg-transparent text-2xl font-mono font-bold text-[#333] outline-none w-full text-center"
                />
              </div>
              <div className="space-y-4">
                {(['r', 'g', 'b'] as const).map(c => (
                  <div key={c} className="flex items-center gap-4">
                    <span className="w-4 text-xs font-bold uppercase">{c}</span>
                    <input type="range" min="0" max="255" value={rgb[c]} onChange={(e) => updateRGB(c, e.target.value)} className="custom-slider" />
                    <input type="number" value={rgb[c]} onChange={(e) => updateRGB(c, e.target.value)} className="w-16 bg-white border border-[#333] rounded-lg p-1 text-center font-mono text-sm" />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <button onClick={() => setPaletteTab('classic')} className={`code-button !py-1 !px-4 text-xs ${paletteTab === 'classic' ? '' : '!bg-[#EBEBEB] !text-[#333]'}`}>Classic</button>
                <button onClick={() => setPaletteTab('bright')} className={`code-button !py-1 !px-4 text-xs ${paletteTab === 'bright' ? '' : '!bg-[#EBEBEB] !text-[#333]'}`}>Bright</button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-3">
                {PALETTES[paletteTab].map(p => (
                  <button key={p.hex} onClick={() => onChange(p.hex)} className={`p-2 rounded-xl border-2 transition-all ${currentHex.toLowerCase() === p.hex.toLowerCase() ? 'border-[#333] bg-[#EBEBEB]' : 'border-transparent hover:border-[#333]/20'}`}>
                    <div className="w-full aspect-square rounded-lg mb-2 shadow-sm" style={{ backgroundColor: p.hex }} />
                    <div className="text-[10px] uppercase font-bold text-center truncate">{p.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-4">
            {processedSuggestions.map((s, idx) => (
              <button key={idx} onClick={() => onChange(s.hex)} className={`p-2 rounded-xl border-2 transition-all ${currentHex.toLowerCase() === s.hex.toLowerCase() ? 'border-[#333] bg-[#EBEBEB]' : 'border-transparent hover:border-[#333]/20'}`}>
                <div className="w-full aspect-square rounded-lg mb-2 shadow-sm" style={{ backgroundColor: s.hex }} />
                <div className="text-[10px] font-mono text-center">{s.hex.toUpperCase()}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <button onClick={onClose} className="code-button w-full mt-8 text-lg">Apply</button>
    </div>
  );
};
