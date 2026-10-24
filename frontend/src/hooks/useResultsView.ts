import { useMemo } from 'react';
import type { PhysicsConfig, PostProcessConfig } from '../types/cfd';
import type { ResultsOverlay } from '../components/cad/workbenchCore';
import {
  RESULT_FIELDS,
  fieldDef,
  fieldValues,
  fmtValue,
  valueRange,
  type FlowReference,
  type ResultFieldId,
} from '../utils/resultFields';
import { buildMeshLocator } from '../utils/meshLocator';
import { patchReports, type PatchReport } from '../utils/boundaryData';

interface FieldPayload {
  fields?: Record<string, number[]>;
  ranges?: Record<string, [number, number]>;
  [k: string]: any;
}

interface MeshLike {
  nodes: number[][];
  elements: number[][];
  boundaries?: Record<string, number[]>;
}

export interface ProbeRow {
  id: string;
  x: number;
  y: number;
  /** Null outside the mesh. */
  values: Partial<Record<ResultFieldId, number>> | null;
}

/**
 * What the Results tab shows for the loaded field and the post-processing
 * settings: the field data with the active (possibly derived) field and its
 * colour range filled in, the canvas overlay, probe values and boundary
 * reports.
 */
export function useResultsView(
  fieldData: FieldPayload | null | undefined,
  mesh: MeshLike | null | undefined,
  pp: PostProcessConfig,
  physics: PhysicsConfig,
) {
  const ref = useMemo<FlowReference>(() => {
    const compressible = physics.compressibility === 'compressible';
    return {
      compressible,
      rho: physics.density || 1.225,
      U: physics.inletVelocity || 1,
      p: compressible ? physics.inletPressure || 0 : 0,
    };
  }, [physics.compressibility, physics.density, physics.inletVelocity, physics.inletPressure]);

  const fields = fieldData?.fields;
  const active = pp.activeField;

  /** Which fields this result can show (an older run has no Ux / Uy). */
  const available = useMemo(
    () =>
      new Set(
        RESULT_FIELDS.filter((f) => {
          const v = fieldValues(fields, f.id, ref);
          return !!v && v.length > 0;
        }).map((f) => f.id),
      ),
    [fields, ref],
  );

  const activeVals = useMemo(() => fieldValues(fields, active, ref), [fields, active, ref]);

  const autoRange = useMemo<[number, number] | null>(
    () =>
      activeVals
        ? valueRange(
            activeVals,
            pp.rangeMode === 'full' ? 'full' : 'auto',
            fieldDef(active).symmetric,
          )
        : null,
    [activeVals, active, pp.rangeMode],
  );

  const range = useMemo<[number, number] | null>(() => {
    if (!autoRange) return null;
    if (pp.rangeMode !== 'custom') return autoRange;
    const lo = pp.rangeMin ?? autoRange[0];
    const hi = pp.rangeMax ?? autoRange[1];
    return hi > lo ? [lo, hi] : autoRange;
  }, [autoRange, pp.rangeMode, pp.rangeMin, pp.rangeMax]);

  const displayFieldData = useMemo(() => {
    if (!fieldData || !activeVals || !range) return fieldData ?? null;
    return {
      ...fieldData,
      // The viewport draws plain arrays; derived fields come back typed.
      fields: {
        ...fieldData.fields,
        [active]: Array.isArray(activeVals) ? activeVals : Array.from(activeVals),
      },
      ranges: { ...fieldData.ranges, [active]: range },
    };
  }, [fieldData, activeVals, range, active]);

  const hasProbes = pp.probes.length > 0;
  const probeLocator = useMemo(
    () =>
      hasProbes && mesh?.nodes?.length && mesh?.elements?.length
        ? buildMeshLocator(mesh.nodes, mesh.elements)
        : null,
    [hasProbes, mesh?.nodes, mesh?.elements],
  );

  // Every available field at every probe.
  const allVals = useMemo(() => {
    const m: Partial<Record<ResultFieldId, ArrayLike<number>>> = {};
    if (!pp.probes.length) return m;
    available.forEach((id) => {
      const v = fieldValues(fields, id, ref);
      if (v) m[id] = v;
    });
    return m;
  }, [pp.probes.length, available, fields, ref]);

  const probeRows = useMemo<ProbeRow[]>(
    () =>
      pp.probes.map((p) => {
        const hit = probeLocator?.locate(p.x, p.y);
        if (!hit) return { ...p, values: null };
        const values: Partial<Record<ResultFieldId, number>> = {};
        (Object.keys(allVals) as ResultFieldId[]).forEach((id) => {
          const v = allVals[id]!;
          values[id] =
            hit.w[0] * v[hit.nodes[0]] + hit.w[1] * v[hit.nodes[1]] + hit.w[2] * v[hit.nodes[2]];
        });
        return { ...p, values };
      }),
    [pp.probes, probeLocator, allVals],
  );

  const reports = useMemo<PatchReport[]>(
    () =>
      mesh?.nodes?.length && activeVals && activeVals.length === mesh.nodes.length
        ? patchReports(mesh, activeVals, fields?.Ux, fields?.Uy)
        : [],
    [mesh, activeVals, fields],
  );

  const def = fieldDef(active);
  const overlay = useMemo<ResultsOverlay>(
    () => ({
      levels: pp.levels,
      contourLines: pp.contourLines,
      showMesh: pp.showMeshWireframe,
      showStreamlines: pp.showStreamlines,
      showVectors: pp.showVectors && available.has('Ux'),
      vectorSpacing: pp.vectorSpacing,
      vectorScale: pp.glyphScale,
      probes: probeRows.map((r) => ({
        id: r.id,
        x: r.x,
        y: r.y,
        label: r.values?.[active] !== undefined ? fmtValue(r.values[active]!) : 'outside',
      })),
      legend: { title: def.short, unit: def.unit },
    }),
    [pp, available, probeRows, active, def],
  );

  return { ref, available, displayFieldData, range, autoRange, overlay, probeRows, reports };
}
