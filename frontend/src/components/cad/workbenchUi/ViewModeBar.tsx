import React from 'react';
import { Check } from 'lucide-react';

/** Mesh / Results view toggles (blocks, mesh, quality, field, wireframe, streamlines), shown only when there are controls. */
export function ViewModeBar(p: ViewModeBarProps) {
  const {
    displayOnly,
    meshOnly,
    showField,
    canvasMode,
    setCanvasMode,
    structuredView,
    blocksOn,
    setBlocksOn,
    setMeshOn,
    meshLayer,
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
              {(structuredView
                ? [
                    // Structured: blocks and mesh are layers, each on or off.
                    {
                      id: 'blocks',
                      label: 'Blocks',
                      on: blocksOn,
                      disabled: false,
                      onClick: () => setBlocksOn((v) => !v),
                    },
                    {
                      id: 'mesh',
                      label: 'Mesh',
                      on: meshLayer,
                      disabled: !meshData,
                      onClick: () => setMeshOn((v) => !v),
                    },
                    {
                      id: 'quality',
                      label: 'Quality',
                      on: meshLayer && showMeshQuality,
                      disabled: !meshLayer,
                      title: 'Colour each cell by skewness',
                      onClick: () => setShowMeshQuality((v) => !v),
                    },
                  ]
                : [
                    {
                      id: 'mesh',
                      label: 'Mesh',
                      on: canvasMode === 'mesh' && !showMeshQuality,
                      disabled: !meshData || meshStale,
                      onClick: () => {
                        setCanvasMode('mesh');
                        setShowMeshQuality(false);
                      },
                    },
                    {
                      id: 'quality',
                      label: 'Quality',
                      on: canvasMode === 'mesh' && showMeshQuality,
                      disabled: !meshData || meshStale,
                      title: 'Colour each cell by skewness',
                      onClick: () => {
                        setCanvasMode('mesh');
                        setShowMeshQuality(true);
                      },
                    },
                  ]
              ).map(
                (m: {
                  id: string;
                  label: string;
                  on: boolean;
                  disabled: boolean;
                  title?: string;
                  onClick: () => void;
                }) => (
                  <button
                    key={m.id}
                    onClick={() => !m.disabled && m.onClick()}
                    disabled={m.disabled}
                    aria-pressed={m.on}
                    title={m.title || (m.disabled ? 'Generate a mesh first' : undefined)}
                    className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium text-fg-2 hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span
                      className={`w-3 h-3 rounded-sm border flex items-center justify-center ${
                        m.on ? 'border-fg-2 bg-fg-2' : 'border-line-strong'
                      }`}
                    >
                      {m.on && <Check className="w-2.5 h-2.5 text-surface" strokeWidth={3} />}
                    </span>
                    <span className={m.on ? 'text-fg' : ''}>{m.label}</span>
                  </button>
                ),
              )}
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
  /** Structured meshing: blocks and mesh are independent layers. */
  structuredView: boolean;
  blocksOn: boolean;
  setBlocksOn: React.Dispatch<React.SetStateAction<boolean>>;
  meshOn: boolean;
  setMeshOn: React.Dispatch<React.SetStateAction<boolean>>;
  meshLayer: boolean;
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
