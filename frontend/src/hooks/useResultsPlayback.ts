import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSolverResults } from '../utils/api';
import { toast } from '../components/ui/Toast';
import { CFDProjectState } from '../types/cfd';

/** Loading, caching and scrubbing/playing back solver result frames on the
 * Results/Solver tabs - live cell-based preview during a run, on-demand
 * per-frame fetch with an LRU cache, prefetch of neighbouring frames, and the
 * play/pause/speed transport for transient cases. */
export function useResultsPlayback(params: {
  fieldData: any;
  setFieldData: (d: any) => void;
  meshData: any;
  projectId: string;
  setState: React.Dispatch<React.SetStateAction<CFDProjectState>>;
}) {
  const { fieldData, setFieldData, meshData, projectId, setState } = params;

  const [resultsLoading, setResultsLoading] = useState(false);

  // Live cell-based field streamed from the solver while it runs (Solver stage).
  const [livePreview, setLivePreview] = useState<{
    time: string;
    fields: Record<string, number[]>;
    ranges: Record<string, [number, number]>;
  } | null>(null);
  const [transientFrameIndex, setTransientFrameIndex] = useState(0);
  const [transientPlaying, setTransientPlaying] = useState(false);
  const [transientSpeed, setTransientSpeed] = useState<number>(1.0);

  // Keep stable refs so interval callbacks never go stale
  const transientTimesRef = useRef<number[]>([]);
  const transientFrameIndexRef = useRef(0);
  const transientPlayingRef = useRef(false);
  const transientSpeedRef = useRef(1.0);
  const meshDataRef = useRef<any>(null);
  const projectIdRef = useRef<string | undefined>(undefined);

  // Frame cache: key = frame index, value = fieldData object. LRU-limited to 50 frames.
  const frameCacheRef = useRef<Map<number, any>>(new Map());
  const CACHE_MAX = 50;

  // Wipe every cached results frame + transient bookkeeping. Must run whenever the
  // mesh changes or a new solve starts, or the Results tab / player will keep
  // serving the previous run's (or previous mesh's) solution.
  const clearResultsCache = useCallback(() => {
    frameCacheRef.current.clear();
    transientTimesRef.current = [];
    transientFrameIndexRef.current = 0;
    setTransientFrameIndex(0);
    setFieldData(null);
  }, [setFieldData]);

  // In-flight AbortController for the current fetch (cancelled when a newer request starts)
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Scrub debounce timer - delays actual fetch by 80ms so rapid slider movement
  // doesn't fire multiple overlapping requests
  const scrubDebounceRef = useRef<number | null>(null);

  const transientTimes = useMemo(
    () =>
      Array.isArray(fieldData?.availableTimes)
        ? fieldData.availableTimes
            .map(Number)
            .filter(Number.isFinite)
            .sort((a: number, b: number) => a - b)
        : [],
    [fieldData?.availableTimes],
  );

  // Sync refs whenever state changes
  useEffect(() => {
    transientTimesRef.current = transientTimes;
  }, [transientTimes]);
  useEffect(() => {
    transientFrameIndexRef.current = transientFrameIndex;
  }, [transientFrameIndex]);
  useEffect(() => {
    transientPlayingRef.current = transientPlaying;
  }, [transientPlaying]);
  useEffect(() => {
    transientSpeedRef.current = transientSpeed;
  }, [transientSpeed]);
  useEffect(() => {
    meshDataRef.current = meshData;
  }, [meshData]);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Core fetch - always cancels any previous in-flight request first.
  // Returns true if data was loaded (not aborted/errored).
  const fetchFrame = async (
    time: number,
    frameIdx: number,
    signal: AbortSignal,
  ): Promise<boolean> => {
    const mesh = meshDataRef.current;
    if (!mesh?.nodes?.length) return false;

    // Cache hit - apply immediately, no network call
    if (frameCacheRef.current.has(frameIdx)) {
      const cached = frameCacheRef.current.get(frameIdx)!;
      setFieldData(cached);
      setTransientFrameIndex(frameIdx);
      transientFrameIndexRef.current = frameIdx;
      return true;
    }

    const { data, detail } = await fetchSolverResults(
      { nodes: mesh.nodes, elements: mesh.elements },
      projectIdRef.current,
      time,
      signal,
    );

    if (signal.aborted || detail === '__aborted__') return false;
    if (!data) return false;

    // Store in cache; evict oldest if over limit
    frameCacheRef.current.set(frameIdx, data);
    if (frameCacheRef.current.size > CACHE_MAX) {
      const oldestKey = frameCacheRef.current.keys().next().value;
      if (oldestKey !== undefined) frameCacheRef.current.delete(oldestKey);
    }

    // Update available times in ref from this response
    const times = Array.isArray(data.availableTimes)
      ? data.availableTimes
          .map(Number)
          .filter(Number.isFinite)
          .sort((a: number, b: number) => a - b)
      : [];
    if (times.length) transientTimesRef.current = times;

    setFieldData(data);
    setTransientFrameIndex(frameIdx);
    transientFrameIndexRef.current = frameIdx;
    return true;
  };

  const loadResults = async (fromRun = false, time?: number, silent = false, frameIdx?: number) => {
    const mesh = meshDataRef.current;
    if (!mesh?.nodes?.length) {
      if (!silent) toast.info('Generate a mesh first');
      return;
    }

    // Cancel any in-flight request
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const aborter = new AbortController();
    fetchAbortRef.current = aborter;

    setResultsLoading(true);
    const { data, detail } = await fetchSolverResults(
      { nodes: mesh.nodes, elements: mesh.elements },
      projectIdRef.current,
      time,
      aborter.signal,
    );
    setResultsLoading(false);

    if (aborter.signal.aborted || detail === '__aborted__') return;

    if (data) {
      const times = Array.isArray(data.availableTimes)
        ? data.availableTimes
            .map(Number)
            .filter(Number.isFinite)
            .sort((a: number, b: number) => a - b)
        : [];
      transientTimesRef.current = times;

      // When invoked right after a run (no explicit time/frame), point the player
      // at the LAST written frame - that is what `data` holds, and it is the
      // result the user just computed.
      const frame =
        frameIdx !== undefined
          ? frameIdx
          : time !== undefined
            ? times.indexOf(Number(data.time))
            : fromRun && times.length
              ? Math.max(0, times.indexOf(Number(data.time)))
              : -1;
      if (frame >= 0) {
        frameCacheRef.current.set(frame, data);
        setTransientFrameIndex(frame);
        transientFrameIndexRef.current = frame;
      }

      setFieldData(data);
      setState((prev) => ({
        ...prev,
        terminalLogs: [...prev.terminalLogs, `[Results] Loaded fields from time ${data.time}.`],
      }));
      if (!silent)
        toast.success('Results loaded', { description: 'Open the Results tab to view them.' });
    } else {
      const msg = detail || 'no solver output found';
      setState((prev) => ({ ...prev, terminalLogs: [...prev.terminalLogs, `[Results] ${msg}`] }));
      if (!fromRun && !silent) toast.error('Could not load results', { description: msg });
    }
  };

  // Prefetch adjacent frames in the background (non-blocking, won't abort active fetch)
  const prefetchAdjacent = useCallback((frameIdx: number) => {
    const times = transientTimesRef.current;
    const mesh = meshDataRef.current;
    if (!mesh?.nodes?.length || times.length < 2) return;
    [-1, 1, -2, 2].forEach((delta) => {
      const idx = frameIdx + delta;
      if (idx < 0 || idx >= times.length) return;
      if (frameCacheRef.current.has(idx)) return;
      // Fire-and-forget background prefetch with its own abort controller
      const pAborter = new AbortController();
      void fetchSolverResults(
        { nodes: mesh.nodes, elements: mesh.elements },
        projectIdRef.current,
        times[idx],
        pAborter.signal,
      ).then(({ data }) => {
        if (!data || pAborter.signal.aborted) return;
        frameCacheRef.current.set(idx, data);
        if (frameCacheRef.current.size > CACHE_MAX) {
          const oldest = frameCacheRef.current.keys().next().value;
          if (oldest !== undefined) frameCacheRef.current.delete(oldest);
        }
      });
    });
  }, []);

  const selectTransientFrame = useCallback(
    (index: number) => {
      const times = transientTimesRef.current;
      const clamped = Math.max(0, Math.min(times.length - 1, index));
      if (times[clamped] === undefined) return;

      // 1. Instant optimistic UI update for 60fps realtime scrubbing
      setTransientFrameIndex(clamped);
      transientFrameIndexRef.current = clamped;

      // 2. Cache hit → instant GPU field update
      if (frameCacheRef.current.has(clamped)) {
        const cached = frameCacheRef.current.get(clamped)!;
        setFieldData(cached);
        prefetchAdjacent(clamped);
        return;
      }

      // 3. Realtime network fetch with immediate in-flight abort
      if (fetchAbortRef.current) fetchAbortRef.current.abort();
      const aborter = new AbortController();
      fetchAbortRef.current = aborter;

      void fetchFrame(times[clamped], clamped, aborter.signal).then((ok) => {
        if (ok) prefetchAdjacent(clamped);
      });
    },
    [prefetchAdjacent],
  );

  // Single stable interval/timeout loop - calibrated to actual physical simulation time
  const playTimeoutRef = useRef<number | null>(null);
  const stopPlayback = useCallback(() => {
    if (playTimeoutRef.current !== null) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }
    setTransientPlaying(false);
    transientPlayingRef.current = false;
  }, []);

  const scheduleNextFrame = useCallback(() => {
    if (!transientPlayingRef.current) return;
    const times = transientTimesRef.current;
    const current = transientFrameIndexRef.current;

    if (times.length < 2 || current >= times.length - 1) {
      stopPlayback();
      return;
    }

    const next = current + 1;
    // Physical time delta between current and next frame in seconds
    const dtReal = Math.max(0.001, (times[next] ?? 0) - (times[current] ?? 0));
    // Delay in milliseconds scaled by chosen playback speed (e.g. 1x = 1:1 real simulation time)
    const speed = transientSpeedRef.current || 1.0;
    const delayMs = Math.max(16, Math.round((dtReal * 1000) / speed));

    playTimeoutRef.current = window.setTimeout(() => {
      if (!transientPlayingRef.current) return;
      transientFrameIndexRef.current = next;
      setTransientFrameIndex(next);

      if (frameCacheRef.current.has(next)) {
        setFieldData(frameCacheRef.current.get(next)!);
        prefetchAdjacent(next);
        scheduleNextFrame();
      } else {
        if (fetchAbortRef.current) fetchAbortRef.current.abort();
        const aborter = new AbortController();
        fetchAbortRef.current = aborter;
        void fetchFrame(times[next], next, aborter.signal).then(() => {
          scheduleNextFrame();
        });
      }
    }, delayMs);
  }, [stopPlayback, prefetchAdjacent]);

  const startPlayback = useCallback(() => {
    if (playTimeoutRef.current !== null) window.clearTimeout(playTimeoutRef.current);
    setTransientPlaying(true);
    transientPlayingRef.current = true;
    scheduleNextFrame();
  }, [scheduleNextFrame]);

  const handleToggleTransientPlay = useCallback(() => {
    if (transientPlayingRef.current) stopPlayback();
    else startPlayback();
  }, [stopPlayback, startPlayback]);

  // When speed changes mid-playback, restart to apply new timing
  useEffect(() => {
    transientSpeedRef.current = transientSpeed;
    if (transientPlayingRef.current) {
      if (playTimeoutRef.current !== null) window.clearTimeout(playTimeoutRef.current);
      scheduleNextFrame();
    }
  }, [transientSpeed, scheduleNextFrame]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (playTimeoutRef.current) window.clearTimeout(playTimeoutRef.current);
      if (fetchAbortRef.current) fetchAbortRef.current.abort();
      if (scrubDebounceRef.current !== null) window.clearTimeout(scrubDebounceRef.current);
    },
    [],
  );

  return {
    resultsLoading,
    livePreview,
    setLivePreview,
    transientFrameIndex,
    transientPlaying,
    transientSpeed,
    setTransientSpeed,
    transientTimes,
    clearResultsCache,
    loadResults,
    selectTransientFrame,
    handleToggleTransientPlay,
  };
}
