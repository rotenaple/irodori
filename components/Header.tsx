import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="fixed top-0 left-0 w-full bg-[#EBEBEB] h-16 z-[100] border-b border-[#333]/10">
      <nav className="w-full max-w-[1600px] mx-auto h-full px-4 md:px-6">
        <div className="flex items-center h-full px-6">
          <h1 className="text-[#333] text-xl font-black tracking-tight leading-none uppercase">
            Irodori
          </h1>
        </div>
      </nav>
    </header>
  );
};