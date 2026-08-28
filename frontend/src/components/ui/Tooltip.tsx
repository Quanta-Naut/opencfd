import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type State = 'hidden' | 'in' | 'out';

interface TooltipProps {
  content: React.ReactNode;
  /** A single DOM element (button / span / div / label). */
  children: React.ReactElement;
  delay?: number;
  maxWidth?: number;
}

/**
 * Clean floating tooltip. Renders into <body> (never clipped by scroll areas),
 * fades + slides in after a short hover delay, fades out on leave.
 */
export const Tooltip: React.FC<TooltipProps> = ({ content, children, delay = 750, maxWidth = 260 }) => {
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const suppressed = useRef(false); // stays suppressed after a click until the pointer leaves
  const [state, setState] = useState<State>('hidden');
  const [pos, setPos] = useState<{ left: number; top: number; placement: 'top' | 'bottom' }>({
    left: 0, top: 0, placement: 'bottom',
  });

  const clear = () => window.clearTimeout(timer.current);

  // Arm the show timer. Called on enter AND on every move, so it only fires once
  // the pointer has been still over the element for `delay` ms (static hover).
  const arm = useCallback(() => {
    if (suppressed.current) return;
    clear();
    timer.current = window.setTimeout(() => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const roomBelow = window.innerHeight - r.bottom;
      const placement: 'top' | 'bottom' = roomBelow < 150 && r.top > roomBelow ? 'top' : 'bottom';
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - maxWidth - 8));
      const top = placement === 'bottom' ? r.bottom + 8 : r.top - 8;
      setPos({ left, top, placement });
      setState('in');
    }, delay);
  }, [delay, maxWidth]);

  const hide = useCallback(() => {
    clear();
    setState((s) => (s === 'hidden' ? s : 'out'));
  }, []);

  const onLeave = useCallback(() => {
    suppressed.current = false;
    hide();
  }, [hide]);

  const onDown = useCallback(() => {
    suppressed.current = true;
    hide();
  }, [hide]);

  useEffect(() => () => clear(), []);

  const setRef = useCallback((node: HTMLElement | null) => {
    anchor.current = node;
    const childRef = (children as any).ref;
    if (typeof childRef === 'function') childRef(node);
    else if (childRef && typeof childRef === 'object') childRef.current = node;
  }, [children]);

  const compose = (own: any, mine: (e: any) => void) => (e: any) => { own?.(e); mine(e); };

  const childProps = (children.props ?? {}) as Record<string, any>;
  const trigger = React.cloneElement(children as React.ReactElement<any>, {
    ref: setRef,
    onMouseEnter: compose(childProps.onMouseEnter, arm),
    onMouseMove: compose(childProps.onMouseMove, arm),
    onMouseLeave: compose(childProps.onMouseLeave, onLeave),
    onMouseDown: compose(childProps.onMouseDown, onDown),
  });

  return (
    <>
      {trigger}
      {state !== 'hidden' &&
        createPortal(
          <div
            data-placement={pos.placement}
            data-state={state}
            onTransitionEnd={() => { if (state === 'out') setState('hidden'); }}
            style={{ position: 'fixed', left: pos.left, top: pos.top, maxWidth }}
            className="tooltip-pop pointer-events-none z-[9999] rounded-lg bg-white border border-[#E4E7EC] px-3 py-2 text-[11px] leading-relaxed text-[#3F4652] shadow-[0_10px_30px_-6px_rgba(15,23,42,0.18),0_2px_8px_-2px_rgba(15,23,42,0.10)]"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
};

export default Tooltip;
