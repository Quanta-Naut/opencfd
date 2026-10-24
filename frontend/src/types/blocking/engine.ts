import { BoundaryTag, CadEntity } from '../cadWorkflow';
import { Blocking } from './types';
import { entityRing } from './geometry';
import { autoBlockingFromOutline, makeTagLookup, outlineRing } from './autoBlock';
import { bodiesForOgrid, wrapBodyOgrid } from './ogrid';
import { airfoilsForCGrid, cGridFromAirfoil, wrapAirfoilOgrid } from './cgrid';
import { applyTargetCellSize, autoCellSize, propagateNodeCounts } from './sizing';
import { cGridTemplate, oGridTemplate, ohGridTemplate, templateFailure } from './templates';
import { optimizeBlocking, OptimizeStep } from './optimize';
import { BlockingScore, scoreBlocking } from './quality';

// Automatic blocking as a search, not a one-shot guess: build every topology
// that fits the geometry, give each a short round of shape optimization,
// score them on the mesh they would produce, keep the best and optimize it
// until it stops improving.

export interface Candidate {
  key: string;
  label: string;
  build: () => Blocking | null;
}

export interface Ranked {
  key: string;
  label: string;
  score: BlockingScore | null;
  rank: number;
  /** Why it could not be built, if it could not. */
  failed?: string;
}

export interface AutoBlockProgress {
  phase: 'screen' | 'refine';
  /** 0..1 overall. */
  progress: number;
  label: string;
  /** Live shape during refinement. */
  blocking?: Blocking;
  ranking?: Ranked[];
}

export interface AutoBlockResult {
  blocking: Blocking;
  key: string;
  label: string;
  score: BlockingScore;
  ranking: Ranked[];
}

export interface AutoBlockOptions {
  /** Only try these candidate keys (all when omitted). */
  keys?: string[];
  /** Optimization sweeps each candidate gets before they are compared. */
  screenSweeps?: number;
  firstCellHeight?: number;
  growth?: number;
  /** Ring shape for the legacy body O-grid wrap. */
  ogrid?: { offsetFactor: number; radialNodes: number; radialRatio: number };
}

/** The topology families the panel offers. */
export type BlockKind = 'auto' | 'hgrid' | 'ogrid' | 'cgrid' | 'cgrid_closed';

/** Candidate keys each family searches over ('auto' searches them all). */
export const KIND_KEYS: Record<BlockKind, string[] | undefined> = {
  auto: undefined,
  hgrid: ['strips', 'strips-ogrid'],
  ogrid: ['ohgrid', 'ogrid', 'strips-ogrid'],
  cgrid: ['cgrid', 'hcgrid'],
  cgrid_closed: ['closed-ogrid'],
};

/** Lower is better. Skew in the first layer off a wall costs most. */
export function rankScore(s: BlockingScore): number {
  if (s.invalid) return Infinity;
  return 1.5 * s.wallWorst + 0.5 * s.worst + s.mean;
}

/** The topologies worth trying for this geometry. */
export function topologyCandidates(
  entities: CadEntity[],
  edgeTagMap: Record<string, BoundaryTag>,
  bodyPatchFor: (entId: string) => BoundaryTag | undefined,
  wall: Pick<AutoBlockOptions, 'firstCellHeight' | 'growth' | 'ogrid'> = {},
): Candidate[] {
  const tag = makeTagLookup(entities, edgeTagMap);
  const bodies = entities.filter(
    (e) =>
      e.layer !== 'construction' &&
      e.role !== 'domain_boundary' &&
      (e.isClosed || e.type === 'rectangle' || e.type === 'circle' || e.type === 'ellipse'),
  );
  const out: Candidate[] = [];
  const legacy = (bk: Blocking | null) =>
    bk && applyTargetCellSize(propagateNodeCounts(bk), autoCellSize(bk));
  if (bodies.length === 1) {
    const b = bodies[0];
    const opts = {
      patch: bodyPatchFor(b.id),
      tag,
      firstCellHeight: wall.firstCellHeight,
      growth: wall.growth,
    };
    out.push({ key: 'cgrid', label: 'C-grid', build: () => cGridTemplate(entities, b.id, opts) });
    out.push({
      key: 'ohgrid',
      label: 'O-grid in H-grid',
      build: () => ohGridTemplate(entities, b.id, opts),
    });
    out.push({
      key: 'ogrid',
      label: 'O-grid to corners',
      build: () => oGridTemplate(entities, b.id, opts),
    });
    const af = airfoilsForCGrid(entities)[0];
    if (af) {
      const ent = entities[af.index];
      out.push({
        key: 'hcgrid',
        label: 'H-C grid',
        build: () => {
          const domEnts = entities.filter((e) => e.role === 'domain_boundary');
          const domEnt = domEnts.length === 1 ? domEnts[0] : domEnts.find((e) => e.isClosed);
          return legacy(
            cGridFromAirfoil(
              entityRing(ent),
              outlineRing(domEnts),
              bodyPatchFor(ent.id),
              ent.id,
              domEnt?.id,
            ),
          );
        },
      });
    }
  }
  if (bodies.length >= 1) {
    out.push({
      key: 'strips-ogrid',
      label: 'Strips with body O-grids',
      build: () => {
        let bk = autoBlockingFromOutline(entities, edgeTagMap);
        if (!bk) return null;
        for (const b of bodiesForOgrid(entities, bk)) {
          const ent = entities[b.index];
          const next = wrapBodyOgrid(bk, entityRing(ent), bodyPatchFor(ent.id), {
            bodyEntityId: ent.id,
            ...wall.ogrid,
          });
          if (next) bk = next;
        }
        return legacy(bk);
      },
    });
    const af = airfoilsForCGrid(entities)[0];
    if (af && bodies.length === 1) {
      const ent = entities[af.index];
      out.push({
        key: 'closed-ogrid',
        label: 'Closed O-grid',
        build: () => {
          const base = autoBlockingFromOutline(entities, edgeTagMap);
          return (
            base &&
            legacy(
              wrapAirfoilOgrid(base, entityRing(ent), bodyPatchFor(ent.id), {
                airfoilEntityId: ent.id,
              }),
            )
          );
        },
      });
    }
  }
  // Plain strips leave bodies unmeshed, so they only fit an empty domain.
  if (!bodies.length)
    out.push({
      key: 'strips',
      label: 'Strips',
      build: () => legacy(autoBlockingFromOutline(entities, edgeTagMap)),
    });
  return out;
}

