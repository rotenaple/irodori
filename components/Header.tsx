import React from 'react';

interface HeaderProps {
  webgpuAvailable: boolean | null;
  usingWebGPU: boolean;
}

export const Header: React.FC<HeaderProps> = ({ webgpuAvailable, usingWebGPU }) => {
  const getStatusBadge = () => {
    if (webgpuAvailable === null) {
      return null; // Not yet determined
    }
    
    if (!webgpuAvailable) {
      return (
        <span className="px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase bg-orange-100 text-orange-700 rounded">
          CPU Fallback
        </span>
      );
    }
    
    if (usingWebGPU) {
      return (
        <span className="px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase bg-green-100 text-green-700 rounded flex items-center gap-1">
          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          WebGPU Active
        </span>
      );
    }
    
    return (
      <span className="px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase bg-blue-100 text-blue-700 rounded">
        WebGPU Available
      </span>
    );
  };

  return (
    <header className="bg-[#EBEBEB] h-12 flex-none border-b border-[#333]/10 z-50">
      <nav className="w-full max-w-[1600px] mx-auto h-full px-6 md:px-16">
        <div className="flex items-center justify-between h-full">
          <div className="flex flex-col justify-center gap-0.5">
            <h1 className="text-[#333] text-xl font-black tracking-tighter leading-none uppercase">
              Irodori
            </h1>
            <h2 className="text-[#666] text-[16px] font-medium tracking-widest leading-none uppercase" style={{ fontFamily: "'Kiwi Maru', serif" }}>
              いろどり
            </h2>
          </div>
          <div className="flex items-center">
            {getStatusBadge()}
          </div>
        </div>
      </nav>
    </header>
  );
};