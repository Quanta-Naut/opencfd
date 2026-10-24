import { BoundaryTag, CadEntity, Point2D } from '../cadWorkflow';
import { Block, BlockEdge, BlockVertex, Blocking, EdgeLaw } from './types';
import { boundsOf, centroidOf, signedArea, uid } from './geometry';
import { blockPolygon, orderBlockEdges } from './blockEdit';
import { Outline, outlinesFor, projectOnRing, traceAlong } from './editor';
import { outlineBreaks } from './vertexHome';
import { propagateNodeCounts } from './sizing';

// Block topology templates, the way ICEM CFD users block a single body: a
// thin layer of blocks hugging the wall (so grid lines leave it at right
// angles), then blocks out to the far field whose corners land on the domain
// corners. They only set up the topology and a first placement; the shape
// optimizer (optimize.ts) then moves the vertices and bends the edges.
//
//   C-grid in a box (sharp trailing edge)        O-grid in a box (blunt body)
//
//   A ------- B ------------- C                  corner ------------ corner
//   |  top    |   wake top    |                    | \     outer    / |
//   |  QU --- QB ----------- QD+                   |   o -------- o   |
//   | / front \ upper | wake up |                  |   | \ near / |   |
//   ||  ( airfoil )  TE ------ D                   |   |  (body)  |   |
//   | \       / lower | wake lo |                  |   | /      \ |   |
//   |  QL --- QF ----------- QD-                   |   o -------- o   |
//   |  bottom |   wake bottom |                    | /              \ |
//   G ------- F ------------- E                  corner ------------ corner

export interface TemplateOptions {
  /** Patch for the body's wall edges. */
  patch?: BoundaryTag;
  /** Patch lookup for domain edges (the user's tags). */
  tag?: (a: Point2D, b: Point2D) => BoundaryTag | undefined;
  /** First cell height at the wall (drawing units), e.g. from the y+ target.
   *  Defaults to a thousandth of the body size. */
  firstCellHeight?: number;
  /** Growth rate of the wall-normal layers (cell to cell). */
  growth?: number;
}

let failure = '';
/** Why the last template call returned null (for the UI). */
export const templateFailure = () => failure;
const fail = (why: string): null => {
  failure = why;
  return null;
};

const sub = (a: Point2D, b: Point2D) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point2D, b: Point2D, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s });
const norm = (a: Point2D) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const dist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);
const polyLen = (pts: Point2D[]) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0);

/** First hit of the ray o + t*dir (t > 0) on a closed ring. */
function rayHit(ring: Point2D[], o: Point2D, dir: Point2D): Point2D | null {
  let best: { t: number; p: Point2D } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-14) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * dir.y - (a.y - o.y) * dir.x) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t < best.t))
      best = { t, p: { x: o.x + t * dir.x, y: o.y + t * dir.y } };
  }
  return best?.p ?? null;
}

/** Arc-length position of p along a closed ring (p assumed on it). */
function arcPos(ring: Point2D[], p: Point2D): number {
  const pr = projectOnRing(ring, p);
  let s = 0;
  for (let i = 0; i < pr.seg; i++) s += dist(ring[i], ring[(i + 1) % ring.length]);
  return s + pr.t * dist(ring[pr.seg], ring[(pr.seg + 1) % ring.length]);
}

/** Geometric growth ratio (last/first) for n cells of first size h over length L. */
function growthRatio(L: number, n: number, h: number): number {
  if (n <= 1 || h <= 0) return 1;
  if (Math.abs(L - n * h) < 1e-12 * L) return 1;
  const total = (g: number) => (Math.abs(g - 1) < 1e-9 ? n * h : (h * (g ** n - 1)) / (g - 1));
  let lo = L > n * h ? 1 : 0.2,
    hi = L > n * h ? 3 : 1;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > L) hi = mid;
    else lo = mid;
  }
  return ((lo + hi) / 2) ** (n - 1);
}

/** Geometric spacing from h0 to h1 over length L: cell count and ratio (last/first). */
function gradeBetween(L: number, h0: number, h1: number): { cells: number; ratio: number } {
  const R = h1 / h0;
  let best = { cells: 2, err: Infinity };
  for (let n = 2; n <= 400; n++) {
    const q = R ** (1 / (n - 1));
    const total = Math.abs(q - 1) < 1e-9 ? n * h0 : (h0 * (q ** n - 1)) / (q - 1);
    const err = Math.abs(total - L);
    if (err < best.err) best = { cells: n, err };
  }
  return { cells: best.cells, ratio: R };
}

/** First cell and layer count for a wall-normal layer of thickness d. */
function wallLayers(opts: TemplateOptions, d: number, size: number): { y1: number; nRad: number } {
  const h = opts.firstCellHeight;
  const y1 = h && h > 0 ? Math.min(h, d / 20) : 1e-3 * size;
  const g = Math.min(1.3, Math.max(1.05, opts.growth ?? 1.2));
  return { y1, nRad: Math.max(15, Math.min(150, cellsFor(d, y1, g))) };
}

