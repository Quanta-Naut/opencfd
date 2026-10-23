import React from 'react';

/** Solver stage: live field preview controls. Mesh wireframe and field colouring are independent toggles. */
export function LivePreviewControls(p: LivePreviewControlsProps) {
  const {
    displayOnly,
    meshOnly,
    showField,
    livePreview,
    setLiveMeshOn,
    liveMeshOn,
    setLiveField,
    liveField,
  } = p;
  return (
    <>
      {/* Solver stage: live cell-based field preview controls - mesh
            wireframe and field colouring are independent toggles, not a
            single radio group, and each field button re-clicks off. */}
      {displayOnly && meshOnly && !showField && livePreview && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-surface border border-line rounded px-2 py-1 text-xs select-none">
          <button
            onClick={() => setLiveMeshOn((m) => !m)}
            title="Toggle mesh wireframe overlay"
            className={`px-2 py-0.5 rounded text-[11px] font-medium ${
              liveMeshOn ? 'bg-app text-fg font-semibold' : 'text-fg-2 hover:text-fg'
            }`}
          >
            Mesh
          </button>
          {(['U_mag', 'p', 'k'] as const)
            .filter((f) => Array.isArray(livePreview.fields[f]))
            .map((f) => (
              <button
                key={f}
                onClick={() => setLiveField((cur) => (cur === f ? null : f))}
                title={liveField === f ? 'Click to hide this field' : undefined}
                className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                  liveField === f
                    ? 'bg-accent-soft text-accent-fg font-semibold'
                    : 'text-fg-2 hover:text-fg'
                }`}
              >
                {f === 'U_mag' ? '[U]' : f}
              </button>
            ))}
        </div>
      )}
    </>
  );
}

export interface LivePreviewControlsProps {
  displayOnly: boolean;
  meshOnly: boolean;
  showField: boolean;
  livePreview: {
    time: string;
    fields: Record<string, number[]>;
    ranges: Record<string, [number, number]>;
  };
  setLiveMeshOn: React.Dispatch<React.SetStateAction<boolean>>;
  liveMeshOn: boolean;
  setLiveField: React.Dispatch<React.SetStateAction<'U_mag' | 'p' | 'k'>>;
  liveField: 'U_mag' | 'p' | 'k';
}
