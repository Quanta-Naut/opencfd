import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRunField, SolverRunFieldSnapshot } from '../utils/api';

/** Selecting and loading a past solver run's field snapshot for the Results tab
 * (the "View in Viewport" flow on a previous run), including its in-memory
 * cache and in-flight-request cancellation. */
export function useHistoricalRunField(projectId: string) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [historicalFieldData, setHistoricalFieldData] = useState<SolverRunFieldSnapshot | null>(null);
  const [historicalFieldStatus, setHistoricalFieldStatus] = useState<{
    loading: boolean;
    error: string | null;
    runId: string | null;
  }>({ loading: false, error: null, runId: null });
  const historicalCacheRef = useRef<Map<string, SolverRunFieldSnapshot>>(new Map());
  const historicalAbortRef = useRef<AbortController | null>(null);

  const handleSelectRun = useCallback(
    async (runId: string | null) => {
      if (historicalAbortRef.current) {
        historicalAbortRef.current.abort();
        historicalAbortRef.current = null;
      }

      if (!runId) {
        setSelectedRunId(null);
        setHistoricalFieldData(null);
        setHistoricalFieldStatus({ loading: false, error: null, runId: null });
        return;
      }

      setSelectedRunId(runId);

      // In-memory cache hit
      if (historicalCacheRef.current.has(runId)) {
        const cached = historicalCacheRef.current.get(runId)!;
        setHistoricalFieldData(cached);
        setHistoricalFieldStatus({ loading: false, error: null, runId });
        return;
      }

      const aborter = new AbortController();
      historicalAbortRef.current = aborter;
      setHistoricalFieldStatus({ loading: true, error: null, runId });

      let res = await fetchRunField(projectId, runId, aborter.signal);
      for (let attempt = 0; !res.data && attempt < 3 && !aborter.signal.aborted; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        if (aborter.signal.aborted) break;
        res = await fetchRunField(projectId, runId, aborter.signal);
      }
      if (aborter.signal.aborted || res.detail === '__aborted__') return;

      if (!res.data) {
        setHistoricalFieldData(null);
        setHistoricalFieldStatus({
          loading: false,
          error: res.detail || 'No stored field snapshot found for this run.',
          runId,
        });
        return;
      }

      const snap = res.data;
      if (
        !snap.mesh ||
        !Array.isArray(snap.mesh.nodes) ||
        !Array.isArray(snap.mesh.elements) ||
        snap.mesh.nodes.length === 0
      ) {
        setHistoricalFieldData(null);
        setHistoricalFieldStatus({
          loading: false,
          error: 'Historical mesh geometry missing or invalid in snapshot.',
          runId,
        });
        return;
      }

      // Guard explicitly against field-to-mesh node mismatch
      const nodeCount = snap.mesh.nodes.length;
      let mismatch = false;
      if (snap.fields && typeof snap.fields === 'object') {
        for (const arr of Object.values(snap.fields)) {
          if (Array.isArray(arr) && arr.length > 0 && arr.length !== nodeCount) {
            mismatch = true;
            break;
          }
        }
      }
      if (mismatch) {
        setHistoricalFieldData(null);
        setHistoricalFieldStatus({
          loading: false,
          error: 'Field data length does not match historical mesh node count.',
          runId,
        });
        return;
      }

      historicalCacheRef.current.set(runId, snap);
      setHistoricalFieldData(snap);
      setHistoricalFieldStatus({ loading: false, error: null, runId });
    },
    [projectId],
  );

  useEffect(
    () => () => {
      if (historicalAbortRef.current) historicalAbortRef.current.abort();
    },
    [],
  );

  return {
    selectedRunId,
    setSelectedRunId,
    historicalFieldData,
    setHistoricalFieldData,
    historicalFieldStatus,
    setHistoricalFieldStatus,
    historicalCacheRef,
    handleSelectRun,
  };
}
