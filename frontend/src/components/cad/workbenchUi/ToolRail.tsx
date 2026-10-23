import type { CadAction } from '../workbenchCore';
import React from 'react';
import {
  MousePointer2,
  Minus,
  Circle,
  CircleDot,
  Square,
  CornerUpRight,
  Maximize2,
  Trash2,
  Undo2,
  Redo2,
  Scissors,
  TriangleRight,
  ScanLine,
  Eraser,
  ArrowUpRight,
} from 'lucide-react';
import { IS_MAC, MOD_LABEL } from '../../../utils/platform';
import { Tooltip } from '../../ui/Tooltip';
import type { CadTool } from '../workbenchCore';

/** Left tool rail: sketch, modify and history tools. Floats over the viewport so drawing gets the full height. */
export function ToolRail(p: ToolRailProps) {
  const {
    displayOnly,
    tip,
    undo,
    railBtn,
    redo,
    railSep,
    toolBtn,
    modifyBtn,
    filletR,
    setFilletR,
    applyFillet,
    offsetD,
    setOffsetD,
    applyOffset,
    dispatch,
    selectedCount,
    setCmdText,
  } = p;
  return (
    <>
      {/* Tool rail: floats over the viewport so drawing gets the full height. */}
      {!displayOnly && (
        <div className="absolute top-3 left-3 z-20 flex flex-col items-center gap-0.5 p-1 bg-surface border border-line rounded select-none">
          <Tooltip
            content={tip('Undo', IS_MAC ? `${MOD_LABEL}Z` : `${MOD_LABEL}+Z`)}
            delay={350}
            side="right"
          >
            <button type="button" aria-label="Undo" onClick={undo} className={railBtn(false)}>
              <Undo2 className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip
            content={tip('Redo', IS_MAC ? `${MOD_LABEL}Y` : `${MOD_LABEL}+Y`)}
            delay={350}
            side="right"
          >
            <button type="button" aria-label="Redo" onClick={redo} className={railBtn(false)}>
              <Redo2 className="w-4 h-4" />
            </button>
          </Tooltip>
          {railSep}
          {toolBtn('select', <MousePointer2 className="w-4 h-4" />, 'Select', 'S')}
          {railSep}
          {toolBtn('line', <Minus className="w-4 h-4" />, 'Line', 'L')}
          {toolBtn('polyline', <ArrowUpRight className="w-4 h-4" />, 'Polyline', 'P')}
          {toolBtn('rectangle', <Square className="w-4 h-4" />, 'Rectangle', 'R')}
          {toolBtn('circle_center_radius', <Circle className="w-4 h-4" />, 'Circle', 'C')}
          {toolBtn('ellipse_center', <CircleDot className="w-4 h-4" />, 'Ellipse', 'E')}
          {toolBtn('arc_center', <TriangleRight className="w-4 h-4" />, 'Arc', 'A')}
          {toolBtn('construction_line', <ScanLine className="w-4 h-4" />, 'Construction line')}
          {railSep}
          {modifyBtn(
            'fillet',
            <CornerUpRight className="w-4 h-4" />,
            'Fillet',
            'Rounds the corners of every polyline with this radius.',
            filletR,
            setFilletR,
            applyFillet,
          )}
          {modifyBtn(
            'offset',
            <Maximize2 className="w-4 h-4" />,
            'Offset',
            'Moves the outline of every shape outward by this distance.',
            offsetD,
            setOffsetD,
            applyOffset,
          )}
          {toolBtn('trim', <Scissors className="w-4 h-4" />, 'Trim', 'T')}
          {railSep}
          <Tooltip content={tip('Delete selected', 'Del')} delay={350} side="right">
            <button
              type="button"
              aria-label="Delete selected"
              onClick={() => dispatch({ type: 'DELETE_SELECTED' })}
              disabled={selectedCount === 0}
              className={`${railBtn(false)} hover:!text-danger`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip content="Clear canvas" delay={350} side="right">
            <button
              type="button"
              aria-label="Clear canvas"
              onClick={() => {
                dispatch({ type: 'CLEAR' });
                setCmdText('Canvas cleared.');
              }}
              className={`${railBtn(false)} hover:!text-danger`}
            >
              <Eraser className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      )}
    </>
  );
}

export interface ToolRailProps {
  displayOnly: boolean;
  tip: (label: string, kbd?: string) => React.JSX.Element;
  undo: () => void;
  railBtn: (active: boolean) => string;
  redo: () => void;
  railSep: React.JSX.Element;
  toolBtn: (t: CadTool, icon: React.ReactNode, label: string, kbd?: string) => React.JSX.Element;
  modifyBtn: (
    id: 'fillet' | 'offset',
    icon: React.ReactNode,
    label: string,
    hint: string,
    value: number,
    setValue: (v: number) => void,
    apply: () => void,
  ) => React.JSX.Element;
  filletR: number;
  setFilletR: React.Dispatch<React.SetStateAction<number>>;
  applyFillet: () => Promise<void>;
  offsetD: number;
  setOffsetD: React.Dispatch<React.SetStateAction<number>>;
  applyOffset: () => Promise<void>;
  dispatch: React.ActionDispatch<[action: CadAction]>;
  selectedCount: number;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
}
