import React from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { appWindow } from '../../utils/desktop';

const btn =
  'h-11 w-11 inline-flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-3 transition-colors';

/** Minimise, maximise / restore and close, for Windows and Linux. */
export const WindowControls: React.FC<{ maximized: boolean }> = ({ maximized }) => {
  const run = (f: (w: Awaited<ReturnType<typeof appWindow>>) => Promise<unknown>) => () =>
    void appWindow().then(f);
  return (
    <div className="flex items-center self-stretch -mr-2 shrink-0">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        className={btn}
        onClick={run((w) => w.minimize())}
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        className={btn}
        onClick={run((w) => w.toggleMaximize())}
      >
        {maximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        className={`${btn} hover:!bg-danger hover:!text-white`}
        onClick={run((w) => w.close())}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
