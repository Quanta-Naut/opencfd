import React from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3x3,
  Crosshair,
  Magnet,
  ScanLine,
  Compass,
  Sliders,
} from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip';
import type { Snap } from '../workbenchCore';
import { DEFAULT_SNAP_SETTINGS, POLAR_STEP_CHOICES } from '../workbenchCore';
import type { SnapSettings, SnapBoolKey } from '../workbenchCore';

/** Drafting aids and view controls: one compact strip, top centre (grid, snap, ortho, construction, zoom, fit). */
export function DraftingStrip(p: DraftingStripProps) {
  const {
    displayOnly,
    showGrid,
    setShowGrid,
    snapSettings,
    setSnapSettings,
    snapEnabled,
    setSnapEnabled,
    ortho,
    setOrtho,
    constructionMode,
    setConstructionMode,
    tip,
    draftingRef,
    draftingOpen,
    setDraftingOpen,
    setZoom,
    fitView,
  } = p;
  return (
    <>
      {/* Drafting aids + view: one compact strip, top centre. */}
      {!displayOnly && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 p-1 bg-surface border border-line rounded select-none text-[11px]">
          {[
            {
              label: 'Grid',
              title: 'Show grid',
              kbd: 'F7',
              on: showGrid,
              toggle: () => setShowGrid((g) => !g),
              icon: <Grid3x3 className="w-3.5 h-3.5" />,
            },
            {
              label: 'Grid snap',
              title: 'Snap to grid',
              kbd: 'F9',
              on: snapSettings.grid,
              toggle: () => setSnapSettings((s) => ({ ...s, grid: !s.grid })),
              icon: <Grid3x3 className="w-3.5 h-3.5" />,
            },
            {
              label: 'Snap',
              title: 'Object snap (endpoints, midpoints, intersections...)',
              kbd: 'F3',
              on: snapEnabled,
              toggle: () => setSnapEnabled((s) => !s),
              icon: <Magnet className="w-3.5 h-3.5" />,
            },
            {
              label: 'Ortho',
              title: 'Constrain to horizontal / vertical',
              kbd: 'F8',
              on: ortho,
              toggle: () => setOrtho((o) => !o),
              icon: <Crosshair className="w-3.5 h-3.5" />,
            },
            {
              label: 'Angle',
              title: `Angle tracking in ${snapSettings.polarStepDeg}° steps`,
              kbd: undefined,
              on: snapSettings.polar,
              toggle: () => setSnapSettings((s) => ({ ...s, polar: !s.polar })),
              icon: <Compass className="w-3.5 h-3.5" />,
            },
            {
              label: 'Construction',
              title: 'New geometry is drawn as non-solid reference lines',
              kbd: undefined,
              on: constructionMode,
              toggle: () => setConstructionMode((c) => !c),
              icon: <ScanLine className="w-3.5 h-3.5" />,
            },
          ].map(({ label, title, kbd, on, toggle, icon }) => (
            <Tooltip key={label} content={tip(title, kbd)} delay={350}>
              <button
                type="button"
                aria-label={title}
                aria-pressed={on}
                onClick={toggle}
                className={`h-7 px-2 inline-flex items-center gap-1.5 rounded font-medium whitespace-nowrap transition-colors ${
                  on
                    ? 'bg-accent-soft text-accent-fg'
                    : 'text-fg-3 hover:bg-surface-3 hover:text-fg'
                }`}
              >
                {icon}
                <span className="hidden xl:inline">{label}</span>
              </button>
            </Tooltip>
          ))}

          {/* Drafting settings popover */}
          <div className="relative" ref={draftingRef}>
            <Tooltip content="Snap settings" delay={350}>
              <button
                type="button"
                aria-label="Drafting and snap settings"
                aria-haspopup="dialog"
                aria-expanded={draftingOpen}
                onClick={() => setDraftingOpen((o) => !o)}
                className={`h-7 w-7 inline-flex items-center justify-center rounded transition-colors ${
                  draftingOpen
                    ? 'bg-surface-3 text-fg'
                    : 'text-fg-3 hover:bg-surface-3 hover:text-fg'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            {draftingOpen && (
              <div
                role="dialog"
                aria-label="Drafting and snap settings"
                className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-72 bg-surface border border-line rounded-sm p-3 text-[11px] text-fg"
              >
                <label className="flex items-center gap-1.5 pb-2 mb-2 border-b border-line-soft font-semibold cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={snapEnabled}
                    onChange={(e) => setSnapEnabled(e.target.checked)}
                    className="accent-accent"
                  />
                  <span>Snapping enabled</span>
                  <span className="ml-auto text-[10px] font-normal text-fg-3">F3</span>
                </label>

                <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                  Snap to
                </span>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {(
                    [
                      ['endpoint', 'Endpoints'],
                      ['midpoint', 'Midpoints'],
                      ['center', 'Centres'],
                      ['quadrant', 'Quadrants'],
                      ['intersection', 'Intersections'],
                      ['perpendicular', 'Perpendicular'],
                      ['parallel', 'Parallel'],
                      ['onCurve', 'On edge'],
                      ['alignment', 'Align guides'],
                      ['grid', 'Grid snap'],
                    ] as [SnapBoolKey, string][]
                  ).map(([k, lbl]) => (
                    <label key={k} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={Boolean(snapSettings[k])}
                        onChange={(e) => setSnapSettings((s) => ({ ...s, [k]: e.target.checked }))}
                        className="accent-accent"
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-3 pt-3 border-t border-line-soft">
                  <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
                    <span className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={snapSettings.polar}
                        onChange={(e) =>
                          setSnapSettings((s) => ({ ...s, polar: e.target.checked }))
                        }
                        className="accent-accent"
                      />
                      <span>Angle tracking</span>
                    </span>
                    <select
                      value={snapSettings.polarStepDeg}
                      disabled={!snapSettings.polar}
                      onChange={(e) =>
                        setSnapSettings((s) => ({ ...s, polarStepDeg: Number(e.target.value) }))
                      }
                      className="px-1.5 py-0.5 bg-surface border border-line rounded text-[11px] disabled:opacity-40"
                    >
                      {POLAR_STEP_CHOICES.map((d) => (
                        <option key={d} value={d}>
                          {d}°
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-3 pt-3 border-t border-line-soft flex items-center justify-between gap-2">
                  <span className="text-[10px] text-fg-3 leading-tight">
                    F3 snap · F7 grid · F8 ortho · F9 grid snap
                  </span>
                  <button
                    type="button"
                    onClick={() => setSnapSettings({ ...DEFAULT_SNAP_SETTINGS })}
                    className="px-2 py-0.5 rounded border border-line text-[10px] font-semibold text-fg-2 hover:text-fg hover:border-accent transition-colors shrink-0"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          <span className="h-4 w-px bg-line mx-1" />
          <Tooltip content="Zoom in" delay={350}>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(25000, z * 1.35))}
              className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-3 hover:bg-surface-3 hover:text-fg transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Zoom out" delay={350}>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.5, z / 1.35))}
              className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-3 hover:bg-surface-3 hover:text-fg transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Fit to view" delay={350}>
            <button
              type="button"
              aria-label="Fit to view"
              onClick={fitView}
              className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-3 hover:bg-surface-3 hover:text-fg transition-colors"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      )}
    </>
  );
}

export interface DraftingStripProps {
  displayOnly: boolean;
  showGrid: boolean;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;
  snapSettings: SnapSettings;
  setSnapSettings: React.Dispatch<React.SetStateAction<SnapSettings>>;
  snapEnabled: boolean;
  setSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  ortho: boolean;
  setOrtho: React.Dispatch<React.SetStateAction<boolean>>;
  constructionMode: boolean;
  setConstructionMode: React.Dispatch<React.SetStateAction<boolean>>;
  tip: (label: string, kbd?: string) => React.JSX.Element;
  draftingRef: React.RefObject<HTMLDivElement>;
  draftingOpen: boolean;
  setDraftingOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  fitView: () => void;
}
