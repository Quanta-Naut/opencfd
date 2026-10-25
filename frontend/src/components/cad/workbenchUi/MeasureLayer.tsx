import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Point2D } from '../../../types/cadWorkflow';

export interface MeasureLayerProps {
  /** The container the canvas lives in; clicks on the bare canvas place points. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  glCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  toScreen: (wx: number, wy: number) => Point2D;
  toWorld: (cx: number, cy: number) => Point2D;
  /** Whether measuring is on; the toggle lives in the top bar. */
  on: boolean;
  onChange: (on: boolean) => void;
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
  on,
  onChange,
  onStart,
  besideRail = false,
}) => {
  const [pts, setPts] = useState<Point2D[]>([]);
  const [cursor, setCursor] = useState<Point2D | null>(null);
  const down = useRef({ x: 0, y: 0 });
  const live = useRef({ toWorld, pts });
  live.current = { toWorld, pts };

  // D toggles measuring, like the top bar button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'd' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (/INPUT|SELECT|TEXTAREA/.test(t.tagName) || t.isContentEditable)) return;
      onChange(!on);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, onChange]);

  useEffect(() => {
    if (on) onStart?.();
    else setPts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

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
        else onChange(false);
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
  }, [on, onChange, besideRail, containerRef, canvasRef, glCanvasRef]);

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
  const sp = pts.map((p) => toScreen(p.x, p.y));
  const drawn = pairs;
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
      {on && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 px-2.5 py-1 bg-surface border border-line rounded text-[11px] text-fg-2 pointer-events-none select-none"
          style={{ top: besideRail ? 64 : 12 }}
        >
          Measure: click points. Backspace undoes, Esc clears, Esc again exits.
        </div>
      )}

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
