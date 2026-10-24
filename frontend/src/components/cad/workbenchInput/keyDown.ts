import type { BlockTool } from '../workbenchUi/blockEditor/shared';
import type { CadAction } from '../workbenchCore';
import React from 'react';
import { Point2D } from '../../../types/cadWorkflow';
import { Blocking } from '../../../types/blocking';
import type { CadTool, DynamicDimPrompt } from '../workbenchCore';
import { uid } from '../workbenchCore';
import type { SnapSettings } from '../workbenchCore';

/** Workbench keyboard shortcuts (tools, Delete, Escape, Enter, undo / redo, F-keys). */
export function onKeyDown(e: KeyboardEvent, wb: KeyDownContext) {
  const {
    tool,
    redo,
    displayOnly,
    showBlocking,
    canvasMode,
    setBlockDrawPts,
    setBlockTool,
    setBlockMsg,
    blockTool,
    selectedBlockId,
    deleteBlockById,
    commitTool,
    cancelTool,
    cycleField,
    setShowPremesh,
    isDrawing,
    tempPts,
    setIsDrawing,
    setTempPts,
    setCmdText,
    dispatch,
    setTool,
    constructionMode,
    lastEditRef,
    blockUndoRef,
    undo,
    undoBlocking,
    blockRedoRef,
    redoBlocking,
    setOrtho,
    setSnapEnabled,
    setShowGrid,
    setSnapSettings,
    setDimPrompt,
    setManualDim,
  } = wb;
  // Never let canvas shortcuts (Delete, tool letters, Space/Enter, F-keys) fire
  // while the user is typing in a form field anywhere in the app. This is what
  // caused "backspace in a mesh input deleted my whole geometry".
  const t = e.target as HTMLElement | null;
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  ) {
    return;
  }
  // Outside the geometry stage the canvas is display-only: the CAD shortcuts
  // (Delete, tool letters) must not touch the geometry. In the Blocks view the
  // keys drive the block editor instead. Undo/redo still fall through.
  if (displayOnly && !e.ctrlKey && !e.metaKey) {
    if (showBlocking && canvasMode === 'cad') {
      const k = e.key.toLowerCase();
      // Each tool is a command: Enter finishes it, Esc cancels it (undoing
      // what it changed) and goes back to Select, Tab moves between its fields.
      if (e.key === 'Escape') {
        cancelTool();
        setBlockMsg(null);
      } else if (e.key === 'Enter' && blockTool !== 'select') {
        e.preventDefault();
        commitTool();
      } else if (e.key === 'Tab' && blockTool !== 'select') {
        e.preventDefault();
        cycleField(e.shiftKey ? -1 : 1);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBlockId) {
        e.preventDefault();
        deleteBlockById(selectedBlockId);
      } else if (k === 'v') setBlockTool('select');
      else if (k === 'b') {
        setBlockTool('draw');
        setBlockDrawPts([]);
      } else if (k === 'k') setBlockTool('split');
      else if (k === 'x') setBlockTool('delete');
      else if (k === 'o') setBlockTool('ogrid');
      else if (k === 'm') setBlockTool('mergeV');
      else if (k === 'j') setBlockTool('mergeB');
      else if (k === 'a') setBlockTool('assoc');
      else if (k === 'e') setBlockTool('params');
      else if (k === 't') setBlockTool('match');
      else if (k === 'p') setShowPremesh((v) => !v);
    }
    return;
  }
  if (e.key === 'Escape') {
    if (isDrawing || tempPts.length > 0) {
      setIsDrawing(false);
      setTempPts([]);
      setCmdText(`${tool.toUpperCase()}: Cancelled. Press Esc again to return to Select.`);
    } else {
      // Nothing in progress -> return to select tool and clear any active selection
      dispatch({ type: 'SELECT_ENTITY', id: null });
      setTool('select');
      setCmdText('SELECT: Click entity/vertex or drag box to select.');
    }
  }

  if (e.key === 'Enter' || e.key === ' ') {
    // End polyline without closing, or confirm
    if (tool === 'polyline' && isDrawing && tempPts.length >= 2) {
      const layer = constructionMode ? 'construction' : 'default';
      dispatch({
        type: 'ADD_ENTITY',
        entity: { id: uid(), type: 'polyline', layer, pts: tempPts, isClosed: false },
      });
      setIsDrawing(false);
      setTempPts([]);
      setCmdText('POLYLINE: Done. Pick first point.');
    }
    if (tool === 'line' && isDrawing) {
      setIsDrawing(false);
      setTempPts([]);
      setCmdText('LINE: Done. Pick start point.');
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (lastEditRef.current === 'blocks' && blockUndoRef.current.length) {
      if (!undoBlocking()) undo();
    } else undo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault();
    if (lastEditRef.current === 'blocks' && blockRedoRef.current.length) {
      if (!redoBlocking()) redo();
    } else redo();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    dispatch({ type: 'DELETE_SELECTED' });
  }
  if (e.key === 'F8') setOrtho((o) => !o);
  if (e.key === 'F3') setSnapEnabled((s) => !s);
  if (e.key === 'F7') setShowGrid((g) => !g);
  if (e.key === 'F9') setSnapSettings((s) => ({ ...s, grid: !s.grid }));
  if (e.key === 'l' || e.key === 'L') {
    setTool('line');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
  }
  if (e.key === 'p' || e.key === 'P') {
    setTool('polyline');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
  }
  if (e.key === 'r' || e.key === 'R') {
    setTool('rectangle');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
  }
  if (e.key === 'c' || e.key === 'C') {
    setTool('circle_center_radius');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
  }
  if (e.key === 'e' || e.key === 'E') {
    setTool('ellipse_center');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
  }
  if (e.key === 'a' || e.key === 'A') {
    setTool('arc_center');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
  }
  if (e.key === 's' || e.key === 'S') {
    setTool('select');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
  }
  if (e.key === 't' || e.key === 'T') {
    setTool('trim');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
  }
}

