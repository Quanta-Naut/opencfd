/**
 * useMeshGL - GPU renderer for every mesh view in the 2D workbench.
 *
 * The Canvas 2D path filled and stroked each cell as its own path, which costs
 * hundreds of milliseconds per frame on a few-hundred-thousand-cell mesh and
 * was re-run on every pan, zoom and hover. Here the mesh is uploaded to the GPU
 * once and each frame is two draw calls:
 *
 * - Fill: one expanded triangle buffer (x, y, node index, cell index per
 *   vertex). What colours a cell is chosen by `u_mode`:
 *     solid    - a flat colour (plain mesh view)
 *     node     - a nodal scalar, interpolated across the cell (Results field)
 *     cell     - a per-cell scalar, flat per cell (live preview, quality)
 *     cellRGBA - a per-cell colour (block / direction colouring)
 *   Scalars live in R32F data textures read with texelFetch in the vertex
 *   shader, so changing the field, colormap or range never touches geometry,
 *   and a value array is re-uploaded only when its identity changes.
 * - Wireframe: unique mesh edges as an indexed LINES draw over a shared node
 *   position buffer.
 *
 * Pan / zoom only changes a mat3 uniform. Requires WebGL2 (WebView2, WebKit,
 * WebKitGTK and every current browser have it); `updateGeometry` returns false
 * without it so the caller can fall back to Canvas 2D.
 */

import { useCallback, useEffect, useRef } from 'react';
import { colormapRGB, meshEdgeSets } from './workbenchCore';

/** Data textures are TEX_W texels wide and as many rows as needed. */
const TEX_W = 2048;

const FILL_VERT = `#version 300 es
precision highp float;
precision highp int;
in vec2 a_pos;
in float a_node;
in float a_cell;
uniform mat3 u_transform;
uniform int u_mode;
uniform highp sampler2D u_nodeVal;
uniform highp sampler2D u_cellVal;
uniform lowp sampler2D u_cellCol;
uniform float u_lo;
uniform float u_span;
uniform vec4 u_solid;
out float v_t;
out vec4 v_col;
ivec2 tc(float i) {
  int k = int(i + 0.5);
  return ivec2(k % ${TEX_W}, k / ${TEX_W});
}
void main() {
  vec3 p = u_transform * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_t = 0.0;
  v_col = u_solid;
  if (u_mode == 1) {
    v_t = (texelFetch(u_nodeVal, tc(a_node), 0).r - u_lo) / u_span;
  } else if (u_mode == 2) {
    v_t = (texelFetch(u_cellVal, tc(a_cell), 0).r - u_lo) / u_span;
  } else if (u_mode == 3) {
    v_col = texelFetch(u_cellCol, tc(a_cell), 0);
  }
}
`;

const FILL_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform int u_mode;
uniform sampler2D u_colormap;
uniform float u_levels;
uniform float u_lines;
uniform float u_clipOut;
in float v_t;
in vec4 v_col;
out vec4 outColor;
void main() {
  if (u_mode == 1 || u_mode == 2) {
    // Hide values outside the colour range.
    if (u_clipOut > 0.5 && (v_t < 0.0 || v_t > 1.0)) discard;
    float t = clamp(v_t, 0.0, 1.0);
    // Banded contours: N flat colours, each the middle of its band.
    if (u_levels > 0.5) t = (min(floor(t * u_levels), u_levels - 1.0) + 0.5) / u_levels;
    vec4 c = texture(u_colormap, vec2(t, 0.5));
    // Iso-lines at the band edges, one pixel wide at any zoom.
    if (u_lines > 0.5) {
      float g = v_t * max(u_levels, 10.0);
      float d = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), 1e-6);
      c.rgb = mix(c.rgb * 0.25, c.rgb, clamp(d - 0.5, 0.0, 1.0));
    }
    outColor = c;
  } else {
    outColor = v_col;
  }
}
`;

const LINE_VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
uniform mat3 u_transform;
void main() {
  vec3 p = u_transform * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}
`;

