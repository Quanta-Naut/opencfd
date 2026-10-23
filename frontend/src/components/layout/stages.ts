export type StageId =
  | 'geometry'
  | 'caseSetup'
  | 'mesh'
  | 'physics'
  | 'yplus'
  | 'solver'
  | 'results';

export interface StageStatus {
  locked: boolean;
  reason?: string;
  missing?: string[];
}

/** The five workflow stages, in order. Number keys 1-5 jump to them. */
export const STAGES: { id: StageId; label: string }[] = [
  { id: 'geometry', label: 'Geometry' },
  { id: 'caseSetup', label: 'Case Setup' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'solver', label: 'Solver' },
  { id: 'results', label: 'Results' },
];
