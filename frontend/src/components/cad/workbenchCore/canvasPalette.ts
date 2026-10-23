// Neutral colours for the 2D workbench canvas and the GPU mesh layer, per
// theme. Semantic colours (selection blue, domain orange, boundary-tag
// colours, colormaps) read well on both backgrounds and stay where they are.
import type { ResolvedTheme } from '../../../utils/theme';

export interface CanvasPalette {
  bg: string;
  gridMinor: string;
  gridMajor: string;
  axisX: string;
  axisY: string;
  /** Plain mesh: cell fill and wire, as CSS and as 0-1 RGBA for the GPU. */
  meshFill: string;
  meshFillRGBA: [number, number, number, number];
  meshLine: string;
  meshLineRGBA: [number, number, number, number];
  /** Opacity of the block colour over `meshFill` in direction colouring. */
  blockTint: number;
  boundary: string;
  entity: string;
  vertex: string;
  vertexDim: string;
  label: string;
  guide: string;
  cursor: string;
  /** Floating value chips drawn on the canvas. */
  chipBg: string;
  chipLine: string;
  chipText: string;
  /** High-contrast tooltip (inverse of the canvas). */
  tipBg: string;
  tipText: string;
  /** Ring drawn around coloured handle dots so they separate from lines. */
  halo: string;
  handleFill: string;
  ink: string;
}

const LIGHT: CanvasPalette = {
  bg: '#FAFAFA',
  gridMinor: '#EBEBEB',
  gridMajor: '#D8D8D8',
  axisX: '#F87171',
  axisY: '#4ADE80',
  meshFill: '#FFFFFF',
  meshFillRGBA: [1, 1, 1, 1],
  meshLine: '#CBD5E1',
  meshLineRGBA: [203 / 255, 213 / 255, 225 / 255, 0.8],
  blockTint: 0x26 / 255,
  boundary: '#111827',
  entity: '#1A1D21',
  vertex: '#888888',
  vertexDim: '#5B6472',
  label: '#8B95A1',
  guide: '#94A3B8',
  cursor: '#888888',
  chipBg: 'rgba(255,255,255,0.92)',
  chipLine: '#E1E4E8',
  chipText: '#171A1F',
  tipBg: '#171A1F',
  tipText: '#FFFFFF',
  halo: '#FFFFFF',
  handleFill: '#FFFFFF',
  ink: '#1E293B',
};

const DARK: CanvasPalette = {
  bg: '#0E0F11',
  gridMinor: '#181A1D',
  gridMajor: '#24272B',
  axisX: '#B4484D',
  axisY: '#3E9A5D',
  meshFill: '#16171A',
  meshFillRGBA: [22 / 255, 23 / 255, 26 / 255, 1],
  meshLine: '#3A3F47',
  meshLineRGBA: [98 / 255, 106 / 255, 118 / 255, 0.55],
  blockTint: 0.22,
  boundary: '#E6E8EB',
  entity: '#E6E8EB',
  vertex: '#8B919A',
  vertexDim: '#A3A9B2',
  label: '#80868F',
  guide: '#5E6670',
  cursor: '#8B919A',
  chipBg: 'rgba(26,27,30,0.92)',
  chipLine: '#2B2D32',
  chipText: '#E6E8EB',
  tipBg: '#E6E8EB',
  tipText: '#121315',
  halo: '#0E0F11',
  handleFill: '#1A1B1E',
  ink: '#E6E8EB',
};

export function canvasPalette(theme: ResolvedTheme): CanvasPalette {
  return theme === 'dark' ? DARK : LIGHT;
}
