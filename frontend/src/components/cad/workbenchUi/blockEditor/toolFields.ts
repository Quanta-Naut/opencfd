import type { BlockTool } from './shared';

// Each block tool works like a Fusion 360 command: its dialog lists the
// things to pick as selection fields. Clicks on the canvas fill the active
// field; a single-pick field hands over to the next one once filled.

export type PickKind = 'block' | 'edge' | 'vertex' | 'curve';

export interface ToolField {
  key: string;
  label: string;
  kind: PickKind;
  multi?: boolean;
  optional?: boolean;
}

export type ToolPicks = Record<string, string[]>;

export const TOOL_FIELDS: Record<BlockTool, ToolField[]> = {
  select: [],
  draw: [],
  split: [],
  ogrid: [
    { key: 'blocks', label: 'Blocks', kind: 'block', multi: true },
    { key: 'pass', label: 'Pass-through', kind: 'edge', multi: true, optional: true },
  ],
  assoc: [
    { key: 'edges', label: 'Edges', kind: 'edge', multi: true },
    { key: 'curves', label: 'Curves', kind: 'curve', multi: true },
  ],
  params: [{ key: 'edges', label: 'Edges', kind: 'edge', multi: true }],
  match: [
    { key: 'ref', label: 'Reference', kind: 'edge' },
    { key: 'targets', label: 'Targets', kind: 'edge', multi: true },
  ],
  align: [
    { key: 'a', label: 'From', kind: 'vertex' },
    { key: 'b', label: 'To', kind: 'vertex' },
    { key: 'verts', label: 'Vertices', kind: 'vertex', multi: true },
  ],
  shape: [{ key: 'edge', label: 'Edge', kind: 'edge' }],
  link: [
    { key: 'src', label: 'Source', kind: 'edge' },
    { key: 'edges', label: 'Edges', kind: 'edge', multi: true },
  ],
  mergeV: [
    { key: 'keep', label: 'Keep', kind: 'vertex' },
    { key: 'merge', label: 'Merge', kind: 'vertex' },
  ],
  mergeB: [
    { key: 'a', label: 'Block', kind: 'block' },
    { key: 'b', label: 'With', kind: 'block' },
  ],
  delete: [{ key: 'blocks', label: 'Blocks', kind: 'block', multi: true }],
};

export const activeFieldOf = (tool: BlockTool, key: string): ToolField | undefined =>
  TOOL_FIELDS[tool].find((f) => f.key === key) ?? TOOL_FIELDS[tool][0];

/** Toggle `id` in the active field. A single-pick field takes it and moves
 *  on to the next empty field. */
export function pickInto(
  tool: BlockTool,
  picks: ToolPicks,
  fieldKey: string,
  id: string,
): { picks: ToolPicks; field: string } {
  const fields = TOOL_FIELDS[tool];
  const f = activeFieldOf(tool, fieldKey);
  if (!f) return { picks, field: fieldKey };
  const cur = picks[f.key] ?? [];
  if (f.multi) {
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return { picks: { ...picks, [f.key]: next }, field: f.key };
  }
  const out = { ...picks, [f.key]: [id] };
  const after = fields.slice(fields.indexOf(f) + 1).find((g) => !(out[g.key] ?? []).length);
  return { picks: out, field: after?.key ?? f.key };
}

/** Everything of one kind picked in the tool's fields. */
export function pickedOfKind(tool: BlockTool, picks: ToolPicks, kind: PickKind): Set<string> {
  const s = new Set<string>();
  for (const f of TOOL_FIELDS[tool])
    if (f.kind === kind) for (const id of picks[f.key] ?? []) s.add(id);
  return s;
}

/** True when every required field has its picks. */
export const fieldsReady = (tool: BlockTool, picks: ToolPicks) =>
  TOOL_FIELDS[tool].every((f) => f.optional || (picks[f.key] ?? []).length > 0);