/**
 * Run the search. A generator so the caller can show progress, animate the
 * winner settling, and stop early; it returns the final result.
 */
export function* autoBlock(
  entities: CadEntity[],
  edgeTagMap: Record<string, BoundaryTag>,
  bodyPatchFor: (entId: string) => BoundaryTag | undefined,
  opts: AutoBlockOptions = {},
): Generator<AutoBlockProgress, AutoBlockResult | null> {
  const tag = makeTagLookup(entities, edgeTagMap);
  const cands = topologyCandidates(entities, edgeTagMap, bodyPatchFor, opts).filter(
    (c) => !opts.keys || opts.keys.includes(c.key),
  );
  const screenSweeps = opts.screenSweeps ?? 40;
  const ranking: Ranked[] = [];
  const shaped = new Map<string, Blocking>();
  const share = cands.length > 1 ? 0.5 : 0.05;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    yield { phase: 'screen', progress: (share * i) / cands.length, label: `Trying ${c.label}` };
    let bk: Blocking | null = null;
    let failed: string | undefined;
    try {
      bk = c.build();
      if (!bk) failed = templateFailure() || 'Does not fit this geometry.';
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
    }
    if (!bk) {
      ranking.push({ key: c.key, label: c.label, score: null, rank: Infinity, failed });
      continue;
    }
    // A short round of optimization so every topology is judged at its best
    // shape rather than its first guess.
    let step: OptimizeStep | null = null;
    if (cands.length > 1) {
      const it = optimizeBlocking(bk, entities, { tag, maxSweeps: screenSweeps });
      let r = it.next();
      while (!r.done) r = it.next();
      step = r.value;
    }
    const shape = step?.blocking ?? bk;
    const score = scoreBlocking(shape);
    shaped.set(c.key, shape);
    ranking.push({ key: c.key, label: c.label, score, rank: rankScore(score) });
  }
  ranking.sort((a, b) => a.rank - b.rank);
  const best = ranking.find((r) => Number.isFinite(r.rank));
  if (!best) {
    yield { phase: 'screen', progress: 1, label: 'No topology fits', ranking };
    return null;
  }
  const start = shaped.get(best.key)!;
  // Refine the winner until it stops improving, showing it settle.
  const it = optimizeBlocking(start, entities, { tag, yieldEvery: 5 });
  let r = it.next();
  let sweeps = 0;
  while (!r.done) {
    sweeps = r.value.sweep;
    yield {
      phase: 'refine',
      progress: share + (1 - share) * Math.min(0.95, sweeps / 250),
      label: `Optimizing ${best.label}`,
      blocking: r.value.blocking,
      ranking,
    };
    r = it.next();
  }
  const blocking = r.value?.blocking ?? start;
  return { blocking, key: best.key, label: best.label, score: scoreBlocking(blocking), ranking };
}

/** Run the search to the end (tests, scripts). */
export function autoBlockSync(
  entities: CadEntity[],
  edgeTagMap: Record<string, BoundaryTag>,
  bodyPatchFor: (entId: string) => BoundaryTag | undefined,
  opts: AutoBlockOptions = {},
): AutoBlockResult | null {
  const it = autoBlock(entities, edgeTagMap, bodyPatchFor, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
