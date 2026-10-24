import { useMemo } from 'react';
import { Point2D, CadEntity } from '../../../../types/cadWorkflow';
import {
  Blocking,
  BlockPremesh,
  EdgeLaw,
  SpacingJump,
  VertexKind,
  disassociateEdges,
  edgeGroup,
  edgeStations,
  endCells,
  setEdgeParams,
  PREMESH_MIN_ANGLE,
  PREMESH_MIN_DET,
} from '../../../../types/blocking';
import { VERTEX_COLORS } from '../../workbenchDraw/blocking';
import { card, Field, fmtLen, Labeled, smallBtn } from './shared';

const KIND_TEXT: Record<VertexKind, [string, string]> = {
  pinned: ['Fixed', 'Sits on a geometry corner or a patch change and stays there.'],
  slide: ['On curve', 'Slides along the curve under it. Alt-drag detaches it.'],
  free: ['Free', 'Moves anywhere. Keep it away from walls.'],
};

/** Right-hand card: parameters of whatever is selected (ICEM's Edge Params,
 *  Move Vertices > Set Location, and a block's size and quality). */
export function BlockInspector(p: {
  blocking: Blocking;
  onUpdateBlocking: (bk: Blocking | null) => void;
  entities: CadEntity[];
  selectedEdgeId: string | null;
  selectedVertexId: string | null;
  selectedBlockId: string | null;
  blockVertexKinds: Map<string, VertexKind>;
  blockPremesh: BlockPremesh[];
  blockSpacingJumps: SpacingJump[];
  setVertexLocation: (vid: string, pt: Point2D) => void;
  deleteBlockById: (id: string) => void;
  ogridThis: (blockId: string) => void;
}) {
  const { blocking } = p;
  const edge = p.selectedEdgeId ? blocking.edges.find((e) => e.id === p.selectedEdgeId) : undefined;
  const vertex = p.selectedVertexId
    ? blocking.vertices.find((v) => v.id === p.selectedVertexId)
    : undefined;
  const blockIdx = p.selectedBlockId
    ? blocking.blocks.findIndex((b) => b.id === p.selectedBlockId)
    : -1;
  if (edge) return <EdgeParams {...p} edgeIds={[edge.id]} />;
  if (vertex) {
    const kind = p.blockVertexKinds.get(vertex.id) ?? 'free';
    const [name, desc] = KIND_TEXT[kind];
    const fixed = kind === 'pinned';
    return (
      <div className={`${card} p-2 space-y-2 w-[268px]`}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Vertex</span>
          <span className="flex items-center gap-1.5 text-fg-2">
            <span className="w-2 h-2 rounded-full" style={{ background: VERTEX_COLORS[kind] }} />
            {name}
          </span>
        </div>
        <p className="text-[10px] text-fg-2 leading-snug">{desc}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(['x', 'y'] as const).map((k) => (
            <Labeled key={k} label={k.toUpperCase()}>
              <Field
                value={Number(vertex.pt[k].toPrecision(6))}
                disabled={fixed}
                onCommit={(v) =>
                  v !== undefined && p.setVertexLocation(vertex.id, { ...vertex.pt, [k]: v })
                }
              />
            </Labeled>
          ))}
        </div>
        {vertex.curves?.length ? (
          <button
            className={smallBtn}
            onClick={() =>
              p.onUpdateBlocking({
                ...blocking,
                vertices: blocking.vertices.map((v) =>
                  v.id === vertex.id ? { ...v, curves: undefined } : v,
                ),
              })
            }
          >
            Detach from curve
          </button>
        ) : null}
      </div>
    );
  }
  if (blockIdx >= 0) {
    const blk = blocking.blocks[blockIdx];
    const pm = p.blockPremesh.find((b) => b.blockId === blk.id);
    const em = new Map(blocking.edges.map((e) => [e.id, e] as const));
    const ni = (em.get(blk.edges[0])?.nodes ?? 2) - 1;
    const nj = (em.get(blk.edges[1])?.nodes ?? 2) - 1;
    return (
      <div className={`${card} p-2 space-y-2 w-[268px]`}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Block {blockIdx + 1}</span>
          <span className="font-mono text-fg-2">
            {ni} x {nj} cells
          </span>
        </div>
        {pm && (
          <div className="grid grid-cols-2 gap-1.5 font-mono">
            <Metric label="Min determinant" v={pm.minDet} ok={pm.minDet >= PREMESH_MIN_DET} />
            <Metric
              label="Min angle"
              v={pm.minAngle}
              unit="deg"
              ok={pm.minAngle >= PREMESH_MIN_ANGLE}
            />
          </div>
        )}
        <div className="flex gap-1.5">
          <button className={smallBtn} onClick={() => p.ogridThis(blk.id)}>
            O-grid it
          </button>
          <button
            className={`${smallBtn} hover:text-danger`}
            onClick={() => p.deleteBlockById(blk.id)}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }
  return null;
}

