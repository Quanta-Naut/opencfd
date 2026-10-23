import React from 'react';
import { Point2D } from '../../../types/cadWorkflow';
import type { DynamicDimPrompt } from '../workbenchCore';
import { onMouseDown } from '../workbenchInput/mouseDown';
import { onKeyDown } from '../workbenchInput/keyDown';

/** Live dimension input box next to the cursor (Onshape / Fusion 360 style). */
export function DimensionInput(p: DimensionInputProps) {
  const {
    displayOnly,
    dimPrompt,
    toScreen,
    containerRef,
    input1Ref,
    inputVal1,
    setManualDim,
    setInputVal1,
    setInputVal2,
    handleDimKeyDown,
    input2Ref,
    inputVal2,
  } = p;
  return (
    <>
      {/* ─── Dynamic Dimension Input Box (Onshape / Fusion 360 style) ─── */}
      {!displayOnly &&
        dimPrompt &&
        (() => {
          const screenPos = toScreen(dimPrompt.worldPos.x, dimPrompt.worldPos.y);
          const containerW = containerRef.current?.clientWidth || 800;
          const containerH = containerRef.current?.clientHeight || 600;
          const posX = Math.max(12, Math.min(containerW - 270, screenPos.x - 100));
          const posY = Math.max(12, Math.min(containerH - 60, screenPos.y - 48));

          return (
            <div
              className="absolute z-30 flex items-center gap-2 bg-surface text-fg px-2.5 py-1.5 rounded-sm border border-line text-xs font-mono select-none transition-all duration-75"
              style={{ left: `${posX}px`, top: `${posY}px` }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Field 1 */}
              <div className="flex items-center gap-1">
                <span className="text-accent font-bold text-[11px]">{dimPrompt.label1}:</span>
                <input
                  ref={input1Ref}
                  type="number"
                  step="any"
                  value={inputVal1}
                  onChange={(e) => {
                    if (dimPrompt.live) setManualDim(true);
                    setInputVal1(e.target.value);
                    if (dimPrompt.type === 'circle' && dimPrompt.label2 === 'Ø') {
                      const n = parseFloat(e.target.value);
                      if (!isNaN(n)) setInputVal2((n * 2).toFixed(4));
                    }
                  }}
                  onKeyDown={handleDimKeyDown}
                  className="w-20 px-1.5 py-0.5 bg-app hover:bg-surface focus:bg-surface border border-line focus:border-accent rounded text-right text-fg font-mono text-xs outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                />
              </div>

              {/* Field 2 */}
              {dimPrompt.label2 && (
                <div className="flex items-center gap-1">
                  <span className="text-accent font-bold text-[11px]">{dimPrompt.label2}:</span>
                  <input
                    ref={input2Ref}
                    type="number"
                    step="any"
                    value={inputVal2}
                    onChange={(e) => {
                      if (dimPrompt.live) setManualDim(true);
                      setInputVal2(e.target.value);
                      if (dimPrompt.type === 'circle' && dimPrompt.label2 === 'Ø') {
                        const n = parseFloat(e.target.value);
                        if (!isNaN(n)) setInputVal1((n / 2).toFixed(4));
                      }
                    }}
                    onKeyDown={handleDimKeyDown}
                    className="w-18 px-1.5 py-0.5 bg-app hover:bg-surface focus:bg-surface border border-line focus:border-accent rounded text-right text-fg font-mono text-xs outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                  />
                </div>
              )}

              {/* Hints */}
              <div className="flex items-center gap-1 pl-1.5 border-l border-line text-[10px] text-fg-2">
                <span className="px-1 py-0.5 bg-app border border-line rounded text-[10px] font-semibold">
                  Tab ⇥
                </span>
                <span className="px-1 py-0.5 bg-app border border-line rounded text-[10px] font-semibold">
                  ↵
                </span>
              </div>
            </div>
          );
        })()}
    </>
  );
}

export interface DimensionInputProps {
  displayOnly: boolean;
  dimPrompt: DynamicDimPrompt;
  toScreen: (wx: number, wy: number) => Point2D;
  containerRef: React.RefObject<HTMLDivElement>;
  input1Ref: React.RefObject<HTMLInputElement>;
  inputVal1: string;
  setManualDim: React.Dispatch<React.SetStateAction<boolean>>;
  setInputVal1: React.Dispatch<React.SetStateAction<string>>;
  setInputVal2: React.Dispatch<React.SetStateAction<string>>;
  handleDimKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  input2Ref: React.RefObject<HTMLInputElement>;
  inputVal2: string;
}
