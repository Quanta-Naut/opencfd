import React from 'react';
import type { StageId } from '../stages';
import { Tooltip } from '../../ui/Tooltip';
import {
  Upload,
  FileCode,
  RotateCcw,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Link,
} from 'lucide-react';
import {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  DomainPreset,
  BoundaryTag,
  BOUNDARY_COLORS,
  GeometryBBox,
} from '../../../types/cadWorkflow';
import { NumberField } from './NumberField';

/** Geometry stage: the single-open Geometry / Domain / Boundary Patches accordion. */
export function GeometryStagePanel(p: GeometryStagePanelProps) {
  const {
    activeStage,
    flowType,
    boundaryValidation,
    setOpenGeoSection,
    openGeoSection,
    setCadWorkflowStep,
    fileInputAirfoilRef,
    handleAirfoilChange,
    fileInputDxfRef,
    handleDxfChange,
    airfoilUrl,
    setAirfoilUrl,
    urlError,
    setUrlError,
    handleImportUrl,
    isFetchingUrl,
    onClearGeometry,
    setFlowType,
    domainKind,
    farfieldOpen,
    setFarfieldOpen,
    domainState,
    onSetSelectedAsDomain,
    domainShape,
    setDomainShape,
    onApplyPreset,
    domainPreset,
    geometryBBox,
    upstreamChordFactor,
    setUpstreamChordFactor,
    lateralHeightFactor,
    setLateralHeightFactor,
    downstreamChordFactor,
    setDownstreamChordFactor,
    setDomainPreset,
    domainValidation,
    onGenerateDomain,
    setFlowDirection,
    flowDirection,
    activeTagTool,
    setActiveTagTool,
    setAngleOfAttackDeg,
    onAutoSuggestTags,
  } = p;
  return (
    <>
      {/* 01 GEOMETRY · DOMAIN · BOUNDARY PATCHES (single-open accordion) */}
      {activeStage === 'geometry' &&
        (() => {
          const isInternal = flowType === 'internal';
          const inletCount = boundaryValidation.counts?.inlet ?? 0;
          const outletCount = boundaryValidation.counts?.outlet ?? 0;

          // Selection state: subtle blue outline + tint instead of a solid fill.
          const sel = (active: boolean) =>
            active
              ? 'border-accent bg-accent-soft text-accent-fg'
              : 'border-line bg-surface text-fg-2 hover:border-line-strong hover:bg-surface-2';

          const toggle = (n: CadWorkflowStep) => {
            setOpenGeoSection((prev) => (prev === n ? null : n));
            if (openGeoSection !== n) setCadWorkflowStep?.(n);
          };

          const section = (n: CadWorkflowStep, label: string, body: React.ReactNode) => {
            const isOpen = openGeoSection === n;
            return (
              <div className="border-t border-line first:border-t-0">
                <button
                  onClick={() => toggle(n)}
                  className={`w-full flex items-center gap-2 py-2.5 text-left`}
                >
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold shrink-0 border ${isOpen ? 'bg-accent-soft text-accent border-accent' : 'bg-surface-3 text-fg-4 border-transparent'}`}
                  >
                    {n}
                  </span>
                  <span
                    className={`flex-1 text-[11px] font-semibold uppercase tracking-wider ${isOpen ? 'text-accent' : 'text-fg-2'}`}
                  >
                    {label}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-fg-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && <div className="pb-3">{body}</div>}
              </div>
            );
          };

          return (
            <div className="px-3 pt-1 pb-10 text-xs text-fg">
              {/* ══════════ 1 · GEOMETRY ══════════ */}
              {section(
                1,
                'Geometry',
                <div className="space-y-4">
                  <input
                    type="file"
                    ref={fileInputAirfoilRef}
                    onChange={handleAirfoilChange}
                    accept=".dat,.csv,.txt"
                    className="hidden"
                  />
                  <input
                    type="file"
                    ref={fileInputDxfRef}
                    onChange={handleDxfChange}
                    accept=".dxf"
                    className="hidden"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => fileInputAirfoilRef.current?.click()}
                      className="group py-3 px-2 bg-surface hover:bg-surface-2 border border-line hover:border-fg rounded font-medium flex flex-col items-center gap-1.5 transition-all"
                    >
                      <Upload className="w-4 h-4 text-fg-2 group-hover:text-fg" />
                      <span className="text-[11px] text-fg">.dat / .csv</span>
                      <span className="text-[10px] text-fg-4">airfoil coords</span>
                    </button>
                    <button
                      onClick={() => fileInputDxfRef.current?.click()}
                      className="group py-3 px-2 bg-surface hover:bg-surface-2 border border-line hover:border-fg rounded font-medium flex flex-col items-center gap-1.5 transition-all"
                    >
                      <FileCode className="w-4 h-4 text-fg-2 group-hover:text-fg" />
                      <span className="text-[11px] text-fg">DXF drawing</span>
                      <span className="text-[10px] text-fg-4">2D CAD outline</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-4">
                    <span className="h-px flex-1 bg-line" />
                    or paste a URL
                    <span className="h-px flex-1 bg-line" />
                  </div>

                  <div className="space-y-1.5">
                    <div className="relative">
                      <Link className="w-3.5 h-3.5 text-fg-4 absolute left-2.5 top-2.5" />
                      <input
                        type="url"
                        value={airfoilUrl}
                        onChange={(e) => {
                          setAirfoilUrl(e.target.value);
                          if (urlError) setUrlError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleImportUrl();
                          }
                        }}
                        placeholder="Selig / UIUC .dat link…"
                        className="w-full pl-8 pr-2 py-2 bg-surface-2 focus:bg-surface border border-line focus:border-accent rounded text-[11px] font-mono placeholder:font-sans text-fg outline-none transition-colors"
                      />
                    </div>
                    <button
                      onClick={handleImportUrl}
                      disabled={!airfoilUrl.trim() || isFetchingUrl}
                      className="w-full py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded text-[11px] font-semibold transition-colors"
                    >
                      {isFetchingUrl ? 'Fetching…' : 'Fetch airfoil'}
                    </button>
                    {urlError && (
                      <span className="text-[10px] text-danger block leading-tight">
                        {urlError}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-fg-4">
                      Everything you draw here is geometry.
                    </span>
                    <button
                      onClick={onClearGeometry}
                      title="Clear all geometry"
                      className="px-2.5 py-1.5 bg-surface hover:bg-danger-soft hover:text-danger hover:border-danger-line text-fg-4 border border-line rounded transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                </div>,
              )}

              {/* ══════════ 2 · DOMAIN ══════════ */}
              {section(
                2,
                'Domain',
                <div className="space-y-3">
                  {/* Flow type */}
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { v: 'external', label: 'External flow', hint: 'around a body' },
                        { v: 'internal', label: 'Internal flow', hint: 'inside a channel' },
                      ] as const
                    ).map(({ v, label, hint }) => (
                      <button
                        key={v}
                        onClick={() => setFlowType?.(v)}
                        className={`py-2 px-2.5 rounded border text-left transition-colors ${sel(flowType === v)}`}
                      >
                        <span className="block text-[11px] font-semibold">{label}</span>
                        <span
                          className={`block text-[10px] ${flowType === v ? 'text-accent' : 'text-fg-4'}`}
                        >
                          {hint}
                        </span>
                      </button>
                    ))}
                  </div>

                  {isInternal
                    ? /* moved out of the live UI - see layout/LeftStagePanel.tsx (Domain section),
                    kept for a future tutorial
                    <div className="p-2.5 bg-surface-2 border border-line rounded text-[10px] text-fg-2 leading-relaxed">
                      The geometry walls bound the fluid directly - no outer domain is generated.
                      Tag the open ends as <b className="text-fg">inlet</b> /{' '}
                      <b className="text-fg">outlet</b> and the solid sides as{' '}
                      <b className="text-fg">wall</b> in step 3.
                    </div>
                    */
                      null
                    : (() => {
                        const farOpen = domainKind === 'auto' ? true : farfieldOpen;
                        return (
                          <>
                            {/* Collapsible far-field generator - collapsed by default */}
                            <button
                              onClick={() => setFarfieldOpen((v) => !v)}
                              className="w-full flex items-center gap-1.5 py-1.5 text-[11px] font-semibold text-fg-2 hover:text-fg transition-colors"
                            >
                              <ChevronRight
                                className={`w-3.5 h-3.5 transition-transform ${farOpen ? 'rotate-90 text-accent' : ''}`}
                              />
                              <span className={farOpen ? 'text-accent' : ''}>
                                Generate a far-field box automatically
                              </span>
                            </button>

                            {/* Collapsed: explicitly define the fluid domain */}
                            {!farOpen && (
                              <Tooltip
                                content={
                                  domainState === 'broken'
                                    ? 'The fluid domain is broken: an edge that formed the outer boundary was deleted or replaced, so the loop no longer closes. Select the whole outline again on the canvas (Select tool, drag a box around it), then click this to redefine it. Your inlet / outlet / wall tags are kept.'
                                    : domainState === 'ok'
                                      ? 'The fluid domain is set. Click to redefine it from the current selection. Deleting a boundary edge will break it and this button turns red.'
                                      : 'Marks the selected closed loop as the outer fluid boundary. Draw your outline as one closed loop (endpoints must meet), select all of it, then click this. Or expand the far-field option above.'
                                }
                              >
                                <button
                                  onClick={onSetSelectedAsDomain}
                                  className={`w-full py-2 rounded font-bold transition-colors text-white ${domainState === 'broken' ? 'bg-danger hover:bg-danger' : 'bg-accent hover:bg-accent-hover'}`}
                                >
                                  {domainState === 'ok'
                                    ? 'Redefine domain'
                                    : domainState === 'broken'
                                      ? 'Reselect & redefine'
                                      : 'Set as domain'}
                                </button>
                              </Tooltip>
                            )}

                            {farOpen && (
                              <div className="space-y-3">
                                <div>
                                  <span className="text-[10px] font-semibold text-fg-2 block mb-1.5">
                                    Far-field shape
                                  </span>
                                  <div className="grid grid-cols-3 gap-2">
                                    {(
                                      [
                                        { v: 'rectangle', label: 'Box' },
                                        { v: 'c_grid', label: 'C-grid' },
                                        { v: 'circle', label: 'Farfield' },
                                      ] as const
                                    ).map(({ v, label }) => {
                                      const on = domainShape === v;
                                      return (
                                        <button
                                          key={v}
                                          onClick={() => setDomainShape?.(v)}
                                          className={`p-2 rounded border flex flex-col items-center gap-1 transition-colors ${sel(on)}`}
                                        >
                                          <svg
                                            className="w-full h-7"
                                            viewBox="0 0 100 48"
                                            fill="none"
                                          >
                                            {v === 'rectangle' && (
                                              <rect
                                                x="6"
                                                y="6"
                                                width="88"
                                                height="36"
                                                rx="2"
                                                stroke={on ? '#2563EB' : '#94A3B8'}
                                                strokeWidth="1.5"
                                                strokeDasharray="3 2"
                                                fill="#EFF6FF"
                                                fillOpacity={on ? 0.7 : 0.15}
                                              />
                                            )}
                                            {v === 'c_grid' && (
                                              <path
                                                d="M94 8 L36 8 A16 16 0 0 0 36 40 L94 40 Z"
                                                stroke={on ? '#2563EB' : '#94A3B8'}
                                                strokeWidth="1.5"
                                                strokeDasharray="3 2"
                                                fill="#EFF6FF"
                                                fillOpacity={on ? 0.7 : 0.15}
                                              />
                                            )}
                                            {v === 'circle' && (
                                              <circle
                                                cx="50"
                                                cy="24"
                                                r="17"
                                                stroke={on ? '#2563EB' : '#94A3B8'}
                                                strokeWidth="1.5"
                                                strokeDasharray="3 2"
                                                fill="#EFF6FF"
                                                fillOpacity={on ? 0.7 : 0.15}
                                              />
                                            )}
                                            <path
                                              d="M42 24 C44 20, 52 21, 62 24 C54 26, 46 26, 42 24 Z"
                                              fill="#171A1F"
                                            />
                                          </svg>
                                          <span
                                            className={`text-[10px] font-bold ${on ? 'text-accent-fg' : 'text-fg-2'}`}
                                          >
                                            {label}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div>
                                  <span className="text-[10px] font-semibold text-fg-2 block mb-1.5">
                                    Size preset
                                  </span>
                                  <div className="grid grid-cols-4 gap-1.5">
                                    {(
                                      ['tight', 'standard', 'large', 'custom'] as DomainPreset[]
                                    ).map((p) => (
                                      <button
                                        key={p}
                                        onClick={() => onApplyPreset(p)}
                                        className={`py-1.5 rounded text-[10px] font-medium border transition-colors capitalize ${sel(domainPreset === p)}`}
                                      >
                                        {p}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="bg-surface-2 border border-line rounded p-2.5 space-y-2">
                                  <div className="flex justify-between items-center text-[10px] text-fg-2">
                                    <span className="font-semibold">Clearance (chords)</span>
                                    <span className="font-mono text-accent">
                                      1c = {(geometryBBox?.chord ?? 1.0).toFixed(2)} m
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1.5 items-start">
                                    {(
                                      [
                                        {
                                          label: '← Inlet',
                                          cls: '',
                                          v: upstreamChordFactor,
                                          set: setUpstreamChordFactor,
                                        },
                                        {
                                          label: '↕ Lateral',
                                          cls: 'text-center',
                                          v: lateralHeightFactor,
                                          set: setLateralHeightFactor,
                                        },
                                        {
                                          label: 'Outlet →',
                                          cls: 'text-right',
                                          v: downstreamChordFactor,
                                          set: setDownstreamChordFactor,
                                        },
                                      ] as const
                                    ).map(({ label, cls, v, set: setter }) => (
                                      <label key={label} className={`text-[10px] text-fg-2 ${cls}`}>
                                        {label}
                                        <NumberField
                                          value={v}
                                          min={1}
                                          max={100}
                                          onChange={(n) => {
                                            setter?.(n);
                                            setDomainPreset?.('custom');
                                          }}
                                          className="w-full mt-0.5 px-1 py-1 bg-surface border border-line focus:border-accent outline-none rounded text-center text-[10px] font-mono font-bold text-fg"
                                        />
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                {!domainValidation.valid && domainKind === 'auto' && (
                                  <div className="flex items-start gap-1 text-[10px] text-danger">
                                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                    <span>
                                      {domainValidation.reason || 'Geometry is outside the domain.'}
                                    </span>
                                  </div>
                                )}

                                <button
                                  onClick={onGenerateDomain}
                                  className="w-full py-2 bg-accent hover:bg-accent-hover text-white rounded font-bold transition-colors"
                                >
                                  Generate domain
                                </button>
                              </div>
                            )}
                          </>
                        );
                      })()}
                </div>,
              )}

              {/* ══════════ 3 · BOUNDARY PATCHES ══════════ */}
              {section(
                3,
                'Boundary patches',
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] font-semibold text-fg-2 block mb-1.5">
                      Flow direction
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(
                        [
                          { label: '-X', icon: '→', value: 'neg_x_pos_x' },
                          { label: '+X', icon: '←', value: 'pos_x_neg_x' },
                          { label: '+Y', icon: '↑', value: 'neg_y_pos_y' },
                          { label: '-Y', icon: '↓', value: 'pos_y_neg_y' },
                        ] as const
                      ).map(({ label, icon, value }) => (
                        <button
                          key={value}
                          onClick={() => setFlowDirection(value)}
                          title={`Inlet from ${label}`}
                          className={`py-1.5 rounded border flex flex-col items-center transition-colors ${sel(flowDirection === value)}`}
                        >
                          <span className="text-sm font-bold leading-none">{icon}</span>
                          <span className="text-[10px] font-semibold font-mono">{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-semibold text-fg-2 block mb-1.5">
                      {activeTagTool
                        ? `Tagging: ${activeTagTool.toUpperCase()} - click canvas edges (click the tag again to stop)`
                        : 'Pick a tag, then click canvas edges to apply it'}
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {/* 'axis' is always offered - tagging an edge with it is what turns
                        the case axisymmetric, manually, no separate toggle. */}
                      {(
                        [
                          'inlet',
                          'outlet',
                          'wall',
                          'farfield',
                          'symmetry',
                          'periodic',
                          'axis',
                        ] as BoundaryTag[]
                      ).map((tag) => {
                        const conf = BOUNDARY_COLORS[tag];
                        const isSel = activeTagTool === tag;
                        return (
                          <button
                            key={tag}
                            onClick={() => setActiveTagTool?.(isSel ? null : tag)}
                            className={`py-1.5 px-2 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors flex items-center gap-1.5 ${isSel ? `${conf.bg} ${conf.text}` : 'bg-surface text-fg-2 border-line hover:bg-surface-2'}`}
                            style={isSel ? { borderColor: conf.hex } : undefined}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: isSel ? conf.hex : '#CBD5E1' }}
                            />
                            <span className="flex-1 text-left">{tag}</span>
                            <span className="text-[10px] font-mono opacity-70">
                              {boundaryValidation.counts[tag] || 0}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const dirToAoa: Record<string, number> = {
                        neg_x_pos_x: 0,
                        pos_x_neg_x: 180,
                        neg_y_pos_y: 90,
                        pos_y_neg_y: -90,
                      };
                      setAngleOfAttackDeg?.(dirToAoa[flowDirection] ?? 0);
                      setTimeout(() => onAutoSuggestTags?.(), 30);
                    }}
                    className="w-full py-2 bg-accent hover:bg-accent-hover text-white rounded font-bold transition-all active:scale-[0.99]"
                  >
                    Auto-tag edges
                  </button>

                  {(inletCount === 0 || outletCount === 0) && (
                    <div className="flex items-start gap-1 text-[10px] text-danger">
                      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>
                        {inletCount === 0 && outletCount === 0
                          ? 'Tag at least one inlet and one outlet.'
                          : inletCount === 0
                            ? 'Tag at least one inlet.'
                            : 'Tag at least one outlet.'}
                      </span>
                    </div>
                  )}
                </div>,
              )}
            </div>
          );
        })()}
    </>
  );
}

export interface GeometryStagePanelProps {
  activeStage: StageId;
  flowType: FlowType;
  boundaryValidation:
    | { valid: boolean; reason?: string; counts: Record<BoundaryTag, number> }
    | {
        valid: true;
        counts: {
          inlet: number;
          outlet: number;
          wall: number;
          farfield: number;
          symmetry: number;
          periodic: number;
        };
      };
  setOpenGeoSection: React.Dispatch<React.SetStateAction<CadWorkflowStep>>;
  openGeoSection: CadWorkflowStep;
  setCadWorkflowStep: (step: CadWorkflowStep) => void;
  fileInputAirfoilRef: React.RefObject<HTMLInputElement>;
  handleAirfoilChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputDxfRef: React.RefObject<HTMLInputElement>;
  handleDxfChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  airfoilUrl: string;
  setAirfoilUrl: React.Dispatch<React.SetStateAction<string>>;
  urlError: string;
  setUrlError: React.Dispatch<React.SetStateAction<string>>;
  handleImportUrl: () => Promise<void>;
  isFetchingUrl: boolean;
  onClearGeometry: () => void;
  setFlowType: (t: FlowType) => void;
  domainKind: 'custom' | 'none' | 'auto';
  farfieldOpen: boolean;
  setFarfieldOpen: React.Dispatch<React.SetStateAction<boolean>>;
  domainState: 'none' | 'auto' | 'ok' | 'broken';
  onSetSelectedAsDomain: () => void;
  domainShape: DomainShapeType;
  setDomainShape: (s: DomainShapeType) => void;
  onApplyPreset: (p: DomainPreset) => void;
  domainPreset: DomainPreset;
  geometryBBox: GeometryBBox;
  upstreamChordFactor: number;
  setUpstreamChordFactor: (f: number) => void;
  lateralHeightFactor: number;
  setLateralHeightFactor: (f: number) => void;
  downstreamChordFactor: number;
  setDownstreamChordFactor: (f: number) => void;
  setDomainPreset: (p: DomainPreset) => void;
  domainValidation: { valid: boolean; reason?: string };
  onGenerateDomain: () => void;
  setFlowDirection: React.Dispatch<
    React.SetStateAction<'neg_x_pos_x' | 'pos_x_neg_x' | 'neg_y_pos_y' | 'pos_y_neg_y'>
  >;
  flowDirection: 'neg_x_pos_x' | 'pos_x_neg_x' | 'neg_y_pos_y' | 'pos_y_neg_y';
  activeTagTool: BoundaryTag;
  setActiveTagTool: (t: BoundaryTag | null) => void;
  setAngleOfAttackDeg: (a: number) => void;
  onAutoSuggestTags: () => void;
}