/** Cells needed to cover L starting at size h and growing by at most g per cell. */
function cellsFor(L: number, h: number, g: number): number {
  if (h >= L) return 2;
  return Math.ceil(Math.log(1 + (L * (g - 1)) / h) / Math.log(g));
}

/** Offset a polyline outward (away from `inside`) by d, then smooth it. */
function offsetCurve(pts: Point2D[], d: number, inside: (p: Point2D) => boolean): Point2D[] {
  const normal = (i: number) => {
    const t = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    return { x: -t.y, y: t.x };
  };
  // Which side is outside, decided once at the middle of a segment (testing at
  // a sharp corner is ambiguous: the probe lands on the next side's line).
  const k = Math.floor((pts.length - 2) / 2);
  const m = { x: (pts[k].x + pts[k + 1].x) / 2, y: (pts[k].y + pts[k + 1].y) / 2 };
  const t = norm(sub(pts[k + 1], pts[k]));
  const sgn = inside(add(m, { x: -t.y, y: t.x }, 1e-3 * polyLen(pts))) ? -1 : 1;
  const out = pts.map((p, i) => add(p, normal(i), sgn * d));
  for (let pass = 0; pass < 6; pass++)
    for (let i = 1; i + 1 < out.length; i++)
      out[i] = {
        x: (out[i - 1].x + 2 * out[i].x + out[i + 1].x) / 4,
        y: (out[i - 1].y + 2 * out[i].y + out[i + 1].y) / 4,
      };
  return out;
}

function pointInRing(p: Point2D, ring: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Small builder: named vertices and edges, blocks by edge names. */
class Topology {
  private verts = new Map<string, BlockVertex>();
  private edges = new Map<string, BlockEdge>();
  private blocks: string[][] = [];

  v(name: string, pt: Point2D) {
    this.verts.set(name, { id: uid(), pt: { x: pt.x, y: pt.y } });
  }

  pt(name: string) {
    return this.verts.get(name)!.pt;
  }

  /** Edge a -> b: along an outline (traced), through `mid` points, or straight. */
  e(
    name: string,
    a: string,
    b: string,
    o: {
      along?: Outline;
      hint?: Point2D;
      mid?: Point2D[];
      patch?: BoundaryTag;
      nodes?: number;
      law?: EdgeLaw;
      ratio?: number;
    } = {},
  ): boolean {
    const pa = this.pt(a),
      pb = this.pt(b);
    let path: Point2D[] = o.mid ? o.mid.map((p) => ({ ...p })) : [];
    if (o.along) {
      const tr = traceAlong(o.along.pts, pa, pb, o.hint);
      if (!tr) return false;
      path = tr;
    }
    this.edges.set(name, {
      id: uid(),
      v0: this.verts.get(a)!.id,
      v1: this.verts.get(b)!.id,
      path,
      patch: o.patch,
      nodes: o.nodes ?? 20,
      law: o.law ?? 'uniform',
      ratio: o.ratio ?? 1,
      curveId: o.along?.entityId,
    });
    return true;
  }

  edge(name: string) {
    return this.edges.get(name)!;
  }

  /** Length of a named edge along its path. */
  len(name: string) {
    const e = this.edges.get(name)!;
    const at = (id: string) => [...this.verts.values()].find((v) => v.id === id)!.pt;
    return polyLen([at(e.v0), ...e.path, at(e.v1)]);
  }

  /** Set a graded edge's count and grow it from first cell h. */
  grade(name: string, cells: number, h: number) {
    this.gradeAll([name], cells, growthRatio(this.len(name), cells, h));
  }

  /** One count and one ratio for a set of parallel edges, so the layers line
   *  up across every block they bound (ICEM's "copy to parallel edges"):
   *  different ratios on opposite sides shear the grid and fold thin cells. */
  gradeAll(names: readonly string[], cells: number, ratio: number) {
    for (const n of names)
      Object.assign(this.edges.get(n)!, { nodes: cells + 1, law: 'geometric' as EdgeLaw, ratio });
  }

  block(...edgeNames: string[]) {
    this.blocks.push(edgeNames);
  }

  /** Assemble and validate: every block a simple quad, blocks tiling the fluid. */
  build(fluidArea: number): Blocking | null {
    const scratch: Blocking = {
      vertices: [...this.verts.values()],
      edges: [...this.edges.values()],
      blocks: [],
    };
    const blocks: Block[] = [];
    for (const names of this.blocks) {
      const ord = orderBlockEdges(
        scratch,
        names.map((n) => this.edges.get(n)!.id),
      );
      if (!ord) return fail(`Block ${names.join('/')} does not close.`);
      blocks.push({ id: uid(), edges: ord });
    }
    const bk: Blocking = { ...scratch, blocks, links: [] };
    let area = 0;
    for (const blk of blocks) {
      const poly = blockPolygon(bk, blk);
      if (poly.length < 4 || selfIntersects(poly)) return fail('A block came out twisted.');
      area += Math.abs(signedArea(poly));
    }
    // Blocks that overlap or leave gaps do not add up to the fluid area.
    if (Math.abs(area - fluidArea) > 0.01 * fluidArea)
      return fail(
        `The blocks cover ${((100 * area) / fluidArea).toFixed(1)}% of the fluid, not 100%.`,
      );
    return propagateNodeCounts(bk);
  }
}

function selfIntersects(poly: Point2D[]): boolean {
  const n = poly.length;
  const o = (p: Point2D, q: Point2D, r: Point2D) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = poly[j],
        d = poly[(j + 1) % n];
      if (o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0) return true;
    }
  }
  return false;
}

