import { useState } from 'react';
import { MousePointerClick, X } from 'lucide-react';
import type { CadEntity } from '../../../../types/cadWorkflow';
import { straightenEdges } from '../../../../types/blocking';
import type { Blocking, SpacingJump } from '../../../../types/blocking';
import { TOOLS } from './BlockToolRail';
import { EdgeParams } from './BlockInspector';
import { card, Field, smallBtn } from './shared';
import type { BlockMsg, BlockTool } from './shared';
import { TOOL_FIELDS, fieldsReady } from './toolFields';
import type { ToolPicks } from './toolFields';

const NOUN = { block: 'block', edge: 'edge', vertex: 'vertex', curve: 'curve' } as const;

// One line per tool; the fields say the rest.
const HINT: Partial<Record<BlockTool, string>> = {
  draw: 'Click 4 corners. They snap to vertices and geometry.',
  split: 'Click an edge where the split goes.',
  ogrid: 'Pass-through edges open the ring: one gives a C-grid.',
  assoc: 'Edges follow the curves, end to end.',
  match: 'Targets take the reference cell size where they meet it.',
  mergeV: 'The second vertex moves onto the first.',
  mergeB: 'The two blocks must share a whole side.',
  align: 'Vertices on a curve slide along it to the line.',
  shape: 'Click the edge to add a point, drag points to bend it. Alt-click removes one.',
  link: 'The edges bend like the source. Factor 1 is the same bend, 0 straight.',
};

/** The active tool's command dialog (Fusion 360 style): selection fields,
 *  options, OK (Enter) and Cancel (Esc). */