/** What onKeyDown reads from the workbench component. */
export interface KeyDownContext {
  tool: CadTool;
  redo: () => void;
  displayOnly: boolean;
  showBlocking: boolean;
  canvasMode: 'cad' | 'mesh';
  blockDrawPts: Point2D[];
  setBlockDrawPts: React.Dispatch<React.SetStateAction<Point2D[]>>;
  setBlockTool: React.Dispatch<React.SetStateAction<BlockTool>>;
  setBlockMsg: React.Dispatch<React.SetStateAction<{ text: string; error: boolean }>>;
  blockTool: BlockTool;
  selectedBlockId: string;
  deleteBlockById: (id: string) => void;
  commitTool: () => void;
  cancelTool: () => void;
  cycleField: (dir: number) => void;
  setShowPremesh: React.Dispatch<React.SetStateAction<boolean>>;
  isDrawing: boolean;
  tempPts: Point2D[];
  setIsDrawing: React.Dispatch<React.SetStateAction<boolean>>;
  setTempPts: React.Dispatch<React.SetStateAction<Point2D[]>>;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
  dispatch: React.ActionDispatch<[action: CadAction]>;
  setTool: React.Dispatch<React.SetStateAction<CadTool>>;
  constructionMode: boolean;
  lastEditRef: React.RefObject<'cad' | 'blocks'>;
  blockUndoRef: React.RefObject<Blocking[]>;
  undo: () => void;
  undoBlocking: () => boolean;
  blockRedoRef: React.RefObject<Blocking[]>;
  redoBlocking: () => boolean;
  setOrtho: React.Dispatch<React.SetStateAction<boolean>>;
  setSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;
  setSnapSettings: React.Dispatch<React.SetStateAction<SnapSettings>>;
  setDimPrompt: React.Dispatch<React.SetStateAction<DynamicDimPrompt>>;
  setManualDim: React.Dispatch<React.SetStateAction<boolean>>;
}
