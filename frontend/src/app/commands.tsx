import React from 'react';
import type { StageId } from '../components/layout/stages';
import {
  PenTool,
  SlidersHorizontal,
  Grid3x3,
  Play,
  Square,
  BarChart3,
  Plus,
  RefreshCw,
  FileCode,
  Settings,
  LayoutGrid,
  Layers,
  Wand2,
  Ruler,
  FileDown,
  SunMoon,
  PanelLeft,
  Monitor,
} from 'lucide-react';
import { setThemePreference, toggleTheme } from '../utils/theme';
import { Command } from '../components/ui/CommandPalette';
import { MOD_LABEL } from '../utils/platform';
import { Blocking } from '../types/blocking';

/** Every command in the command palette (navigation, actions, view, theme). */
export function buildCommands(wb: CommandsContext): Command[] {
  const {
    setActiveStage,
    meshGate,
    isMeshing,
    handleGenerateMesh,
    blocking,
    handleBuildBlocks,
    handleGenerateStructuredMesh,
    handleApplyYPlusToMesh,
    requestDownloadBlockMeshDictRef,
    solverRunning,
    handleStopSolver,
    meshReady,
    solverBusy,
    handleRunSolver,
    clearResultsCache,
    loadResults,
    setCreatePlotModalOpen,
    selectLatestFinishedRun,
    setCaseFilesOpen,
    setPreferencesOpen,
    setLeftPanelHidden,
    handleExitHome,
  } = wb;
  return [
    // Navigate
    {
      id: 'go-geometry',
      group: 'Navigate',
      title: 'Go to Geometry',
      icon: <PenTool className="w-4 h-4" />,
      shortcut: ['1'],
      run: () => setActiveStage('geometry'),
    },
    {
      id: 'go-case-setup',
      group: 'Navigate',
      title: 'Go to Case Setup',
      icon: <SlidersHorizontal className="w-4 h-4" />,
      shortcut: ['2'],
      run: () => setActiveStage('caseSetup'),
    },
    {
      id: 'go-mesh',
      group: 'Navigate',
      title: 'Go to Mesh',
      icon: <Grid3x3 className="w-4 h-4" />,
      shortcut: ['3'],
      run: () => setActiveStage('mesh'),
    },
    {
      id: 'go-solver',
      group: 'Navigate',
      title: 'Go to Solver',
      icon: <Play className="w-4 h-4" />,
      shortcut: ['4'],
      run: () => setActiveStage('solver'),
    },
    {
      id: 'go-results',
      group: 'Navigate',
      title: 'Go to Results',
      icon: <BarChart3 className="w-4 h-4" />,
      shortcut: ['5'],
      run: () => setActiveStage('results'),
    },

    // Mesh
    {
      id: 'mesh-generate',
      group: 'Mesh',
      title: 'Generate Mesh (Gmsh)',
      keywords: 'unstructured triangulate remesh',
      icon: <Grid3x3 className="w-4 h-4" />,
      disabled: !meshGate.ready || isMeshing,
      disabledReason: !meshGate.ready
        ? meshGate.missing.join('; ')
        : 'A mesh is already being generated',
      run: handleGenerateMesh,
    },
    {
      id: 'mesh-blocks-h',
      group: 'Mesh',
      title: 'Build Structured Blocks · H-grid',
      keywords: 'blocking hexa structured',
      icon: <Layers className="w-4 h-4" />,
      run: () => handleBuildBlocks('hgrid'),
    },
    {
      id: 'mesh-blocks-o',
      group: 'Mesh',
      title: 'Build Structured Blocks · O-grid',
      keywords: 'blocking ring body',
      icon: <Layers className="w-4 h-4" />,
      run: () => handleBuildBlocks('ogrid'),
    },
    {
      id: 'mesh-blocks-c',
      group: 'Mesh',
      title: 'Build Structured Blocks · C-grid',
      keywords: 'blocking airfoil wake',
      icon: <Layers className="w-4 h-4" />,
      run: () => handleBuildBlocks('cgrid'),
    },
    {
      id: 'mesh-structured-generate',
      group: 'Mesh',
      title: 'Generate Structured Mesh',
      keywords: 'transfinite quad',
      icon: <Wand2 className="w-4 h-4" />,
      disabled: !blocking || isMeshing,
      disabledReason: 'Build the block topology first',
      run: handleGenerateStructuredMesh,
    },
    {
      id: 'mesh-apply-yplus',
      group: 'Mesh',
      title: 'Apply y⁺ Sizing to Mesh',
      keywords: 'first layer prism boundary layer',
      icon: <Ruler className="w-4 h-4" />,
      run: handleApplyYPlusToMesh,
    },
    {
      id: 'mesh-blockmeshdict',
      group: 'Mesh',
      title: 'Download blockMeshDict',
      keywords: 'export native openfoam',
      icon: <FileDown className="w-4 h-4" />,
      run: () => requestDownloadBlockMeshDictRef.current?.(),
    },

    // Solver
    solverRunning
      ? {
          id: 'solver-stop',
          group: 'Solver',
          title: 'Stop Solver',
          icon: <Square className="w-4 h-4" />,
          shortcut: [MOD_LABEL, '↵'],
          run: handleStopSolver,
        }
      : {
          id: 'solver-run',
          group: 'Solver',
          title: 'Run Solver',
          icon: <Play className="w-4 h-4" />,
          shortcut: [MOD_LABEL, '↵'],
          disabled: !meshReady || solverBusy,
          disabledReason: !meshReady ? 'Generate a mesh first' : 'A run is already in progress',
          run: handleRunSolver,
        },
    {
      id: 'solver-reload',
      group: 'Solver',
      title: 'Reload Results',
      keywords: 'refresh refetch field',
      icon: <RefreshCw className="w-4 h-4" />,
      run: () => {
        clearResultsCache();
        void loadResults(true);
      },
    },

    // Results
    {
      id: 'results-new-plot',
      group: 'Results',
      title: 'New Plot',
      keywords: 'chart line probe compare',
      icon: <Plus className="w-4 h-4" />,
      run: () => setCreatePlotModalOpen(true),
    },
    {
      id: 'results-view-latest',
      group: 'Results',
      title: 'View Latest Run',
      keywords: 'open field viewport',
      icon: <BarChart3 className="w-4 h-4" />,
      run: selectLatestFinishedRun,
    },

    // Project
    {
      id: 'project-case-files',
      group: 'Project',
      title: 'Open OpenFOAM Case Files',
      keywords: 'dicts browse system constant',
      icon: <FileCode className="w-4 h-4" />,
      run: () => setCaseFilesOpen(true),
    },
    {
      id: 'project-preferences',
      group: 'Project',
      title: 'Open Preferences',
      keywords: 'settings options',
      icon: <Settings className="w-4 h-4" />,
      run: () => setPreferencesOpen(true),
    },
    {
      id: 'view-toggle-left-panel',
      group: 'View',
      title: 'Toggle Stage Panel',
      keywords: 'sidebar left hide show collapse focus',
      icon: <PanelLeft className="w-4 h-4" />,
      shortcut: [MOD_LABEL, 'B'],
      run: () => setLeftPanelHidden((h) => !h),
    },
    {
      id: 'view-theme-toggle',
      group: 'View',
      title: 'Toggle Light / Dark Theme',
      keywords: 'appearance dark mode light mode colour',
      icon: <SunMoon className="w-4 h-4" />,
      run: toggleTheme,
    },
    {
      id: 'view-theme-system',
      group: 'View',
      title: 'Use System Theme',
      keywords: 'appearance auto os',
      icon: <Monitor className="w-4 h-4" />,
      run: () => setThemePreference('system'),
    },
    {
      id: 'project-home',
      group: 'Project',
      title: 'Back to Projects',
      keywords: 'close home exit',
      icon: <LayoutGrid className="w-4 h-4" />,
      run: handleExitHome,
    },
  ];
}

/** What buildCommands reads from the workbench component. */
export interface CommandsContext {
  setActiveStage: React.Dispatch<React.SetStateAction<StageId>>;
  meshGate: { ready: boolean; missing: string[] };
  isMeshing: boolean;
  handleGenerateMesh: () => Promise<void>;
  blocking: Blocking;
  handleBuildBlocks: (kind: 'hgrid' | 'ogrid' | 'cgrid' | 'cgrid_closed') => void;
  handleGenerateStructuredMesh: () => Promise<void>;
  handleApplyYPlusToMesh: () => void;
  requestDownloadBlockMeshDictRef: React.RefObject<() => void>;
  solverRunning: boolean;
  handleStopSolver: () => void;
  meshReady: boolean;
  solverBusy: boolean;
  handleRunSolver: () => Promise<void>;
  clearResultsCache: () => void;
  loadResults: (
    fromRun?: boolean,
    time?: number,
    silent?: boolean,
    frameIdx?: number,
  ) => Promise<void>;
  setCreatePlotModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectLatestFinishedRun: () => void;
  setCaseFilesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPreferencesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setLeftPanelHidden: React.Dispatch<React.SetStateAction<boolean>>;
  handleExitHome: () => Promise<void>;
}