/** Domain corner nearest the extreme in direction `dir`, else a ray hit from `from`. */
function farCorner(dom: Outline, corners: Point2D[], from: Point2D, dir: Point2D): Point2D | null {
  const hit = rayHit(dom.pts, from, dir);
  if (!hit) return null;
  let best: Point2D | null = null,
    bs = -Infinity;
  for (const c of corners) {
    const s = (c.x - from.x) * dir.x + (c.y - from.y) * dir.y;
    // the corner must sit in the same quadrant as the ray and not too far off it
    const off = Math.abs((c.x - from.x) * dir.y - (c.y - from.y) * dir.x);
    if (s > 0 && off < 0.75 * s && s > bs) (bs = s), (best = c);
  }
  return best ? { ...best } : hit;
}

function domainPatch(o: TemplateOptions, path: Point2D[], centre: Point2D): BoundaryTag {
  const m = Math.floor((path.length - 1) / 2);
  const a = path[m],
    b = path[Math.min(path.length - 1, m + 1)];
  const t = o.tag?.(a, b);
  if (t) return t;
  // untagged: facing upstream is the inlet, downstream the outlet
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const out = norm(sub(mid, centre));
  if (out.x < -0.7) return 'inlet';
  if (out.x > 0.7) return 'outlet';
  return 'farfield';
}

function findOutlines(entities: CadEntity[], bodyId: string) {
  const outlines = outlinesFor(entities);
  const body = outlines.find((o) => o.body && o.entityId === bodyId);
  const dom = outlines.find((o) => !o.body);
  if (!body || !dom) return null;
  const others = outlines.filter((o) => o.body && o !== body);
  return { body, dom, others };
}

/**
 * ICEM-style C-grid around a sharp-trailing-edge airfoil in any closed domain:
 * a near-wall C layer (upper, nose, lower, two wake blocks) and an outer layer
 * out to the domain. 10 blocks, every interior vertex shared by four.
 */