export function BlockToolDialog(p: {
  blockTool: BlockTool;
  blocking: Blocking;
  onUpdateBlocking: (bk: Blocking | null) => void;
  entities: CadEntity[];
  toolPicks: ToolPicks;
  setToolPicks: (v: ToolPicks) => void;
  toolField: string;
  setToolField: (k: string) => void;
  drawCount: number;
  ogridScale: number;
  setOgridScale: (v: number) => void;
  matchCopy: boolean;
  setMatchCopy: (v: boolean) => void;
  linkFactor: number;
  setLinkFactor: (v: number) => void;
  blockSpacingJumps: SpacingJump[];
  blockMsg: BlockMsg;
  commitTool: () => void;
  cancelTool: () => void;
}) {
  const [paramsCopy, setParamsCopy] = useState(true);
  const tool = TOOLS.find((t) => t.id === p.blockTool);
  if (!tool || p.blockTool === 'select') return null;
  const fields = TOOL_FIELDS[p.blockTool];
  // Draw, Split and Edge shape apply as you click; Edge params as you type.
  const live =
    p.blockTool === 'draw' ||
    p.blockTool === 'split' ||
    p.blockTool === 'params' ||
    p.blockTool === 'shape';
  const shaped =
    p.blockTool === 'shape'
      ? p.blocking.edges.find((e) => e.id === p.toolPicks.edge?.[0])
      : undefined;
  const ready = live || fieldsReady(p.blockTool, p.toolPicks);
  const hint = HINT[p.blockTool];
  return (
    <div className={`${card} w-[268px] select-none`}>
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
        <tool.icon className="w-3.5 h-3.5 text-accent-fg" />
        <span className="font-semibold uppercase tracking-wide text-[10px]">{tool.label}</span>
        <button
          onClick={p.cancelTool}
          className="ml-auto text-fg-2 hover:text-fg"
          title="Cancel (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-2 space-y-1.5">
        {fields.map((f) => {
          const ids = p.toolPicks[f.key] ?? [];
          const active = p.toolField === f.key;
          const noun = NOUN[f.kind];
          return (
            <div key={f.key} className="flex items-center gap-2">
              <span className="w-[72px] shrink-0 text-fg-2">{f.label}</span>
              <button
                onClick={() => p.setToolField(f.key)}
                className={`flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-1 rounded-sm border text-left transition-colors ${
                  active
                    ? 'border-accent bg-accent-soft text-accent-fg'
                    : 'border-line bg-app text-fg-2 hover:border-line-strong'
                }`}
              >
                <MousePointerClick className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {ids.length
                    ? `${ids.length} ${noun}${ids.length > 1 ? (noun === 'vertex' ? 'es' : 's') : ''}`
                    : f.optional
                      ? 'None'
                      : `Select ${noun}${f.multi ? 's' : ''}`}
                </span>
                {ids.length > 0 && (
                  <span
                    role="button"
                    title="Clear"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      p.setToolPicks({ ...p.toolPicks, [f.key]: [] });
                      p.setToolField(f.key);
                    }}
                    className="ml-auto text-fg-2 hover:text-fg"
                  >
                    <X className="w-3 h-3" />
                  </span>
                )}
              </button>
            </div>
          );
        })}
        {p.blockTool === 'draw' && (
          <div className="flex items-center gap-2">
            <span className="w-[72px] text-fg-2">Corners</span>
            <span className="font-mono">{p.drawCount} / 4</span>
          </div>
        )}
        {p.blockTool === 'ogrid' && (
          <label
            className="flex items-center gap-2"
            title="Size of the picked blocks after the ring goes round them"
          >
            <span className="w-[72px] text-fg-2">Inner size</span>
            <input
              type="range"
              min={0.2}
              max={0.9}
              step={0.05}
              value={p.ogridScale}
              onChange={(ev) => p.setOgridScale(parseFloat(ev.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="font-mono w-7 text-right">{p.ogridScale.toFixed(2)}</span>
          </label>
        )}
        {p.blockTool === 'match' && (
          <label className="flex items-center gap-1.5 text-fg-2">
            <input
              type="checkbox"
              checked={p.matchCopy}
              onChange={(ev) => p.setMatchCopy(ev.target.checked)}
              className="accent-accent"
            />
            Copy to parallel edges
          </label>
        )}
        {p.blockTool === 'link' && (
          <div className="flex items-center gap-2">
            <span className="w-[72px] shrink-0 text-fg-2">Factor</span>
            <Field value={p.linkFactor} onCommit={(v) => v !== undefined && p.setLinkFactor(v)} />
          </div>
        )}
        {shaped && (
          <div className="flex items-center gap-2">
            <span className="w-[72px] shrink-0 text-fg-2">Points</span>
            <span className="font-mono">
              {shaped.link ? 'linked' : (shaped.shape?.length ?? 0)}
            </span>
            <button
              className={`${smallBtn} ml-auto`}
              disabled={!shaped.shape?.length && !shaped.link}
              onClick={() => p.onUpdateBlocking(straightenEdges(p.blocking, [shaped.id]))}
            >
              Straighten
            </button>
          </div>
        )}
        {p.blockTool === 'params' && (p.toolPicks.edges ?? []).length > 0 && (
          <div className="pt-1.5 border-t border-line">
            <EdgeParams
              bare
              blocking={p.blocking}
              onUpdateBlocking={p.onUpdateBlocking}
              entities={p.entities}
              edgeIds={p.toolPicks.edges ?? []}
              blockSpacingJumps={p.blockSpacingJumps}
              copyParallel={{ on: paramsCopy, set: setParamsCopy }}
            />
          </div>
        )}
        {hint && <p className="text-[10px] text-fg-2 leading-snug">{hint}</p>}
        {p.blockMsg?.error && <p className="text-[10px] text-danger">{p.blockMsg.text}</p>}
      </div>
      <div className="flex justify-end gap-1.5 px-2 pb-2">
        <button onClick={p.cancelTool} className={smallBtn}>
          Cancel
        </button>
        <button
          onClick={p.commitTool}
          disabled={!ready}
          className="px-3 py-0.5 rounded bg-accent hover:bg-accent-hover text-white font-medium disabled:opacity-40 disabled:pointer-events-none"
        >
          OK
        </button>
      </div>
    </div>
  );
}
