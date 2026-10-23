import type { CadAction } from '../workbenchCore';
import React from 'react';
import {
  uploadAndParseAirfoil,
  uploadAndParseDxf,
  fetchAndParseAirfoilFromUrl,
} from '../../../utils/api';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import { uid, pointsToLineSegments } from '../workbenchCore';

/** Import the file handed over from the left panel (airfoil .dat / DXF / URL). */
export function importPendingFile(wb: ImportPendingFileContext) {
  const {
    pendingImportFile,
    setIsLoading,
    dispatch,
    setCadName,
    setCmdText,
    setPan,
    setZoom,
    onClearPendingImport,
  } = wb;
  if (!pendingImportFile) return;
  const load = async () => {
    setIsLoading(true);
    try {
      if (pendingImportFile.type === 'parsed') {
        const pts = pendingImportFile.points;
        const segments = pointsToLineSegments(pts, 'geometry');
        dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
        setCadName(pendingImportFile.name);
        setCmdText(`Imported: ${pendingImportFile.name} (closed airfoil profile)`);
        setPan({ x: -120, y: 0 });
        setZoom(240);
      } else if (pendingImportFile.type === 'airfoil' && pendingImportFile.file) {
        const res = await uploadAndParseAirfoil(pendingImportFile.file);
        const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
        const segments = pointsToLineSegments(pts, 'geometry');
        dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
        setCadName(res.name || pendingImportFile.file.name);
        setCmdText(`Imported: ${res.name} (closed airfoil profile)`);
        setPan({ x: -120, y: 0 });
        setZoom(240);
      } else if (pendingImportFile.type === 'url' && pendingImportFile.url) {
        const res = await fetchAndParseAirfoilFromUrl(pendingImportFile.url);
        const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
        const segments = pointsToLineSegments(pts, 'geometry');
        dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
        setCadName(res.name || 'Airfoil from Link');
        setCmdText(`Imported from Link: ${res.name} (closed airfoil profile)`);
        setPan({ x: -120, y: 0 });
        setZoom(240);
      } else if (pendingImportFile.type === 'dxf' && pendingImportFile.file) {
        const res = await uploadAndParseDxf(pendingImportFile.file);
        const newEnts: CadEntity[] = [];
        for (const p of res.polylines || []) {
          const pts: Point2D[] = p.points.map(([x, y]: number[]) => ({ x, y }));
          newEnts.push({
            id: uid(),
            type: 'polyline',
            layer: 'default',
            pts,
            isClosed: p.is_closed,
          });
        }
        for (const l of res.lines || []) {
          newEnts.push({
            id: uid(),
            type: 'line',
            layer: 'default',
            pts: [
              { x: l.x1, y: l.y1 },
              { x: l.x2, y: l.y2 },
            ],
          });
        }
        if (newEnts.length) {
          dispatch({ type: 'REPLACE_ENTITIES', entities: newEnts });
          setCadName(pendingImportFile.file.name);
          setCmdText(`Imported DXF: ${newEnts.length} entities`);
        }
      }
    } catch (err: any) {
      setCmdText(`Import error: ${err.message}`);
    }
    setIsLoading(false);
    onClearPendingImport?.();
  };
  load();
}

/** What importPendingFile reads from the workbench component. */
export interface ImportPendingFileContext {
  pendingImportFile:
    | { type: 'parsed'; name: string; points: Point2D[] }
    | { type: 'airfoil' | 'dxf' | 'url'; file?: File; url?: string };
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  dispatch: React.ActionDispatch<[action: CadAction]>;
  setCadName: (name: string) => void;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
  setPan: React.Dispatch<React.SetStateAction<Point2D>>;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  onClearPendingImport: () => void;
}
