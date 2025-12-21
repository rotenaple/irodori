import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="bg-[#EBEBEB] h-12 flex-none border-b border-[#333]/10 z-50">
      <nav className="w-full max-w-[1600px] mx-auto h-full px-6 md:px-16">
        {/* Changed items-start to ensure left alignment, gap-0.5 for row spacing */}
        <div className="flex flex-col justify-center h-full gap-0.5">
          <h1 className="text-[#333] text-xl font-black tracking-tighter leading-none uppercase">
            Irodori
          </h1>
          <h2 className="text-[#666] text-[12px] font-bold tracking-widest leading-none uppercase">
            いろどり
          </h2>
        </div>
      </nav>
    </header>
  );
};