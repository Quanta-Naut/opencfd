import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import { dist, distToSegment } from './geometry';
import { segParam, segSegIntersect, segInfLineIntersect, segCircleIntersect, segEllipseIntersect } from './intersections';

export interface TrimTarget {
  targetEnt: CadEntity;
  targetSegIdx: number;
  subSeg: { p0: Point2D; p1: Point2D };
  preservedSegs: { p0: Point2D; p1: Point2D }[];
  preservedPolylines?: Point2D[][];
  subPolyline?: Point2D[];
}

function sampleArcPoints(
  hStart: { idx: number; pt: Point2D },
  hEnd: { idx: number; pt: Point2D },
  ring: Point2D[]
): Point2D[] {
  const N = ring.length;
  const pts: Point2D[] = [hStart.pt];
  let k = Math.floor(hStart.idx) + 1;
  const endLimit = hStart.idx <= hEnd.idx ? hEnd.idx : hEnd.idx + N;

  while (k < endLimit) {
    const ringVtx = ring[k % N];
    if (dist(pts[pts.length - 1], ringVtx) > 1e-4) {
      pts.push(ringVtx);
    }
    k++;
  }

  if (dist(pts[pts.length - 1], hEnd.pt) > 1e-4) {
    pts.push(hEnd.pt);
  }
  return pts;
}