function Metric(p: { label: string; v: number; ok: boolean; unit?: string }) {
  return (
    <div className="p-1.5 rounded-sm border border-line bg-app">
      <span className="text-[10px] text-fg-2 block font-sans">{p.label}</span>
      <span className={`font-semibold ${p.ok ? 'text-fg' : 'text-danger'}`}>
        {p.unit ? p.v.toFixed(1) : p.v.toFixed(2)}
        {p.unit ? ` ${p.unit}` : ''}
      </span>
    </div>
  );
}

const LAWS: [EdgeLaw, string][] = [
  ['bigeometric', 'BiGeometric'],
  ['tanh', 'Hyperbolic (tanh)'],
  ['uniform', 'Uniform'],
  ['geometric', 'Geometric'],
  ['bump', 'Bump'],
];

/** ICEM "Edge Params" for one or more edges: the first is shown, every
 *  change applies to all of them (and their parallels when `copyParallel`). */
export function EdgeParams(p: {
  blocking: Blocking;
  onUpdateBlocking: (bk: Blocking | null) => void;
  entities: CadEntity[];
  edgeIds: string[];
  blockSpacingJumps: SpacingJump[];
  /** When given, a checkbox replaces the Copy to parallel button. */
  copyParallel?: { on: boolean; set: (v: boolean) => void };
  bare?: boolean;
  /** Edit the edge's whole parallel group (always copies, no copy controls). */
  group?: boolean;
}) {
  const { blocking } = p;
  const edge = blocking.edges.find((e) => e.id === p.edgeIds[0]);
  const parallel = useMemo(
    () => (edge ? edgeGroup(blocking, edge.id).length - 1 : 0),
    [blocking, edge],
  );
  // What the law actually gives: end cells and the worst growth between cells.
  const actual = useMemo(() => {
    if (!edge) return null;
    const vm = new Map(blocking.vertices.map((v) => [v.id, v.pt] as const));
    const pts = [vm.get(edge.v0)!, ...edge.path, vm.get(edge.v1)!];
    let L = 0;
    for (let i = 1; i < pts.length; i++)
      L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const st = edgeStations(blocking, edge, Infinity, vm);
    let growth = 1;
    for (let k = 2; k < st.length; k++) {
      const a = st[k - 1] - st[k - 2];
      const b = st[k] - st[k - 1];
      if (a > 0 && b > 0) growth = Math.max(growth, b / a, a / b);
    }
    const n = st.length - 1;
    return { L, first: (st[1] - st[0]) * L, last: (st[n] - st[n - 1]) * L, growth };
  }, [blocking, edge]);
  if (!edge || !actual) return null;
  const set = (q: Parameters<typeof setEdgeParams>[2]) => {
    let bk = blocking;
    for (const id of p.edgeIds)
      bk = setEdgeParams(bk, id, {
        ...q,
        copyParallel: p.group || (q.copyParallel ?? p.copyParallel?.on),
      });
    p.onUpdateBlocking(bk);
  };
  // A cell-size jump at one of this edge's ends (Pointwise "Sync Spacings").
  const jump = p.blockSpacingJumps.find(
    (j) => j.coarse === edge.id && (j.vid === edge.v0 || j.vid === edge.v1),
  );
  const matchJump = () => {
    if (!jump) return;
    const fine = blocking.edges.find((e) => e.id === jump.fine);
    if (!fine) return;
    const cells = endCells(blocking).get(fine.id)!;
    const target = fine.v0 === jump.vid ? cells.at0 : cells.at1;
    const end = edge.v0 === jump.vid ? 'spacing1' : 'spacing2';
    set({
      law: edge.law === 'tanh' ? 'tanh' : 'bigeometric',
      [end]: Number(target.toPrecision(3)),
    });
  };
  const spaced = edge.law === 'tanh' || edge.law === 'bigeometric';
  const curveNames = (edge.curves ?? [])
    .map((id) => p.entities.find((x) => x.id === id))
    .map((ent) =>
      ent ? `${ent.type}${ent.role === 'domain_boundary' ? ' (domain)' : ''}` : 'missing',
    )
    .join(', ');
  const spacingField = (k: 'spacing1' | 'spacing2', label: string) => (
    <Labeled label={label} hint="First cell length at this end of the arrow. Empty leaves it free.">
      <Field
        value={edge[k]}
        optional
        min={0}
        placeholder="free"
        onCommit={(v) => set({ [k]: v ?? 0 })}
      />
    </Labeled>
  );
  const ratioField = (k: 'ratio1' | 'ratio2', label: string) => (
    <Labeled
      label={label}
      hint="Growth from one cell to the next away from this end. 1.1 to 1.3 is usual."
    >
      <Field value={edge[k] ?? 1.2} min={1} onCommit={(v) => v && set({ [k]: v })} />
    </Labeled>
  );
  return (
    <div className={p.bare ? 'space-y-2' : `${card} p-2 space-y-2 w-[268px]`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">
          {p.edgeIds.length > 1 ? `${p.edgeIds.length} edges` : 'Edge'}
        </span>
        <span className="text-fg-2">
          {edge.patch ?? 'interior'} · {fmtLen(actual.L)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Labeled
          label={`Nodes${parallel ? ` (+${parallel} parallel)` : ''}`}
          hint="A structured grid needs the same count on every parallel edge, so this sets them all."
        >
          <Field value={edge.nodes} integer min={2} onCommit={(v) => v && set({ nodes: v })} />
        </Labeled>
        <Labeled label="Mesh law">
          <select
            value={edge.law}
            onChange={(ev) => set({ law: ev.target.value as EdgeLaw })}
            className="w-full px-1 py-1 bg-app border border-line rounded-sm text-[11px] text-fg focus:outline-none focus:border-accent"
          >
            {LAWS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Labeled>
        {spaced && (
          <>
            {spacingField('spacing1', 'Spacing 1')}
            {edge.law === 'bigeometric' ? ratioField('ratio1', 'Ratio 1') : <span />}
            {spacingField('spacing2', 'Spacing 2')}
            {edge.law === 'bigeometric' ? ratioField('ratio2', 'Ratio 2') : <span />}
          </>
        )}
        {edge.law === 'bigeometric' && (
          <Labeled label="Max space" hint="Largest cell allowed. Empty = no limit.">
            <Field
              value={edge.maxSpace}
              optional
              min={0}
              placeholder="none"
              onCommit={(v) => set({ maxSpace: v ?? 0 })}
            />
          </Labeled>
        )}
        {(edge.law === 'geometric' || edge.law === 'bump') && (
          <Labeled
            label={edge.law === 'bump' ? 'End / middle ratio' : 'Last / first cell'}
            hint="Above 1 clusters toward end 1."
          >
            <Field value={edge.ratio} min={0.01} onCommit={(v) => v && set({ ratio: v })} />
          </Labeled>
        )}
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] text-fg-2 bg-app border border-line rounded-sm px-1.5 py-1">
        <span title="Actual first cell at end 1">1: {fmtLen(actual.first)}</span>
        <span title="Actual first cell at end 2">2: {fmtLen(actual.last)}</span>
        <span
          className={actual.growth > 1.3 ? 'text-warning' : ''}
          title="Largest size change between neighbouring cells. Keep it under about 1.2 to 1.3."
        >
          growth {actual.growth.toFixed(2)}
        </span>
      </div>
      {jump && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-warning">
          <span>
            {jump.ratio.toFixed(1)}x jump at end {edge.v0 === jump.vid ? 1 : 2}
          </span>
          <button className={smallBtn} onClick={matchJump}>
            Match
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {p.group ? null : p.copyParallel ? (
          <label className="flex items-center gap-1.5 text-fg-2 mr-auto">
            <input
              type="checkbox"
              checked={p.copyParallel.on}
              onChange={(ev) => p.copyParallel!.set(ev.target.checked)}
              className="accent-accent"
            />
            Copy to parallel edges
          </label>
        ) : (
          <button
            className={smallBtn}
            title="Copy this distribution to every parallel edge, keeping the fine end on the same side"
            onClick={() =>
              set({
                law: edge.law,
                ratio: edge.ratio,
                spacing1: edge.spacing1 ?? 0,
                spacing2: edge.spacing2 ?? 0,
                ratio1: edge.ratio1 ?? 0,
                ratio2: edge.ratio2 ?? 0,
                maxSpace: edge.maxSpace ?? 0,
                copyParallel: true,
              })
            }
          >
            Copy to parallel
          </button>
        )}
        <button
          className={smallBtn}
          title="Swap the two ends"
          onClick={() =>
            set({
              ratio: edge.ratio ? 1 / edge.ratio : 1,
              spacing1: edge.spacing2 ?? 0,
              spacing2: edge.spacing1 ?? 0,
              ratio1: edge.ratio2 ?? 0,
              ratio2: edge.ratio1 ?? 0,
            })
          }
        >
          Flip
        </button>
        {!p.bare && edge.curves?.length ? (
          <button
            className={smallBtn}
            onClick={() => p.onUpdateBlocking(disassociateEdges(blocking, [edge.id]))}
          >
            Disassociate
          </button>
        ) : null}
      </div>
      {!p.bare && (
        <p className="text-[10px] text-fg-2">
          {edge.curves?.length ? (
            <span className="text-success">On {curveNames}</span>
          ) : edge.curveId ? (
            'On the outline under it'
          ) : (
            'Straight'
          )}
        </p>
      )}
    </div>
  );
}
