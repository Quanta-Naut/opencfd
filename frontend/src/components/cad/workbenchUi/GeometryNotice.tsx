import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip';

/**
 * Mesh tab, top right: the geometry was edited after the blocks or the mesh
 * were made. The canvas keeps showing the geometry they belong to; Update
 * takes the latest geometry and domain and clears the blocks and the mesh.
 * Later folds the notice into a yellow warning button that opens it again.
 */
export function GeometryNotice(p: { structured: boolean; onUpdate: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open)
    return (
      <Tooltip content="Geometry changed" delay={250}>
        <button
          type="button"
          aria-label="Geometry changed"
          onClick={() => setOpen(true)}
          className="w-8 h-8 inline-flex items-center justify-center rounded bg-warning-soft border border-warning-line text-warning hover:border-warning transition-colors"
        >
          <AlertTriangle className="w-4 h-4" strokeWidth={2.25} />
        </button>
      </Tooltip>
    );
  return (
    <div
      role="alertdialog"
      aria-label="Geometry changed"
      className="w-[264px] bg-surface border border-warning-line rounded text-[11px] text-fg select-none"
    >
      <div className="flex items-center gap-2 px-2 py-1.5 bg-warning-soft border-b border-warning-line rounded-t">
        <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" strokeWidth={2.25} />
        <span className="font-semibold">Geometry changed</span>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto text-fg-2 hover:text-fg"
          title="Hide"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="px-2 pt-1.5 text-fg-2 leading-snug">
        This view shows the geometry your {p.structured ? 'blocks and mesh' : 'mesh'}{' '}
        {p.structured ? 'were' : 'was'} made from. Update loads the latest geometry and domain and
        clears the {p.structured ? 'blocks and the mesh' : 'mesh'}.
      </p>
      <div className="flex justify-end gap-1.5 px-2 py-2">
        <button
          onClick={() => setOpen(false)}
          className="px-2 py-0.5 rounded border border-line bg-surface text-fg-2 hover:text-fg hover:border-line-strong transition-colors"
        >
          Later
        </button>
        <button
          onClick={p.onUpdate}
          className="px-3 py-0.5 rounded bg-accent hover:bg-accent-hover text-white font-medium"
        >
          Update
        </button>
      </div>
    </div>
  );
}