export function cGridTemplate(
  entities: CadEntity[],
  bodyId: string,
  opts: TemplateOptions = {},
): Blocking | null {
  failure = '';
  const found = findOutlines(entities, bodyId);
  if (!found) return fail('Needs one closed body inside a closed domain.');
  if (found.others.length)
    return fail('This template blocks a single body; the domain has more than one.');
  const { body, dom } = found;
  const ring = body.pts;
  const n = ring.length;
  const breaks = outlineBreaks(ring);
  const c0 = centroidOf(ring);
  // Trailing edge: the sharp corner furthest from the centroid, else the
  // furthest point downstream.
  let iTE = breaks.length
    ? breaks.reduce((a, b) => (dist(ring[b], c0) > dist(ring[a], c0) ? b : a))
    : ring.reduce((a, p, i) => (p.x > ring[a].x ? i : a), 0);
  const TE = ring[iTE];
  const iLE = ring.reduce((a, p, i) => (dist(p, TE) > dist(ring[a], TE) ? i : a), 0);
  const LE = ring[iLE];
  const chord = dist(LE, TE);
  if (chord <= 0 || TE.x <= LE.x)
    return fail('Could not find a trailing edge downstream of the leading edge.');
  const bb = boundsOf(ring);
  if (bb.maxY - bb.minY > 0.5 * chord)
    return fail('The body is not slender enough for a C-grid; use the O-grid.');
  // Upper / lower surface split points at a fraction of the chord.
  const walk = (from: number, to: number, step: number) => {
    const out: number[] = [from];
    for (let i = from; i !== to; ) (i = (i + step + n) % n), out.push(i);
    return out;
  };
  const sideA = walk(iTE, iLE, 1),
    sideB = walk(iTE, iLE, -1);
  const cdir = norm(sub(TE, LE));
  const left = (i: number) => cdir.x * (ring[i].y - LE.y) - cdir.y * (ring[i].x - LE.x);
  const avg = (ids: number[]) => ids.reduce((s, i) => s + left(i), 0) / ids.length;
  const upper = avg(sideA) >= avg(sideB) ? sideA : sideB;
  const lower = upper === sideA ? sideB : sideA;
  const atChord = (ids: number[], f: number) => {
    let best = ids[0],
      bd = Infinity;
    for (const i of ids) {
      const x = (ring[i].x - LE.x) * cdir.x + (ring[i].y - LE.y) * cdir.y;
      if (Math.abs(x - f * chord) < bd) (bd = Math.abs(x - f * chord)), (best = i);
    }
    return best;
  };
  const iU = atChord(upper, 0.25),
    iL = atChord(lower, 0.25);
  const U = ring[iU],
    L = ring[iL];

  // Domain points.
  const up = { x: 0, y: 1 },
    down = { x: 0, y: -1 },
    aft = { x: 1, y: 0 };
  const D = rayHit(dom.pts, TE, aft),
    B = rayHit(dom.pts, TE, up),
    F = rayHit(dom.pts, TE, down);
  if (!D || !B || !F)
    return fail('The domain must surround the trailing edge above, below and downstream.');
  const corners = outlineBreaks(dom.pts).map((i) => dom.pts[i]);
  const mid = { x: (LE.x + TE.x) / 2, y: (LE.y + TE.y) / 2 };
  const A = farCorner(dom, corners, mid, norm({ x: -1, y: 1 }));
  const G = farCorner(dom, corners, mid, norm({ x: -1, y: -1 }));
  const C = farCorner(dom, corners, TE, norm({ x: 1, y: 1 }));
  const E = farCorner(dom, corners, TE, norm({ x: 1, y: -1 }));
  if (!A || !G || !C || !E) return fail('Could not place the far-field corners on the domain.');

  // Thickness of the near-wall layer: half a chord, less in a tight domain.
  let clearance = Infinity;
  for (const p of ring) clearance = Math.min(clearance, projectOnRing(dom.pts, p).d);
  const d = Math.min(0.5 * chord, 0.4 * clearance);
  if (!(d > 0.02 * chord)) return fail('The body is too close to the domain boundary.');
  const QB = add(TE, up, d),
    QF = add(TE, down, d);
  const QDp = rayHit(dom.pts, QB, aft),
    QDm = rayHit(dom.pts, QF, aft);
  if (!QDp || !QDm) return fail('The wake layer does not reach the outlet.');
  const inBody = (p: Point2D) => pointInRing(p, ring);
  // Front C arc: the nose offset by d, smoothed, split at the leading edge so
  // a grid line leaves the leading edge square to the wall.
  const noseIdx = walk(iU, iL, upper === sideA ? 1 : -1);
  const kLE = noseIdx.indexOf(iLE);
  if (kLE <= 0 || kLE >= noseIdx.length - 1)
    return fail('Could not find the leading edge between the surface split points.');
  const noseArc = offsetCurve(
    noseIdx.map((i) => ring[i]),
    d,
    inBody,
  );
  const QU = noseArc[0],
    QL = noseArc[noseArc.length - 1],
    QN = noseArc[kLE];
  const Nf = rayHit(dom.pts, QN, norm(sub(QN, LE)));
  if (!Nf) return fail('The domain must surround the leading edge upstream.');

  // The domain must run D -> C -> B -> A -> Nf -> G -> F -> E one way round.
  const order = [D, QDp, C, B, A, Nf, G, F, E, QDm].map((p) => arcPos(dom.pts, p));
  const L0 = polyLen([...dom.pts, dom.pts[0]]);
  const rel = order.map((s) => (s - order[0] + L0) % L0);
  const inc = rel.every((s, i) => i === 0 || s > rel[i - 1] - 1e-9);
  const dec = rel.slice(1).every((s, i) => i === 0 || s < rel[i] + 1e-9);
  if (!inc && !dec) return fail('The far-field points do not run in order round the domain.');

  // ── Sizing (ICEM defaults a CFD user would start from): wall spacing
  // clustered to the leading and trailing edges, a graded wall-normal layer,
  // a wake that starts at the trailing-edge spacing.
  const hWall = chord / 100;
  const hLE = hWall / 5,
    hTE = hWall / 2;
  const { y1, nRad } = wallLayers(opts, d, chord);
  const T = new Topology();
  for (const [k, p] of Object.entries({
    TE,
    U,
    L,
    LE,
    D,
    B,
    F,
    A,
    G,
    C,
    E,
    Nf,
    QB,
    QF,
    QU,
    QL,
    QN,
    QDp,
    QDm,
  }))
    T.v(k, p);
  const wallPatch = opts.patch ?? 'wall';
  const centre = mid;
  const along = (
    name: string,
    a: string,
    b: string,
    o: Outline,
    hint: Point2D,
    extra: Parameters<Topology['e']>[3] = {},
  ) => {
    if (!T.e(name, a, b, { along: o, hint, ...extra })) return false;
    const e = T.edge(name);
    if (o === dom) e.patch = domainPatch(opts, [T.pt(a), ...e.path, T.pt(b)], centre);
    return true;
  };
  const midOf = (a: Point2D, b: Point2D) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const upperMid = ring[upper[Math.floor(upper.length * 0.4)]];
  const lowerMid = ring[lower[Math.floor(lower.length * 0.4)]];
  const noseUpMid = ring[noseIdx[Math.floor(kLE / 2)]];
  const noseLoMid = ring[noseIdx[Math.floor((kLE + noseIdx.length - 1) / 2)]];
  const ok = [
    // walls: trailing edge -> split point -> leading edge
    along('wU', 'TE', 'U', body, upperMid, { patch: wallPatch }),
    along('wL', 'TE', 'L', body, lowerMid, { patch: wallPatch }),
    along('wNu', 'U', 'LE', body, noseUpMid, { patch: wallPatch }),
    along('wNl', 'L', 'LE', body, noseLoMid, { patch: wallPatch }),
    // far field
    along('dB1', 'B', 'A', dom, midOf(B, A)),
    along('dLu', 'A', 'Nf', dom, midOf(A, Nf)),
    along('dLl', 'G', 'Nf', dom, midOf(G, Nf)),
    along('dF1', 'F', 'G', dom, midOf(F, G)),
    along('dB2', 'B', 'C', dom, midOf(B, C)),
    along('dF2', 'F', 'E', dom, midOf(F, E)),
    along('dOp', 'QDp', 'C', dom, midOf(QDp, C)),
    along('dOm', 'QDm', 'E', dom, midOf(QDm, E)),
    along('rDp', 'D', 'QDp', dom, midOf(D, QDp)),
    along('rDm', 'D', 'QDm', dom, midOf(D, QDm)),
  ].every(Boolean);
  if (!ok) return fail('A far-field edge could not be traced along the domain.');
  // interior edges (straight or offset to start with; the optimizer bends them)
  T.e('cut', 'TE', 'D');
  T.e('rTB', 'TE', 'QB');
  T.e('rTF', 'TE', 'QF');
  T.e('rU', 'U', 'QU');
  T.e('rL', 'L', 'QL');
  T.e('rN', 'LE', 'QN');
  T.e('cU', 'QB', 'QU');
  T.e('cL', 'QF', 'QL');
  T.e('cNu', 'QU', 'QN', { mid: noseArc.slice(1, kLE) });
  T.e('cNl', 'QL', 'QN', { mid: noseArc.slice(kLE + 1, -1).reverse() });
  T.e('cWp', 'QB', 'QDp');
  T.e('cWm', 'QF', 'QDm');
  T.e('oB', 'QB', 'B');
  T.e('oA', 'QU', 'A');
  T.e('oN', 'QN', 'Nf');
  T.e('oG', 'QL', 'G');
  T.e('oF', 'QF', 'F');

  T.block('wU', 'rU', 'cU', 'rTB');
  T.block('wNu', 'rN', 'cNu', 'rU');
  T.block('wNl', 'rN', 'cNl', 'rL');
  T.block('wL', 'rL', 'cL', 'rTF');
  T.block('cut', 'rDp', 'cWp', 'rTB');
  T.block('cut', 'rDm', 'cWm', 'rTF');
  T.block('cU', 'oB', 'dB1', 'oA');
  T.block('cNu', 'oN', 'dLu', 'oA');
  T.block('cNl', 'oN', 'dLl', 'oG');
  T.block('cL', 'oG', 'dF1', 'oF');
  T.block('cWp', 'dOp', 'dB2', 'oB');
  T.block('cWm', 'dOm', 'dF2', 'oF');

  // Along the wall: the same count and grading on the C arc opposite.
  const hU = hWall;
  for (const [w, c, h0, h1] of [
    ['wU', 'cU', hTE, hU],
    ['wL', 'cL', hTE, hU],
    ['wNu', 'cNu', hU, hLE],
    ['wNl', 'cNl', hU, hLE],
  ] as const) {
    const { cells, ratio } = gradeBetween(T.len(w), h0, h1);
    for (const k of [w, c]) Object.assign(T.edge(k), { nodes: cells + 1, law: 'geometric', ratio });
    T.edge(c).match = T.edge(w).id;
  }
  for (const [k, w] of [
    ['dB1', 'wU'],
    ['dF1', 'wL'],
    ['dLu', 'wNu'],
    ['dLl', 'wNl'],
  ] as const)
    T.edge(k).nodes = T.edge(w).nodes;
  // Wall-normal layers: first cell y1 at the wall, growing out.
  const lastNear = y1 * growthRatio(d, nRad, y1);
  T.gradeAll(['rTB', 'rTF', 'rU', 'rL', 'rN', 'rDp', 'rDm'], nRad, growthRatio(d, nRad, y1));
  const outerLen = Math.max(dist(QB, B), dist(QU, A), dist(QN, Nf), dist(QL, G), dist(QF, F));
  const nOut = Math.max(4, Math.min(200, cellsFor(outerLen, lastNear, 1.15)));
  T.gradeAll(
    ['oB', 'oA', 'oN', 'oG', 'oF', 'dOp', 'dOm'],
    nOut,
    growthRatio(outerLen, nOut, lastNear),
  );
  // Wake: first cell at the trailing edge matches the wall spacing there.
  const wakeLen = dist(TE, D);
  const nWake = Math.max(8, Math.min(300, cellsFor(wakeLen, hTE, 1.08)));
  T.gradeAll(['cut', 'cWp', 'cWm', 'dB2', 'dF2'], nWake, growthRatio(wakeLen, nWake, hTE));

  const fluid = Math.abs(signedArea(dom.pts)) - Math.abs(signedArea(ring));
  return T.build(fluid);
}

