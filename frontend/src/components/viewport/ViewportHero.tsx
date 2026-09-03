import React, { useEffect, useRef, useState } from 'react';
import { interpolateColor } from '../../utils/colormaps';
import { Maximize2 } from 'lucide-react';
import { CadEntity } from '../../types/cadWorkflow';

interface ViewportHeroProps {
  meshData: any;
  cadEntities: CadEntity[];
  fieldData: any;
  activeField: 'U_mag' | 'p' | 'k' | 'omega' | 'vorticity';
  colormap: 'viridis' | 'coolwarm' | 'turbo' | 'jet' | 'rainbow';
  showMeshWireframe: boolean;
  showStreamlines: boolean;
  onToggleWireframe: () => void;
  onToggleStreamlines: () => void;
  onChangeField: (field: any) => void;
}

export const ViewportHero: React.FC<ViewportHeroProps> = ({
  meshData,
  cadEntities,
  fieldData,
  activeField,
  colormap,
  showMeshWireframe,
  showStreamlines,
  onToggleWireframe,
  onToggleStreamlines,
  onChangeField,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Camera & view states
  const [zoom, setZoom] = useState<number>(75);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [renderMode, setRenderMode] = useState<'mesh' | 'cad'>(meshData ? 'mesh' : 'cad');

  useEffect(() => {
    setRenderMode(meshData ? 'mesh' : 'cad');
  }, [meshData]);

  const resetView = (mode: 'top' | 'front' | 'iso') => {
    setZoom(75);
    setPan({ x: 0, y: 0 });
  };

  const fieldUnits: Record<string, string> = {
    U_mag: 'm/s',
    p: 'Pa',
    k: 'm²/s²',
    omega: '1/s',
    vorticity: '1/s',
  };

  const currentRange = fieldData?.ranges?.[activeField] || [0, 35];
  const fieldValues = fieldData?.fields?.[activeField] || [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clean viewport background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Subtle engineering background grid
    ctx.strokeStyle = '#F0F2F5';
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

    const toScreen = (wx: number, wy: number) => {
      return {
        x: width / 2 + pan.x + wx * zoom,
        y: height / 2 + pan.y - wy * zoom,
      };
    };

    if (renderMode === 'cad') {
      ctx.save();
      ctx.strokeStyle = '#171A1F';
      ctx.fillStyle = 'transparent';
      ctx.lineWidth = 2;
      for (const entity of cadEntities.filter((item) => item.layer !== 'construction')) {
        if (entity.pts.length === 0) continue;
        ctx.beginPath();
        const first = toScreen(entity.pts[0].x, entity.pts[0].y);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < entity.pts.length; i += 1) {
          const point = toScreen(entity.pts[i].x, entity.pts[i].y);
          ctx.lineTo(point.x, point.y);
        }
        if (entity.isClosed || entity.type === 'circle' || entity.type === 'rectangle') ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (!meshData || !meshData.nodes || meshData.nodes.length === 0) return;

    const nodes = meshData.nodes;
    const elements = meshData.elements || [];

    const [minVal, maxVal] = currentRange;

    // 1. Draw Surface Mesh / Filled Contours
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
          ctx.fillStyle = '#F8FAFC';
          ctx.fill();
        }

        if (showMeshWireframe || renderMode === 'mesh') {
          ctx.strokeStyle = '#E1E4E8';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // 2. Draw Airfoil / Body Solid Outline
    if (meshData.boundaries?.airfoil) {
      ctx.beginPath();
      ctx.strokeStyle = '#171A1F';
      ctx.lineWidth = 2.5;
      const bNodes = meshData.boundaries.airfoil;
      for (let i = 0; i < bNodes.length; i++) {
        const pt = toScreen(nodes[bNodes[i]][0], nodes[bNodes[i]][1]);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = '#171A1F';
      ctx.fill();
      ctx.stroke();
    }

    // 3. Draw Streamlines
    if (showStreamlines && fieldData?.streamlines) {
      ctx.strokeStyle = 'rgba(23, 26, 31, 0.45)';
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

    // 4. Clean Coordinate Indicator (Bottom-Left)
    const orig = { x: 36, y: height - 36 };
    ctx.beginPath();
    ctx.strokeStyle = '#DC2626';
    ctx.lineWidth = 2;
    ctx.moveTo(orig.x, orig.y);
    ctx.lineTo(orig.x + 24, orig.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = '#16A34A';
    ctx.lineWidth = 2;
    ctx.moveTo(orig.x, orig.y);
    ctx.lineTo(orig.x, orig.y - 24);
    ctx.stroke();
  }, [meshData, cadEntities, fieldData, activeField, colormap, showMeshWireframe, showStreamlines, renderMode, zoom, pan]);

  // Handlers
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
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prev) => Math.max(10, Math.min(600, prev * factor)));
  };

  return (
    <div className="relative w-full h-full bg-white select-none overflow-hidden flex flex-col">
      {/* View mode */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1 bg-white/95 backdrop-blur border border-[#E1E4E8] rounded-md px-1.5 py-1 text-xs">
        <button
          onClick={() => setRenderMode('cad')}
          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
            renderMode === 'cad' ? 'bg-[#F5F6F8] text-[#171A1F] font-semibold' : 'text-[#69717D] hover:text-[#171A1F]'
          }`}
        >
          {renderMode === 'cad' ? '◉' : '○'} CAD
        </button>
        <button
          onClick={() => meshData && setRenderMode('mesh')}
          disabled={!meshData}
          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
            renderMode === 'mesh' ? 'bg-[#F5F6F8] text-[#171A1F] font-semibold' : 'text-[#69717D] hover:text-[#171A1F] disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          {renderMode === 'mesh' ? '◉' : '○'} Mesh
        </button>
      </div>

      {/* 3. MAIN INTERACTIVE CANVAS VIEWPORT */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* 4. BOTTOM-RIGHT FLOATING SCALAR COLORMAP BAR (VIRIDIS DEFAULT) */}
      {fieldValues.length > 0 && renderMode === 'mesh' && (
        <div className="absolute bottom-3 right-3 z-20 bg-white/95 backdrop-blur border border-[#E1E4E8] rounded-md p-2.5 w-48 text-xs select-none">
          <div className="flex justify-between items-center mb-1">
            <select
              value={activeField}
              onChange={(e) => onChangeField(e.target.value)}
              className="font-semibold text-[#171A1F] bg-transparent border-none focus:outline-none cursor-pointer text-xs"
            >
              <option value="U_mag">|U| (Velocity)</option>
              <option value="p">p (Pressure)</option>
              <option value="k">k (Turb. Kinetic)</option>
              <option value="omega">ω (Dissipation)</option>
            </select>
            <span className="text-[#A5ACB5] font-mono text-[10px]">[{fieldUnits[activeField]}]</span>
          </div>

          <div
            className="h-2.5 rounded-xs border border-[#D1D5DB]"
            style={{
              background:
                colormap === 'viridis'
                  ? 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)'
                  : colormap === 'coolwarm'
                  ? 'linear-gradient(to right, rgb(59,76,192), rgb(240,240,240), rgb(180,4,38))'
                  : 'linear-gradient(to right, #30123b, #4185f4, #22da78, #f5a623, #d92120, #7a0403)',
            }}
          />

          <div className="flex justify-between text-[10px] font-mono text-[#69717D] mt-1">
            <span>{currentRange[0].toFixed(1)}</span>
            <span>{((currentRange[0] + currentRange[1]) / 2).toFixed(1)}</span>
            <span>{currentRange[1].toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