export function getTrimTarget(rawPt: Point2D, entities: CadEntity[], zoom: number): TrimTarget | null {
  const hitR = 14 / zoom;
  let targetEnt: CadEntity | null = null;
  let targetSegIdx = -1;
  let bestD = Infinity;

  for (const ent of entities) {
    if (ent.layer === 'construction') continue;
    for (let i = 0; i < ent.pts.length - 1; i++) {
      const d = distToSegment(rawPt, ent.pts[i], ent.pts[i + 1]);
      if (d < hitR && d < bestD) { bestD = d; targetEnt = ent; targetSegIdx = i; }
    }
    if (ent.isClosed && ent.pts.length >= 3) {
      const i = ent.pts.length - 1;
      const d = distToSegment(rawPt, ent.pts[i], ent.pts[0]);
      if (d < hitR && d < bestD) { bestD = d; targetEnt = ent; targetSegIdx = i; }
    }
    if (ent.type === 'circle' && ent.pts.length >= 1) {
      const r = ent.radius ?? (ent.pts[1] ? dist(ent.pts[0], ent.pts[1]) : 0);
      if (r > 0) {
        const radialD = Math.abs(dist(rawPt, ent.pts[0]) - r);
        if (radialD < hitR && radialD < bestD) {
          bestD = radialD;
          targetEnt = ent;
          targetSegIdx = -1;
        }
      }
    }
    if (ent.type === 'ellipse' && ent.pts.length >= 1 && ent.rx != null && ent.ry != null) {
      const c = ent.pts[0];
      const rx = ent.rx;
      const ry = ent.ry;
      const rot = ent.rotation || 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const N = 32;
      let minD = Infinity;
      let prevP = {
        x: c.x + rx * cosR,
        y: c.y + rx * sinR,
      };
      for (let j = 1; j <= N; j++) {
        const a = (2 * Math.PI * j) / N;
        const lx = rx * Math.cos(a);
        const ly = ry * Math.sin(a);
        const curP = {
          x: c.x + lx * cosR - ly * sinR,
          y: c.y + lx * sinR + ly * cosR,
        };
        const d = distToSegment(rawPt, prevP, curP);
        if (d < minD) minD = d;
        prevP = curP;
      }
      if (minD < hitR && minD < bestD) {
        bestD = minD;
        targetEnt = ent;
        targetSegIdx = -1;
      }
    }
  }

  if (!targetEnt) return null;
  if (targetEnt.type !== 'circle' && targetEnt.type !== 'ellipse' && targetSegIdx < 0) return null;

  if (targetEnt.type === 'circle' || targetEnt.type === 'ellipse') {
    const c = targetEnt.pts[0];
    let rx = 0;
    let ry = 0;
    let rot = 0;
    if (targetEnt.type === 'circle') {
      rx = targetEnt.radius ?? (targetEnt.pts[1] ? dist(c, targetEnt.pts[1]) : 0);
      ry = rx;
      rot = 0;
    } else {
      rx = targetEnt.rx ?? (targetEnt.pts[1] ? dist(c, targetEnt.pts[1]) : 0);
      ry = targetEnt.ry ?? (rx * 0.5);
      rot = targetEnt.rotation || 0;
    }
    if (rx <= 1e-6 || ry <= 1e-6) return null;

    const N = 128;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const ring: Point2D[] = [];
    for (let k = 0; k < N; k++) {
      const a = (2 * Math.PI * k) / N;
      const lx = rx * Math.cos(a);
      const ly = ry * Math.sin(a);
      ring.push({
        x: c.x + lx * cosR - ly * sinR,
        y: c.y + lx * sinR + ly * cosR,
      });
    }

    const rawHits: { idx: number; pt: Point2D }[] = [];
    for (let k = 0; k < N; k++) {
      const segA = ring[k];
      const segB = ring[(k + 1) % N];

      for (const other of entities) {
        if (other.id === targetEnt.id) continue;

        for (let j = 0; j < other.pts.length - 1; j++) {
          if (other.type === 'construction' && other.pts.length >= 2) {
            const ix = segInfLineIntersect(segA, segB, other.pts[0], other.pts[1]);
            if (ix) {
              const t = segParam(ix, segA, segB);
              rawHits.push({ idx: (k + t) % N, pt: ix });
            }
          } else {
            const ix = segSegIntersect(segA, segB, other.pts[j], other.pts[j + 1]);
            if (ix) {
              const t = segParam(ix, segA, segB);
              rawHits.push({ idx: (k + t) % N, pt: ix });
            }
          }
        }

        if (other.isClosed && other.pts.length >= 3) {
          const j = other.pts.length - 1;
          const ix = segSegIntersect(segA, segB, other.pts[j], other.pts[0]);
          if (ix) {
            const t = segParam(ix, segA, segB);
            rawHits.push({ idx: (k + t) % N, pt: ix });
          }
        }

        if (other.type === 'circle' && other.pts.length >= 2) {
          const rOther = other.radius ?? dist(other.pts[0], other.pts[1]);
          const ixs = segCircleIntersect(segA, segB, other.pts[0], rOther);
          for (const ix of ixs) {
            const t = segParam(ix, segA, segB);
            rawHits.push({ idx: (k + t) % N, pt: ix });
          }
        }

        if (other.type === 'ellipse' && other.pts.length >= 2 && other.rx != null && other.ry != null) {
          const ixs = segEllipseIntersect(segA, segB, other.pts[0], other.rx, other.ry, other.rotation || 0);
          for (const ix of ixs) {
            const t = segParam(ix, segA, segB);
            rawHits.push({ idx: (k + t) % N, pt: ix });
          }
        }
      }
    }

    rawHits.sort((a, b) => a.idx - b.idx);
    const uniqueHits: { idx: number; pt: Point2D }[] = [];
    for (const h of rawHits) {
      const isDup = uniqueHits.some(u => {
        const idxDiff = Math.abs(u.idx - h.idx);
        const wrapDiff = Math.abs(idxDiff - N);
        return dist(u.pt, h.pt) < 1e-3 || idxDiff < 0.2 || wrapDiff < 0.2;
      });
      if (!isDup) uniqueHits.push(h);
    }

    if (uniqueHits.length < 2) {
      return {
        targetEnt,
        targetSegIdx: -1,
        subSeg: { p0: ring[0], p1: ring[Math.floor(N / 2)] },
        subPolyline: [...ring, ring[0]],
        preservedSegs: [],
        preservedPolylines: [],
      };
    }

    let clickIdx = 0;
    let clickMinD = Infinity;
    for (let k = 0; k < N; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % N];
      const d = distToSegment(rawPt, a, b);
      if (d < clickMinD) {
        clickMinD = d;
        const t = segParam(rawPt, a, b);
        clickIdx = (k + t) % N;
      }
    }

    let trimSpanIdx = -1;
    for (let i = 0; i < uniqueHits.length - 1; i++) {
      if (clickIdx >= uniqueHits[i].idx && clickIdx <= uniqueHits[i + 1].idx) {
        trimSpanIdx = i;
        break;
      }
    }
    if (trimSpanIdx === -1) {
      trimSpanIdx = uniqueHits.length - 1;
    }

    const preservedPolylines: Point2D[][] = [];
    const preservedSegs: { p0: Point2D; p1: Point2D }[] = [];
    let subPolyline: Point2D[] = [];
    let subSeg = { p0: ring[0], p1: ring[Math.floor(N / 2)] };

    for (let i = 0; i < uniqueHits.length; i++) {
      const hStart = uniqueHits[i];
      const hEnd = uniqueHits[(i + 1) % uniqueHits.length];
      const arcPts = sampleArcPoints(hStart, hEnd, ring);
      if (i === trimSpanIdx) {
        subPolyline = arcPts;
        subSeg = { p0: hStart.pt, p1: hEnd.pt };
      } else {
        preservedPolylines.push(arcPts);
        preservedSegs.push({ p0: hStart.pt, p1: hEnd.pt });
      }
    }

    return {
      targetEnt,
      targetSegIdx: -1,
      subSeg,
      subPolyline,
      preservedSegs,
      preservedPolylines,
    };
  }

  const segA = targetEnt.pts[targetSegIdx];
  const segB = targetEnt.pts[(targetSegIdx + 1) % targetEnt.pts.length];

  // Collect all intersection t-parameters along the segment [0, 1]
  const tParams: number[] = [0, 1];

  for (const other of entities) {
    for (let j = 0; j < other.pts.length - 1; j++) {
      if (other.id === targetEnt.id && j === targetSegIdx) continue;
      if (other.type === 'construction' && other.pts.length >= 2) {
        const ix = segInfLineIntersect(segA, segB, other.pts[0], other.pts[1]);
        if (ix) {
          const t = segParam(ix, segA, segB);
          if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
        }
      } else {
        const ix = segSegIntersect(segA, segB, other.pts[j], other.pts[j + 1]);
        if (ix) {
          const t = segParam(ix, segA, segB);
          if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
        }
      }
    }
    if (other.isClosed && other.pts.length >= 3) {
      const j = other.pts.length - 1;
      if (!(other.id === targetEnt.id && j === targetSegIdx)) {
        const ix = segSegIntersect(segA, segB, other.pts[j], other.pts[0]);
        if (ix) {
          const t = segParam(ix, segA, segB);
          if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
        }
      }
    }
    if (other.type === 'circle' && other.pts.length >= 2) {
      const r = other.radius ?? dist(other.pts[0], other.pts[1]);
      const ixs = segCircleIntersect(segA, segB, other.pts[0], r);
      for (const ix of ixs) {
        const t = segParam(ix, segA, segB);
        if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
      }
    }
    if (other.type === 'ellipse' && other.pts.length >= 2 && other.rx != null && other.ry != null) {
      const ixs = segEllipseIntersect(segA, segB, other.pts[0], other.rx, other.ry, other.rotation || 0);
      for (const ix of ixs) {
        const t = segParam(ix, segA, segB);
        if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
      }
    }
  }

  const sortedT = Array.from(new Set(tParams.map(t => +t.toFixed(6)))).sort((a, b) => a - b);

  if (sortedT.length <= 2) {
    // Nothing crosses this segment - trim removes the whole segment.
    return { targetEnt, targetSegIdx, subSeg: { p0: segA, p1: segB }, preservedSegs: [] };
  }

  const tClick = segParam(rawPt, segA, segB);
  let subIdx = sortedT.findIndex((t, i) => i < sortedT.length - 1 && tClick >= t && tClick <= sortedT[i + 1]);
  if (subIdx < 0) subIdx = 0;

  const t0 = sortedT[subIdx];
  const t1 = sortedT[subIdx + 1];
  const subSeg = {
    p0: { x: +(segA.x + t0 * (segB.x - segA.x)).toFixed(5), y: +(segA.y + t0 * (segB.y - segA.y)).toFixed(5) },
    p1: { x: +(segA.x + t1 * (segB.x - segA.x)).toFixed(5), y: +(segA.y + t1 * (segB.y - segA.y)).toFixed(5) }
  };

  const preservedSegs: { p0: Point2D; p1: Point2D }[] = [];
  for (let i = 0; i < sortedT.length - 1; i++) {
    if (i !== subIdx) {
      const ta = sortedT[i];
      const tb = sortedT[i + 1];
      if (tb - ta > 1e-5) {
        preservedSegs.push({
          p0: { x: +(segA.x + ta * (segB.x - segA.x)).toFixed(5), y: +(segA.y + ta * (segB.y - segA.y)).toFixed(5) },
          p1: { x: +(segA.x + tb * (segB.x - segA.x)).toFixed(5), y: +(segA.y + tb * (segB.y - segA.y)).toFixed(5) }
        });
      }
    }
  }

  return {
    targetEnt,
    targetSegIdx,
    subSeg,
    preservedSegs,
  };
}
