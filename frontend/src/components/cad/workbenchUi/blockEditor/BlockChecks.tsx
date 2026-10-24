import {
  PremeshQuality,
  PREMESH_MIN_ANGLE,
  PREMESH_MIN_DET,
  SpacingJump,
} from '../../../../types/blocking';
import { VERTEX_COLORS } from '../../workbenchDraw/blocking';
import { card } from './shared';

/** Live checks while blocking: ICEM pre-mesh quality, what still needs doing,
 *  and the vertex colour legend. */
export function BlockChecks(p: {
  blockCount: number;
  quality: PremeshQuality;
  outside: number;
  overBody: number;
  unpatched: number;
  jumps: SpacingJump[];
  coverage: number | null;
  showPremesh: boolean;
  maxAspect: number;
  cellCount: number;
  tinyEdges: number;
}) {
  const q = p.quality;
  const problems: { tone: 'danger' | 'warning'; text: string }[] = [];
  if (p.overBody)
    problems.push({
      tone: 'danger',
      text: `${p.overBody} block${p.overBody > 1 ? 's' : ''} over a body: delete ${p.overBody > 1 ? 'them' : 'it'}`,
    });
  if (p.outside)
    problems.push({
      tone: 'danger',
      text: `${p.outside} block${p.outside > 1 ? 's reach' : ' reaches'} outside the fluid`,
    });
  if (q.folded)
    problems.push({ tone: 'danger', text: `${q.folded} folded cell${q.folded > 1 ? 's' : ''}` });
  if (p.unpatched)
    problems.push({
      tone: 'danger',
      text: `${p.unpatched} boundary edge${p.unpatched > 1 ? 's' : ''} not associated (dashed red)`,
    });
  if (p.tinyEdges)
    problems.push({
      tone: 'danger',
      text: `${p.tinyEdges} edge${p.tinyEdges > 1 ? 's are' : ' is'} almost zero long: the grid fans out of a point there (use a C-grid at a sharp trailing edge)`,
    });
  if (p.coverage !== null && p.coverage < 0.995)
    problems.push({
      tone: 'warning',
      text: `Blocks cover ${Math.round(p.coverage * 100)}% of the fluid`,
    });
  if (p.jumps.length)
    problems.push({
      tone: 'warning',
      text: `Cell size jumps at ${p.jumps.length} join${p.jumps.length > 1 ? 's' : ''} (amber rings)`,
    });
  const low = q.lowDet + q.lowAngle;
  if (low && !q.folded)
    problems.push({
      tone: 'warning',
      text: `${low} cell${low > 1 ? 's' : ''} under the quality targets${p.showPremesh ? ' (red)' : ', show the pre-mesh (P)'}`,
    });
  return (
    <div className={`${card} p-2 space-y-1.5 w-[268px]`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Checks</span>
        <span className="text-fg-2">
          {p.blockCount} block{p.blockCount > 1 ? 's' : ''} · {p.cellCount.toLocaleString()} cells
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 font-mono">
        <div
          className="p-1.5 rounded-sm border border-line bg-app"
          title={`ICEM determinant (2x2): 1 is perfect, aim for over ${PREMESH_MIN_DET}`}
        >
          <span className="text-[10px] text-fg-2 block font-sans">Determinant</span>
          <span
            className={`font-semibold ${q.minDet >= PREMESH_MIN_DET ? 'text-fg' : 'text-danger'}`}
          >
            {q.minDet.toFixed(2)}
          </span>
          <span className="text-[10px] text-fg-3"> &gt;{PREMESH_MIN_DET}</span>
        </div>
        <div
          className="p-1.5 rounded-sm border border-line bg-app"
          title={`Smallest cell angle: aim for over ${PREMESH_MIN_ANGLE} degrees`}
        >
          <span className="text-[10px] text-fg-2 block font-sans">Angle</span>
          <span
            className={`font-semibold ${q.minAngle >= PREMESH_MIN_ANGLE ? 'text-fg' : 'text-danger'}`}
          >
            {q.minAngle.toFixed(1)}
          </span>
          <span className="text-[10px] text-fg-3"> &gt;{PREMESH_MIN_ANGLE}</span>
        </div>
        <div
          className="p-1.5 rounded-sm border border-line bg-app"
          title="Longest over shortest side of the most stretched cell. Large values are normal in a boundary layer."
        >
          <span className="text-[10px] text-fg-2 block font-sans">Aspect</span>
          <span className="font-semibold text-fg">
            {p.maxAspect >= 100 ? Math.round(p.maxAspect) : p.maxAspect.toFixed(1)}
          </span>
          <span className="text-[10px] text-fg-3"> max</span>
        </div>
      </div>
      {problems.length ? (
        <ul className="space-y-0.5">
          {problems.map((pr) => (
            <li key={pr.text} className="flex items-start gap-1.5 leading-snug">
              <span
                className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${pr.tone === 'danger' ? 'bg-danger' : 'bg-warning'}`}
              />
              <span className="text-fg-2">{pr.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-success">Ready to mesh.</p>
      )}
      <div className="flex items-center gap-3 pt-1 border-t border-line text-[10px] text-fg-2">
        {(
          [
            ['pinned', 'Fixed'],
            ['slide', 'On curve'],
            ['free', 'Free'],
          ] as const
        ).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: VERTEX_COLORS[k] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
