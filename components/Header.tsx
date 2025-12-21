import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="fixed top-0 left-0 w-full bg-[#EBEBEB] h-16 z-[100] border-b border-[#333]/10">
      <nav className="w-full max-w-[1600px] mx-auto h-full px-4 md:px-8">
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