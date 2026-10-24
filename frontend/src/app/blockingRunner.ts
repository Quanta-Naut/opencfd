import type { Blocking } from '../types/blocking';
import type { BlockingJob, BlockingMessage, BlockingReport } from '../workers/blockingWorker';

export type { BlockingReport };

// One blocking job at a time, in a worker. Starting a new job cancels the one
// in flight: its worker is terminated and its promise settles with null, so a
// stale result can never land and its toast never hangs.

let active: { worker: Worker; settle: (r: BlockingReport | null) => void } | null = null;

export function cancelBlockingJob() {
  if (!active) return;
  const { worker, settle } = active;
  active = null;
  worker.terminate();
  settle(null);
}

export function runBlockingJob(
  job: BlockingJob,
  on: {
    progress: (p: number, label: string) => void;
    snapshot?: (bk: Blocking) => void;
  },
): Promise<BlockingReport | null> {
  cancelBlockingJob();
  const worker = new Worker(new URL('../workers/blockingWorker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise((resolve, reject) => {
    const mine = { worker, settle: resolve };
    active = mine;
    const finish = () => {
      worker.terminate();
      if (active === mine) active = null;
    };
    worker.onmessage = (ev: MessageEvent<BlockingMessage>) => {
      if (active !== mine) return;
      const m = ev.data;
      if (m.type === 'progress') {
        on.progress(m.progress, m.label);
        if (m.blocking) on.snapshot?.(m.blocking);
        return;
      }
      finish();
      if (m.type === 'done') resolve(m.result);
      else reject(new Error(m.message));
    };
    worker.onerror = (ev) => {
      if (active !== mine) return;
      finish();
      reject(new Error(ev.message || 'The blocking worker failed.'));
    };
    worker.postMessage(job);
  });
}
