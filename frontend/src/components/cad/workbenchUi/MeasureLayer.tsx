import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ruler, X, Copy } from 'lucide-react';
import type { Point2D } from '../../../types/cadWorkflow';
import { Tooltip } from '../../ui/Tooltip';

export interface MeasureLayerProps {
  /** The container the canvas lives in; clicks on the bare canvas place points. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  glCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  toScreen: (wx: number, wy: number) => Point2D;
  toWorld: (cx: number, cy: number) => Point2D;
  /** Called when measuring starts, so a drawing tool does not stay armed. */
  onStart?: () => void;
  /** The sketch tool rail is on the left; sit beside it. */
  besideRail?: boolean;
}

const fmtLen = (d: number) => {
  const a = Math.abs(d);
  if (a === 0) return '0 m';
  if (a < 0.01) return `${Number((d * 1000).toPrecision(4))} mm`;
  return `${Number(d.toPrecision(5))} m`;
};

interface Pair {
  a: number;
  b: number;
  d: number;
  dx: number;
  dy: number;
}

/** Measure tool: click any number of points on the canvas and every distance
 * between them is drawn and listed. Works the same on every tab. */
export const MeasureLayer: React.FC<MeasureLayerProps> = ({
  containerRef,
  canvasRef,
  glCanvasRef,
  toScreen,
  toWorld,
  onStart,
  besideRail = false,
}) => {
  const [on, setOn] = useState(false);
  const [pts, setPts] = useState<Point2D[]>([]);
  const [cursor, setCursor] = useState<Point2D | null>(null);
  const down = useRef({ x: 0, y: 0 });
  const live = useRef({ toWorld, pts });
  live.current = { toWorld, pts };

  const toggle = () => {
    setOn((v) => {
      if (!v) onStart?.();
      return !v;
    });
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!on || !el) return;
    const prevCursor = el.style.cursor;
    el.style.cursor = 'crosshair';
    const isCanvas = (t: EventTarget | null) =>
      t === canvasRef.current || t === glCanvasRef.current;
    const onDown = (e: MouseEvent) => {
      down.current = { x: e.clientX, y: e.clientY };
      // The sketch editor selects and drags on a left press; measuring must not.
      if (besideRail && e.button === 0 && isCanvas(e.target)) e.stopPropagation();
    };
    const onUp = (e: MouseEvent) => {
      if (besideRail && e.button === 0 && isCanvas(e.target)) e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !isCanvas(e.target)) return;
      if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 4) return;
      e.stopPropagation();
      e.preventDefault();
      const p = live.current.toWorld(e.clientX, e.clientY);
      setPts((prev) => [...prev, p]);
    };
    const onMove = (e: MouseEvent) => {
      if (!isCanvas(e.target)) return setCursor(null);
      const r = el.getBoundingClientRect();
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const onLeave = () => setCursor(null);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (e.key === 'Escape') {
        if (live.current.pts.length) setPts([]);
        else setOn(false);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (live.current.pts.length) {
          e.preventDefault();
          e.stopPropagation();
          setPts((p) => p.slice(0, -1));
        }
      }
    };
    el.addEventListener('mousedown', onDown, true);
    el.addEventListener('mouseup', onUp, true);
    el.addEventListener('click', onClick, true);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    window.addEventListener('keydown', onKey, true);
    return () => {
      el.style.cursor = prevCursor;
      el.removeEventListener('mousedown', onDown, true);
      el.removeEventListener('mouseup', onUp, true);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('keydown', onKey, true);
      setCursor(null);
    };
  }, [on, besideRail, containerRef, canvasRef, glCanvasRef]);

  const pairs = useMemo(() => {
    const out: Pair[] = [];
    for (let a = 0; a < pts.length; a++)
      for (let b = a + 1; b < pts.length; b++) {
        const dx = pts[b].x - pts[a].x;
        const dy = pts[b].y - pts[a].y;
        out.push({ a, b, d: Math.hypot(dx, dy), dx, dy });
      }
    return out;
  }, [pts]);
  const path = pairs.filter((p) => p.b === p.a + 1).reduce((s, p) => s + p.d, 0);

  const copy = () => {
    const rows = [
      'from,to,distance_m,dx_m,dy_m',
      ...pairs.map((p) => `${p.a + 1},${p.b + 1},${p.d},${p.dx},${p.dy}`),
    ];
    navigator.clipboard?.writeText(rows.join('\n')).catch(() => {});
  };

  const sp = pts.map((p) => toScreen(p.x, p.y));
  // Every pair is drawn up to five points, after that only the chain, so the
  // canvas stays readable; the table always lists them all.
  const drawn = pts.length <= 5 ? pairs : pairs.filter((p) => p.b === p.a + 1);
  const last = sp[sp.length - 1];
  const live2 = on && cursor && last ? Math.hypot(cursor.x - last.x, cursor.y - last.y) : 0;
  let liveDist = 0;
  if (live2 > 0) {
    const r = containerRef.current?.getBoundingClientRect();
    const w = toWorld(cursor!.x + (r?.left ?? 0), cursor!.y + (r?.top ?? 0));
    const q = pts[pts.length - 1];
    liveDist = Math.hypot(w.x - q.x, w.y - q.y);
  }

  const label = (x: number, y: number, text: string, key: string, strong: boolean) => {
    const w = text.length * 6.4 + 10;
    return (
      <g key={key} transform={`translate(${x},${y})`}>
        <rect
          x={-w / 2}
          y={-9}
          width={w}
          height={18}
          rx={3}
          fill="var(--surface)"
          stroke="var(--line-strong)"
          opacity={strong ? 1 : 0.92}
        />
        <text
          textAnchor="middle"
          dy="3.5"
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          fill="var(--fg)"
        >
          {text}
        </text>
      </g>
    );
  };

  return (
    <>
      <div
        className="absolute z-20 flex flex-col gap-2 items-start select-none"
        style={{
          left: besideRail ? 56 : 12,
          bottom: 'calc(var(--app-bottom-bar, 0px) + 44px)',
        }}
      >
        {on && (
          <div className="w-60 bg-surface border border-line rounded text-[11px] text-fg">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-line-soft">
              <span className="font-semibold">Measure</span>
              <span className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={copy}
                  disabled={!pairs.length}
                  title="Copy as CSV"
                  className="p-1 rounded text-fg-2 hover:bg-surface-3 hover:text-fg disabled:opacity-30"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPts([])}
                  disabled={!pts.length}
                  className="px-1.5 py-0.5 rounded text-fg-2 hover:bg-surface-3 hover:text-fg disabled:opacity-30"
                >
                  Clear
                </button>
              </span>
            </div>
            {pts.length < 2 ? (
              <p className="px-2.5 py-2 text-fg-2">
                {pts.length === 0
                  ? 'Click a point, then another. Add as many as you like.'
                  : 'Click a second point.'}
              </p>
            ) : (
              <div className="max-h-48 overflow-auto">
                <table className="w-full font-mono">
                  <tbody>
                    {pairs.map((p) => (
                      <tr key={`${p.a}-${p.b}`} className="border-b border-line-soft last:border-0">
                        <td className="pl-2.5 py-1 text-fg-2">
                          {p.a + 1} to {p.b + 1}
                        </td>
                        <td className="pr-2.5 py-1 text-right font-semibold">{fmtLen(p.d)}</td>
                      </tr>
                    ))}
                    {pts.length > 2 && (
                      <tr className="bg-surface-2">
                        <td className="pl-2.5 py-1 text-fg-2">Path</td>
                        <td className="pr-2.5 py-1 text-right font-semibold">{fmtLen(path)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-2.5 py-1.5 border-t border-line-soft text-[10px] text-fg-3">
              Backspace removes the last point. Esc clears, then exits.
            </div>
          </div>
        )}
        <Tooltip content="Measure distances" delay={350} side="right">
          <button
            type="button"
            aria-label="Measure"
            aria-pressed={on}
            onClick={toggle}
            className={`w-8 h-8 inline-flex items-center justify-center rounded border transition-colors ${
              on
                ? 'bg-accent-soft text-accent-fg border-accent-line'
                : 'bg-surface text-fg-2 border-line hover:text-fg hover:bg-surface-3'
            }`}
          >
            <Ruler className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      {pts.length > 0 && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-[15]">
          {drawn.map((p) => {
            const a = sp[p.a];
            const b = sp[p.b];
            const chain = p.b === p.a + 1;
            return (
              <line
                key={`l${p.a}-${p.b}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--accent)"
                strokeWidth={chain ? 1.75 : 1}
                strokeDasharray={chain ? undefined : '4 4'}
                opacity={chain ? 1 : 0.7}
              />
            );
          })}
          {on && cursor && last && (
            <line
              x1={last.x}
              y1={last.y}
              x2={cursor.x}
              y2={cursor.y}
              stroke="var(--accent)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          )}
          {drawn.map((p, i) => {
            const a = sp[p.a];
            const b = sp[p.b];
            const chain = p.b === p.a + 1;
            // Stagger the labels of non-chain lines so they do not stack on a crossing.
            const t = chain ? 0.5 : 0.35 + 0.3 * ((i % 3) / 2);
            return label(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, fmtLen(p.d), `t${i}`, chain);
          })}
          {on && cursor && last && live2 > 6 && (
            <g opacity={0.9}>
              {label(cursor.x + 38, cursor.y - 16, fmtLen(liveDist), 'live', false)}
            </g>
          )}
          {sp.map((s, i) => (
            <g key={`p${i}`} transform={`translate(${s.x},${s.y})`}>
              <circle r={5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />
              <text
                x={9}
                y={-8}
                fontSize={11}
                fontWeight={600}
                fontFamily="ui-monospace, monospace"
                fill="var(--accent-fg)"
              >
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      )}
    </>
  );
};
