import React, { useState } from 'react';
import {
  Box,
  Activity,
  Calculator,
  Compass,
  Cpu,
  Eye,
  Layers,
  ChevronRight,
  Wind,
} from 'lucide-react';
import { GeometryMeshPanel } from '../panels/GeometryMeshPanel';
import { PhysicsTurbulencePanel } from '../panels/PhysicsTurbulencePanel';
import { YPlusCalculatorPanel } from '../panels/YPlusCalculatorPanel';
import { BoundaryConditionsPanel } from '../panels/BoundaryConditionsPanel';
import { SolverControlPanel } from '../panels/SolverControlPanel';
import { PostProcessPanel } from '../panels/PostProcessPanel';
import { CFDProjectState } from '../../types/cfd';

type WorkflowStep = 'geometry' | 'physics' | 'yplus' | 'boundaries' | 'solver' | 'postprocess';

interface SidebarProps {
  state: CFDProjectState;
  updateGeometry: (p: any) => void;
  updatePhysics: (p: any) => void;
  updateBoundaries: (p: any) => void;
  updateYPlus: (p: any) => void;
  updateSolver: (p: any) => void;
  updatePostProcess: (p: any) => void;
  onGenerateMesh: () => void;
  onApplyYPlusToMesh: () => void;
  onRunSolver: () => void;
  onStopSolver: () => void;
  isMeshing: boolean;
  fieldRanges: Record<string, [number, number]>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  state,
  updateGeometry,
  updatePhysics,
  updateBoundaries,
  updateYPlus,
  updateSolver,
  updatePostProcess,
  onGenerateMesh,
  onApplyYPlusToMesh,
  onRunSolver,
  onStopSolver,
  isMeshing,
  fieldRanges,
}) => {
  const [activeStep, setActiveStep] = useState<WorkflowStep>('geometry');

  const steps: { id: WorkflowStep; label: string; icon: any }[] = [
    { id: 'geometry', label: '1. Geometry & Gmsh', icon: Box },
    { id: 'physics', label: '2. Flow & Turbulence', icon: Activity },
    { id: 'yplus', label: '3. Y+ Calculator', icon: Calculator },
    { id: 'boundaries', label: '4. Boundaries', icon: Compass },
    { id: 'solver', label: '5. OpenFOAM Solver', icon: Cpu },
    { id: 'postprocess', label: '6. Post Processing', icon: Eye },
  ];

  return (
    <div className="w-80 h-full flex flex-col bg-surface border-r border-line select-none z-20">
      {/* App Header Branding */}
      <div className="px-4 py-3.5 border-b border-line flex items-center justify-between bg-surface">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-inverse flex items-center justify-center text-on-inverse">
            <Wind className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-fg text-sm tracking-tight">OpenCFD Studio</span>
            <span className="text-[10px] text-fg-4 block -mt-0.5">OpenFOAM &amp; Gmsh Suite</span>
          </div>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-surface-3 text-fg-2 rounded-sm border border-line font-semibold">
          v1.0
        </span>
      </div>

      {/* Step Navigation Pill Bar */}
      <div className="p-2 border-b border-line bg-surface-2/50 space-y-1">
        <div className="grid grid-cols-3 gap-1">
          {steps.slice(0, 3).map((step) => {
            const Icon = step.icon;
            const isActive = activeStep === step.id;
            return (
              <button
                key={step.id}
                onClick={() => setActiveStep(step.id)}
                className={`py-1.5 px-1 rounded-sm text-[11px] font-medium flex flex-col items-center gap-1 transition-all ${
                  isActive
                    ? 'bg-surface text-accent border border-line font-semibold'
                    : 'text-fg-2 hover:text-fg hover:bg-surface-3'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="truncate w-full text-center text-[10px]">
                  {step.label.split('. ')[1]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {steps.slice(3, 6).map((step) => {
            const Icon = step.icon;
            const isActive = activeStep === step.id;
            return (
              <button
                key={step.id}
                onClick={() => setActiveStep(step.id)}
                className={`py-1.5 px-1 rounded-sm text-[11px] font-medium flex flex-col items-center gap-1 transition-all ${
                  isActive
                    ? 'bg-surface text-accent border border-line font-semibold'
                    : 'text-fg-2 hover:text-fg hover:bg-surface-3'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="truncate w-full text-center text-[10px]">
                  {step.label.split('. ')[1]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Workflow Panel Content */}
      <div className="flex-1 overflow-y-auto bg-surface">
        {activeStep === 'geometry' && (
          <GeometryMeshPanel
            config={state.geometry}
            onChange={updateGeometry}
            onGenerateMesh={onGenerateMesh}
            isMeshing={isMeshing}
          />
        )}

        {activeStep === 'physics' && (
          <PhysicsTurbulencePanel config={state.physics} onChange={updatePhysics} />
        )}

        {activeStep === 'yplus' && (
          <YPlusCalculatorPanel
            yplus={state.yplus}
            onChange={updateYPlus}
            onApplyToMesh={onApplyYPlusToMesh}
          />
        )}

        {activeStep === 'boundaries' && (
          <BoundaryConditionsPanel
            boundaries={state.boundaries}
            physics={state.physics}
            onChange={updateBoundaries}
          />
        )}

        {activeStep === 'solver' && (
          <SolverControlPanel
            solver={state.solver}
            physics={state.physics}
            onChangeSolver={updateSolver}
            onChangePhysics={updatePhysics}
            onRunSolver={onRunSolver}
            onStopSolver={onStopSolver}
            executionStatus={state.executionStatus}
          />
        )}

        {activeStep === 'postprocess' && (
          <PostProcessPanel
            config={state.postprocess}
            onChange={updatePostProcess}
            availableRanges={fieldRanges}
          />
        )}
      </div>

      {/* Footer Info Badge */}
      <div className="p-3 bg-surface-2 border-t border-line text-[11px] text-fg-2 flex justify-between items-center">
        <span className="truncate">
          {state.physics.regime === 'turbulent' ? state.physics.turbulenceModel : 'Laminar'}
        </span>
        <span className="font-mono text-fg-4">U = {state.boundaries.inletVelocity} m/s</span>
      </div>
    </div>
  );
};
