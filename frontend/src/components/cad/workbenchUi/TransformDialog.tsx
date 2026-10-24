import React, { useState } from 'react';
import {
  Crosshair,
  FlipHorizontal2,
  Move,
  MousePointerClick,
  RotateCw,
  Scaling,
  X,
} from 'lucide-react';
import type { Point2D } from '../../../types/cadWorkflow';
import type { CadTool } from '../workbenchCore';
import { GIZMO } from '../workbenchCore';
import { card, Field, smallBtn } from './blockEditor/shared';
import type { TransformCommand, XformPick } from './useTransformCommand';

const HEAD: Record<string, { label: string; icon: React.ElementType; hint: string }> = {
  move: {
    label: 'Move',
    icon: Move,
    hint: 'Click vertices or shapes, or drag a box round them. Drag an arrow or the centre square, or type the offset. From / To puts one point on another.',
  },
  scale: {
    label: 'Scale',
    icon: Scaling,
    hint: 'Click vertices or shapes, or drag a box. Drag a square tip for one axis or the centre for both, or type the factors. Scales about the base point (the centre of the selection until you pick one).',
  },
  rotate: {
    label: 'Rotate',
    icon: RotateCw,
    hint: 'Click vertices or shapes, or drag a box. Drag the ring (Shift for 15° steps) or type the angle; positive turns counter-clockwise.',
  },
  mirror: {
    label: 'Mirror',
    icon: FlipHorizontal2,
    hint: 'Click vertices or shapes, or drag a box. Then click Line and two points on the mirror line, or use a horizontal or vertical line through the centre.',
  },
  point: {
    label: 'Point',
    icon: Crosshair,
    hint: 'Click to place points, or type X and Y. Points are reference geometry: they guide snapping and never become walls.',
  },
};

const fmt = (p: Point2D | null) => (p ? `${+p.x.toFixed(4)}, ${+p.y.toFixed(4)}` : null);

