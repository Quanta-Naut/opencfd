import { useCallback, useEffect, useRef } from 'react';
import { toast } from '../components/ui/Toast';
import { WS_BASE } from '../utils/api';
import { CFDProjectState, ResidualDataPoint, SolverRunRecord } from '../types/cfd';

/** Runs one solver execution over the `/ws/solver` WebSocket: builds the run
 * record, streams log/residual/field/status messages back into app state, and
 * batches the high-frequency residual stream so it doesn't force a re-render
 * per point. */
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
    p: { time: string; fields: Record<string, number[]>; ranges: Record<string, [number, number]> } | null,
  ) => void;
  clearResultsCache: () => void;
  setSelectedRunId: (id: string | null) => void;
  setHistoricalFieldData: (d: any) => void;
  setHistoricalFieldStatus: (s: { loading: boolean; error: string | null; runId: string | null }) => void;
  loadResults: (fromRun?: boolean, time?: number, silent?: boolean, frameIdx?: number) => Promise<void>;
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
  } = params;

  const wsRef = useRef<WebSocket | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const runLogStartRef = useRef(0);

  // High-frequency residual batching (flushed on interval to cut re-render churn)
  const pendingResidualsRef = useRef<ResidualDataPoint[]>([]);
  const residualBatchTimerRef = useRef<number | null>(null);

  const flushResiduals = useCallback(() => {
    if (pendingResidualsRef.current.length === 0) return;
    const batch = pendingResidualsRef.current;
    pendingResidualsRef.current = [];
    setState((prev) => ({
      ...prev,
      residuals: [...prev.residuals, ...batch],
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

      setState((prev) => {
        const allResiduals = finalPending.length > 0 ? [...prev.residuals, ...finalPending] : prev.residuals;
        const last = allResiduals.length > 0 ? allResiduals[allResiduals.length - 1] : undefined;
        const finalCd = typeof last?.cd === 'number' ? last.cd : undefined;
        const finalCl = typeof last?.cl === 'number' ? last.cl : undefined;
        const iterationsRun = extra?.iterations ?? last?.iteration;
        const logs = prev.terminalLogs.slice(runLogStartRef.current);
        const residuals = [...allResiduals];
        const finishedAt = Date.now();

        return {
          ...prev,
          residuals: allResiduals,
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
    runLogStartRef.current = state.terminalLogs.length;

    setState((prev) => ({
      ...prev,
      executionStatus: 'running',
      residuals: [],
      terminalLogs: [
        ...prev.terminalLogs,
        `[OpenFOAM] Writing case (${patchSpec.length} patches), ${state.physics.timeFormulation === 'transient' ? 'transient' : 'steady-state'}...`,
      ],
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

    const ws = new WebSocket(`${WS_BASE}/ws/solver`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          mode: 'auto',
          project_id: projectId,
          run_id: record.id,
          physics: state.physics,
          mesh: meshData
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
              p.role === 'wall' ? 'wall' : p.role === 'symmetry' ? 'symmetry' : p.role === 'axis' ? 'empty' : 'patch',
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
      if (msg.type === 'log') {
        setState((prev) => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs, msg.line],
        }));
      } else if (msg.type === 'residual') {
        pendingResidualsRef.current.push(msg.data);
        if (residualBatchTimerRef.current === null) {
          residualBatchTimerRef.current = window.setInterval(flushResiduals, 200);
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
      if (residualBatchTimerRef.current !== null) window.clearInterval(residualBatchTimerRef.current);
    },
    [],
  );

  return { handleRunSolver, handleStopSolver };
}
