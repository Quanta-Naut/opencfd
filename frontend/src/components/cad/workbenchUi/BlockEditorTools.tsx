import React from 'react';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import {
  Blocking,
  BlockPremesh,
  PremeshQuality,
  SpacingJump,
  VertexKind,
  disassociateEdges,
  emptyBlocking,
} from '../../../types/blocking';
import { BlockToolRail } from './blockEditor/BlockToolRail';
import { BlockToolStrip } from './blockEditor/BlockToolStrip';
import { BlockInspector } from './blockEditor/BlockInspector';
import { BlockChecks } from './blockEditor/BlockChecks';
import type { BlockMsg, BlockTool } from './blockEditor/shared';

/** The block editor (Blocks view): ICEM CFD Hexa style tools on the left, the
 *  active tool's prompt on top, the selection and the live checks on the
 *  right. The geometry is locked here; only the blocks change. */
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
  if (!(displayOnly && showBlocking && canvasMode === 'cad' && onUpdateBlocking)) return null;
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
      <BlockToolStrip
        blockTool={blockTool}
        hasBlocks={hasBlocks}
        blockMsg={p.blockMsg}
        drawCount={p.blockDrawCount}
        pickPending={!!p.blockPick}
        ogridSel={p.ogridSel}
        ogridPass={p.ogridPass}
        ogridScale={p.ogridScale}
        setOgridScale={p.setOgridScale}
        applyOgrid={p.applyOgrid}
        clearOgrid={() => {
          p.setOgridSel([]);
          p.setOgridPass([]);
        }}
        assocStage={p.assocStage}
        assocCount={p.assocEdges.length}
        setAssocStage={p.setAssocStage}
        disassociate={() => {
          if (!blocking) return;
          onUpdateBlocking(disassociateEdges(blocking, p.assocEdges));
          setBlockMsg({
            text: `${p.assocEdges.length} edge${p.assocEdges.length > 1 ? 's' : ''} disassociated.`,
            error: false,
          });
          p.setAssocEdges([]);
        }}
        clearAssoc={() => p.setAssocEdges([])}
      />
      {hasBlocks && blocking && (
        <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5 select-none">
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
            ogridThis={(id) => {
              setBlockTool('ogrid');
              p.setOgridSel([id]);
              p.setOgridPass([]);
            }}
          />
          <BlockChecks
            blockCount={blocking.blocks.length}
            quality={p.premeshQ}
            outside={p.outsideBlockIds.size}
            overBody={p.badBlockIds.size}
            unpatched={p.unpatchedEdgeIds.size}
            jumps={p.blockSpacingJumps}
            coverage={p.blockCoverage}
            showPremesh={p.showPremesh}
          />
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
  blockPick: string | null;
  blockMsg: BlockMsg;
  setBlockMsg: React.Dispatch<React.SetStateAction<BlockMsg>>;
  initializeBlocks: () => void;
  snapProject: () => void;
  undo: () => void;
  redo: () => void;
  showPremesh: boolean;
  setShowPremesh: React.Dispatch<React.SetStateAction<boolean>>;
  ogridSel: string[];
  setOgridSel: React.Dispatch<React.SetStateAction<string[]>>;
  ogridPass: string[];
  setOgridPass: React.Dispatch<React.SetStateAction<string[]>>;
  ogridScale: number;
  setOgridScale: React.Dispatch<React.SetStateAction<number>>;
  applyOgrid: () => void;
  assocStage: 'edges' | 'curve';
  setAssocStage: React.Dispatch<React.SetStateAction<'edges' | 'curve'>>;
  assocEdges: string[];
  setAssocEdges: React.Dispatch<React.SetStateAction<string[]>>;
  selectedEdgeId: string | null;
  selectedVertexId: string | null;
  selectedBlockId: string | null;
  blockVertexKinds: Map<string, VertexKind>;
  blockPremesh: BlockPremesh[];
  premeshQ: PremeshQuality;
  blockSpacingJumps: SpacingJump[];
  setVertexLocation: (vid: string, pt: Point2D) => void;
  deleteBlockById: (id: string) => void;
  unpatchedEdgeIds: Set<string>;
  badBlockIds: Set<string>;
  outsideBlockIds: Set<string>;
  blockCoverage: number | null;
}