/** A selection box (Fusion 360 style): click it, then click on the canvas. */
function PickField(p: {
  label: string;
  active: boolean;
  text: string | null;
  empty: string;
  onClick: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[64px] shrink-0 text-fg-2">{p.label}</span>
      <button
        onClick={p.onClick}
        className={`flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-1 rounded-sm border text-left transition-colors ${
          p.active
            ? 'border-accent bg-accent-soft text-accent-fg'
            : 'border-line bg-app text-fg-2 hover:border-line-strong'
        }`}
      >
        <MousePointerClick className="w-3 h-3 shrink-0" />
        <span className={`truncate ${p.text ? 'font-mono' : ''}`}>{p.text ?? p.empty}</span>
        {p.text && p.onClear && (
          <span
            role="button"
            title="Clear"
            onClick={(ev) => {
              ev.stopPropagation();
              p.onClear!();
            }}
            className="ml-auto text-fg-2 hover:text-fg"
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </button>
    </div>
  );
}

function NumRow(p: { label: string; value: number; onCommit: (v: number) => void; unit?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[64px] shrink-0 text-fg-2">{p.label}</span>
      <Field value={p.value} onCommit={(v) => v !== undefined && p.onCommit(v)} />
      {p.unit && <span className="w-3 text-fg-3">{p.unit}</span>}
    </div>
  );
}

/** The values of the active command, shared by the dialog and the box
 *  beside the handles. */
function useValues(cmd: TransformCommand) {
  const { xf, setXf } = cmd;
  const set = (patch: Partial<typeof xf>) => setXf((s) => ({ ...s, ...patch }));
  return {
    set,
    move: [
      { label: 'X', value: xf.dx, commit: (dx: number) => set({ dx, pick: 'objects' }) },
      { label: 'Y', value: xf.dy, commit: (dy: number) => set({ dy, pick: 'objects' }) },
    ],
    scale: xf.uniform
      ? [{ label: 'Factor', value: xf.sx, commit: (v: number) => v > 0 && set({ sx: v, sy: v }) }]
      : [
          { label: 'X', value: xf.sx, commit: (v: number) => v > 0 && set({ sx: v }) },
          { label: 'Y', value: xf.sy, commit: (v: number) => v > 0 && set({ sy: v }) },
        ],
    rotate: [{ label: 'Angle', value: xf.angle, commit: (angle: number) => set({ angle }) }],
  };
}

/** The value box that rides with the on-canvas handles: type a distance,
 *  factor or angle right where you are dragging. */
export function GizmoValues(p: { tool: CadTool; cmd: TransformCommand; at: Point2D }) {
  const vals = useValues(p.cmd);
  const rows =
    p.tool === 'move'
      ? vals.move
      : p.tool === 'scale'
        ? vals.scale
        : p.tool === 'rotate'
          ? vals.rotate
          : null;
  if (!rows) return null;
  return (
    <div
      className={`${card} absolute z-20 flex items-center gap-1.5 px-1.5 py-1 select-none`}
      style={
        p.tool === 'rotate'
          ? { left: p.at.x + GIZMO.ring + 14, top: p.at.y + 10 }
          : { left: p.at.x + 16, top: p.at.y + 16 }
      }
      onMouseDown={(ev) => ev.stopPropagation()}
    >
      {rows.map((r) => (
        <label key={r.label} className="flex items-center gap-1">
          <span className="text-fg-2">{r.label}</span>
          <span className="w-[64px]">
            <Field value={+r.value.toFixed(6)} onCommit={(v) => v !== undefined && r.commit(v)} />
          </span>
          {p.tool === 'rotate' && <span className="text-fg-3">°</span>}
        </label>
      ))}
    </div>
  );
}

/** The Move / Scale / Rotate / Mirror command dialog, and the Point tool's
 *  coordinate entry. OK (Enter) applies, Cancel (Esc) leaves. */
export function TransformDialog(p: {
  tool: CadTool;
  cmd: TransformCommand;
  addPoint: (pt: Point2D) => void;
  done: () => void;
}) {
  const { tool, cmd } = p;
  const [px, setPx] = useState(0);
  const [py, setPy] = useState(0);
  const vals = useValues(cmd);
  const head = HEAD[tool];
  if (!head) return null;
  const { xf } = cmd;
  const set = vals.set;
  // Clicking an active point field again goes back to selecting.
  const pickTo = (pick: XformPick) => () => set({ pick: xf.pick === pick ? 'objects' : pick });
  const { shapes, points } = cmd.count;
  const selText = [
    shapes ? `${shapes} shape${shapes > 1 ? 's' : ''}` : '',
    points ? `${points} point${points > 1 ? 's' : ''}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const Icon = head.icon;

  const body =
    tool === 'point' ? (
      <>
        <NumRow label="X" value={px} onCommit={setPx} />
        <NumRow label="Y" value={py} onCommit={setPy} />
        <div className="flex justify-end">
          <button className={smallBtn} onClick={() => p.addPoint({ x: px, y: py })}>
            Add point
          </button>
        </div>
      </>
    ) : (
      <>
        <PickField
          label="Select"
          active={xf.pick === 'objects'}
          text={selText || null}
          empty="Click or drag a box"
          onClick={() => set({ pick: 'objects' })}
          onClear={cmd.clearSelection}
        />
        {tool === 'move' && (
          <>
            {vals.move.map((r) => (
              <NumRow
                key={r.label}
                label={`${r.label} offset`}
                value={r.value}
                onCommit={r.commit}
              />
            ))}
            <PickField
              label="From"
              active={xf.pick === 'base'}
              text={fmt(xf.base)}
              empty="Pick a point (optional)"
              onClick={pickTo('base')}
              onClear={() => set({ base: null, pick: 'objects' })}
            />
            {xf.base && (
              <PickField
                label="To"
                active={xf.pick === 'target'}
                text={xf.dx || xf.dy ? fmt({ x: xf.base.x + xf.dx, y: xf.base.y + xf.dy }) : null}
                empty="Pick the target point"
                onClick={pickTo('target')}
              />
            )}
          </>
        )}
        {(tool === 'scale' || tool === 'rotate') && (
          <PickField
            label={tool === 'scale' ? 'Base' : 'Centre'}
            active={xf.pick === 'base'}
            text={xf.base ? fmt(xf.base) : cmd.pivot ? `centre (${fmt(cmd.pivot)})` : null}
            empty="Pick a point"
            onClick={pickTo('base')}
            onClear={xf.base ? () => set({ base: null, pick: 'objects' }) : undefined}
          />
        )}
        {tool === 'scale' && (
          <>
            <label className="flex items-center gap-1.5 text-fg-2">
              <input
                type="checkbox"
                checked={xf.uniform}
                onChange={(ev) =>
                  set(ev.target.checked ? { uniform: true, sy: xf.sx } : { uniform: false })
                }
                className="accent-accent"
              />
              Same factor for X and Y
            </label>
            {vals.scale.map((r) => (
              <NumRow
                key={r.label}
                label={r.label === 'Factor' ? 'Factor' : `${r.label} factor`}
                value={r.value}
                onCommit={r.commit}
              />
            ))}
          </>
        )}
        {tool === 'rotate' && (
          <NumRow label="Angle" value={xf.angle} onCommit={vals.rotate[0].commit} unit="°" />
        )}
        {tool === 'mirror' && (
          <>
            <PickField
              label="Line"
              active={xf.pick === 'm1' || xf.pick === 'm2'}
              text={
                xf.m1 && xf.m2
                  ? `${fmt(xf.m1)} to ${fmt(xf.m2)}`
                  : xf.pick === 'm2'
                    ? 'Pick the 2nd point'
                    : null
              }
              empty="Pick 2 points"
              onClick={() =>
                set(
                  xf.pick === 'm1' || xf.pick === 'm2'
                    ? { pick: 'objects' }
                    : { m1: null, m2: null, pick: 'm1' },
                )
              }
            />
            <div className="flex gap-1.5 pl-[72px]">
              {(
                [
                  ['Horizontal', 1, 0],
                  ['Vertical', 0, 1],
                ] as const
              ).map(([lbl, ux, uy]) => (
                <button
                  key={lbl}
                  className={smallBtn}
                  disabled={!cmd.pivot}
                  onClick={() => {
                    const c = cmd.pivot!;
                    set({ m1: c, m2: { x: c.x + ux, y: c.y + uy }, pick: 'objects' });
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </>
        )}
        <label
          className={`flex items-center gap-1.5 text-fg-2 ${cmd.partial ? 'opacity-50' : ''}`}
          title={
            cmd.partial ? 'Picked vertices always move; copies are of whole shapes.' : undefined
          }
        >
          <input
            type="checkbox"
            checked={xf.copy && !cmd.partial}
            disabled={cmd.partial}
            onChange={(ev) => set({ copy: ev.target.checked })}
            className="accent-accent"
          />
          Keep the originals (copy)
        </label>
      </>
    );

  return (
    <div className={`${card} absolute top-3 right-3 z-20 w-[268px] select-none`}>
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
        <Icon className="w-3.5 h-3.5 text-accent-fg" />
        <span className="font-semibold uppercase tracking-wide text-[10px]">{head.label}</span>
        <button onClick={p.done} className="ml-auto text-fg-2 hover:text-fg" title="Close (Esc)">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-2 space-y-1.5">
        {body}
        <p className="text-[10px] text-fg-2 leading-snug">{head.hint}</p>
      </div>
      {tool !== 'point' && (
        <div className="flex justify-end gap-1.5 px-2 pb-2">
          <button onClick={cmd.cancel} className={smallBtn}>
            Cancel
          </button>
          <button
            onClick={cmd.commit}
            disabled={!cmd.preview(null)}
            className="px-3 py-0.5 rounded bg-accent hover:bg-accent-hover text-white font-medium disabled:opacity-40 disabled:pointer-events-none"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}
