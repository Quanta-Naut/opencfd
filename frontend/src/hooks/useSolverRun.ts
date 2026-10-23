import { useCallback, useEffect, useRef } from 'react';
import { toast } from '../components/ui/Toast';
import { WS_BASE } from '../utils/api';
import { CFDProjectState, ResidualDataPoint, SolverRunRecord } from '../types/cfd';

/** Lines kept in the console, and in a run's saved log. The full stream is on
 * disk (runs/<id>/stream.jsonl); a mesher or solver can print hundreds of
 * thousands of lines, and holding all of them made every update slower. */
const MAX_LOG_LINES = 5000;
/** How often streamed log lines and residuals are pushed into React state. */
const STREAM_FLUSH_MS = 150;

const appendCapped = (lines: string[], more: string[]) => {
  const all = lines.concat(more);
  return all.length > MAX_LOG_LINES ? all.slice(all.length - MAX_LOG_LINES) : all;
};

/** Runs one solver execution over the `/ws/solver` WebSocket: builds the run
 * record, streams log/residual/field/status messages back into app state, and
 * batches the high-frequency log and residual streams so they don't force a
 * re-render per line or point. */
export function useSolverRun(params: {
  state: CFDProjectState;
  setState: React.Dispatch<React.SetStateAction<CFDProjectState>>;
  meshData: any;
  projectId: string;
  caseRefLength: number;
  patchSpec: { name: string }[];
  patchRoles: { name: string; role: string }[];
  makeCaseFiles: () => Promise<Record<string, string>>;
  setCaseFiles: (files: Record<string, string>) => void;
  setMonitorOpen: (open: boolean) => void;
  setLivePreview: (
    p: {
      time: string;
      fields: Record<string, number[]>;
      ranges: Record<string, [number, number]>;
    } | null,
  ) => void;
  clearResultsCache: () => void;
  setSelectedRunId: (id: string | null) => void;
  setHistoricalFieldData: (d: any) => void;
  setHistoricalFieldStatus: (s: {
    loading: boolean;
    error: string | null;
    runId: string | null;
  }) => void;
  loadResults: (
    fromRun?: boolean,
    time?: number,
    silent?: boolean,
    frameIdx?: number,
  ) => Promise<void>;
  /** Writes any unsaved mesh/field blobs to the project (App's autosave). */
  flushBlobs: () => Promise<void>;
}) {
  const {
    state,
    setState,
    meshData,
    projectId,
    caseRefLength,
    patchSpec,
    patchRoles,
    makeCaseFiles,
    setCaseFiles,
    setMonitorOpen,
    setLivePreview,
    clearResultsCache,
    setSelectedRunId,
    setHistoricalFieldData,
    setHistoricalFieldStatus,
    loadResults,
    flushBlobs,
  } = params;

  const wsRef = useRef<WebSocket | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  // This run's own log lines, for its history record. Kept apart from the
  // console (which is capped and shared with other messages) so trimming the
  // console never shifts what the record captures.
  const runLogsRef = useRef<string[]>([]);

  // High-frequency stream batching: log lines and residuals are queued and
  // flushed into state together on an interval, one re-render per flush.
  const pendingResidualsRef = useRef<ResidualDataPoint[]>([]);
  const pendingLogsRef = useRef<string[]>([]);
  const residualBatchTimerRef = useRef<number | null>(null);

  const flushResiduals = useCallback(() => {
    const residualBatch = pendingResidualsRef.current;
    const logBatch = pendingLogsRef.current;
    if (residualBatch.length === 0 && logBatch.length === 0) return;
    pendingResidualsRef.current = [];
    pendingLogsRef.current = [];
    if (logBatch.length) runLogsRef.current = appendCapped(runLogsRef.current, logBatch);
    setState((prev) => ({
      ...prev,
      ...(residualBatch.length ? { residuals: [...prev.residuals, ...residualBatch] } : {}),
      ...(logBatch.length ? { terminalLogs: appendCapped(prev.terminalLogs, logBatch) } : {}),
    }));
  }, [setState]);

  const stopResidualBatching = useCallback(() => {
    if (residualBatchTimerRef.current !== null) {
      window.clearInterval(residualBatchTimerRef.current);
      residualBatchTimerRef.current = null;
    }
  }, []);

  const finalizeRun = useCallback(
    (status: 'completed' | 'error' | 'stopped', extra?: { iterations?: number }) => {
      const targetId = activeRunIdRef.current;
      if (!targetId) return;
      activeRunIdRef.current = null;

      stopResidualBatching();
      const finalPending = pendingResidualsRef.current;
      pendingResidualsRef.current = [];
      const finalLogs = pendingLogsRef.current;
      pendingLogsRef.current = [];
      if (finalLogs.length) runLogsRef.current = appendCapped(runLogsRef.current, finalLogs);
      const logs = runLogsRef.current;

      setState((prev) => {
        const allResiduals =
          finalPending.length > 0 ? [...prev.residuals, ...finalPending] : prev.residuals;
        const last = allResiduals.length > 0 ? allResiduals[allResiduals.length - 1] : undefined;
        const finalCd = typeof last?.cd === 'number' ? last.cd : undefined;
        const finalCl = typeof last?.cl === 'number' ? last.cl : undefined;
        const iterationsRun = extra?.iterations ?? last?.iteration;
        const residuals = [...allResiduals];
        const finishedAt = Date.now();

        return {
          ...prev,
          residuals: allResiduals,
          ...(finalLogs.length ? { terminalLogs: appendCapped(prev.terminalLogs, finalLogs) } : {}),
          solverRuns: (prev.solverRuns ?? []).map((r) => {
            if (r.id !== targetId) return r;
            return {
              ...r,
              status,
              finishedAt,
              residuals,
              logs,
              ...(finalCd !== undefined ? { finalCd } : {}),
              ...(finalCl !== undefined ? { finalCl } : {}),
              ...(iterationsRun !== undefined ? { iterationsRun } : {}),
            };
          }),
        };
      });
    },
    [setState, stopResidualBatching],
  );

  const handleRunSolver = useCallback(async () => {
    if (activeRunIdRef.current) {
      finalizeRun('stopped');
    }
    if (wsRef.current) wsRef.current.close();
    setMonitorOpen(true); // reveal the residuals / forces rail for the run
    setLivePreview(null); // start the live field preview fresh
    clearResultsCache(); // the previous run's frames must not survive a new solve
    setSelectedRunId(null);
    setHistoricalFieldData(null);
    setHistoricalFieldStatus({ loading: false, error: null, runId: null });
    stopResidualBatching();
    pendingResidualsRef.current = [];

    const n = (state.solverRuns?.length ?? 0) + 1;
    const runId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record: SolverRunRecord = {
      id: runId,
      startedAt: Date.now(),
      finishedAt: null,
      status: 'running',
      label: `Run ${n}`,
      config: {
        timeFormulation: state.physics.timeFormulation === 'transient' ? 'transient' : 'steady',
        turbulenceModel: state.physics.turbulenceModelId,
        iterations: state.solution.run.iterations,
        velocity: state.physics.inletVelocity,
        reynolds:
          (state.physics.inletVelocity * caseRefLength) /
          Math.max(state.physics.kinematicViscosity, 1e-12),
        regime: state.physics.regime,
        cells: meshData?.num_elements ?? 0,
        momentumOrder: state.solution.methods.momentum,
        relax: state.solution.controls.relax,
        axisymmetric: state.physics.axisymmetric,
      },
      residuals: [],
      logs: [],
    };
    activeRunIdRef.current = record.id;
    const writingLine = `[OpenFOAM] Writing case (${patchSpec.length} patches), ${state.physics.timeFormulation === 'transient' ? 'transient' : 'steady-state'}...`;
    runLogsRef.current = [writingLine];
    pendingLogsRef.current = [];

    setState((prev) => ({
      ...prev,
      executionStatus: 'running',
      residuals: [],
      terminalLogs: appendCapped(prev.terminalLogs, [writingLine]),
      solverRuns: [...(prev.solverRuns ?? []), record],
    }));

    // regenerate the case dictionaries with the current solution config
    try {
      const dicts = await makeCaseFiles();
      if (dicts && Object.keys(dicts).length > 0) {
        setCaseFiles(dicts);
      }
    } catch (e: any) {
      toast(`Could not write the case files: ${e?.message ?? e}`, 'error');
    }

    // The backend reads the mesh from the project instead of receiving it in
    // the socket message: serialising a 200k-cell mesh to JSON here froze the
    // UI for a moment on every Run. Make sure the saved copy is current first;
    // if that fails, fall back to sending it inline.
    let meshFromProject = false;
    if (meshData && projectId) {
      try {
        await flushBlobs();
        meshFromProject = true;
      } catch {
        meshFromProject = false;
      }
    }

    const ws = new WebSocket(`${WS_BASE}/ws/solver`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          mode: 'auto',
          project_id: projectId,
          run_id: record.id,
          physics: state.physics,
          mesh_source: meshFromProject ? 'project' : undefined,
          mesh: meshFromProject
            ? null
            : meshData
              ? {
                  nodes: meshData.nodes,
                  elements: meshData.elements,
                  boundaries: meshData.boundaries,
                }
              : null,
          wallPatches: patchRoles.filter((p) => p.role === 'wall').map((p) => p.name),
          patchTypes: Object.fromEntries(
            patchRoles.map((p) => [
              p.name,
              p.role === 'wall'
                ? 'wall'
                : p.role === 'symmetry'
                  ? 'symmetry'
                  : p.role === 'axis'
                    ? 'empty'
                    : 'patch',
            ]),
          ),
          axisymmetric: state.physics.axisymmetric,
          iterations: state.solution.run.iterations,
          regime: state.physics.regime,
          velocity: state.physics.inletVelocity,
          reynolds:
            (state.physics.inletVelocity * caseRefLength) /
            Math.max(state.physics.kinematicViscosity, 1e-12),
          cells: meshData?.num_elements ?? 20000,
          relax: state.solution.controls.relax,
          momentumOrder: state.solution.methods.momentum,
          turbulenceModel: state.physics.turbulenceModelId,
          forces: state.solution.monitors.forces.enabled,
          init: state.solution.run.init,
        }),
      );
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'log' || msg.type === 'residual') {
        if (msg.type === 'log') pendingLogsRef.current.push(msg.line);
        else pendingResidualsRef.current.push(msg.data);
        if (residualBatchTimerRef.current === null) {
          residualBatchTimerRef.current = window.setInterval(flushResiduals, STREAM_FLUSH_MS);
        }
      } else if (msg.type === 'field') {
        setLivePreview(msg.data);
      } else if (msg.type === 'status' && msg.status === 'completed') {
        finalizeRun('completed', { iterations: msg.iterations });
        setState((prev) => ({
          ...prev,
          executionStatus: 'completed',
          terminalLogs: [
            ...prev.terminalLogs,
            `[OpenFOAM] Run finished (${msg.iterations ?? '-'} iterations).`,
          ],
        }));
        toast('Solver run finished.', 'success');
        void loadResults(true);
      } else if (msg.type === 'error') {
        finalizeRun('error');
        setState((prev) => ({
          ...prev,
          executionStatus: 'error',
          terminalLogs: [...prev.terminalLogs, `[Error] ${msg.message}`],
        }));
        toast(msg.message, 'error');
        // A diverged / stopped run still wrote partial fields - refresh the
        // Results tab from them instead of leaving the previous run's data.
        if (msg.results_available) {
          void loadResults(true);
          toast('Loaded the partial fields from the last written step.', 'info', 6000);
        }
      }
    };

    ws.onerror = () => {
      finalizeRun('error');
      setState((prev) => ({
        ...prev,
        executionStatus: 'error',
        terminalLogs: [
          ...prev.terminalLogs,
          '[Error] Could not reach the solver stream (backend down?).',
        ],
      }));
      toast('Could not reach the solver stream.', 'error');
    };
    // Deliberately narrow deps: this recreates the closure each render like the
    // original inline handler did (it always reads the latest `state` etc. via
    // the params object identity changing every render), so behavior is
    // unchanged from before the extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state,
    meshData,
    projectId,
    caseRefLength,
    patchSpec,
    patchRoles,
    makeCaseFiles,
    setCaseFiles,
    setMonitorOpen,
    setLivePreview,
    clearResultsCache,
    setSelectedRunId,
    setHistoricalFieldData,
    setHistoricalFieldStatus,
    loadResults,
    finalizeRun,
    flushResiduals,
    stopResidualBatching,
    setState,
  ]);

  const handleStopSolver = useCallback(() => {
    finalizeRun('stopped');
    if (wsRef.current) {
      wsRef.current.close();
    }
    setState((prev) => ({
      ...prev,
      executionStatus: 'idle',
      terminalLogs: [...prev.terminalLogs, '[Solver] Execution aborted.'],
    }));
  }, [finalizeRun, setState]);

  // Cleanup the residual-batching interval on unmount.
  useEffect(
    () => () => {
      if (residualBatchTimerRef.current !== null)
        window.clearInterval(residualBatchTimerRef.current);
    },
    [],
  );

  return { handleRunSolver, handleStopSolver };
}
