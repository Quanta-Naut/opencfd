import React from 'react';
import { Copy } from 'lucide-react';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import { Blocking, emptyBlocking, disassociateEdges, setEdgeParams } from '../../../types/blocking';
import type { Snap } from '../workbenchCore';
import { onKeyDown } from '../workbenchInput/keyDown';

/** Block editor tools, Blocks view only: edit the block topology ICEM CFD Hexa style while the geometry stays locked. */
export function BlockEditorTools(p: BlockEditorToolsProps) {
  const {
    displayOnly,
    showBlocking,
    canvasMode,
    blockMode,
    onUpdateBlocking,
    selectedEdgeId,
    blocking,
    cadState,
    setBlockTool,
    setBlockDrawPts,
    setBlockMsg,
    blockTool,
    initializeBlocks,
    snapProject,
    blockMsg,
    ogridScale,
    setOgridScale,
    assocStage,
    assocEdges,
    setAssocStage,
    setAssocEdges,
    unpatchedEdgeIds,
    badBlockIds,
    outsideBlockIds,
    blockCoverage,
  } = p;
  return (
    <>
      {/* Block editor tools - Blocks view only. Geometry is locked here; these
            edit the block topology, ICEM CFD Hexa style. */}
      {displayOnly &&
        showBlocking &&
        canvasMode === 'cad' &&
        blockMode === 'manual' &&
        onUpdateBlocking &&
        (() => {
          const tools = [
            { id: 'select', label: 'Select', key: 'V' },
            { id: 'draw', label: 'Draw', key: 'B' },
            { id: 'split', label: 'Split', key: 'K' },
            { id: 'ogrid', label: 'O-grid', key: 'O' },
            { id: 'assoc', label: 'Associate', key: 'A' },
            { id: 'mergeV', label: 'Merge vtx', key: 'M' },
            { id: 'mergeB', label: 'Merge blk', key: 'J' },
            { id: 'delete', label: 'Delete', key: 'X' },
          ] as const;
          const selEdge = selectedEdgeId
            ? blocking?.edges.find((x) => x.id === selectedEdgeId)
            : undefined;
          const curveNames = (ids?: string[]) =>
            (ids ?? [])
              .map((id) => {
                const ent = cadState.entities.find((x) => x.id === id);
                return ent
                  ? `${ent.type}${ent.role === 'domain_boundary' ? ' (domain)' : ''}`
                  : 'missing curve';
              })
              .join(', ');
          const btn =
            'px-2 py-0.5 rounded font-medium text-fg-2 hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed';
          return (
            <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1 select-none max-w-[calc(100%-14rem)]">
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded border border-warning text-warning bg-warning-soft text-[10px] font-semibold uppercase tracking-wider">
                  Beta
                </span>
                <div className="flex items-center gap-0.5 flex-wrap bg-surface border border-line rounded px-1.5 py-1 text-[11px]">
                  {tools.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setBlockTool(t.id);
                        setBlockDrawPts([]);
                        setBlockMsg(null);
                      }}
                      className={`px-2 py-0.5 rounded font-medium ${
                        blockTool === t.id
                          ? 'bg-app text-fg font-semibold'
                          : 'text-fg-2 hover:text-fg'
                      }`}
                    >
                      {t.label}
                      <span className="ml-1 text-[10px] text-fg-3">{t.key}</span>
                    </button>
                  ))}
                  <span className="w-px h-4 bg-line mx-0.5" />
                  <button onClick={initializeBlocks} className={btn}>
                    Initialize
                  </button>
                  <button
                    onClick={snapProject}
                    disabled={!blocking?.vertices.some((v) => v.curves?.length)}
                    className={btn}
                  >
                    Snap project
                  </button>
                  <button
                    onClick={() => {
                      if (!blocking?.blocks.length) return;
                      if (blockMsg?.text !== 'Click again to clear.') {
                        setBlockMsg({ text: 'Click again to clear.', error: true });
                        return;
                      }
                      onUpdateBlocking(emptyBlocking());
                      setBlockTool('draw');
                      setBlockDrawPts([]);
                      setBlockMsg({ text: 'All blocks cleared.', error: false });
                    }}
                    disabled={!blocking?.blocks.length}
                    className="px-2 py-0.5 rounded font-medium text-fg-2 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Clear all
                  </button>
                </div>
              </div>

              {/* Tool options */}
              {blockTool === 'ogrid' && (
                <div className="flex items-center gap-2 bg-surface border border-line rounded px-2 py-1 text-[11px]">
                  <span className="text-fg">Centre block size</span>
                  <input
                    type="range"
                    min={0.2}
                    max={0.8}
                    step={0.05}
                    value={ogridScale}
                    onChange={(ev) => setOgridScale(parseFloat(ev.target.value))}
                    className="w-28 accent-accent"
                  />
                  <span className="font-mono text-fg w-8">{ogridScale.toFixed(2)}</span>
                  <span className="text-fg-3">of the block</span>
                </div>
              )}
              {blockTool === 'assoc' && (
                <div className="flex items-center gap-1 flex-wrap bg-surface border border-line rounded px-2 py-1 text-[11px]">
                  <span className={assocStage === 'edges' ? 'font-semibold text-fg' : 'text-fg-2'}>
                    1 Pick edges ({assocEdges.length})
                  </span>
                  <span className="text-fg-3">then</span>
                  <span className={assocStage === 'curve' ? 'font-semibold text-fg' : 'text-fg-2'}>
                    2 Click a curve
                  </span>
                  <span className="w-px h-4 bg-line mx-1" />
                  {assocStage === 'edges' ? (
                    <button
                      disabled={!assocEdges.length}
                      onClick={() => {
                        setAssocStage('curve');
                      }}
                      className="px-2 py-0.5 rounded bg-accent text-white font-medium disabled:opacity-40"
                    >
                      Pick curve (Enter)
                    </button>
                  ) : (
                    <button onClick={() => setAssocStage('edges')} className={btn}>
                      Back to edges
                    </button>
                  )}
                  <button
                    disabled={!assocEdges.length}
                    onClick={() => {
                      if (!blocking) return;
                      onUpdateBlocking(disassociateEdges(blocking, assocEdges));
                      setBlockMsg({
                        text: `${assocEdges.length} edge${assocEdges.length > 1 ? 's' : ''} disassociated.`,
                        error: false,
                      });
                      setAssocEdges([]);
                    }}
                    className={btn}
                  >
                    Disassociate
                  </button>
                  <button
                    disabled={!assocEdges.length}
                    onClick={() => setAssocEdges([])}
                    className={btn}
                  >
                    Clear picks
                  </button>
                </div>
              )}
              {blockTool === 'select' && selEdge && blocking && (
                <div className="bg-surface border border-line rounded px-2 py-1.5 text-[11px] space-y-1.5 w-[300px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-fg">Edge params</span>
                    <span className="text-fg-3">
                      {selEdge.patch ??
                        (unpatchedEdgeIds.has(selEdge.id) ? 'no patch' : 'internal')}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 items-end">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-fg-2">Nodes</span>
                      <input
                        type="number"
                        min={2}
                        step={1}
                        defaultValue={selEdge.nodes}
                        key={`n-${selEdge.id}-${selEdge.nodes}`}
                        onBlur={(ev) => {
                          const n = parseInt(ev.target.value, 10);
                          if (n >= 2 && n !== selEdge.nodes)
                            onUpdateBlocking(setEdgeParams(blocking, selEdge.id, { nodes: n }));
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                        }}
                        className="px-1.5 py-0.5 border border-line rounded font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-fg-2">Spacing law</span>
                      <select
                        value={selEdge.law}
                        onChange={(ev) =>
                          onUpdateBlocking(
                            setEdgeParams(blocking, selEdge.id, {
                              law: ev.target.value as typeof selEdge.law,
                            }),
                          )
                        }
                        className="px-1 py-0.5 border border-line rounded bg-surface"
                      >
                        <option value="uniform">Uniform</option>
                        <option value="geometric">Geometric</option>
                        <option value="bump">Bump</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-fg-2">Ratio</span>
                      <input
                        type="number"
                        min={0.01}
                        step={0.1}
                        defaultValue={selEdge.ratio}
                        key={`r-${selEdge.id}-${selEdge.ratio}`}
                        disabled={selEdge.law === 'uniform'}
                        onBlur={(ev) => {
                          const r = parseFloat(ev.target.value);
                          if (r > 0 && r !== selEdge.ratio)
                            onUpdateBlocking(setEdgeParams(blocking, selEdge.id, { ratio: r }));
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                        }}
                        className="px-1.5 py-0.5 border border-line rounded font-mono disabled:bg-app"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      onClick={() => {
                        onUpdateBlocking(
                          setEdgeParams(blocking, selEdge.id, {
                            law: selEdge.law,
                            ratio: selEdge.ratio,
                            copyParallel: true,
                          }),
                        );
                        setBlockMsg({
                          text: 'Spacing copied to every parallel edge.',
                          error: false,
                        });
                      }}
                      className="px-2 py-0.5 rounded border border-line hover:border-accent hover:text-accent-fg"
                    >
                      Copy to parallel edges
                    </button>
                    {selEdge.curves?.length ? (
                      <>
                        <span className="text-success">on {curveNames(selEdge.curves)}</span>
                        <button
                          onClick={() =>
                            onUpdateBlocking(disassociateEdges(blocking, [selEdge.id]))
                          }
                          className={btn}
                        >
                          Disassociate
                        </button>
                      </>
                    ) : (
                      <span className="text-fg-3">not associated</span>
                    )}
                  </div>
                </div>
              )}

              {(blockMsg ||
                badBlockIds.size > 0 ||
                outsideBlockIds.size > 0 ||
                unpatchedEdgeIds.size > 0 ||
                (blockCoverage !== null && blockCoverage < 0.995)) && (
                <div className="bg-surface border border-line rounded px-2 py-1 text-[11px] leading-snug max-w-[520px]">
                  {blockMsg && (
                    <div className={blockMsg.error ? 'text-danger' : 'text-fg'}>
                      {blockMsg.text}
                    </div>
                  )}
                  {outsideBlockIds.size > 0 && (
                    <div className="text-danger">
                      {outsideBlockIds.size} block{outsideBlockIds.size > 1 ? 's' : ''} outside the
                      fluid
                    </div>
                  )}
                  {badBlockIds.size > 0 && (
                    <div className="text-danger">
                      {badBlockIds.size} block{badBlockIds.size > 1 ? 's' : ''} over a body
                    </div>
                  )}
                  {unpatchedEdgeIds.size > 0 && (
                    <div className="text-danger">
                      {unpatchedEdgeIds.size} unpatched boundary edge
                      {unpatchedEdgeIds.size > 1 ? 's' : ''}
                    </div>
                  )}
                  {blockCoverage !== null && blockCoverage < 0.995 && (
                    <div className="text-warning">
                      {Math.round(blockCoverage * 100)}% of the fluid blocked
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
    </>
  );
}

export interface BlockEditorToolsProps {
  displayOnly: boolean;
  showBlocking: boolean;
  canvasMode: 'cad' | 'mesh';
  blockMode: 'auto' | 'manual';
  onUpdateBlocking: (bk: Blocking | null) => void;
  selectedEdgeId: string;
  blocking: Blocking;
  cadState: { entities: CadEntity[] };
  setBlockTool: React.Dispatch<
    React.SetStateAction<
      'select' | 'draw' | 'split' | 'delete' | 'ogrid' | 'mergeV' | 'mergeB' | 'assoc'
    >
  >;
  setBlockDrawPts: React.Dispatch<React.SetStateAction<Point2D[]>>;
  setBlockMsg: React.Dispatch<React.SetStateAction<{ text: string; error: boolean }>>;
  blockTool: 'select' | 'draw' | 'split' | 'delete' | 'ogrid' | 'mergeV' | 'mergeB' | 'assoc';
  initializeBlocks: () => void;
  snapProject: () => void;
  blockMsg: { text: string; error: boolean };
  ogridScale: number;
  setOgridScale: React.Dispatch<React.SetStateAction<number>>;
  assocStage: 'edges' | 'curve';
  assocEdges: string[];
  setAssocStage: React.Dispatch<React.SetStateAction<'edges' | 'curve'>>;
  setAssocEdges: React.Dispatch<React.SetStateAction<string[]>>;
  unpatchedEdgeIds: Set<string>;
  badBlockIds: Set<string>;
  outsideBlockIds: Set<string>;
  blockCoverage: number;
}
