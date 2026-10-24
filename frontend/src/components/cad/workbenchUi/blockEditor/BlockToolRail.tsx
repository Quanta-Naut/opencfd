import React, { useState } from 'react';
import {
  Combine,
  Eraser,
  Grid3x3,
  Magnet,
  PanelLeftClose,
  PanelLeftOpen,
  MousePointer2,
  Redo2,
  SquareSplitHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  AlignIcon,
  AssociateIcon,
  CreateBlockIcon,
  EdgeParamsIcon,
  InitBlockIcon,
  LinkShapeIcon,
  MatchSpacingIcon,
  MergeVerticesIcon,
  OGridIcon,
  ShapeEdgeIcon,
} from './blockIcons';
import { Tooltip } from '../../../ui/Tooltip';
import { Kbd } from '../../../ui/Kbd';
import type { BlockTool } from './shared';

// The block editor's tools, in the order an ICEM CFD blocking is built:
// shape the topology, wrap bodies, attach it to the geometry, tidy up.
export const TOOLS: { id: BlockTool; icon: React.ElementType; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'split', icon: SquareSplitHorizontal, label: 'Split', key: 'K' },
  { id: 'draw', icon: CreateBlockIcon, label: 'Create block', key: 'B' },
  { id: 'ogrid', icon: OGridIcon, label: 'O-grid', key: 'O' },
  { id: 'assoc', icon: AssociateIcon, label: 'Associate', key: 'A' },
  { id: 'align', icon: AlignIcon, label: 'Align vertices', key: 'L' },
  { id: 'shape', icon: ShapeEdgeIcon, label: 'Edge shape', key: 'S' },
  { id: 'link', icon: LinkShapeIcon, label: 'Link edge shape', key: 'I' },
  { id: 'params', icon: EdgeParamsIcon, label: 'Edge params', key: 'E' },
  { id: 'match', icon: MatchSpacingIcon, label: 'Match edge spacing', key: 'T' },
  { id: 'mergeV', icon: MergeVerticesIcon, label: 'Merge vertices', key: 'M' },
  { id: 'mergeB', icon: Combine, label: 'Merge blocks', key: 'J' },
  { id: 'delete', icon: Trash2, label: 'Delete block', key: 'X' },
];

export function BlockToolRail(p: {
  blockTool: BlockTool;
  pickTool: (t: BlockTool) => void;
  showPremesh: boolean;
  setShowPremesh: (v: boolean) => void;
  hasBlocks: boolean;
  canSnap: boolean;
  initializeBlocks: () => void;
  snapProject: () => void;
  clearAll: () => void;
  undo: () => void;
  redo: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  // Folds down to one button for anyone who wants the canvas clear.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('opencfd.blockRailCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const fold = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem('opencfd.blockRailCollapsed', v ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  };
  const btn = (active: boolean) =>
    `w-7 h-7 shrink-0 inline-flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:pointer-events-none ${
      active ? 'bg-accent-soft text-accent-fg' : 'text-fg-2 hover:bg-surface-3 hover:text-fg'
    }`;
  const tip = (label: string, kbd?: string) => (
    <span className="flex items-center gap-2">
      {label}
      {kbd && <Kbd>{kbd}</Kbd>}
    </span>
  );
  const sep = <span className="h-px w-5 bg-line my-0.5 shrink-0" />;
  const item = (
    key: string,
    label: React.ReactNode,
    icon: React.ReactNode,
    onClick: () => void,
    active = false,
    disabled = false,
  ) => (
    <Tooltip key={key} content={label} delay={350} side="right">
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled}
        className={btn(active)}
      >
        {icon}
      </button>
    </Tooltip>
  );
  if (collapsed)
    return (
      <div className="absolute top-14 left-3 z-20 p-1 bg-surface border border-line rounded select-none">
        {item('expand', 'Show block tools', <PanelLeftOpen className="w-4 h-4" />, () =>
          fold(false),
        )}
      </div>
    );
  return (
    <div className="absolute top-14 left-3 z-20 flex flex-col items-center gap-0.5 p-1 max-h-[calc(100%-6.5rem)] overflow-y-auto bg-surface border border-line rounded select-none">
      {item('collapse', 'Hide block tools', <PanelLeftClose className="w-4 h-4" />, () =>
        fold(true),
      )}
      {sep}
      {item('undo', tip('Undo', 'Ctrl Z'), <Undo2 className="w-4 h-4" />, p.undo)}
      {item('redo', tip('Redo', 'Ctrl Y'), <Redo2 className="w-4 h-4" />, p.redo)}
      {sep}
      {item(
        'init',
        'Initialize: one block around all the geometry',
        <InitBlockIcon className="w-4 h-4" />,
        p.initializeBlocks,
      )}
      {sep}
      {TOOLS.map((t) =>
        item(
          t.id,
          tip(t.label, t.key),
          <t.icon className="w-4 h-4" />,
          () => p.pickTool(t.id),
          p.blockTool === t.id,
          !p.hasBlocks && t.id !== 'select' && t.id !== 'draw',
        ),
      )}
      {sep}
      {item(
        'snap',
        'Snap project: put associated vertices back on their curves',
        <Magnet className="w-4 h-4" />,
        p.snapProject,
        false,
        !p.canSnap,
      )}
      {item(
        'premesh',
        tip(p.showPremesh ? 'Hide pre-mesh' : 'Show pre-mesh and its quality', 'P'),
        <Grid3x3 className="w-4 h-4" />,
        () => p.setShowPremesh(!p.showPremesh),
        p.showPremesh,
        !p.hasBlocks,
      )}
      {sep}
      {item(
        'clear',
        confirmClear ? 'Click again to delete every block' : 'Clear all blocks',
        <Eraser className={`w-4 h-4 ${confirmClear ? 'text-danger' : ''}`} />,
        () => {
          if (!confirmClear) {
            setConfirmClear(true);
            window.setTimeout(() => setConfirmClear(false), 2500);
            return;
          }
          setConfirmClear(false);
          p.clearAll();
        },
        false,
        !p.hasBlocks,
      )}
    </div>
  );
}
