import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import type { CadAction, CadTool, Affine } from '../workbenchCore';
import {
  uid,
  translation,
  scaling,
  rotation,
  mirroring,
  transformEntity,
  entitiesCenter,
} from '../workbenchCore';

// Move, Scale, Rotate and Mirror as Fusion 360 style commands: pick the
// objects (or use the selection), pick a base point, then pick the target or
// type the numbers. The result previews live; OK or Enter applies it, Esc
// cancels. "Copy" keeps the originals. Point places reference points.

export const TRANSFORM_TOOLS = ['move', 'scale', 'rotate', 'mirror'] as const;
export type TransformTool = (typeof TRANSFORM_TOOLS)[number];
export const isTransformTool = (t: CadTool): t is TransformTool =>
  (TRANSFORM_TOOLS as readonly string[]).includes(t);

/** What the next canvas click sets. */
export type XformPick = 'objects' | 'base' | 'target' | 'm1' | 'm2' | null;

export interface XformState {
  pick: XformPick;
  base: Point2D | null;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  uniform: boolean;
  angle: number;
  m1: Point2D | null;
  m2: Point2D | null;
  copy: boolean;
}

const fresh = (copy = false): XformState => ({
  pick: 'objects',
  base: null,
  dx: 0,
  dy: 0,
  sx: 1,
  sy: 1,
  uniform: true,
  angle: 0,
  m1: null,
  m2: null,
  copy,
});

const VERB: Record<TransformTool, string> = {
  move: 'Moved',
  scale: 'Scaled',
  rotate: 'Rotated',
  mirror: 'Mirrored',
};

export function useTransformCommand(p: {
  tool: CadTool;
  setTool: (t: CadTool) => void;
  entities: CadEntity[];
  dispatch: React.Dispatch<CadAction>;
  setCmdText: (s: string) => void;
}) {
  const { tool, setTool, entities, dispatch, setCmdText } = p;
  const [xf, setXf] = useState<XformState>(fresh);
  const selected = useMemo(() => entities.filter((e) => e.selected && !e.autoDomain), [entities]);
  const active = isTransformTool(tool);

  // Each start of a command: the selection is its objects when there is one.
  useEffect(() => {
    if (!isTransformTool(tool)) return;
    // Mirror keeps the originals by default, as in most CAD tools.
    const has = entities.some((e) => e.selected && !e.autoDomain);
    setXf({
      ...fresh(tool === 'mirror'),
      pick: has ? (tool === 'mirror' ? 'm1' : 'base') : 'objects',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // Scale and Rotate turn about the selection's centre until a base is picked.
  const pivot = xf.base ?? entitiesCenter(selected);

  /** The map the command would apply, with the cursor standing in for the
   *  point being picked. Null until there is enough to go on. */
  const affine = useCallback(
    (cursor: Point2D | null): Affine | null => {
      if (!active || !selected.length) return null;
      switch (tool) {
        case 'move': {
          if (xf.pick === 'target' && xf.base && cursor)
            return translation(cursor.x - xf.base.x, cursor.y - xf.base.y);
          return xf.dx || xf.dy ? translation(xf.dx, xf.dy) : null;
        }
        case 'scale':
          return pivot && (xf.sx !== 1 || xf.sy !== 1) && xf.sx && xf.sy
            ? scaling(pivot, xf.sx, xf.sy)
            : null;
        case 'rotate':
          return pivot && xf.angle ? rotation(pivot, xf.angle) : null;
        case 'mirror': {
          const b = xf.m2 ?? (xf.pick === 'm2' ? cursor : null);
          return xf.m1 && b ? mirroring(xf.m1, b) : null;
        }
      }
      return null;
    },
    [active, selected, tool, xf, pivot],
  );

  /** Transformed copies of the selected entities, for the preview. */
  const preview = useCallback(
    (cursor: Point2D | null): CadEntity[] | null => {
      const m = affine(cursor);
      return m ? selected.map((e) => transformEntity(e, m)) : null;
    },
    [affine, selected],
  );

  /** A canvas click while a transform command is open. `hitId` is the entity
   *  under the cursor. */
  const onPick = useCallback(
    (pt: Point2D, hitId: string | null, shift: boolean) => {
      if (!active) return;
      if (xf.pick === 'objects') {
        if (hitId) {
          dispatch({ type: 'SELECT_ENTITY', id: hitId, multi: true });
          return;
        }
        if (!selected.length) {
          setCmdText('Pick the shapes to transform first.');
          return;
        }
        // An empty click once something is picked is the base point.
        if (tool === 'mirror') setXf((s) => ({ ...s, m1: pt, pick: 'm2' }));
        else setXf((s) => ({ ...s, base: pt, pick: tool === 'move' ? 'target' : null }));
        return;
      }
      if (xf.pick === 'base') {
        setXf((s) => ({ ...s, base: pt, pick: tool === 'move' ? 'target' : null }));
      } else if (xf.pick === 'target' && xf.base) {
        const b = xf.base;
        setXf((s) => ({ ...s, dx: pt.x - b.x, dy: pt.y - b.y, pick: null }));
      } else if (xf.pick === 'm1') {
        setXf((s) => ({ ...s, m1: pt, m2: null, pick: 'm2' }));
      } else if (xf.pick === 'm2') {
        setXf((s) => ({ ...s, m2: pt, pick: null }));
      } else if (hitId && !shift) {
        // Nothing left to pick: a click on a shape adds or removes it.
        dispatch({ type: 'SELECT_ENTITY', id: hitId, multi: true });
      }
    },
    [active, xf, selected.length, tool, dispatch, setCmdText],
  );

  /** OK / Enter: apply to the selection (or to copies of it). */
  const commit = useCallback(() => {
    if (!isTransformTool(tool)) return;
    const m = affine(null);
    if (!m) {
      setCmdText('Nothing to apply yet.');
      return;
    }
    const ids = new Set(selected.map((e) => e.id));
    const moved = selected.map((e) => transformEntity(e, m));
    const out = xf.copy
      ? [
          ...entities.map((e) => ({ ...e, selected: false })),
          ...moved.map((e) => ({ ...e, id: uid(), selected: true })),
        ]
      : entities.map((e) => (ids.has(e.id) ? moved.find((x) => x.id === e.id)! : e));
    dispatch({ type: 'REPLACE_ENTITIES', entities: out });
    setCmdText(`${VERB[tool]} ${moved.length} shape${moved.length > 1 ? 's' : ''}.`);
    setTool('select');
  }, [tool, affine, selected, entities, xf.copy, dispatch, setCmdText, setTool]);

  const cancel = useCallback(() => setTool('select'), [setTool]);

  /** Where Ortho and Angle measure from while the next point is picked. */
  const anchor: Point2D | null = xf.pick === 'target' ? xf.base : xf.pick === 'm2' ? xf.m1 : null;

  return { xf, setXf, selected, pivot, active, preview, onPick, commit, cancel, anchor };
}

export type TransformCommand = ReturnType<typeof useTransformCommand>;
