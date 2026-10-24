import type { PlotDefinition, PlotSampleData } from '../../types/cfd';
import { fetchRunField, sampleSolverRunLine } from '../../utils/api';
import { patchSamples, snapshotBoundaries } from '../../utils/boundaryData';
import { fieldValues, type FlowReference } from '../../utils/resultFields';

/** Sampled data for a line or boundary plot: the x coordinate along it and
 *  every solver field at those points. */
export type PlotSamples = Pick<PlotSampleData, 'distance' | 'fields'>;

/**
 * The x / y pairs a line or boundary plot draws from its samples. Y is
 * computed from the raw fields (so derived ones like Cp work and pressure is
 * in Pa); the cached `values` are the fallback for plots without fields.
 */
export function plotXY(
  plot: PlotDefinition,
  data: PlotSamples | PlotSampleData | null | undefined,
  ref: FlowReference,
): { xs: ArrayLike<number>; ys: ArrayLike<number> } {
  if (!data) return { xs: [], ys: [] };
  const ys =
    fieldValues(data.fields, plot.variable, ref) ??
    ('values' in data && data.values ? data.values : []);
  const xAxis = plot.xAxis ?? 'distance';
  const xs =
    xAxis === 'distance' ? data.distance : (fieldValues(data.fields, xAxis, ref) ?? data.distance);
  return { xs, ys };
}

/** Sample a line or boundary plot from another run (or re-sample its own). */
export async function loadPlotSamples(
  plot: PlotDefinition,
  projectId: string,
  runId: string,
  /** The project mesh, for runs whose snapshot has no patch lists. */
  currentMesh?: { nodes?: ArrayLike<unknown>; boundaries?: Record<string, number[]> } | null,
): Promise<{ data: PlotSamples | null; detail?: string }> {
  if (plot.kind === 'boundary' && plot.boundary) {
    const res = await fetchRunField(projectId, runId);
    if (!res.data) return { data: null, detail: res.detail || 'No stored field for this run' };
    const mesh = { ...res.data.mesh, boundaries: snapshotBoundaries(res.data.mesh, currentMesh) };
    if (!Object.keys(mesh.boundaries).length)
      return { data: null, detail: 'Older run on another mesh, saved without boundaries' };
    const s = patchSamples(mesh, res.data.fields, plot.boundary.patch, plot.boundary.axis);
    if (!s) return { data: null, detail: `No boundary "${plot.boundary.patch}" in this run` };
    return { data: s };
  }
  if (!plot.line) return { data: null, detail: 'Nothing to sample' };
  const res = await sampleSolverRunLine(
    projectId,
    runId,
    plot.line.p1,
    plot.line.p2,
    plot.line.samples,
  );
  if (!res.data) return { data: null, detail: res.detail || 'Sampling failed' };
  return { data: { distance: res.data.distance, fields: res.data.fields } };
}

/** Axis caption for a plot's x coordinate. */
export function plotXLabel(plot: PlotDefinition): string {
  if (plot.kind === 'boundary' && plot.boundary) {
    const a = plot.boundary.axis;
    return a === 's' ? `Length along ${plot.boundary.patch}` : `${a} on ${plot.boundary.patch}`;
  }
  return 'Distance along line';
}
