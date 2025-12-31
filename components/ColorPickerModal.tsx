import React, { useState, useRef, useEffect, useMemo } from 'react';
import { rgbToHex, hexToRgb, rgbToHsl, hslToRgb, hslToHex, HTML_COLORS } from '../utils/colorUtils';
import { PALETTES } from '../constants/palettes';
import { ColorInstance } from '../types';

interface ColorPickerModalProps {
  currentHex: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  title: string;
  mode: 'spectrum' | 'sampled';
  suggestions?: (string | ColorInstance)[];
  showNoneOption?: boolean;
}

export const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  currentHex, onChange, onClose, title, mode, suggestions = [], showNoneOption = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paletteTab, setPaletteTab] = useState<'classic' | 'bright'>('classic');
  const [colorMode, setColorMode] = useState<'rgb' | 'hsl'>('rgb');
  const [rgbValues, setRgbValues] = useState({ r: 0, g: 0, b: 0 });
  const [hslValues, setHslValues] = useState({ h: 0, s: 0, l: 0 });

  // Initialize state from currentHex
  useEffect(() => {
    const rgb = hexToRgb(currentHex) || { r: 0, g: 0, b: 0 };
    setRgbValues(rgb);
    setHslValues(rgbToHsl(rgb.r, rgb.g, rgb.b));
  }, [currentHex]);

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
    const rgb = { r: pixel[0], g: pixel[1], b: pixel[2] };
    setRgbValues(rgb);
    setHslValues(rgbToHsl(rgb.r, rgb.g, rgb.b));
  };

  // Compute current hex for preview
  const computedHex = useMemo(() => {
    if (colorMode === 'rgb') {
      return rgbToHex(rgbValues.r, rgbValues.g, rgbValues.b);
    } else {
      return hslToHex(hslValues.h, hslValues.s, hslValues.l);
    }
  }, [colorMode, rgbValues, hslValues]);

  const updateRGB = (channel: 'r' | 'g' | 'b', value: string) => {
    let num = parseInt(value);
    if (isNaN(num)) num = 0;
    const next = { ...rgbValues, [channel]: Math.max(0, Math.min(255, num)) };
    setRgbValues(next);
    setHslValues(rgbToHsl(next.r, next.g, next.b));
  };

  const updateHSL = (channel: 'h' | 's' | 'l', value: string) => {
    let num = parseFloat(value);
    if (isNaN(num)) num = 0;
    let next: { h: number; s: number; l: number };
    if (channel === 'h') {
      next = { ...hslValues, h: Math.max(0, Math.min(359, num)) };
    } else if (channel === 's') {
      next = { ...hslValues, s: Math.max(0, Math.min(100, num)) };
    } else {
      next = { ...hslValues, l: Math.max(0, Math.min(100, num)) };
    }
    setHslValues(next);
    // Don't update RGB to prevent rounding issues - RGB will be computed when Apply is clicked
  };

  const processedSuggestions = useMemo(() => {
    if (mode !== 'sampled') return [];

    // Normalize suggestions to ColorInstance-like objects
    const normalized = suggestions.map(s => {
      if (typeof s === 'string') {
        return { hex: s.toLowerCase(), percentage: undefined, score: undefined };
      }
      return { hex: s.hex.toLowerCase(), percentage: s.percentage, score: s.score };
    });

    const seen = new Set<string>();
    const unique = normalized.filter(s => {
      if (seen.has(s.hex)) return false;
      seen.add(s.hex);
      return true;
    });

    return unique.map(s => ({
      ...s,
      name: HTML_COLORS[s.hex] || null
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

      <div className="flex-1 min-h-0 flex flex-col relative bg-white">
        {mode === 'spectrum' ? (
          <>
            <div className="px-5 pt-5 pb-3 shrink-0 relative z-10 shadow-[0_4px_20px_-12px_rgba(0,0,0,0.05)]">
              <div className="flex flex-col lg:flex-row gap-4 mb-4">
                <div className="lg:w-1/2 relative">
                  <canvas
                    ref={canvasRef} width={400} height={60}
                    className="w-full h-20 lg:h-full rounded-xl border border-slate-200 cursor-crosshair shadow-sm block"
                    onMouseDown={handleInteract}
                    onMouseMove={(e) => e.buttons === 1 && handleInteract(e)}
                    onTouchMove={handleInteract}
                  />
                  <div
                    className="absolute w-6 h-6 rounded-full shadow-[0_0_4px_rgba(0,0,0,0.5)] pointer-events-none flex items-center justify-center"
                    style={{
                      left: `${(hslValues.h / 360) * 100}%`,
                      top: `${Math.max(0, Math.min(100, ((85 - hslValues.l) / 70) * 100))}%`,
                      transform: 'translate(-50%, -50%)',
                      background: `conic-gradient(#ffffff ${hslValues.s}%, rgba(255,255,255,0.3) 0)`
                    }}
                  >
                    <div
                      className="w-4 h-4 rounded-full border border-black/10 shadow-sm"
                      style={{ backgroundColor: computedHex }}
                    />
                  </div>
                </div>

                <div className="lg:w-1/2 bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg border border-slate-200 shadow-sm shrink-0" style={{ backgroundColor: computedHex }} />
                    <div className="flex-1 flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase text-slate-400 shrink-0">Hex</span>
                      <input
                        type="text" value={computedHex.toUpperCase()}
                        onChange={(e) => {
                          const hex = e.target.value;
                          const rgb = hexToRgb(hex);
                          if (rgb) {
                            setRgbValues(rgb);
                            setHslValues(rgbToHsl(rgb.r, rgb.g, rgb.b));
                          }
                        }}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 font-mono text-sm text-slate-700 outline-none focus:border-[#33569a] transition-colors"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-0.5">
                    <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-2">
                      <button onClick={() => setColorMode('rgb')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all flex-1 text-center ${colorMode === 'rgb' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>RGB</button>
                      <button onClick={() => setColorMode('hsl')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all flex-1 text-center ${colorMode === 'hsl' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>HSL</button>
                    </div>
                    {colorMode === 'rgb' ? (
                      <>
                        {(['r', 'g', 'b'] as const).map(c => (
                          <div key={c} className="flex items-center gap-2">
                            <span className="w-3 text-[10px] font-bold uppercase text-slate-400">{c}</span>
                            <div className="flex-1 h-5 flex items-center">
                              <input
                                type="range" min="0" max="255" value={rgbValues[c]} onChange={(e) => updateRGB(c, e.target.value)} className="custom-slider"
                                style={{
                                  background: c === 'r'
                                    ? `linear-gradient(90deg, rgb(0, ${rgbValues.g}, ${rgbValues.b}), rgb(255, ${rgbValues.g}, ${rgbValues.b}))`
                                    : c === 'g'
                                      ? `linear-gradient(90deg, rgb(${rgbValues.r}, 0, ${rgbValues.b}), rgb(${rgbValues.r}, 255, ${rgbValues.b}))`
                                      : `linear-gradient(90deg, rgb(${rgbValues.r}, ${rgbValues.g}, 0), rgb(${rgbValues.r}, ${rgbValues.g}, 255))`
                                }}
                              />
                            </div>
                            <input
                              type="number"
                              value={rgbValues[c]}
                              onChange={(e) => updateRGB(c, e.target.value)}
                              className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                        ))}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="w-3 text-[10px] font-bold uppercase text-slate-400">H</span>
                          <div className="flex-1 h-5 flex items-center">
                            <input
                              type="range" min="0" max="359" step="1" value={hslValues.h} onChange={(e) => updateHSL('h', e.target.value)} className="custom-slider"
                              style={{ background: `linear-gradient(to right, hsl(0, ${hslValues.s}%, ${hslValues.l}%), hsl(60, ${hslValues.s}%, ${hslValues.l}%), hsl(120, ${hslValues.s}%, ${hslValues.l}%), hsl(180, ${hslValues.s}%, ${hslValues.l}%), hsl(240, ${hslValues.s}%, ${hslValues.l}%), hsl(300, ${hslValues.s}%, ${hslValues.l}%), hsl(360, ${hslValues.s}%, ${hslValues.l}%))` }}
                            />
                          </div>
                          <input
                            type="number"
                            value={Math.round(hslValues.h)}
                            onChange={(e) => updateHSL('h', e.target.value)}
                            className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 text-[10px] font-bold uppercase text-slate-400">S</span>
                          <div className="flex-1 h-5 flex items-center">
                            <input
                              type="range" min="0" max="100" step="1" value={hslValues.s} onChange={(e) => updateHSL('s', e.target.value)} className="custom-slider"
                              style={{ background: `linear-gradient(to right, hsl(${hslValues.h}, 0%, ${hslValues.l}%), hsl(${hslValues.h}, 100%, ${hslValues.l}%))` }}
                            />
                          </div>
                          <input
                            type="number"
                            value={Math.round(hslValues.s)}
                            onChange={(e) => updateHSL('s', e.target.value)}
                            className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 text-[10px] font-bold uppercase text-slate-400">L</span>
                          <div className="flex-1 h-5 flex items-center">
                            <input
                              type="range" min="0" max="100" step="1" value={hslValues.l} onChange={(e) => updateHSL('l', e.target.value)} className="custom-slider"
                              style={{ background: `linear-gradient(to right, hsl(${hslValues.h}, ${hslValues.s}%, 0%), hsl(${hslValues.h}, ${hslValues.s}%, 50%), hsl(${hslValues.h}, ${hslValues.s}%, 100%))` }}
                            />
                          </div>
                          <input
                            type="number"
                            value={Math.round(hslValues.l)}
                            onChange={(e) => updateHSL('l', e.target.value)}
                            className="w-10 bg-white border border-slate-200 rounded-md py-0 text-center font-mono text-xs text-slate-600 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                <button onClick={() => setPaletteTab('classic')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all flex-1 text-center ${paletteTab === 'classic' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Classic</button>
                <button onClick={() => setPaletteTab('bright')} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all flex-1 text-center ${paletteTab === 'bright' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Bright</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5 scrollbar-thin">
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2 items-start mt-1">
                {PALETTES[paletteTab].map(p => (
                  <button key={p.hex} onClick={() => {
                    const rgb = hexToRgb(p.hex)!;
                    setRgbValues(rgb);
                    setHslValues(rgbToHsl(rgb.r, rgb.g, rgb.b));
                  }} className={`group p-1.5 rounded-lg border transition-all h-full flex flex-col ${computedHex.toLowerCase() === p.hex.toLowerCase() ? 'border-slate-400 bg-slate-50 shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`} title={p.name}>
                    <div className="w-full aspect-square rounded-md shadow-sm border border-black/5 mb-1.5 shrink-0" style={{ backgroundColor: p.hex }} />
                    <div className="text-[10px] font-bold text-slate-500 text-center leading-3 uppercase w-full break-words">{p.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
            <div className="space-y-4">
              <p className="text-xs text-slate-500 italic">Select a color from the image palette.</p>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-8 gap-3">
                {processedSuggestions.map((s, idx) => (
                  <button key={idx} onClick={() => {
                    const rgb = hexToRgb(s.hex)!;
                    setRgbValues(rgb);
                    setHslValues(rgbToHsl(rgb.r, rgb.g, rgb.b));
                  }} className={`group p-1.5 rounded-xl border transition-all ${computedHex.toLowerCase() === s.hex.toLowerCase() ? 'border-[#333]/20 bg-slate-50 shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`} title={s.name || s.hex}>
                    <div className="w-full aspect-square rounded-lg mb-1 shadow-sm border border-black/5 relative group" style={{ backgroundColor: s.hex }}>
                      {s.percentage !== undefined && (
                        <div className="absolute -top-1 -right-1 bg-white/90 backdrop-blur-sm border border-slate-200 px-1 rounded text-[9px] font-bold text-slate-600 shadow-sm opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                          {Math.round(s.percentage)}%
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-center text-slate-500 group-hover:text-slate-700 truncate leading-tight">
                      {s.name || s.hex.toUpperCase()}
                      {s.percentage !== undefined && (
                        <div className="text-[9px] font-bold text-slate-400 mt-0.5">{Math.round(s.percentage)}%</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {processedSuggestions.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-xs border-2 border-dashed border-slate-100 rounded-xl">
                  No matching colors found in source
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex items-center gap-3">
        {showNoneOption && (
          <button
            onClick={() => {
              onChange('');
              onClose();
            }}
            className="h-11 px-4 bg-white text-red-500 border border-red-100 rounded-xl font-bold uppercase tracking-widest text-[9px] shadow-sm active:scale-[0.98] transition-all hover:bg-red-50 flex items-center justify-center gap-2 whitespace-nowrap"
            title="Cancel Recolor (Use original color)"
          >
            Reset
          </button>
        )}
        <button onClick={() => {
          onChange(computedHex);
          onClose();
        }} className="flex-1 bg-[#333] text-white rounded-xl h-11 font-bold uppercase tracking-widest text-[11px] shadow-lg active:scale-[0.98] transition-all hover:bg-black flex items-center justify-center gap-2">
          <i className="fa-solid fa-check"></i> Apply Color
        </button>
      </div>
    </div>
  );
};