/**
 * ICEM-style O-grid around a single blunt body (cylinder, square, ellipse):
 * four near-wall blocks around the body and four out to the domain corners.
 */
export function oGridTemplate(
  entities: CadEntity[],
  bodyId: string,
  opts: TemplateOptions = {},
): Blocking | null {
  failure = '';
  const found = findOutlines(entities, bodyId);
  if (!found) return fail('Needs one closed body inside a closed domain.');
  if (found.others.length)
    return fail('This template blocks a single body; the domain has more than one.');
  const { body, dom } = found;
  const ring = body.pts;
  const c0 = centroidOf(ring);
  const bb = boundsOf(ring);
  const size = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
  const dirs = [
    norm({ x: 1, y: 1 }),
    norm({ x: -1, y: 1 }),
    norm({ x: -1, y: -1 }),
    norm({ x: 1, y: -1 }),
  ];
  // Body points on the diagonals (a body corner near one wins, so a square
  // body's corners become block vertices).
  const bodyCorners = outlineBreaks(ring).map((i) => ring[i]);
  const P = dirs.map((dv) => {
    const hit = rayHit(ring, c0, dv);
    if (!hit) return null;
    const near = bodyCorners.find((q) => dist(q, hit) < 0.2 * size);
    return near ? { ...near } : hit;
  });
  if (P.some((p) => !p)) return fail('Could not place block corners on the body.');
  const corners = outlineBreaks(dom.pts).map((i) => dom.pts[i]);
  const K = dirs.map((dv) => farCorner(dom, corners, c0, dv));
  if (K.some((p) => !p)) return fail('Could not place the far-field corners on the domain.');
  let clearance = Infinity;
  for (const p of ring) clearance = Math.min(clearance, projectOnRing(dom.pts, p).d);
  const d = Math.min(0.5 * size, 0.4 * clearance);
  if (!(d > 0.02 * size)) return fail('The body is too close to the domain boundary.');
  const inBody = (p: Point2D) => pointInRing(p, ring);
  // Body arcs between consecutive diagonal points (counter-clockwise order).
  const arcs = [0, 1, 2, 3].map((k) => {
    const pts: Point2D[] = [P[k]!];
    const tr = traceAlong(
      ring,
      P[k]!,
      P[(k + 1) % 4]!,
      add(c0, norm(add(dirs[k], dirs[(k + 1) % 4])), size),
    );
    if (!tr) return null;
    pts.push(...tr, P[(k + 1) % 4]!);
    return pts;
  });
  if (arcs.some((a) => !a)) return fail('Could not split the body outline into four arcs.');
  const offs = arcs.map((a) => offsetCurve(a!, d, inBody));
  // Ring vertices: the average of the two offset arcs' ends meeting there.
  const Q = [0, 1, 2, 3].map((k) => {
    const a = offs[(k + 3) % 4][offs[(k + 3) % 4].length - 1],
      b = offs[k][0];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });
  const T = new Topology();
  const hWall = size / 40;
  const { y1, nRad } = wallLayers(opts, d, size);
  [0, 1, 2, 3].forEach((k) => {
    T.v(`P${k}`, P[k]!);
    T.v(`Q${k}`, Q[k]);
    T.v(`K${k}`, K[k]!);
  });
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    const arcLen = polyLen(arcs[k]!);
    const nn = Math.max(8, Math.round(arcLen / hWall)) + 1;
    if (
      !T.e(`w${k}`, `P${k}`, `P${k1}`, {
        along: body,
        hint: arcs[k]![Math.floor(arcs[k]!.length / 2)],
        patch: opts.patch ?? 'wall',
        nodes: nn,
      })
    )
      return fail('A wall edge could not be traced along the body.');
    T.e(`c${k}`, `Q${k}`, `Q${k1}`, { mid: offs[k].slice(1, -1), nodes: nn });
    const hint = rayHit(dom.pts, c0, norm(add(dirs[k], dirs[k1]))) ?? K[k]!;
    if (!T.e(`d${k}`, `K${k}`, `K${k1}`, { along: dom, hint, nodes: nn }))
      return fail('A far-field edge could not be traced along the domain.');
    const de = T.edge(`d${k}`);
    de.patch = domainPatch(opts, [K[k]!, ...de.path, K[k1]!], c0);
    T.e(`r${k}`, `P${k}`, `Q${k}`);
  }
  T.gradeAll(['r0', 'r1', 'r2', 'r3'], nRad, growthRatio(d, nRad, y1));
  const lastNear = y1 * growthRatio(d, nRad, y1);
  const outerLen = Math.max(...[0, 1, 2, 3].map((k) => dist(Q[k], K[k]!)));
  const nOut = Math.max(4, Math.min(200, cellsFor(outerLen, lastNear, 1.15)));
  for (let k = 0; k < 4; k++) T.e(`o${k}`, `Q${k}`, `K${k}`);
  T.gradeAll(['o0', 'o1', 'o2', 'o3'], nOut, growthRatio(outerLen, nOut, lastNear));
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    T.block(`w${k}`, `r${k1}`, `c${k}`, `r${k}`);
    T.block(`c${k}`, `o${k1}`, `d${k}`, `o${k}`);
  }
  const fluid = Math.abs(signedArea(dom.pts)) - Math.abs(signedArea(ring));
  return T.build(fluid);
}

