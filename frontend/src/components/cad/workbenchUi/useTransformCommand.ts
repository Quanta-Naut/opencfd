import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import type { CadAction, CadTool, Affine, GizmoHandle, GizmoKind } from '../workbenchCore';
import {
  uid,
  translation,
  scaling,
  rotation,
  mirroring,
  transformEntity,
  transformVertices,
  pointwise,
  entitiesCenter,
  editPoints,
  hitGizmo,
  GIZMO,
} from '../workbenchCore';

// Move, Scale, Rotate and Mirror as Fusion 360 style commands. The selection
// is shapes and single vertices: click a vertex or a shape, or drag a box
// (vertices inside it are picked; shapes wholly inside it are picked whole).
// Only what is picked changes, so the nose of an airfoil can be scaled while
// the rest stays put. Drag the on-canvas handles or type the values; the
// result previews live, OK or Enter applies it, Esc cancels.

export const TRANSFORM_TOOLS = ['move', 'scale', 'rotate', 'mirror'] as const;
export type TransformTool = (typeof TRANSFORM_TOOLS)[number];
export const isTransformTool = (t: CadTool): t is TransformTool =>
  (TRANSFORM_TOOLS as readonly string[]).includes(t);

/** What a canvas click does: select ('objects') or set one of the points. */
export type XformPick = 'objects' | 'base' | 'target' | 'm1' | 'm2';

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

/** Picked vertices: entity id -> grip indices (editPoints order). */
export type VertexPicks = Map<string, Set<number>>;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const VERTEX_PX = 9;

const screenOf = (e: React.MouseEvent) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

