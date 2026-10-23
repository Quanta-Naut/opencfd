import React from 'react';

/** A single key cap, e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>. Flat, bordered, mono - the
 * engineering-doc convention (matches the tutorial page's key caps). */
export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[19px] h-[19px] px-1 rounded-sm border border-line-strong bg-app text-[10px] font-mono font-medium text-fg leading-none">
    {children}
  </kbd>
);
