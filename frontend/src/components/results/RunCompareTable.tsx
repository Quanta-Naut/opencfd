import React from 'react';
import type { SolverRunRecord } from '../../types/cfd';
import { fmtValue } from '../../utils/resultFields';

type Row = {
  label: string;
  get: (r: SolverRunRecord) => string | number | null | undefined;
  /** Results rather than settings: never flagged as a difference. */
  result?: boolean;
};

const lastRes = (r: SolverRunRecord) => r.residuals[r.residuals.length - 1];
const cdOf = (r: SolverRunRecord) => r.finalCd ?? lastRes(r)?.cd;
const clOf = (r: SolverRunRecord) => r.finalCl ?? lastRes(r)?.cl;

const ROWS: Row[] = [
  { label: 'Cd', get: cdOf, result: true },
  { label: 'Cl', get: clOf, result: true },
  {
    label: 'L/D',
    get: (r) => {
      const cd = cdOf(r),
        cl = clOf(r);
      return typeof cd === 'number' && typeof cl === 'number' && cd !== 0 ? cl / cd : null;
    },
    result: true,
  },
  { label: 'Iterations', get: (r) => r.iterationsRun ?? lastRes(r)?.iteration, result: true },
  { label: 'Final p residual', get: (r) => lastRes(r)?.p, result: true },
  {
    label: 'Run time',
    get: (r) => (r.finishedAt ? `${Math.round((r.finishedAt - r.startedAt) / 1000)} s` : null),
    result: true,
  },
  { label: 'Cells', get: (r) => r.config?.cells },
  { label: 'Turbulence', get: (r) => r.config?.turbulenceModel },
  { label: 'Velocity', get: (r) => r.config?.velocity },
  { label: 'Reynolds', get: (r) => r.config?.reynolds },
  { label: 'Time', get: (r) => r.config?.timeFormulation },
  { label: 'Momentum', get: (r) => r.config?.momentumOrder },
  { label: 'Relax p', get: (r) => r.config?.relax?.p },
  { label: 'Relax U', get: (r) => r.config?.relax?.U },
  { label: 'Iteration limit', get: (r) => r.config?.iterations },
];

const show = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '-' : typeof v === 'number' ? fmtValue(v) : v;

/** The picked runs side by side: results first, then the settings, with
 *  the settings that differ between them marked. */
export const RunCompareTable: React.FC<{ runs: SolverRunRecord[] }> = ({ runs }) => (
  <div className="bg-surface border border-line-soft rounded overflow-x-auto">
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-line-soft">
          <th className="text-left font-medium text-fg-3 px-2 py-1">&nbsp;</th>
          {runs.map((r) => (
            <th key={r.id} className="text-right font-semibold text-fg px-2 py-1 whitespace-nowrap">
              {r.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row, i) => {
          const vals = runs.map((r) => show(row.get(r)));
          const differs = !row.result && new Set(vals).size > 1;
          const firstSetting = !row.result && ROWS[i - 1]?.result;
          return (
            <tr
              key={row.label}
              className={`${firstSetting ? 'border-t border-line' : ''} ${differs ? 'bg-accent-soft' : ''}`}
            >
              <td
                className={`px-2 py-0.5 whitespace-nowrap ${differs ? 'text-accent-fg font-medium' : 'text-fg-2'}`}
                title={differs ? 'Differs between these runs' : undefined}
              >
                {row.label}
              </td>
              {vals.map((v, j) => (
                <td
                  key={runs[j].id}
                  className={`px-2 py-0.5 text-right font-mono whitespace-nowrap ${
                    differs ? 'text-accent-fg' : 'text-fg'
                  }`}
                >
                  {v}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export default RunCompareTable;
