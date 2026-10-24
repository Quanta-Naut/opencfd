/// <reference lib="webworker" />
import type { BoundaryTag, CadEntity } from '../types/cadWorkflow';
import {
  autoBlock,
  AutoBlockProgress,
  AutoBlockOptions,
  Blocking,
  makeTagLookup,
  optimizeBlocking,
  Ranked,
  scoreBlocking,
} from '../types/blocking';

// Runs the blocking search and the shape optimizer off the main thread, so the
// canvas keeps drawing while they work. Snapshots are throttled: the blocks are
// shown settling without flooding the main thread with copies.

export type BlockingJob =
  | {
      kind: 'auto';
      entities: CadEntity[];
      edgeTagMap: Record<string, BoundaryTag>;
      bodyPatches: Record<string, BoundaryTag>;
      options: AutoBlockOptions;
    }
  | {
      kind: 'optimize';
      entities: CadEntity[];
      edgeTagMap: Record<string, BoundaryTag>;
      blocking: Blocking;
    };

export type BlockingMessage =
  | { type: 'progress'; progress: number; label: string; blocking?: Blocking }
  | { type: 'done'; result: BlockingReport | null }
  | { type: 'error'; message: string };

/** What a finished run reports back (also kept for the panel's readout). */
export interface BlockingReport {
  blocking: Blocking;
  label: string;
  quality: { wallWorst: number; worst: number; mean: number; invalid: number };
  ranking: { label: string; rank: number; failed?: string; wallWorst?: number; worst?: number }[];
}

const SNAPSHOT_MS = 60;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<BlockingJob>) => {
  const job = ev.data;
  try {
    let last = 0;
    const post = (m: BlockingMessage) => ctx.postMessage(m);
    const snapshot = (progress: number, label: string, blocking?: Blocking) => {
      const now = performance.now();
      if (blocking && now - last < SNAPSHOT_MS) blocking = undefined;
      if (blocking) last = now;
      post({ type: 'progress', progress, label, blocking });
    };
    const summary = (bk: Blocking) => {
      const s = scoreBlocking(bk);
      return { wallWorst: s.wallWorst, worst: s.worst, mean: s.mean, invalid: s.invalid };
    };

    if (job.kind === 'auto') {
      const it = autoBlock(job.entities, job.edgeTagMap, (id) => job.bodyPatches[id], job.options);
      let r = it.next();
      let ranking: Ranked[] = [];
      while (!r.done) {
        const step = r.value as AutoBlockProgress;
        if (step.ranking) ranking = step.ranking;
        snapshot(step.progress, step.label, step.blocking);
        r = it.next();
      }
      const res = r.value;
      if (!res) {
        // Nothing could be built: say why each topology failed.
        const why = ranking.map((k) => `${k.label}: ${k.failed ?? 'folded'}`).join('\n');
        post({ type: 'error', message: why || 'No topology fits this geometry.' });
        return;
      }
      post({
        type: 'done',
        result: {
          blocking: res.blocking,
          label: res.label,
          quality: summary(res.blocking),
          ranking: res.ranking.map((k) => ({
            label: k.label,
            rank: k.rank,
            failed: k.failed,
            wallWorst: k.score?.wallWorst,
            worst: k.score?.worst,
          })),
        },
      });
      return;
    }

    const tag = makeTagLookup(job.entities, job.edgeTagMap);
    const it = optimizeBlocking(job.blocking, job.entities, { tag, yieldEvery: 5 });
    let r = it.next();
    while (!r.done) {
      snapshot(Math.min(0.95, r.value.sweep / 250), 'Optimizing block shapes', r.value.blocking);
      r = it.next();
    }
    const bk = r.value?.blocking ?? job.blocking;
    post({
      type: 'done',
      result: { blocking: bk, label: 'Optimized', quality: summary(bk), ranking: [] },
    });
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } as BlockingMessage);
  }
};
