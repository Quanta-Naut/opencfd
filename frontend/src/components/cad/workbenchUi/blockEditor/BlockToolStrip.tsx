import type { BlockMsg, BlockTool } from './shared';
import { smallBtn } from './shared';

const NAMES: Record<BlockTool, string> = {
  select: 'Select',
  draw: 'Create block',
  split: 'Split',
  ogrid: 'O-grid',
  assoc: 'Associate',
  mergeV: 'Merge vertices',
  mergeB: 'Merge blocks',
  delete: 'Delete',
};

/** Top strip: what the active tool wants next, its options, and the result
 *  of the last operation. */
export function BlockToolStrip(p: {
  blockTool: BlockTool;
  hasBlocks: boolean;
  blockMsg: BlockMsg;
  drawCount: number;
  pickPending: boolean;
  ogridSel: string[];
  ogridPass: string[];
  ogridScale: number;
  setOgridScale: (v: number) => void;
  applyOgrid: () => void;
  clearOgrid: () => void;
  assocStage: 'edges' | 'curve';
  assocCount: number;
  setAssocStage: (s: 'edges' | 'curve') => void;
  disassociate: () => void;
  clearAssoc: () => void;
}) {
  const hint = (() => {
    if (!p.hasBlocks && p.blockTool === 'select')
      return 'Start with Initialize (one block around the geometry), or Create block.';
    switch (p.blockTool) {
      case 'select':
        return 'Drag vertices to shape blocks. Click a vertex, edge or block to edit it.';
      case 'draw':
        return `Click four corners${p.drawCount ? ` (${p.drawCount} of 4 placed)` : ''}. They snap to vertices and geometry.`;
      case 'split':
        return 'Click an edge where the split goes. It runs across the whole row of blocks.';
      case 'ogrid':
        return !p.ogridSel.length
          ? 'Click the blocks to wrap, e.g. the block around a body.'
          : 'Add blocks, or click an outside edge to pass through it (one gives a C-grid). Enter builds.';
      case 'assoc':
        return p.assocStage === 'edges'
          ? 'Pick the block edges, then press Enter and click the curve they should follow.'
          : 'Click the geometry curve these edges should follow.';
      case 'mergeV':
        return p.pickPending
          ? 'Click the vertex to merge it with.'
          : 'Click two vertices to merge them (removes a split or collapses an edge).';
      case 'mergeB':
        return p.pickPending
          ? 'Click the neighbouring block.'
          : 'Click two blocks that share a whole edge.';
      case 'delete':
        return 'Click a block to delete it (blocks inside a body must go).';
    }
  })();

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 select-none max-w-[min(680px,calc(100%-22rem))]">
      <div className="flex items-center gap-2 flex-wrap justify-center bg-surface border border-line rounded px-2.5 py-1 text-[11px]">
        <span className="font-semibold text-fg">{NAMES[p.blockTool]}</span>
        <span className="text-fg-2">{hint}</span>
        {p.blockTool === 'ogrid' && p.ogridSel.length > 0 && (
          <>
            <span className="w-px h-4 bg-line" />
            <span className="text-fg-2">
              {p.ogridSel.length} block{p.ogridSel.length > 1 ? 's' : ''}
              {p.ogridPass.length ? `, ${p.ogridPass.length} pass-through` : ''}
            </span>
            <label
              className="flex items-center gap-1.5 text-fg-2"
              title="Size of the wrapped blocks after the ring is added"
            >
              Inner size
              <input
                type="range"
                min={0.2}
                max={0.9}
                step={0.05}
                value={p.ogridScale}
                onChange={(ev) => p.setOgridScale(parseFloat(ev.target.value))}
                className="w-20 accent-accent"
              />
              <span className="font-mono text-fg w-7">{p.ogridScale.toFixed(2)}</span>
            </label>
            <button
              onClick={p.applyOgrid}
              className="px-2 py-0.5 rounded bg-accent hover:bg-accent-hover text-white font-medium"
            >
              Build
            </button>
            <button onClick={p.clearOgrid} className={smallBtn}>
              Clear
            </button>
          </>
        )}
        {p.blockTool === 'assoc' && (
          <>
            <span className="w-px h-4 bg-line" />
            {p.assocStage === 'edges' ? (
              <button
                disabled={!p.assocCount}
                onClick={() => p.setAssocStage('curve')}
                className="px-2 py-0.5 rounded bg-accent hover:bg-accent-hover text-white font-medium disabled:opacity-40"
              >
                Pick curve ({p.assocCount})
              </button>
            ) : (
              <button onClick={() => p.setAssocStage('edges')} className={smallBtn}>
                Back to edges
              </button>
            )}
            <button disabled={!p.assocCount} onClick={p.disassociate} className={smallBtn}>
              Disassociate
            </button>
            <button disabled={!p.assocCount} onClick={p.clearAssoc} className={smallBtn}>
              Clear
            </button>
          </>
        )}
      </div>
      {p.blockMsg && (
        <div
          className={`bg-surface border border-line rounded px-2 py-0.5 text-[11px] ${
            p.blockMsg.error ? 'text-danger' : 'text-fg-2'
          }`}
        >
          {p.blockMsg.text}
        </div>
      )}
    </div>
  );
}
