import { useMemo } from 'react';
import type { PhysicsConfig, PostProcessConfig } from '../types/cfd';
import type { ResultsOverlay } from '../components/cad/workbenchCore';
import {
  RESULT_FIELDS,
  fieldDef,
  registerCustomFields,
  fieldValues,
  fmtValue,
  valueRange,
  type FlowReference,
  type ResultFieldId,
} from '../utils/resultFields';
import { buildMeshLocator } from '../utils/meshLocator';
import { patchReports, type PatchReport } from '../utils/boundaryData';
import { isoSegments } from '../utils/isoLines';

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

/** Another run's field, for a difference view. */
export interface DiffSource {
  label: string;
  fields: Record<string, ArrayLike<number>>;
  mesh: { nodes: number[][]; elements: number[][] };
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
  diff: DiffSource | null = null,
) {
  const custom = pp.customFields;
  const ref = useMemo<FlowReference>(() => {
    const compressible = physics.compressibility === 'compressible';
    registerCustomFields(custom ?? []);
    return {
      compressible,
      rho: physics.density || 1.225,
      U: physics.inletVelocity || 1,
      p: compressible ? physics.inletPressure || 0 : 0,
      nu: physics.kinematicViscosity || 1.5e-5,
      custom: custom ?? [],
    };
  }, [
    physics.compressibility,
    physics.density,
    physics.inletVelocity,
    physics.inletPressure,
    physics.kinematicViscosity,
    custom,
  ]);

  // The solver fields plus the point coordinates, which calculator
  // expressions can read as x and y.
  const rawFields = fieldData?.fields;
  const fields = useMemo(() => {
    const nodes = mesh?.nodes;
    if (!rawFields || !nodes?.length || rawFields.U_mag?.length !== nodes.length) return rawFields;
    return { ...rawFields, x: nodes.map((n) => n[0]), y: nodes.map((n) => n[1]) };
  }, [rawFields, mesh?.nodes]);
  const active = pp.activeField;

  /** Which fields this result can show (an older run has no Ux / Uy). */
  const available = useMemo(
    () =>
      new Set(
        [...RESULT_FIELDS.map((f) => f.id), ...(ref.custom ?? []).map((f) => f.id)].filter((id) => {
          const v = fieldValues(fields, id, ref);
          return !!v && v.length > 0;
        }),
      ),
    [fields, ref],
  );

  // The other run's fields at this mesh's nodes: as they are on the same
  // mesh, interpolated when the meshes differ (NaN outside its domain).
  const diffFields = useMemo(() => {
    const nodes = mesh?.nodes;
    if (!diff || !nodes?.length) return null;
    const xy = { x: nodes.map((n) => n[0]), y: nodes.map((n) => n[1]) };
    if (diff.mesh.nodes.length === nodes.length) return { ...diff.fields, ...xy };
    const loc = buildMeshLocator(diff.mesh.nodes, diff.mesh.elements);
    const out: Record<string, ArrayLike<number>> = { ...xy };
    const hits = nodes.map((n) => loc.locate(n[0], n[1]));
    for (const [k, v] of Object.entries(diff.fields)) {
      if (!v || v.length !== diff.mesh.nodes.length) continue;
      const a = new Float64Array(nodes.length);
      hits.forEach((h, i) => {
        a[i] = h ? h.w[0] * v[h.nodes[0]] + h.w[1] * v[h.nodes[1]] + h.w[2] * v[h.nodes[2]] : NaN;
      });
      out[k] = a;
    }
    return out;
  }, [diff, mesh?.nodes]);

  const ownVals = useMemo(() => fieldValues(fields, active, ref), [fields, active, ref]);
  const activeVals = useMemo(() => {
    if (!diffFields || !ownVals) return ownVals;
    const other = fieldValues(diffFields, active, ref);
    if (!other || other.length !== ownVals.length) return null;
    const d = new Float64Array(ownVals.length);
    // Where the other run has no value, show no difference.
    for (let i = 0; i < d.length; i++) {
      const v = ownVals[i] - other[i];
      d[i] = Number.isFinite(v) ? v : 0;
    }
    return d;
  }, [ownVals, diffFields, active, ref]);
  const diffing = !!diffFields;

  const autoRange = useMemo<[number, number] | null>(
    () =>
      activeVals
        ? valueRange(
            activeVals,
            pp.rangeMode === 'full' ? 'full' : 'auto',
            // A difference is signed: centre it on zero.
            diffing || fieldDef(active).symmetric,
          )
        : null,
    [activeVals, active, pp.rangeMode, diffing],
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

  // Lines at the values typed for this field.
  const isoValues = pp.isoValues?.[active];
  const isoLines = useMemo(() => {
    if (!isoValues?.length || !activeVals || !mesh?.nodes?.length) return [];
    if (activeVals.length !== mesh.nodes.length) return [];
    const unit = fieldDef(active).unit;
    return isoValues.map((level) => ({
      level,
      label: `${fmtValue(level)}${unit ? ` ${unit}` : ''}`,
      segs: isoSegments(mesh.nodes, mesh.elements, activeVals, level),
    }));
  }, [isoValues, activeVals, mesh?.nodes, mesh?.elements, active]);

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
      legend: { title: diffing ? `Δ${def.short}` : def.short, unit: def.unit },
      clipOutside: pp.clipOutside ?? false,
      clipBox: pp.clipBox ?? null,
      isoLines,
    }),
    [pp, available, probeRows, active, def, isoLines, diffing],
  );

  return {
    ref,
    available,
    /** Solver fields plus x and y, for sampling boundaries and the calculator. */
    allFields: fields,
    displayFieldData,
    range,
    autoRange,
    overlay,
    probeRows,
    reports,
    /** Showing this run minus another. */
    diffing,
  };
}
