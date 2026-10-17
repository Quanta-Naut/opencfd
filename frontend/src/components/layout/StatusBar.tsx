import React from 'react';

export const StatusBar: React.FC = () => {
  return (
    <footer className="h-6 bg-[#F5F6F8] border-t border-[#E1E4E8] px-3 flex items-center justify-end text-[11px] font-mono text-[#69717D] select-none shrink-0">
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
        <span className="text-[#171A1F] font-medium">Connected</span>
      </div>
    </footer>
  );
};
