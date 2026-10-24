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
import { card, Field, smallBtn } from './blockEditor/shared';
import type { TransformCommand, XformPick } from './useTransformCommand';

const HEAD: Record<string, { label: string; icon: React.ElementType; hint: string }> = {
  move: {
    label: 'Move',
    icon: Move,
    hint: 'Click a base point, then where it goes. Or type the offset.',
  },
  scale: {
    label: 'Scale',
    icon: Scaling,
    hint: 'Scales about the base point (the centre of the shapes until you pick one). Uneven X and Y turn circles into ellipses.',
  },
  rotate: {
    label: 'Rotate',
    icon: RotateCw,
    hint: 'Turns about the centre point, counter-clockwise for a positive angle.',
  },
  mirror: {
    label: 'Mirror',
    icon: FlipHorizontal2,
    hint: 'Click two points on the mirror line, or use a horizontal or vertical line through the centre.',
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

/** The Move / Scale / Rotate / Mirror command dialog, and the Point tool's
 *  coordinate entry. OK (Enter) applies, Cancel (Esc) leaves. */
export function TransformDialog(p: {
  tool: CadTool;
  cmd: TransformCommand;
  clearSelection: () => void;
  addPoint: (pt: Point2D) => void;
  done: () => void;
}) {
  const { tool, cmd } = p;
  const [px, setPx] = useState(0);
  const [py, setPy] = useState(0);
  const head = HEAD[tool];
  if (!head) return null;
  const { xf, setXf } = cmd;
  const set = (patch: Partial<typeof xf>) => setXf((s) => ({ ...s, ...patch }));
  const pickTo = (pick: XformPick) => () => set({ pick });
  const n = cmd.selected.length;
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
          label="Objects"
          active={xf.pick === 'objects'}
          text={n ? `${n} shape${n > 1 ? 's' : ''}` : null}
          empty="Select shapes"
          onClick={pickTo('objects')}
          onClear={() => {
            p.clearSelection();
            set({ pick: 'objects' });
          }}
        />
        {tool === 'move' && (
          <>
            <PickField
              label="From"
              active={xf.pick === 'base'}
              text={fmt(xf.base)}
              empty="Pick base point"
              onClick={pickTo('base')}
              onClear={() => set({ base: null, pick: 'base' })}
            />
            <PickField
              label="To"
              active={xf.pick === 'target'}
              text={
                xf.base && (xf.dx || xf.dy)
                  ? fmt({ x: xf.base.x + xf.dx, y: xf.base.y + xf.dy })
                  : null
              }
              empty="Pick target point"
              onClick={() => set({ pick: xf.base ? 'target' : 'base' })}
            />
            <NumRow
              label="X offset"
              value={+xf.dx.toFixed(6)}
              onCommit={(dx) => set({ dx, pick: null })}
            />
            <NumRow
              label="Y offset"
              value={+xf.dy.toFixed(6)}
              onCommit={(dy) => set({ dy, pick: null })}
            />
          </>
        )}
        {(tool === 'scale' || tool === 'rotate') && (
          <PickField
            label={tool === 'scale' ? 'Base' : 'Centre'}
            active={xf.pick === 'base'}
            text={xf.base ? fmt(xf.base) : cmd.pivot ? `centre (${fmt(cmd.pivot)})` : null}
            empty="Pick point"
            onClick={pickTo('base')}
            onClear={xf.base ? () => set({ base: null }) : undefined}
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
            {xf.uniform ? (
              <NumRow label="Factor" value={xf.sx} onCommit={(v) => v && set({ sx: v, sy: v })} />
            ) : (
              <>
                <NumRow label="X factor" value={xf.sx} onCommit={(v) => v && set({ sx: v })} />
                <NumRow label="Y factor" value={xf.sy} onCommit={(v) => v && set({ sy: v })} />
              </>
            )}
          </>
        )}
        {tool === 'rotate' && (
          <NumRow label="Angle" value={xf.angle} onCommit={(angle) => set({ angle })} unit="°" />
        )}
        {tool === 'mirror' && (
          <>
            <PickField
              label="Line"
              active={xf.pick === 'm1' || xf.pick === 'm2'}
              text={
                xf.m1 && xf.m2 ? `${fmt(xf.m1)} → ${fmt(xf.m2)}` : xf.m1 ? 'Pick 2nd point' : null
              }
              empty="Pick 2 points"
              onClick={() => set({ m1: null, m2: null, pick: 'm1' })}
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
                    set({ m1: c, m2: { x: c.x + ux, y: c.y + uy }, pick: null });
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="flex items-center gap-1.5 text-fg-2">
          <input
            type="checkbox"
            checked={xf.copy}
            onChange={(ev) => set({ copy: ev.target.checked })}
            className="accent-accent"
          />
          Keep the originals (copy)
        </label>
      </>
    );

  return (
    <div className={`${card} absolute top-3 right-3 z-20 w-[260px] select-none`}>
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
