import type { StudioSession } from '../App';
import React from 'react';
import { CFDProjectState } from '../types/cfd';
import { saveProjectSession } from '../utils/projectsApi';
import { toast } from '../components/ui/Toast';

/** Debounced session autosave (backed off while a solve is running). Returns the cleanup. */
export function scheduleAutosave(wb: AutosaveContext) {
  const { state, projectId, sessionRef, saveWarned } = wb;
  // during a solve the residual stream fires constantly - back the autosave
  // off; the final state is saved when executionStatus leaves 'running'
  const delay = state.executionStatus === 'running' ? 8000 : 400;
  const timer = setTimeout(() => {
    saveProjectSession(projectId, sessionRef.current)
      .then(() => {
        saveWarned.current = false;
      })
      .catch((err) => {
        console.warn('Project autosave note:', err);
        if (!saveWarned.current) {
          saveWarned.current = true;
          toast.error('Autosave failed', {
            id: 'autosave',
            description: 'Check the backend connection. Your work is kept in this window.',
          });
        }
      });
  }, delay);
  return () => clearTimeout(timer);
}

/** What scheduleAutosave reads from the workbench component. */
export interface AutosaveContext {
  state: CFDProjectState;
  projectId: string;
  sessionRef: React.RefObject<StudioSession>;
  saveWarned: React.RefObject<boolean>;
}
