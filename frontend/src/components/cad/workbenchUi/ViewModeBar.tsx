import React from 'react';

/** Mesh / Results view toggles (blocks, mesh, quality, field, wireframe, streamlines), shown only when there are controls. */
export function ViewModeBar(p: ViewModeBarProps) {
  const {
    displayOnly,
    meshOnly,
    showField,
    showBlocking,
    canvasMode,
    setCanvasMode,
    showMesh,
    showMeshQuality,
    meshData,
    meshStale,
    setShowMeshQuality,
    setShowMeshWireframe,
    showMeshWireframe,
    setShowResultsStreamlines,
    showResultsStreamlines,
  } = p;
  return (
    <>
      {/* Top Controls Bar - only when it actually has controls (blocks/mesh
            toggle in CAD/mesh stages, overlay toggles in Results). The solver
            stage has neither, so no empty pill. */}
      {displayOnly && (!meshOnly || showField) && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-surface border border-line rounded px-2 py-1 text-xs select-none">
          {!meshOnly ? (
            <>
              {[
                // "Blocks" only exists for structured meshing (showBlocking).
                ...(showBlocking
                  ? [
                      {
                        id: 'blocks',
                        label: 'Blocks',
                        active: canvasMode === 'cad',
                        disabled: false,
                        title: undefined as string | undefined,
                        onClick: () => setCanvasMode('cad'),
                      },
                    ]
                  : []),
                {
                  id: 'mesh',
                  label: 'Mesh',
                  active: canvasMode === 'mesh' && !showMeshQuality,
                  disabled: !meshData || meshStale,
                  title: undefined as string | undefined,
                  onClick: () => {
                    setCanvasMode('mesh');
                    setShowMeshQuality(false);
                  },
                },
                {
                  id: 'quality',
                  label: 'Quality',
                  active: canvasMode === 'mesh' && showMeshQuality,
                  disabled: !meshData || meshStale,
                  title: 'Colour each cell by skewness - spot bad cells before solving',
                  onClick: () => {
                    setCanvasMode('mesh');
                    setShowMeshQuality(true);
                  },
                },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => !m.disabled && m.onClick()}
                  disabled={m.disabled}
                  title={m.title || (m.disabled ? 'Generate a mesh first' : undefined)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                    m.active
                      ? 'bg-app text-fg font-semibold'
                      : 'text-fg-2 hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  {m.label}
                </button>
              ))}
              {meshStale && showMesh && (
                <span className="ml-1 text-[10px] text-warning font-medium">
                  stale - regenerate
                </span>
              )}
            </>
          ) : showField ? (
            <div className="flex items-center gap-1">
              {/* Mesh Wireframe Toggle */}
              <button
                onClick={() => setShowMeshWireframe((w) => !w)}
                title="Toggle Mesh Cells Wireframe Overlay"
                className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                  showMeshWireframe
                    ? 'bg-accent-soft text-accent-fg font-semibold '
                    : 'text-fg-2 hover:text-fg hover:bg-app'
                }`}
              >
                <span>Mesh</span>
              </button>

              {/* Streamlines Toggle */}
              <button
                onClick={() => setShowResultsStreamlines((s) => !s)}
                title="Toggle Flow Streamlines Overlay"
                className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                  showResultsStreamlines
                    ? 'bg-accent-soft text-accent-fg font-semibold '
                    : 'text-fg-2 hover:text-fg hover:bg-app'
                }`}
              >
                <span>Streamlines</span>
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

export interface ViewModeBarProps {
  displayOnly: boolean;
  meshOnly: boolean;
  showField: boolean;
  showBlocking: boolean;
  canvasMode: 'cad' | 'mesh';
  setCanvasMode: React.Dispatch<React.SetStateAction<'cad' | 'mesh'>>;
  showMesh: boolean;
  showMeshQuality: boolean;
  meshData: any;
  meshStale: boolean;
  setShowMeshQuality: React.Dispatch<React.SetStateAction<boolean>>;
  setShowMeshWireframe: React.Dispatch<React.SetStateAction<boolean>>;
  showMeshWireframe: boolean;
  setShowResultsStreamlines: React.Dispatch<React.SetStateAction<boolean>>;
  showResultsStreamlines: boolean;
}
