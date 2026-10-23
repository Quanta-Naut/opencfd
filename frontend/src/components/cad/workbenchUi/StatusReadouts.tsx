import { Point2D } from '../../../types/cadWorkflow';
import type { CadTool, Snap } from '../workbenchCore';

/** Floating readouts at the bottom of the viewport: cursor coordinates, scale bar and mesh statistics. */
export function StatusReadouts(p: StatusReadoutsProps) {
  const {
    displayOnly,
    showMesh,
    hud,
    scaleInfo,
    tool,
    snap,
    meshData,
    meshCellCounts,
    isDrawing,
    tempPts,
    hoveredVertex,
  } = p;
  return (
    <>
      {/* ════════════════════ FLOATING STATUS READOUTS ═════════════════════════════════ */}
      {!(displayOnly && !showMesh) && (
        <>
          {/* Bottom Left: Live Cursor Position & Google Maps Style Scale Indicator */}
          <div
            className="absolute left-3 z-20 flex items-center gap-3 bg-surface border border-line rounded-sm px-2.5 py-1 text-[11px] font-mono text-fg-2 pointer-events-none select-none"
            style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 10px)' }}
          >
            <div className="flex items-center gap-2.5">
              <span>
                X: <strong className="text-fg">{hud.x}</strong>
              </span>
              <span>
                Y: <strong className="text-fg">{hud.y}</strong>
              </span>
            </div>

            <div className="h-3 w-px bg-line-strong" />

            {/* Google Maps Style Scale Indicator */}
            <div className="flex items-center gap-1.5" title={`Scale: ${scaleInfo.label}`}>
              <span className="text-[10px] font-bold text-fg leading-none">{scaleInfo.label}</span>
              <div className="flex items-end h-2">
                <div
                  className="h-1.5 border-l-2 border-r-2 border-b border-fg bg-fg/5"
                  style={{ width: `${scaleInfo.barWidthPx}px` }}
                />
              </div>
            </div>

            {tool !== 'select' && snap.type !== 'grid' && (
              <>
                <div className="h-3 w-px bg-line-strong" />
                <span className="text-[10px] text-success uppercase font-bold">[{snap.type}]</span>
              </>
            )}
          </div>

          {/* Bottom Right: mesh summary in Mesh view; otherwise the live length/angle/
              diameter of the shape being drawn, or the position of a hovered vertex. */}
          {(() => {
            if (showMesh && meshData?.num_elements) {
              const { triangles, quads } = meshCellCounts;
              const minAngle = meshData.quality?.min_angle_degrees;
              const skew = meshData.quality?.max_skewness;
              return (
                <div
                  className="absolute right-3 z-20 flex items-center gap-3 bg-surface border border-line rounded-sm px-2.5 py-1 text-[11px] font-mono text-fg-2 pointer-events-none select-none"
                  style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 10px)' }}
                >
                  <span>
                    <strong className="text-fg">{meshData.num_nodes}</strong> nodes
                  </span>
                  <span>
                    <strong className="text-fg">{meshData.num_elements}</strong> cells
                  </span>
                  <span>
                    <strong className="text-fg">{triangles}</strong> tri ·{' '}
                    <strong className="text-fg">{quads}</strong> quad
                  </span>
                  {minAngle !== undefined && (
                    <span className={minAngle < 15 ? 'text-warning' : 'text-success'}>
                      <strong>{minAngle.toFixed(0)}°</strong> min
                    </span>
                  )}
                  {skew !== undefined && (
                    <span>
                      skew <strong className="text-fg">{skew.toFixed(2)}</strong>
                    </span>
                  )}
                </div>
              );
            }

            if (isDrawing && tempPts.length > 0) {
              const isCircular = tool === 'circle_center_radius' || tool === 'ellipse_center';
              return (
                <div
                  className="absolute right-3 z-20 flex items-center gap-2.5 bg-surface border border-line rounded-sm px-2.5 py-1 text-[11px] font-mono text-fg-2 pointer-events-none select-none"
                  style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 10px)' }}
                >
                  {isCircular ? (
                    <span>
                      ⌀:{' '}
                      <strong className="text-fg">{(parseFloat(hud.length) * 2).toFixed(3)}</strong>{' '}
                      m
                    </span>
                  ) : (
                    <>
                      <span>
                        L: <strong className="text-fg">{hud.length}</strong> m
                      </span>
                      <div className="h-3 w-px bg-line-strong" />
                      <span>
                        ∠: <strong className="text-fg">{hud.angle}</strong>°
                      </span>
                    </>
                  )}
                </div>
              );
            }

            if (hoveredVertex) {
              return (
                <div
                  className="absolute right-3 z-20 flex items-center gap-2.5 bg-surface border border-line rounded-sm px-2.5 py-1 text-[11px] font-mono text-fg-2 pointer-events-none select-none"
                  style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 10px)' }}
                >
                  <span className="text-[10px] uppercase font-bold text-fg-2">Vertex</span>
                  <span>
                    X: <strong className="text-fg">{hoveredVertex.x.toFixed(4)}</strong>
                  </span>
                  <span>
                    Y: <strong className="text-fg">{hoveredVertex.y.toFixed(4)}</strong>
                  </span>
                </div>
              );
            }

            return null;
          })()}
        </>
      )}
    </>
  );
}

export interface StatusReadoutsProps {
  displayOnly: boolean;
  showMesh: boolean;
  hud: { length: string; angle: string; x: string; y: string };
  scaleInfo: { barWidthPx: number; label: string; worldDist: number };
  tool: CadTool;
  snap: Snap;
  meshData: any;
  meshCellCounts: { triangles: number; quads: number };
  isDrawing: boolean;
  tempPts: Point2D[];
  hoveredVertex: Point2D;
}
