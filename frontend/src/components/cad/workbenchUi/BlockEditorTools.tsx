import React, { useEffect } from 'react';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import {
  Blocking,
  BlockPremesh,
  SpacingJump,
  VertexKind,
  emptyBlocking,
} from '../../../types/blocking';
import { BlockToolRail } from './blockEditor/BlockToolRail';
import { BlockToolDialog } from './blockEditor/BlockToolDialog';
import { BlockInspector } from './blockEditor/BlockInspector';
import type { BlockMsg, BlockTool } from './blockEditor/shared';
import type { ToolPicks } from './blockEditor/toolFields';

/** The block editor (Blocks view): ICEM CFD Hexa style tools on the left; on
 *  the right the active tool's dialog (or, under Select, the selection's
 *  parameters). The geometry is locked here. */
export function BlockEditorTools(p: BlockEditorToolsProps) {
  const {
    displayOnly,
    showBlocking,
    canvasMode,
    onUpdateBlocking,
    blocking,
    setBlockTool,
    setBlockDrawPts,
    setBlockMsg,
    blockTool,
  } = p;
  // Messages fade after a moment; an error stays in the open dialog until the
  // next pick.
  const msg = p.blockMsg;
  const inDialog = blockTool !== 'select';
  useEffect(() => {
    if (!msg || (msg.error && inDialog)) return;
    const t = window.setTimeout(() => setBlockMsg(null), msg.error ? 5000 : 3000);
    return () => window.clearTimeout(t);
  }, [msg, inDialog, setBlockMsg]);
  // The tool rail stays for the whole structured Mesh tab; the dialogs and
  // the selection panel only while the blocks are being edited.
  if (!(displayOnly && showBlocking && onUpdateBlocking)) return null;
  const editing = canvasMode === 'cad';
  const hasBlocks = !!blocking?.blocks.length;
  const pickTool = (t: BlockTool) => {
    setBlockTool(t);
    setBlockDrawPts([]);
    setBlockMsg(null);
  };
  return (
    <>
      <BlockToolRail
        blockTool={blockTool}
        pickTool={pickTool}
        showPremesh={p.showPremesh}
        setShowPremesh={p.setShowPremesh}
        hasBlocks={hasBlocks}
        canSnap={!!blocking?.vertices.some((v) => v.curves?.length)}
        initializeBlocks={p.initializeBlocks}
        snapProject={p.snapProject}
        clearAll={() => {
          onUpdateBlocking(emptyBlocking());
          pickTool('select');
          setBlockMsg({ text: 'All blocks cleared.', error: false });
        }}
        undo={p.undo}
        redo={p.redo}
      />
      {editing && msg && (!msg.error || blockTool === 'select') && (
        <div
          className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-surface border border-line rounded px-2.5 py-1 text-[11px] select-none ${
            msg.error ? 'text-danger' : 'text-fg-2'
          }`}
        >
          {msg.text}
        </div>
      )}
      {editing && (
        <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5">
          {blockTool !== 'select' && (
            <BlockToolDialog
              blockTool={blockTool}
              blocking={blocking ?? emptyBlocking()}
              onUpdateBlocking={onUpdateBlocking}
              entities={p.cadState.entities}
              toolPicks={p.toolPicks}
              setToolPicks={p.setToolPicks}
              toolField={p.toolField}
              setToolField={p.setToolField}
              drawCount={p.blockDrawCount}
              ogridScale={p.ogridScale}
              setOgridScale={p.setOgridScale}
              matchCopy={p.matchCopy}
              setMatchCopy={p.setMatchCopy}
              blockSpacingJumps={p.blockSpacingJumps}
              blockMsg={msg}
              commitTool={p.commitTool}
              cancelTool={p.cancelTool}
            />
          )}
          {!hasBlocks && blockTool === 'select' && (
            <div className="bg-surface border border-line rounded px-2.5 py-1.5 text-[11px] text-fg-2 select-none">
              Initialize a block, or Create one (B).
            </div>
          )}
          {hasBlocks && blocking && blockTool === 'select' && (
            <BlockInspector
              blocking={blocking}
              onUpdateBlocking={onUpdateBlocking}
              entities={p.cadState.entities}
              selectedEdgeId={blockTool === 'select' ? p.selectedEdgeId : null}
              selectedVertexId={blockTool === 'select' ? p.selectedVertexId : null}
              selectedBlockId={blockTool === 'select' ? p.selectedBlockId : null}
              blockVertexKinds={p.blockVertexKinds}
              blockPremesh={p.blockPremesh}
              blockSpacingJumps={p.blockSpacingJumps}
              setVertexLocation={p.setVertexLocation}
              deleteBlockById={p.deleteBlockById}
              ogridThis={(id) => p.startTool('ogrid', { blocks: [id] }, 'pass')}
            />
          )}
        </div>
      )}
    </>
  );
}

export interface BlockEditorToolsProps {
  displayOnly: boolean;
  showBlocking: boolean;
  canvasMode: 'cad' | 'mesh';
  onUpdateBlocking: (bk: Blocking | null) => void;
  blocking: Blocking;
  cadState: { entities: CadEntity[] };
  blockTool: BlockTool;
  setBlockTool: React.Dispatch<React.SetStateAction<BlockTool>>;
  setBlockDrawPts: React.Dispatch<React.SetStateAction<Point2D[]>>;
  blockDrawCount: number;
  blockMsg: BlockMsg;
  setBlockMsg: React.Dispatch<React.SetStateAction<BlockMsg>>;
  initializeBlocks: () => void;
  snapProject: () => void;
  undo: () => void;
  redo: () => void;
  showPremesh: boolean;
  setShowPremesh: React.Dispatch<React.SetStateAction<boolean>>;
  toolPicks: ToolPicks;
  setToolPicks: React.Dispatch<React.SetStateAction<ToolPicks>>;
  toolField: string;
  setToolField: React.Dispatch<React.SetStateAction<string>>;
  ogridScale: number;
  setOgridScale: React.Dispatch<React.SetStateAction<number>>;
  matchCopy: boolean;
  setMatchCopy: React.Dispatch<React.SetStateAction<boolean>>;
  commitTool: () => void;
  cancelTool: () => void;
  /** Open a tool with its fields already filled. */
  startTool: (t: BlockTool, picks: ToolPicks, field?: string) => void;
  selectedEdgeId: string | null;
  selectedVertexId: string | null;
  selectedBlockId: string | null;
  blockVertexKinds: Map<string, VertexKind>;
  blockPremesh: BlockPremesh[];
  blockSpacingJumps: SpacingJump[];
  setVertexLocation: (vid: string, pt: Point2D) => void;
  deleteBlockById: (id: string) => void;
}