/**
 * O-grid inside an H-grid (cylinder in a channel): the O layer runs from the
 * body out to a box, and straight cuts from the box corners split the rest of
 * the domain into rectangles. 12 blocks; suits long domains where diagonals
 * to the domain corners would make thin wedges.
 */
export function ohGridTemplate(
  entities: CadEntity[],
  bodyId: string,
  opts: TemplateOptions = {},
): Blocking | null {
  failure = '';
  const found = findOutlines(entities, bodyId);
  if (!found) return fail('Needs one closed body inside a closed domain.');
  if (found.others.length)
    return fail('This template blocks a single body; the domain has more than one.');
  const { body, dom } = found;
  const ring = body.pts;
  const c0 = centroidOf(ring);
  const bb = boundsOf(ring);
  const size = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
  let clearance = Infinity;
  for (const p of ring) clearance = Math.min(clearance, projectOnRing(dom.pts, p).d);
  const d = Math.min(0.5 * size, 0.45 * clearance);
  if (!(d > 0.02 * size)) return fail('The body is too close to the domain boundary.');
  // Box corners Q (top-right, top-left, bottom-left, bottom-right).
  const Q = [
    { x: bb.maxX + d, y: bb.maxY + d },
    { x: bb.minX - d, y: bb.maxY + d },
    { x: bb.minX - d, y: bb.minY - d },
    { x: bb.maxX + d, y: bb.minY - d },
  ];
  if (Q.some((q) => !pointInRing(q, dom.pts)))
    return fail('The box around the body does not fit in the domain.');
  const bodyCorners = outlineBreaks(ring).map((i) => ring[i]);
  const P = Q.map((q) => {
    const hit = rayHit(ring, c0, norm(sub(q, c0)));
    if (!hit) return null;
    const near = bodyCorners.find((c) => dist(c, hit) < 0.2 * size);
    return near ? { ...near } : hit;
  });
  if (P.some((p) => !p)) return fail('Could not place block corners on the body.');
  const up = { x: 0, y: 1 },
    down = { x: 0, y: -1 },
    right = { x: 1, y: 0 },
    leftD = { x: -1, y: 0 };
  // Where the cuts from the box corners meet the domain: [vertical, horizontal].
  const cut = [
    [rayHit(dom.pts, Q[0], up), rayHit(dom.pts, Q[0], right)],
    [rayHit(dom.pts, Q[1], up), rayHit(dom.pts, Q[1], leftD)],
    [rayHit(dom.pts, Q[2], down), rayHit(dom.pts, Q[2], leftD)],
    [rayHit(dom.pts, Q[3], down), rayHit(dom.pts, Q[3], right)],
  ];
  if (cut.flat().some((p) => !p))
    return fail('The domain must surround the body on all four sides.');
  const corners = outlineBreaks(dom.pts).map((i) => dom.pts[i]);
  const K = Q.map((q) => farCorner(dom, corners, c0, norm(sub(q, c0))));
  if (K.some((p) => !p)) return fail('Could not place the far-field corners on the domain.');

  const T = new Topology();
  const hWall = size / 40;
  const { y1, nRad } = wallLayers(opts, d, size);
  for (let k = 0; k < 4; k++) {
    T.v(`P${k}`, P[k]!);
    T.v(`Q${k}`, Q[k]);
    T.v(`K${k}`, K[k]!);
    T.v(`V${k}`, cut[k][0]!);
    T.v(`H${k}`, cut[k][1]!);
  }
  const wallPatch = opts.patch ?? 'wall';
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    const hint = add(c0, norm(add(norm(sub(Q[k], c0)), norm(sub(Q[k1], c0)))), size);
    if (
      !T.e(`w${k}`, `P${k}`, `P${k1}`, {
        along: body,
        hint: projectOnRing(ring, hint).pt,
        patch: wallPatch,
      })
    )
      return fail('A wall edge could not be traced along the body.');
    const nn = Math.max(8, Math.round(T.len(`w${k}`) / hWall)) + 1;
    T.edge(`w${k}`).nodes = nn;
    T.e(`c${k}`, `Q${k}`, `Q${k1}`, { nodes: nn });
    T.e(`r${k}`, `P${k}`, `Q${k}`);
  }
  T.gradeAll(['r0', 'r1', 'r2', 'r3'], nRad, growthRatio(d, nRad, y1));
  const lastNear = y1 * growthRatio(d, nRad, y1);
  const domEdge = (name: string, a: string, b: string) => {
    const pa = T.pt(a),
      pb = T.pt(b);
    if (!T.e(name, a, b, { along: dom, hint: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } }))
      return false;
    const e = T.edge(name);
    e.patch = domainPatch(opts, [pa, ...e.path, pb], c0);
    return true;
  };
  // The four cuts from each box corner, graded away from the box.
  const cutLen = (k: number, j: number) => dist(Q[k], cut[k][j]!);
  const nUp = Math.max(
    4,
    Math.min(200, cellsFor(Math.max(cutLen(0, 0), cutLen(1, 0)), lastNear, 1.15)),
  );
  const nDown = Math.max(
    4,
    Math.min(200, cellsFor(Math.max(cutLen(2, 0), cutLen(3, 0)), lastNear, 1.15)),
  );
  const nLeft = Math.max(
    4,
    Math.min(200, cellsFor(Math.max(cutLen(1, 1), cutLen(2, 1)), lastNear, 1.15)),
  );
  const nRight = Math.max(
    4,
    Math.min(300, cellsFor(Math.max(cutLen(0, 1), cutLen(3, 1)), lastNear, 1.1)),
  );
  for (let k = 0; k < 4; k++) {
    T.e(`v${k}`, `Q${k}`, `V${k}`);
    T.e(`h${k}`, `Q${k}`, `H${k}`);
  }
  // Each pair of parallel cuts shares one grading (see gradeAll).
  const pairs = [
    [['v0', 'v1'], nUp, Math.max(cutLen(0, 0), cutLen(1, 0))],
    [['v2', 'v3'], nDown, Math.max(cutLen(2, 0), cutLen(3, 0))],
    [['h1', 'h2'], nLeft, Math.max(cutLen(1, 1), cutLen(2, 1))],
    [['h0', 'h3'], nRight, Math.max(cutLen(0, 1), cutLen(3, 1))],
  ] as const;
  for (const [names, cells, len] of pairs)
    T.gradeAll(names, cells, growthRatio(len, cells, lastNear));
  const ok = [
    domEdge('dT', 'V0', 'V1'),
    domEdge('dL', 'H1', 'H2'),
    domEdge('dB', 'V3', 'V2'),
    domEdge('dR', 'H0', 'H3'),
    domEdge('k0v', 'V0', 'K0'),
    domEdge('k0h', 'H0', 'K0'),
    domEdge('k1v', 'V1', 'K1'),
    domEdge('k1h', 'H1', 'K1'),
    domEdge('k2v', 'V2', 'K2'),
    domEdge('k2h', 'H2', 'K2'),
    domEdge('k3v', 'V3', 'K3'),
    domEdge('k3h', 'H3', 'K3'),
  ].every(Boolean);
  if (!ok) return fail('A far-field edge could not be traced along the domain.');
  // Corner-block sides on the domain grade like the cuts they face.
  for (const [k, nm] of [
    ['k0v', 'h0'],
    ['k1v', 'h1'],
    ['k2v', 'h2'],
    ['k3v', 'h3'],
    ['k0h', 'v0'],
    ['k1h', 'v1'],
    ['k2h', 'v2'],
    ['k3h', 'v3'],
  ] as const) {
    const ref = T.edge(nm);
    T.gradeAll([k], ref.nodes - 1, ref.ratio);
  }
  for (const [k, nm] of [
    ['dT', 'c0'],
    ['dL', 'c1'],
    ['dB', 'c2'],
    ['dR', 'c3'],
  ] as const)
    T.edge(k).nodes = T.edge(nm).nodes;
  for (let k = 0; k < 4; k++) T.block(`w${k}`, `r${(k + 1) % 4}`, `c${k}`, `r${k}`);
  T.block('c0', 'v1', 'dT', 'v0');
  T.block('c1', 'h2', 'dL', 'h1');
  T.block('c2', 'v3', 'dB', 'v2');
  T.block('c3', 'h0', 'dR', 'h3');
  T.block('v0', 'k0v', 'k0h', 'h0');
  T.block('v1', 'k1v', 'k1h', 'h1');
  T.block('v2', 'k2v', 'k2h', 'h2');
  T.block('v3', 'k3v', 'k3h', 'h3');
  const fluid = Math.abs(signedArea(dom.pts)) - Math.abs(signedArea(ring));
  return T.build(fluid);
}
