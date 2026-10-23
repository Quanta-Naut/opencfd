import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Kbd } from './Kbd';
import { MOD_LABEL } from '../../utils/platform';

export interface ShortcutGroup {
  title: string;
  items: { keys: string[]; label: string }[];
}

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** The full keyboard map, grouped by where it applies. Kept in one place so the
 * palette footer's "? all shortcuts" promise is always true. */
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    items: [
      { keys: [MOD_LABEL, 'K'], label: 'Command palette' },
      { keys: ['?'], label: 'This shortcut list' },
      { keys: ['1'], label: 'Go to Geometry' },
      { keys: ['2'], label: 'Go to Case Setup' },
      { keys: ['3'], label: 'Go to Mesh' },
      { keys: ['4'], label: 'Go to Solver' },
      { keys: ['5'], label: 'Go to Results' },
      { keys: [MOD_LABEL, '↵'], label: 'Run / stop the solver' },
      { keys: [MOD_LABEL, 'B'], label: 'Show / hide the stage panel' },
      { keys: ['Esc'], label: 'Close dialog or cancel current tool' },
    ],
  },
  {
    title: 'Sketch (Geometry stage)',
    items: [
      { keys: ['L'], label: 'Line' },
      { keys: ['P'], label: 'Polyline' },
      { keys: ['R'], label: 'Rectangle' },
      { keys: ['C'], label: 'Circle' },
      { keys: ['A'], label: 'Arc' },
      { keys: ['S'], label: 'Select' },
      { keys: ['T'], label: 'Trim' },
      { keys: [MOD_LABEL, 'Z'], label: 'Undo' },
      { keys: [MOD_LABEL, '⇧', 'Z'], label: 'Redo' },
      { keys: ['Del'], label: 'Delete selection' },
      { keys: ['F3'], label: 'Toggle snapping (all inferences)' },
      { keys: ['F9'], label: 'Toggle grid snap' },
      { keys: ['F7'], label: 'Toggle grid display' },
      { keys: ['F8'], label: 'Toggle ortho lock' },
    ],
  },
];

export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ open, onClose }) => {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-[12vh] bg-scrim"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-[560px] max-w-[92vw] bg-surface border border-line-strong rounded overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="flex items-center justify-between px-3 h-10 border-b border-line">
          <span className="text-[13px] font-semibold text-fg">Keyboard shortcuts</span>
          <button
            onClick={onClose}
            className="p-1 -mr-1 text-fg-4 hover:text-fg rounded transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-3 mb-2">
                {group.title}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4">
                    <span className="text-[12px] text-fg">{item.label}</span>
                    <span className="flex items-center gap-0.5 shrink-0">
                      {item.keys.map((k, i) => (
                        <Kbd key={`${k}-${i}`}>{k}</Kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
};