export function useTransformCommand(p: {
  tool: CadTool;
  setTool: (t: CadTool) => void;
  entities: CadEntity[];
  dispatch: React.Dispatch<CadAction>;
  setCmdText: (s: string) => void;
  zoom: number;
  toWorld: (cx: number, cy: number) => Point2D;
  toScreen: (wx: number, wy: number) => Point2D;
  setMarquee: (m: { x: number; y: number; w: number; h: number } | null) => void;
}) {
  const { tool, setTool, entities, dispatch, setCmdText, zoom, toWorld, toScreen, setMarquee } = p;
  const [xf, setXf] = useState<XformState>(fresh);
  const [picks, setPicks] = useState<VertexPicks>(() => new Map());
  const [hot, setHot] = useState<GizmoHandle | null>(null);
  const active = isTransformTool(tool);

  // Each start of a command keeps the shapes already selected.
  useEffect(() => {
    if (!isTransformTool(tool)) return;
    // Mirror keeps the originals by default, as in most CAD tools.
    setXf(fresh(tool === 'mirror'));
    setPicks(new Map());
    setHot(null);
  }, [tool]);

  const whole = useMemo(() => entities.filter((e) => e.selected && !e.autoDomain), [entities]);
  // Vertex picks of shapes that are not picked whole and still exist.
  const parts = useMemo(() => {
    const out: { e: CadEntity; idxs: Set<number> }[] = [];
    for (const e of entities)
      if (!e.selected && picks.get(e.id)?.size) out.push({ e, idxs: picks.get(e.id)! });
    return out;
  }, [entities, picks]);
  const pickedPts = useMemo(
    () => parts.flatMap(({ e, idxs }) => editPoints(e).filter((_, i) => idxs.has(i))),
    [parts],
  );
  const count = { shapes: whole.length, points: pickedPts.length };
  const hasSel = count.shapes + count.points > 0;
  const center = useMemo(() => entitiesCenter(whole, pickedPts), [whole, pickedPts]);
  // Scale and Rotate turn about the selection's centre until a base is picked.
  const pivot = xf.base ?? center;

  /** The map the command would apply, with the cursor standing in for the
   *  point being picked. Null until there is enough to go on. */
  const affine = useCallback(
    (cursor: Point2D | null): Affine | null => {
      if (!active || !hasSel) return null;
      switch (tool) {
        case 'move':
          if (xf.pick === 'target' && xf.base && cursor)
            return translation(cursor.x - xf.base.x, cursor.y - xf.base.y);
          return xf.dx || xf.dy ? translation(xf.dx, xf.dy) : null;
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
    [active, hasSel, tool, xf, pivot],
  );

  /** Where the picked shapes and vertices would go, for the preview. */
  const preview = useCallback(
    (cursor: Point2D | null): CadEntity[] | null => {
      const m = affine(cursor);
      if (!m) return null;
      return [
        ...whole.map((e) => transformEntity(e, m)),
        ...parts.map(({ e, idxs }) => transformVertices(e, idxs, m)),
      ];
    },
    [affine, whole, parts],
  );

  // ── Selection ─────────────────────────────────────────────────────────────
  const setWhole = useCallback(
    (ids: Set<string>, on: boolean) =>
      dispatch({
        type: 'REPLACE_ENTITIES',
        entities: entities.map((e) => (ids.has(e.id) ? { ...e, selected: on } : e)),
      }),
    [entities, dispatch],
  );

  /** Toggle the vertex at `raw` (and every vertex joined to it). True when
   *  there was one. */
  const toggleVertex = useCallback(
    (raw: Point2D): boolean => {
      let hit: Point2D | null = null;
      let hd = VERTEX_PX / zoom;
      for (const e of entities) {
        if (e.autoDomain || !pointwise(e)) continue;
        for (const q of editPoints(e)) {
          const d = Math.hypot(q.x - raw.x, q.y - raw.y);
          if (d < hd) {
            hd = d;
            hit = q;
          }
        }
      }
      if (!hit) return false;
      const at = hit;
      const glue = Math.max(1e-9, 3 / zoom);
      const joined: { e: CadEntity; i: number }[] = [];
      for (const e of entities) {
        if (e.autoDomain || !pointwise(e)) continue;
        editPoints(e).forEach((q, i) => {
          if (Math.hypot(q.x - at.x, q.y - at.y) <= glue) joined.push({ e, i });
        });
      }
      const on = !joined.some(({ e, i }) => e.selected || !!picks.get(e.id)?.has(i));
      const next = new Map(picks);
      const unwhole = new Set<string>();
      for (const { e, i } of joined) {
        // Unpicking a vertex of a shape picked whole keeps its other vertices.
        let set = new Set(next.get(e.id) ?? []);
        if (e.selected) {
          unwhole.add(e.id);
          set = new Set(editPoints(e).map((_, k) => k));
        }
        if (on) set.add(i);
        else set.delete(i);
        next.set(e.id, set);
      }
      setPicks(next);
      if (unwhole.size) setWhole(unwhole, false);
      return true;
    },
    [entities, picks, zoom, setWhole],
  );

  /** Window selection: vertices inside the box are picked; a shape wholly
   *  inside it is picked whole. */
  const boxSelect = useCallback(
    (a: Point2D, b: Point2D) => {
      const x0 = Math.min(a.x, b.x),
        x1 = Math.max(a.x, b.x),
        y0 = Math.min(a.y, b.y),
        y1 = Math.max(a.y, b.y);
      const inside = (q: Point2D) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
      const next = new Map(picks);
      const all = new Set<string>();
      for (const e of entities) {
        if (e.autoDomain || e.selected || !e.pts.length) continue;
        if (e.layer === 'construction' && e.type !== 'point') continue;
        if (e.type === 'circle' || e.type === 'ellipse') {
          // A circle or ellipse counts when its whole extent is inside.
          const c = e.pts[0];
          const r =
            e.type === 'circle'
              ? (e.radius ?? Math.hypot(e.pts[1].x - c.x, e.pts[1].y - c.y))
              : Math.max(e.rx ?? 0, e.ry ?? 0);
          if (inside({ x: c.x - r, y: c.y - r }) && inside({ x: c.x + r, y: c.y + r }))
            all.add(e.id);
          continue;
        }
        const grips = editPoints(e);
        const hits = grips.map((q, i) => (inside(q) ? i : -1)).filter((i) => i >= 0);
        if (hits.length === grips.length) {
          all.add(e.id);
          next.delete(e.id);
        } else if (hits.length && pointwise(e)) {
          next.set(e.id, new Set([...(next.get(e.id) ?? []), ...hits]));
        }
      }
      setPicks(next);
      if (all.size) setWhole(all, true);
    },
    [entities, picks, setWhole],
  );

  const clearSelection = useCallback(() => {
    setPicks(new Map());
    dispatch({ type: 'SELECT_ENTITY', id: null });
  }, [dispatch]);

  // ── Canvas input ──────────────────────────────────────────────────────────
  const gizmoKind: GizmoKind | null =
    tool === 'move' ? 'move' : tool === 'scale' ? 'scale' : tool === 'rotate' ? 'rotate' : null;
  /** Where the handles sit: the selection's centre (following a move), or
   *  the base point of a scale or rotation. */
  const gizmoAt: Point2D | null =
    !active || !hasSel || !gizmoKind
      ? null
      : tool === 'move'
        ? center && { x: center.x + xf.dx, y: center.y + xf.dy }
        : pivot;
  const pickingPoint = xf.pick !== 'objects';

  const drag = useRef<{ h: GizmoHandle; m0: Point2D; v0: XformState } | null>(null);
  const box = useRef<{ s: Point2D; w: Point2D; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  /** Left button down on the canvas. True when the command took it. */
  const pointerDown = useCallback(
    (e: React.MouseEvent): boolean => {
      if (!active || e.button !== 0 || e.altKey || pickingPoint) return false;
      const raw = toWorld(e.clientX, e.clientY);
      const m = screenOf(e);
      if (gizmoAt && gizmoKind) {
        const h = hitGizmo(gizmoKind, toScreen(gizmoAt.x, gizmoAt.y), m);
        if (h) {
          drag.current = { h, m0: raw, v0: xf };
          e.preventDefault();
          return true;
        }
      }
      box.current = { s: m, w: raw, moved: false };
      return true;
    },
    [active, pickingPoint, toWorld, toScreen, gizmoAt, gizmoKind, xf],
  );

  /** Mouse move. True when a handle drag or a box owns it. */
  const pointerMove = useCallback(
    (e: React.MouseEvent): boolean => {
      if (!active) return false;
      const raw = toWorld(e.clientX, e.clientY);
      const d = drag.current;
      if (d) {
        const armW = GIZMO.arm / zoom;
        const ddx = raw.x - d.m0.x,
          ddy = raw.y - d.m0.y;
        const v = d.v0;
        if (tool === 'move') {
          setXf({
            ...v,
            dx: d.h === 'y' ? v.dx : r4(v.dx + ddx),
            dy: d.h === 'x' ? v.dy : r4(v.dy + ddy),
          });
        } else if (tool === 'scale') {
          const f = (s0: number, t: number) => r4(Math.max(0.01, s0 * (1 + t / armW)));
          if (d.h === 'xy' || v.uniform) {
            const t = d.h === 'x' ? ddx : d.h === 'y' ? ddy : (ddx + ddy) / 2;
            setXf({ ...v, sx: f(v.sx, t), sy: f(v.sy, t) });
          } else if (d.h === 'x') setXf({ ...v, sx: f(v.sx, ddx) });
          else setXf({ ...v, sy: f(v.sy, ddy) });
        } else if (tool === 'rotate' && pivot) {
          const a = (q: Point2D) => Math.atan2(q.y - pivot.y, q.x - pivot.x);
          let deg = v.angle + ((a(raw) - a(d.m0)) * 180) / Math.PI;
          deg = ((((deg + 180) % 360) + 360) % 360) - 180;
          setXf({
            ...v,
            angle: e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10,
          });
        }
        return true;
      }
      const b = box.current;
      if (b) {
        const m = screenOf(e);
        if (b.moved || Math.hypot(m.x - b.s.x, m.y - b.s.y) > 4) {
          b.moved = true;
          setMarquee({ x: b.s.x, y: b.s.y, w: m.x - b.s.x, h: m.y - b.s.y });
        }
        return true;
      }
      if (gizmoAt && gizmoKind && !pickingPoint) {
        const h = hitGizmo(gizmoKind, toScreen(gizmoAt.x, gizmoAt.y), screenOf(e));
        if (h !== hot) setHot(h);
      } else if (hot) setHot(null);
      return false;
    },
    [
      active,
      toWorld,
      toScreen,
      zoom,
      tool,
      pivot,
      gizmoAt,
      gizmoKind,
      pickingPoint,
      hot,
      setMarquee,
    ],
  );

  /** Mouse up: ends a handle drag or resolves the box. */
  const pointerUp = useCallback(
    (e: React.MouseEvent): boolean => {
      if (drag.current) {
        drag.current = null;
        suppressClick.current = true;
        return true;
      }
      const b = box.current;
      if (b) {
        box.current = null;
        setMarquee(null);
        if (b.moved) {
          boxSelect(b.w, toWorld(e.clientX, e.clientY));
          suppressClick.current = true;
        }
        return true;
      }
      return false;
    },
    [boxSelect, toWorld, setMarquee],
  );

  /** A canvas click: picks a point when a point field is active, otherwise
   *  toggles the vertex or shape under the cursor. */
  const onPick = useCallback(
    (pt: Point2D, raw: Point2D, hitId: string | null) => {
      if (!active) return;
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      switch (xf.pick) {
        case 'base':
          setXf((s) => ({ ...s, base: pt, pick: tool === 'move' ? 'target' : 'objects' }));
          return;
        case 'target':
          if (xf.base) {
            const b = xf.base;
            setXf((s) => ({ ...s, dx: r4(pt.x - b.x), dy: r4(pt.y - b.y), pick: 'objects' }));
          }
          return;
        case 'm1':
          setXf((s) => ({ ...s, m1: pt, m2: null, pick: 'm2' }));
          return;
        case 'm2':
          setXf((s) => ({ ...s, m2: pt, pick: 'objects' }));
          return;
      }
      if (toggleVertex(raw)) return;
      if (hitId) {
        const ent = entities.find((e) => e.id === hitId);
        if (!ent || ent.autoDomain) return;
        const next = new Map(picks);
        next.delete(hitId);
        setPicks(next);
        setWhole(new Set([hitId]), !ent.selected);
      }
    },
    [active, xf, tool, toggleVertex, entities, picks, setWhole],
  );

  /** OK / Enter: apply to the selection (or to copies of the shapes). */
  const commit = useCallback(() => {
    if (!isTransformTool(tool)) return;
    const m = affine(null);
    if (!m) {
      setCmdText(hasSel ? 'Nothing to apply yet.' : 'Select shapes or vertices first.');
      return;
    }
    const partIdx = new Map(parts.map(({ e, idxs }) => [e.id, idxs] as const));
    // Copies are of whole shapes; picked vertices always move.
    const copy = xf.copy && !parts.length;
    const out = copy
      ? [
          ...entities.map((e) => ({ ...e, selected: false })),
          ...whole.map((e) => ({ ...transformEntity(e, m), id: uid(), selected: true })),
        ]
      : entities.map((e) =>
          e.selected && !e.autoDomain
            ? transformEntity(e, m)
            : partIdx.has(e.id)
              ? transformVertices(e, partIdx.get(e.id)!, m)
              : e,
        );
    dispatch({ type: 'REPLACE_ENTITIES', entities: out });
    const what = [
      count.shapes ? `${count.shapes} shape${count.shapes > 1 ? 's' : ''}` : '',
      count.points ? `${count.points} point${count.points > 1 ? 's' : ''}` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    setCmdText(`${VERB[tool]} ${what}.`);
    setPicks(new Map());
    setTool('select');
  }, [
    tool,
    affine,
    hasSel,
    parts,
    whole,
    entities,
    xf.copy,
    count.shapes,
    count.points,
    dispatch,
    setCmdText,
    setTool,
  ]);

  const cancel = useCallback(() => setTool('select'), [setTool]);

  /** Where Ortho and Angle measure from while the next point is picked. */
  const anchor: Point2D | null = xf.pick === 'target' ? xf.base : xf.pick === 'm2' ? xf.m1 : null;

  return {
    xf,
    setXf,
    count,
    hasSel,
    partial: parts.length > 0,
    pivot,
    active,
    preview,
    onPick,
    commit,
    cancel,
    anchor,
    pickedPts,
    clearSelection,
    pointerDown,
    pointerMove,
    pointerUp,
    pickingPoint,
    gizmo: gizmoAt && gizmoKind ? { at: gizmoAt, kind: gizmoKind, hot } : null,
  };
}

export type TransformCommand = ReturnType<typeof useTransformCommand>;
