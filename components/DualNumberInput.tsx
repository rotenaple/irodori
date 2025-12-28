import React from 'react';

interface DualNumberInputProps {
  label: string;
  value1: number;
  value2: number;
  min1: number;
  max1: number;
  min2: number;
  max2: number;
  locked: boolean;
  onValue1Change: (val: number) => void;
  onValue2Change: (val: number) => void;
  onLockToggle: () => void;
  infoKey: string;
  isInfoOpen: boolean;
  onInfoToggle: () => void;
  infoContent: React.ReactNode;
  separator?: string;
  lockTitle?: string;
  unlockTitle?: string;
}

export const DualNumberInput: React.FC<DualNumberInputProps> = ({
  label,
  value1,
  value2,
  min1,
  max1,
  min2,
  max2,
  locked,
  onValue1Change,
  onValue2Change,
  onLockToggle,
  infoKey,
  isInfoOpen,
  onInfoToggle,
  infoContent,
  separator = '×',
  lockTitle = 'Lock aspect ratio',
  unlockTitle = 'Unlock aspect ratio'
}) => {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center text-[10px] font-bold text-[#333] uppercase tracking-wide">
        <span>{label}</span>
        <button 
          onClick={onInfoToggle}
          className={`px-1 transition-colors ${isInfoOpen ? 'text-[#33569a]' : 'text-[#33569a]/70 hover:text-[#33569a]'}`}
          title="Information"
        >
          <i className="fa-solid fa-circle-info"></i>
        </button>
      </div>
      {infoContent}
      <div className="flex items-center gap-1">
        <div className="flex items-center bg-white border border-slate-300 rounded px-1.5 py-0.5 flex-1">
          <input 
            type="number" 
            min={min1}
            max={max1}
            value={value1}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const safeValue = Number.isNaN(parsed)
                ? min1
                : Math.max(min1, Math.min(max1, parsed));
              onValue1Change(safeValue);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
              }
            }}
            className="w-full text-[10px] font-mono text-center border-0 outline-none bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <div className="flex flex-col -my-1">
            <button 
              onClick={() => onValue1Change(Math.min(max1, value1 + 1))}
              className="text-[8px] text-slate-500 hover:text-slate-700 leading-none h-2"
            >
              ▲
            </button>
            <button 
              onClick={() => onValue1Change(Math.max(min1, value1 - 1))}
              className="text-[8px] text-slate-500 hover:text-slate-700 leading-none h-2"
            >
              ▼
            </button>
          </div>
        </div>
        <span className="text-slate-400 text-[10px]">{separator}</span>
        <div className={`flex items-center bg-white border border-slate-300 rounded px-1.5 py-0.5 flex-1 ${locked ? 'opacity-50' : ''}`}>
          <input 
            type="number" 
            min={min2}
            max={max2}
            value={value2}
            disabled={locked}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const safeValue = Number.isNaN(parsed)
                ? min2
                : Math.max(min2, Math.min(max2, parsed));
              onValue2Change(safeValue);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
              }
            }}
            className="w-full text-[10px] font-mono text-center border-0 outline-none bg-transparent disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <div className="flex flex-col -my-1">
            <button 
              disabled={locked}
              onClick={() => onValue2Change(Math.min(max2, value2 + 1))}
              className="text-[8px] text-slate-500 hover:text-slate-700 leading-none h-2 disabled:opacity-30"
            >
              ▲
            </button>
            <button 
              disabled={locked}
              onClick={() => onValue2Change(Math.max(min2, value2 - 1))}
              className="text-[8px] text-slate-500 hover:text-slate-700 leading-none h-2 disabled:opacity-30"
            >
              ▼
            </button>
          </div>
        </div>
        <button 
          onClick={onLockToggle}
          className={`w-6 h-6 rounded flex items-center justify-center transition-colors shrink-0 ${locked ? 'bg-[#33569a] text-white' : 'bg-slate-200 text-slate-400 hover:bg-slate-300'}`}
          title={locked ? unlockTitle : lockTitle}
        >
          <i className={`fa-solid ${locked ? 'fa-lock' : 'fa-unlock'} text-[10px]`}></i>
        </button>
      </div>
    </div>
  );
};
