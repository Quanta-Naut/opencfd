import React, { useEffect, useRef } from 'react';
import { PlotDefinition, FlowVariable } from '../../types/cfd';

export const FLOW_VARIABLES: { id: FlowVariable; label: string; unit: string }[] = [
  { id: 'U_mag', label: 'Velocity Magnitude (|U|)', unit: 'm/s' },
  { id: 'p', label: 'Static Pressure (p)', unit: 'Pa' },
  { id: 'k', label: 'Turbulent Kinetic Energy (k)', unit: 'm²/s²' },
  { id: 'omega', label: 'Specific Dissipation (ω)', unit: '1/s' },
  { id: 'vorticity', label: 'Vorticity (∇×U)', unit: '1/s' },
];

export function getVariableLabel(v: FlowVariable): string {
  return FLOW_VARIABLES.find((item) => item.id === v)?.label ?? v;
}

const COLORMAP_THEMES: Record<string, { stroke: string; fill: string }> = {
  coolwarm: { stroke: '#DC2626', fill: 'rgba(220, 38, 38, 0.12)' },
  viridis: { stroke: '#059669', fill: 'rgba(5, 150, 105, 0.12)' },
  turbo: { stroke: '#D97706', fill: 'rgba(217, 119, 6, 0.12)' },
  jet: { stroke: '#2563EB', fill: 'rgba(37, 99, 235, 0.12)' },
  rainbow: { stroke: '#7C3AED', fill: 'rgba(124, 58, 237, 0.12)' },
};

interface PlotThumbnailProps {
  plot: PlotDefinition;
  isSelected?: boolean;
  onClick: () => void;
}

export const PlotThumbnail: React.FC<PlotThumbnailProps> = ({
  plot,
  isSelected = false,
  onClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = COLORMAP_THEMES[plot.colormap] || COLORMAP_THEMES.viridis;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW < 10 || cssH < 10) return;

    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const values = plot.data?.values ?? [];
    const distances = plot.data?.distance ?? [];

    if (values.length < 2 || distances.length < 2) {
      ctx.fillStyle = '#A5ACB5';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data', cssW / 2, cssH / 2);
      return;
    }

    const pad = { l: 6, r: 6, t: 8, b: 6 };
    const plotW = cssW - pad.l - pad.r;
    const plotH = cssH - pad.t - pad.b;

    // Filter points by range if configured
    const validPairs: { x: number; y: number }[] = [];
    const minD = distances[0];
    const maxD = distances[distances.length - 1];
    const distSpan = maxD - minD || 1;

    let vMin = Infinity;
    let vMax = -Infinity;

    for (let i = 0; i < distances.length; i++) {
      let y = values[i];
      if (typeof y !== 'number' || !isFinite(y)) continue;
      if (plot.rangeMin !== null && y < plot.rangeMin) y = NaN;
      if (plot.rangeMax !== null && y > plot.rangeMax) y = NaN;

      if (isFinite(y)) {
        if (y < vMin) vMin = y;
        if (y > vMax) vMax = y;
      }
      validPairs.push({ x: distances[i], y });
    }

    if (!isFinite(vMin) || !isFinite(vMax) || vMin === vMax) {
      vMin = 0;
      vMax = 1;
    }

    const vSpan = vMax - vMin || 1;
    const sx = (d: number) => pad.l + ((d - minD) / distSpan) * plotW;
    const sy = (v: number) => pad.t + (1 - (v - vMin) / vSpan) * plotH;

    // Background subtle grid lines
    ctx.strokeStyle = '#F0F2F5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + plotH / 2);
    ctx.lineTo(pad.l + plotW, pad.t + plotH / 2);
    ctx.stroke();

    // Area fill gradient
    ctx.beginPath();
    let inArea = false;
    validPairs.forEach((pt) => {
      if (!isFinite(pt.y)) {
        inArea = false;
        return;
      }
      const x = sx(pt.x);
      const y = sy(pt.y);
      if (!inArea) {
        ctx.moveTo(x, pad.t + plotH);
        ctx.lineTo(x, y);
        inArea = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.lineTo(sx(maxD), pad.t + plotH);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, theme.fill);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Polyline stroke
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let inSeg = false;
    validPairs.forEach((pt) => {
      if (!isFinite(pt.y)) {
        inSeg = false;
        return;
      }
      const x = sx(pt.x);
      const y = sy(pt.y);
      if (!inSeg) {
        ctx.moveTo(x, y);
        inSeg = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Min / max annotations
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = '#8A929E';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const fmt = (n: number) => (Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 0.01) ? n.toExponential(1) : n.toFixed(2));
    ctx.fillText(fmt(vMax), pad.l, 1);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmt(vMin), pad.l + plotW, cssH - 1);
  }, [plot, theme]);

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={`group relative rounded border p-2.5 transition-all cursor-pointer text-left ${
        isSelected
          ? 'bg-[#F0F5FF] border-[#2563EB]'
          : 'bg-white border-[#EDEFF3] hover:border-[#C4C9D0] hover:bg-[#F9FAFB]'
      }`}
    >
      {/* 65px sparkline thumbnail canvas */}
      <div className="w-full h-[64px] bg-[#F8FAFC] rounded border border-[#F1F3F5] overflow-hidden mb-2">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold text-[#171A1F] truncate">
          {plot.name || 'Untitled Plot'}
        </span>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: theme.stroke }}
          title={`Colormap: ${plot.colormap}`}
        />
      </div>

      <div className="text-[11px] text-[#69717D] truncate mt-0.5 font-medium">
        {getVariableLabel(plot.variable)}
      </div>

      <div className="flex items-center justify-between text-[10px] text-[#8A929E] mt-1 font-mono">
        <span>{plot.line.samples} samples</span>
        <span>
          L: {Math.hypot(plot.line.p2[0] - plot.line.p1[0], plot.line.p2[1] - plot.line.p1[1]).toFixed(2)}m
        </span>
      </div>
    </div>
  );
};

export default PlotThumbnail;
