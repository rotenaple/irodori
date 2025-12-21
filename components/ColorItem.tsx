
import React from 'react';
import { PaletteColor } from '../types';

interface ColorItemProps {
  color: PaletteColor;
  onRemove: (id: string) => void;
}

export const ColorItem: React.FC<ColorItemProps> = ({ color, onRemove }) => {
  return (
    <div className="flex items-center gap-2 bg-slate-800 p-2 rounded-lg border border-slate-700 group">
      <div 
        className="w-8 h-8 rounded border border-white/20" 
        style={{ backgroundColor: color.hex }}
      />
      <span className="text-xs font-mono uppercase text-slate-300">{color.hex}</span>
      <button 
        onClick={() => onRemove(color.id)}
        className="ml-auto p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <i className="fa-solid fa-xmark"></i>
      </button>
    </div>
  );
};