const LINE_FRAG = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  outColor = u_color;
}
`;

export type RGBA = [number, number, number, number];

export type MeshGLFill =
  | { kind: 'solid'; color: RGBA }
  | {
      kind: 'node';
      vals: ArrayLike<number>;
      lo: number;
      hi: number;
      colormap: string;
      /** Flat colour bands (0 = smooth) and iso-lines over them. */
      levels?: number;
      lines?: boolean;
      /** Leave out values outside lo..hi instead of saturating them. */
      clipOutside?: boolean;
    }
  | { kind: 'cell'; vals: ArrayLike<number>; lo: number; hi: number; colormap: string }
  | {
      kind: 'cellRGBA';
      /** Per-cell '#RRGGBB' (or null = `base`), composited over `base` at `alpha`. */
      colors: readonly (string | null)[];
      alpha: number;
      base: RGBA;
    };

export interface MeshGLScene {
  visible: boolean;
  fill: MeshGLFill;
  /** Wireframe colour (0-1 RGBA), or null for no wireframe. */
  wire: RGBA | null;
  /** Draw only inside this world box [x0, y0, x1, y1]. */
  clip?: readonly [number, number, number, number] | null;
}

export interface MeshGLCamera {
  pan: { x: number; y: number };
  zoom: number;
  width: number;
  height: number;
}

interface GPU {
  gl: WebGL2RenderingContext;
  fillProg: WebGLProgram;
  lineProg: WebGLProgram;
  fillVao: WebGLVertexArrayObject;
  lineVao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  fillVerts: number;
  wireCount: number;
  nodeTex: WebGLTexture;
  cellTex: WebGLTexture;
  cellColTex: WebGLTexture;
  cmTex: WebGLTexture;
  nNodes: number;
  nCells: number;
  /** Identity of what is currently uploaded, so unchanged data is skipped. */
  nodeSrc: unknown;
  cellSrc: unknown;
  cellColSrc: unknown;
  cmName: string;
  uniforms: Record<string, WebGLUniformLocation | null>;
  lineUniforms: Record<string, WebGLUniformLocation | null>;
}

function mkShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  }
  return s;
}

function mkProg(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, mkShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mkShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  }
  return p;
}

function texRows(n: number): number {
  return Math.max(1, Math.ceil(n / TEX_W));
}

function mkDataTex(gl: WebGL2RenderingContext, n: number, rgba8: boolean): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const rows = texRows(n);
  if (rgba8) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, TEX_W, rows, 0, gl.RED, gl.FLOAT, null);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function uploadScalars(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  n: number,
  src: ArrayLike<number>,
) {
  const rows = texRows(n);
  const data = new Float32Array(TEX_W * rows);
  const m = Math.min(n, src.length);
  for (let i = 0; i < m; i++) {
    const v = src[i];
    data[i] = Number.isFinite(v) ? v : 0;
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, rows, gl.RED, gl.FLOAT, data);
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function uploadCellColors(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  n: number,
  colors: readonly (string | null)[],
  alpha: number,
  base: RGBA,
) {
  const rows = texRows(n);
  const data = new Uint8Array(TEX_W * rows * 4);
  const br = base[0] * 255;
  const bg = base[1] * 255;
  const bb = base[2] * 255;
  const ba = Math.round(base[3] * 255);
  // Cells share a handful of colours, so composite each distinct one once.
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const c = colors[i];
    let rgb: [number, number, number] | undefined;
    if (c) {
      rgb = cache.get(c);
      if (!rgb) {
        const p = parseHex(c);
        rgb = p
          ? [
              Math.round(br + (p[0] - br) * alpha),
              Math.round(bg + (p[1] - bg) * alpha),
              Math.round(bb + (p[2] - bb) * alpha),
            ]
          : [br, bg, bb];
        cache.set(c, rgb);
      }
    }
    const o = i * 4;
    data[o] = rgb ? rgb[0] : br;
    data[o + 1] = rgb ? rgb[1] : bg;
    data[o + 2] = rgb ? rgb[2] : bb;
    data[o + 3] = ba;
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, rows, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

/** Bake a colormap into a 256x1 texture from the same ramps the 2D path uses. */
function uploadColormap(gl: WebGL2RenderingContext, tex: WebGLTexture, name: string) {
  const N = 256;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(colormapRGB(i / (N - 1), name));
    data[i * 4] = m ? +m[1] : 0;
    data[i * 4 + 1] = m ? +m[2] : 0;
    data[i * 4 + 2] = m ? +m[3] : 0;
    data[i * 4 + 3] = 255;
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function useMeshGL() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gpuRef = useRef<GPU | null>(null);
  const meshSrcRef = useRef<unknown>(null);

  const destroy = useCallback(() => {
    const g = gpuRef.current;
    if (!g) return;
    try {
      const { gl } = g;
      g.buffers.forEach((b) => gl.deleteBuffer(b));
      gl.deleteVertexArray(g.fillVao);
      gl.deleteVertexArray(g.lineVao);
      [g.nodeTex, g.cellTex, g.cellColTex, g.cmTex].forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(g.fillProg);
      gl.deleteProgram(g.lineProg);
    } catch {
      /* context already lost */
    }
    gpuRef.current = null;
    meshSrcRef.current = null;
  }, []);

  /** Upload a mesh. Cheap no-op when called again with the same arrays.
   *  `edges` (unique edge pairs) can be passed in when the caller already has
   *  them, to skip recomputing. */
  const updateGeometry = useCallback(
    (nodes: number[][], elems: number[][], edges?: Uint32Array): boolean => {
      const canvas = canvasRef.current;
      if (!canvas || nodes.length < 3 || !elems.length) return false;
      if (meshSrcRef.current === elems && gpuRef.current) return true;
      destroy();

      const gl = canvas.getContext('webgl2', {
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true, // "Save image" reads it back
      }) as WebGL2RenderingContext | null;
      if (!gl) return false;

      try {
        const nNodes = nodes.length;
        const nCells = elems.length;
        const maxRows = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        if (texRows(Math.max(nNodes, nCells)) > maxRows) return false;

        const fillProg = mkProg(gl, FILL_VERT, FILL_FRAG);
        const lineProg = mkProg(gl, LINE_VERT, LINE_FRAG);

        // Expanded fill triangles (fan per cell): x, y, node, cell.
        let triVerts = 0;
        for (let e = 0; e < nCells; e++) {
          const len = elems[e].length;
          if (len >= 3) triVerts += (len - 2) * 3;
        }
        const fill = new Float32Array(triVerts * 4);
        let o = 0;
        for (let e = 0; e < nCells; e++) {
          const el = elems[e];
          const len = el.length;
          if (len < 3) continue;
          let ok = true;
          for (let i = 0; i < len; i++) if (el[i] >= nNodes || !nodes[el[i]]) ok = false;
          if (!ok) continue;
          const n0 = el[0];
          const p0 = nodes[n0];
          for (let i = 1; i < len - 1; i++) {
            const n1 = el[i];
            const n2 = el[i + 1];
            const p1 = nodes[n1];
            const p2 = nodes[n2];
            fill[o] = p0[0];
            fill[o + 1] = p0[1];
            fill[o + 2] = n0;
            fill[o + 3] = e;
            fill[o + 4] = p1[0];
            fill[o + 5] = p1[1];
            fill[o + 6] = n1;
            fill[o + 7] = e;
            fill[o + 8] = p2[0];
            fill[o + 9] = p2[1];
            fill[o + 10] = n2;
            fill[o + 11] = e;
            o += 12;
          }
        }
        const fillVerts = o / 4;

        const fillBuf = gl.createBuffer()!;
        const fillVao = gl.createVertexArray()!;
        gl.bindVertexArray(fillVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, fillBuf);
        gl.bufferData(gl.ARRAY_BUFFER, fill.subarray(0, o), gl.STATIC_DRAW);
        const attrs: [string, number, number][] = [
          ['a_pos', 2, 0],
          ['a_node', 1, 8],
          ['a_cell', 1, 12],
        ];
        for (const [name, size, offset] of attrs) {
          const loc = gl.getAttribLocation(fillProg, name);
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 16, offset);
        }

        // Wireframe: node positions + unique edge indices.
        const pos = new Float32Array(nNodes * 2);
        for (let i = 0; i < nNodes; i++) {
          pos[i * 2] = nodes[i][0];
          pos[i * 2 + 1] = nodes[i][1];
        }
        const wire = edges ?? meshEdgeSets(elems, nNodes).all;
        const posBuf = gl.createBuffer()!;
        const edgeBuf = gl.createBuffer()!;
        const lineVao = gl.createVertexArray()!;
        gl.bindVertexArray(lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        const lpos = gl.getAttribLocation(lineProg, 'a_pos');
        gl.enableVertexAttribArray(lpos);
        gl.vertexAttribPointer(lpos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wire, gl.STATIC_DRAW);
        gl.bindVertexArray(null);

        const cmTex = gl.createTexture()!;
        uploadColormap(gl, cmTex, 'coolwarm');

        const u = (n: string) => gl.getUniformLocation(fillProg, n);
        gpuRef.current = {
          gl,
          fillProg,
          lineProg,
          fillVao,
          lineVao,
          buffers: [fillBuf, posBuf, edgeBuf],
          fillVerts,
          wireCount: wire.length,
          nodeTex: mkDataTex(gl, nNodes, false),
          cellTex: mkDataTex(gl, nCells, false),
          cellColTex: mkDataTex(gl, nCells, true),
          cmTex,
          nNodes,
          nCells,
          nodeSrc: null,
          cellSrc: null,
          cellColSrc: null,
          cmName: 'coolwarm',
          uniforms: {
            transform: u('u_transform'),
            mode: u('u_mode'),
            nodeVal: u('u_nodeVal'),
            cellVal: u('u_cellVal'),
            cellCol: u('u_cellCol'),
            colormap: u('u_colormap'),
            lo: u('u_lo'),
            span: u('u_span'),
            solid: u('u_solid'),
            levels: u('u_levels'),
            clipOut: u('u_clipOut'),
            lines: u('u_lines'),
          },
          lineUniforms: {
            transform: gl.getUniformLocation(lineProg, 'u_transform'),
            color: gl.getUniformLocation(lineProg, 'u_color'),
          },
        };
        meshSrcRef.current = elems;
        return true;
      } catch (e) {
        console.warn('[MeshGL] init failed:', e);
        destroy();
        return false;
      }
    },
    [destroy],
  );

  const render = useCallback((scene: MeshGLScene, cam: MeshGLCamera) => {
    const canvas = canvasRef.current;
    const g = gpuRef.current;
    if (!canvas || !g) return;
    const { gl } = g;

    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(cam.width * dpr));
    const ph = Math.max(1, Math.round(cam.height * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!scene.visible) return;

    // World -> NDC, matching the 2D canvas: sx = w/2 + pan.x + x*zoom,
    // sy = h/2 + pan.y - y*zoom.
    const mat = new Float32Array([
      (2 * cam.zoom) / cam.width,
      0,
      0,
      0,
      (2 * cam.zoom) / cam.height,
      0,
      (2 * cam.pan.x) / cam.width,
      (-2 * cam.pan.y) / cam.height,
      1,
    ]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const U = g.uniforms;
    const f = scene.fill;
    let mode = 0;
    let lo = 0;
    let span = 1;
    if (f.kind === 'node' || f.kind === 'cell') {
      mode = f.kind === 'node' ? 1 : 2;
      lo = f.lo;
      span = f.hi - f.lo || 1;
      if (f.kind === 'node' && g.nodeSrc !== f.vals) {
        uploadScalars(gl, g.nodeTex, g.nNodes, f.vals);
        g.nodeSrc = f.vals;
      }
      if (f.kind === 'cell' && g.cellSrc !== f.vals) {
        uploadScalars(gl, g.cellTex, g.nCells, f.vals);
        g.cellSrc = f.vals;
      }
      if (g.cmName !== f.colormap) {
        uploadColormap(gl, g.cmTex, f.colormap);
        g.cmName = f.colormap;
      }
    } else if (f.kind === 'cellRGBA') {
      mode = 3;
      const key = `${f.alpha}:${f.base.join(',')}`;
      const src = g.cellColSrc as { colors: unknown; key: string } | null;
      if (!src || src.colors !== f.colors || src.key !== key) {
        uploadCellColors(gl, g.cellColTex, g.nCells, f.colors, f.alpha, f.base);
        g.cellColSrc = { colors: f.colors, key };
      }
    }

    gl.useProgram(g.fillProg);
    gl.uniformMatrix3fv(U.transform, false, mat);
    gl.uniform1i(U.mode, mode);
    gl.uniform1f(U.lo, lo);
    gl.uniform1f(U.span, span);
    gl.uniform4fv(U.solid, f.kind === 'solid' ? f.color : [1, 1, 1, 1]);
    gl.uniform1f(U.levels, f.kind === 'node' ? (f.levels ?? 0) : 0);
    gl.uniform1f(U.lines, f.kind === 'node' && f.lines ? 1 : 0);
    gl.uniform1f(U.clipOut, f.kind === 'node' && f.clipOutside ? 1 : 0);
    if (scene.clip) {
      // World box to device pixels; GL counts rows from the bottom.
      const [x0, y0, x1, y1] = scene.clip;
      const sx = (x: number) => (cam.width / 2 + cam.pan.x + x * cam.zoom) * dpr;
      const sy = (y: number) => (cam.height / 2 - cam.pan.y + y * cam.zoom) * dpr;
      const l = Math.floor(Math.max(0, Math.min(sx(x0), sx(x1))));
      const b = Math.floor(Math.max(0, Math.min(sy(y0), sy(y1))));
      const r = Math.ceil(Math.min(pw, Math.max(sx(x0), sx(x1))));
      const t = Math.ceil(Math.min(ph, Math.max(sy(y0), sy(y1))));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(l, b, Math.max(0, r - l), Math.max(0, t - b));
    }
    const bind = (unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit);
    };
    bind(0, g.nodeTex, U.nodeVal);
    bind(1, g.cellTex, U.cellVal);
    bind(2, g.cellColTex, U.cellCol);
    bind(3, g.cmTex, U.colormap);
    gl.bindVertexArray(g.fillVao);
    gl.drawArrays(gl.TRIANGLES, 0, g.fillVerts);

    if (scene.wire && g.wireCount > 0) {
      gl.useProgram(g.lineProg);
      gl.uniformMatrix3fv(g.lineUniforms.transform, false, mat);
      gl.uniform4fv(g.lineUniforms.color, scene.wire);
      gl.bindVertexArray(g.lineVao);
      gl.drawElements(gl.LINES, g.wireCount, gl.UNSIGNED_INT, 0);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
  }, []);

  useEffect(() => () => destroy(), [destroy]);

  return { canvasRef, updateGeometry, render };
}
