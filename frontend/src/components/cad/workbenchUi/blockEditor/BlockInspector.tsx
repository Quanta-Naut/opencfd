import { useMemo } from 'react';
import { Point2D, CadEntity } from '../../../../types/cadWorkflow';
import {
  Blocking,
  BlockEdge,
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
  if (edge) return <EdgeCard {...p} edge={edge} />;
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
  ['uniform', 'Uniform'],
  ['tanh', 'Spacing (tanh)'],
  ['geometric', 'Geometric ratio'],
  ['bump', 'Bump (both ends)'],
];

function EdgeCard(p: {
  blocking: Blocking;
  onUpdateBlocking: (bk: Blocking | null) => void;
  entities: CadEntity[];
  edge: BlockEdge;
  blockSpacingJumps: SpacingJump[];
}) {
  const { blocking, edge } = p;
  const set = (q: Parameters<typeof setEdgeParams>[2]) =>
    p.onUpdateBlocking(setEdgeParams(blocking, edge.id, q));
  const parallel = useMemo(() => edgeGroup(blocking, edge.id).length - 1, [blocking, edge.id]);
  // What the law actually gives: end cells and the worst growth between cells.
  const actual = useMemo(() => {
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
    set({ law: 'tanh', [end]: Number(target.toPrecision(3)) });
  };
  const curveNames = (edge.curves ?? [])
    .map((id) => p.entities.find((x) => x.id === id))
    .map((ent) =>
      ent ? `${ent.type}${ent.role === 'domain_boundary' ? ' (domain)' : ''}` : 'missing',
    )
    .join(', ');
  return (
    <div className={`${card} p-2 space-y-2 w-[268px]`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Edge</span>
        <span className="text-fg-2">
          {edge.patch ?? 'interior'} · {fmtLen(actual.L)} long
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Labeled
          label={`Nodes${parallel ? ` (+${parallel} parallel)` : ''}`}
          hint="A structured grid needs the same count on every parallel edge, so this sets them all."
        >
          <Field value={edge.nodes} integer min={2} onCommit={(v) => v && set({ nodes: v })} />
        </Labeled>
        <Labeled label="Law">
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
        {edge.law === 'tanh' && (
          <>
            <Labeled label="Spacing 1" hint="First cell at the arrow's tail (end 1). Empty = free.">
              <Field
                value={edge.spacing1}
                optional
                min={0}
                placeholder="free"
                onCommit={(v) => set({ spacing1: v ?? 0 })}
              />
            </Labeled>
            <Labeled label="Spacing 2" hint="First cell at the arrow's head (end 2). Empty = free.">
              <Field
                value={edge.spacing2}
                optional
                min={0}
                placeholder="free"
                onCommit={(v) => set({ spacing2: v ?? 0 })}
              />
            </Labeled>
          </>
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
        <span>1: {fmtLen(actual.first)}</span>
        <span>2: {fmtLen(actual.last)}</span>
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
            Cells jump {jump.ratio.toFixed(1)}x into the next edge at end{' '}
            {edge.v0 === jump.vid ? 1 : 2}.
          </span>
          <button className={smallBtn} onClick={matchJump}>
            Match
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          className={smallBtn}
          title="Copy this distribution to every parallel edge, keeping the fine end on the same side"
          onClick={() =>
            set({
              law: edge.law,
              ratio: edge.ratio,
              spacing1: edge.spacing1 ?? 0,
              spacing2: edge.spacing2 ?? 0,
              copyParallel: true,
            })
          }
        >
          Copy to parallel
        </button>
        <button
          className={smallBtn}
          title="Swap the two ends' spacings"
          onClick={() =>
            set({
              ratio: edge.ratio ? 1 / edge.ratio : 1,
              spacing1: edge.spacing2 ?? 0,
              spacing2: edge.spacing1 ?? 0,
            })
          }
        >
          Flip
        </button>
        {edge.curves?.length ? (
          <button
            className={smallBtn}
            onClick={() => p.onUpdateBlocking(disassociateEdges(blocking, [edge.id]))}
          >
            Disassociate
          </button>
        ) : null}
      </div>
      <p className="text-[10px] text-fg-2">
        {edge.curves?.length ? (
          <span className="text-success">Follows {curveNames}</span>
        ) : edge.curveId ? (
          'Follows the outline under it'
        ) : (
          'Straight (not associated)'
        )}
      </p>
    </div>
  );
}
