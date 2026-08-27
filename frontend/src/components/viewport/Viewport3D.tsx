import React, { useEffect, useRef, useState } from 'react';
import { interpolateColor } from '../../utils/colormaps';
import { ColormapLegend } from './ColormapLegend';
import { Maximize2, RotateCcw, Eye, Layers, Wind, Grid } from 'lucide-react';

interface Viewport3DProps {
  meshData: any;
  fieldData: any;
  activeField: 'U_mag' | 'p' | 'k' | 'omega' | 'vorticity';
  colormap: 'coolwarm' | 'viridis' | 'turbo' | 'jet' | 'rainbow';
  showMeshWireframe: boolean;
  showStreamlines: boolean;
  onToggleWireframe: () => void;
  onToggleStreamlines: () => void;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  meshData,
  fieldData,
  activeField,
  colormap,
  showMeshWireframe,
  showStreamlines,
  onToggleWireframe,
  onToggleStreamlines,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Camera state
  const [zoom, setZoom] = useState<number>(65);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const resetView = () => {
    setZoom(65);
    setPan({ x: 0, y: 0 });
  };

  // Field display metadata
  const fieldUnits: Record<string, string> = {
    U_mag: 'm/s',
    p: 'Pa',
    k: 'm²/s²',
    omega: '1/s',
    vorticity: '1/s',
  };

  const fieldLabels: Record<string, string> = {
    U_mag: 'Velocity Magnitude (|U|)',
    p: 'Pressure (p)',
    k: 'Turbulent Kinetic Energy (k)',
    omega: 'Specific Dissipation Rate (ω)',
    vorticity: 'Vorticity (∇×U)',
  };

  const currentRange = fieldData?.ranges?.[activeField] || [0, 20];
  const fieldValues = fieldData?.fields?.[activeField] || [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear background with clean off-white / light slate
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Subtle background grid
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    const gridSize = 40;
    const offsetX = (width / 2 + pan.x) % gridSize;
    const offsetY = (height / 2 + pan.y) % gridSize;

    for (let x = offsetX; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = offsetY; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (!meshData || !meshData.nodes || meshData.nodes.length === 0) {
      // Empty state prompt
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Generate a mesh or run solver to inspect flow fields', width / 2, height / 2);
      return;
    }

    const nodes = meshData.nodes;
    const elements = meshData.elements || [];

    // Helper coordinate transform: world -> screen
    const toScreen = (wx: number, wy: number) => {
      return {
        x: width / 2 + pan.x + wx * zoom,
        y: height / 2 + pan.y - wy * zoom, // invert Y for CAD coordinate system
      };
    };

    const [minVal, maxVal] = currentRange;

    // 1. Draw Field Elements (Triangles) with Colormap
    if (elements.length > 0) {
      for (const el of elements) {
        if (el.length < 3) continue;
        ctx.beginPath();
        const first = toScreen(nodes[el[0]][0], nodes[el[0]][1]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < el.length; i++) {
          const p = toScreen(nodes[el[i]][0], nodes[el[i]][1]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();

        if (fieldValues.length > 0) {
          let sum = 0;
          for (let i = 0; i < el.length; i++) sum += fieldValues[el[i]];
          ctx.fillStyle = interpolateColor(sum / el.length, minVal, maxVal, colormap);
          ctx.fill();
        } else {
          ctx.fillStyle = '#f8fafc';
          ctx.fill();
        }

        if (showMeshWireframe) {
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // 2. Draw Geometry Surface / Airfoil Boundary
    if (meshData.boundaries?.airfoil) {
      ctx.beginPath();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      const bNodes = meshData.boundaries.airfoil;
      for (let i = 0; i < bNodes.length; i++) {
        const pt = toScreen(nodes[bNodes[i]][0], nodes[bNodes[i]][1]);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.stroke();
    }

    // 3. Draw Streamlines
    if (showStreamlines && fieldData?.streamlines) {
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.lineWidth = 1.5;
      for (const line of fieldData.streamlines) {
        if (line.length < 2) continue;
        ctx.beginPath();
        const start = toScreen(line[0][0], line[0][1]);
        ctx.moveTo(start.x, start.y);
        for (let k = 1; k < line.length; k++) {
          const p = toScreen(line[k][0], line[k][1]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    // 4. Coordinate Axes Indicator (Bottom-Left)
    const axisOrigin = { x: 45, y: height - 45 };
    const axisLen = 30;
    // X Axis (Red)
    ctx.beginPath();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.moveTo(axisOrigin.x, axisOrigin.y);
    ctx.lineTo(axisOrigin.x + axisLen, axisOrigin.y);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.font = '10px monospace';
    ctx.fillText('X', axisOrigin.x + axisLen + 4, axisOrigin.y + 3);

    // Y Axis (Green)
    ctx.beginPath();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.moveTo(axisOrigin.x, axisOrigin.y);
    ctx.lineTo(axisOrigin.x, axisOrigin.y - axisLen);
    ctx.stroke();
    ctx.fillStyle = '#10b981';
    ctx.fillText('Y', axisOrigin.x - 3, axisOrigin.y - axisLen - 4);
  }, [meshData, fieldData, activeField, colormap, showMeshWireframe, showStreamlines, zoom, pan]);

  // Mouse pan & zoom handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prev) => Math.max(10, Math.min(600, prev * zoomFactor)));
  };

  return (
    <div className="relative w-full h-full bg-white overflow-hidden flex flex-col select-none">
      {/* Top Floating Viewport Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-white/95 backdrop-blur border border-slate-200 shadow-sm rounded-lg px-2.5 py-1.5 text-xs text-slate-700">
        <button
          onClick={onToggleWireframe}
          className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
            showMeshWireframe ? 'bg-blue-50 text-blue-600 font-medium border border-blue-200' : 'hover:bg-slate-100 text-slate-600'
          }`}
          title="Toggle Mesh Wireframe"
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Mesh Wireframe</span>
        </button>

        <button
          onClick={onToggleStreamlines}
          className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
            showStreamlines ? 'bg-blue-50 text-blue-600 font-medium border border-blue-200' : 'hover:bg-slate-100 text-slate-600'
          }`}
          title="Toggle Streamlines"
        >
          <Wind className="w-3.5 h-3.5" />
          <span>Streamlines</span>
        </button>

        <div className="w-px h-4 bg-slate-200" />

        <button
          onClick={resetView}
          className="flex items-center gap-1 px-2 py-1 hover:bg-slate-100 rounded text-slate-600 transition-colors"
          title="Reset View"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset View</span>
        </button>
      </div>

      {/* Main Canvas Viewport */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Colormap Legend Bar */}
      {fieldValues.length > 0 && (
        <ColormapLegend
          fieldName={fieldLabels[activeField] || activeField}
          unit={fieldUnits[activeField] || ''}
          min={currentRange[0]}
          max={currentRange[1]}
          colormap={colormap}
        />
      )}
    </div>
  );
};
