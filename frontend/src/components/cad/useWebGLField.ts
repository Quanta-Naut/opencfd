/**
 * useWebGLField — GPU-accelerated field rendering for CFD result visualization.
 *
 * Replaces the Canvas 2D element-by-element loop with a single WebGL draw call.
 * - Triangle fan triangulation uploaded to GPU ONCE per mesh change.
 * - Field values updated via bufferSubData — minimal data transfer per frame.
 * - Colormap baked into a 1D RGBA texture (256 stops) sampled in fragment shader.
 * - Boundary edges drawn as a separate LINE draw call using the same pos buffer.
 * - Pan/zoom only updates a uniform mat3 — zero data re-upload on camera change.
 */

import { useRef, useEffect, useCallback } from 'react';

const VERT = `
precision highp float;
attribute vec2 a_pos;
attribute float a_val;
uniform mat3 u_transform;
varying float v_val;
void main() {
  vec3 p = u_transform * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_val = a_val;
}
`;

const FRAG = `
precision mediump float;
uniform sampler2D u_colormap;
varying float v_val;
void main() {
  gl_FragColor = texture2D(u_colormap, vec2(clamp(v_val, 0.0, 1.0), 0.5));
}
`;

const EDGE_VERT = `
precision highp float;
attribute vec2 a_pos;
uniform mat3 u_transform;
void main() {
  vec3 p = u_transform * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}
`;

const EDGE_FRAG = `
precision mediump float;
void main() {
  gl_FragColor = vec4(0.07, 0.09, 0.13, 0.85);
}
`;

const RAMPS: Record<string, [number, number, number][]> = {
  coolwarm: [[59,76,192],[144,178,254],[220,220,220],[245,156,125],[180,4,38]],
  viridis:  [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  turbo:    [[48,18,59],[58,138,253],[27,229,138],[223,224,40],[122,4,3]],
  jet:      [[0,0,131],[0,128,255],[122,255,128],[255,191,0],[128,0,0]],
  rainbow:  [[110,64,170],[76,176,202],[126,219,92],[251,179,61],[235,74,74]],
};

function buildCmTex(gl: WebGLRenderingContext, name: string): WebGLTexture {
  const ramp = RAMPS[name] || RAMPS.coolwarm;
  const N = 256;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = t * (ramp.length - 1);
    const ii = Math.min(ramp.length - 2, Math.floor(x));
    const f = x - ii;
    const a = ramp[ii], b = ramp[ii + 1];
    data[i*4]   = Math.round(a[0] + (b[0]-a[0])*f);
    data[i*4+1] = Math.round(a[1] + (b[1]-a[1])*f);
    data[i*4+2] = Math.round(a[2] + (b[2]-a[2])*f);
    data[i*4+3] = 255;
  }
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function mkShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  return s;
}

function mkProg(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, mkShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mkShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

function triangulateFan(el: number[]): number[] {
  const t: number[] = [];
  for (let i = 1; i < el.length - 1; i++) t.push(el[0], el[i], el[i+1]);
  return t;
}

function boundaryEdges(elems: number[][], nNodes: number): Uint32Array {
  const map = new Map<string, {a:number;b:number;n:number}>();
  for (const el of elems) {
    for (let i = 0; i < el.length; i++) {
      const a = el[i], b = el[(i+1)%el.length];
      if (a >= nNodes || b >= nNodes) continue;
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      const e = map.get(k); if (e) e.n++; else map.set(k, {a,b,n:1});
    }
  }
  const r: number[] = [];
  for (const {a,b,n} of map.values()) if (n === 1) r.push(a, b);
  return new Uint32Array(r);
}

interface GPU {
  gl: WebGLRenderingContext;
  prog: WebGLProgram; edgeProg: WebGLProgram;
  posBuf: WebGLBuffer; valBuf: WebGLBuffer;
  idxBuf: WebGLBuffer; edgeIdxBuf: WebGLBuffer;
  cmTex: WebGLTexture;
  triCount: number; edgeCount: number;
  curColormap: string;
  norm: Float32Array; nNodes: number;
}

export interface WebGLFieldRenderOpts {
  vals: number[]; lo: number; hi: number; colormap: string;
  pan: {x:number;y:number}; zoom: number;
  canvasWidth: number; canvasHeight: number; visible: boolean;
}

export function useWebGLField() {
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const gpuRef = useRef<GPU|null>(null);
  const meshKeyRef = useRef('');

  const destroy = useCallback(() => {
    const g = gpuRef.current; if (!g) return;
    try {
      const {gl} = g;
      gl.deleteBuffer(g.posBuf); gl.deleteBuffer(g.valBuf);
      gl.deleteBuffer(g.idxBuf); gl.deleteBuffer(g.edgeIdxBuf);
      gl.deleteTexture(g.cmTex);
      gl.deleteProgram(g.prog); gl.deleteProgram(g.edgeProg);
    } catch {}
    gpuRef.current = null; meshKeyRef.current = '';
  }, []);

  const updateGeometry = useCallback((nodes: [number,number][], elems: number[][]): boolean => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length < 3 || !elems.length) return false;
    const key = `${nodes.length}:${elems.length}`;
    if (key === meshKeyRef.current && gpuRef.current) return true;
    meshKeyRef.current = key;
    destroy();

    const gl = canvas.getContext('webgl', {antialias:false, premultipliedAlpha:false, preserveDrawingBuffer:false}) as WebGLRenderingContext|null;
    if (!gl) return false;
    gl.getExtension('OES_element_index_uint');

    try {
      const prog = mkProg(gl, VERT, FRAG);
      const edgeProg = mkProg(gl, EDGE_VERT, EDGE_FRAG);

      const posData = new Float32Array(nodes.length * 2);
      for (let i = 0; i < nodes.length; i++) { posData[i*2]=nodes[i][0]; posData[i*2+1]=nodes[i][1]; }
      const posBuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, posData, gl.STATIC_DRAW);

      const norm = new Float32Array(nodes.length);
      const valBuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, valBuf);
      gl.bufferData(gl.ARRAY_BUFFER, norm, gl.DYNAMIC_DRAW);

      const allTris: number[] = [];
      for (const el of elems) {
        if (el.length < 3 || el.some(i => i >= nodes.length)) continue;
        allTris.push(...triangulateFan(el));
      }
      const idxData = new Uint32Array(allTris);
      const idxBuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);

      const edgeData = boundaryEdges(elems, nodes.length);
      const edgeIdxBuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIdxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edgeData, gl.STATIC_DRAW);

      const cmTex = buildCmTex(gl, 'coolwarm');

      gpuRef.current = {
        gl, prog, edgeProg, posBuf, valBuf, idxBuf, edgeIdxBuf, cmTex,
        triCount: idxData.length, edgeCount: edgeData.length,
        curColormap: 'coolwarm', norm, nNodes: nodes.length,
      };
      return true;
    } catch(e) {
      console.warn('[WebGLField] init failed:', e);
      destroy(); return false;
    }
  }, [destroy]);

  const render = useCallback((opts: WebGLFieldRenderOpts) => {
    const canvas = canvasRef.current;
    const g = gpuRef.current;
    if (!canvas || !g) return;

    const {vals, lo, hi, colormap, pan, zoom, canvasWidth: cw, canvasHeight: ch, visible} = opts;
    const {gl, prog, edgeProg} = g;

    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!visible || !vals.length) return;

    // Normalize & upload field values
    const range = (hi - lo) || 1;
    const n = Math.min(g.nNodes, vals.length);
    for (let i = 0; i < n; i++) g.norm[i] = Math.max(0, Math.min(1, (vals[i]-lo)/range));
    gl.bindBuffer(gl.ARRAY_BUFFER, g.valBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.norm.subarray(0, g.nNodes));

    // Update colormap texture if changed
    if (colormap !== g.curColormap) {
      gl.deleteTexture(g.cmTex);
      g.cmTex = buildCmTex(gl, colormap);
      g.curColormap = colormap;
    }

    // World→NDC mat3 (column-major)
    // Canvas 2D: screen_x = cw/2 + pan.x + world_x*zoom
    //            screen_y = ch/2 + pan.y - world_y*zoom
    // WebGL NDC: ndc_x = 2*screen_x/cw - 1 = (2*zoom/cw)*world_x + (2*pan.x/cw)
    //            ndc_y = 1 - 2*screen_y/ch = (2*zoom/ch)*world_y - (2*pan.y/ch)
    const sx = 2 * zoom / cw;
    const sy = 2 * zoom / ch;
    const tx = 2 * pan.x / cw;
    const ty = -2 * pan.y / ch;
    const mat = new Float32Array([sx, 0, 0, 0, sy, 0, tx, ty, 1]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Draw filled triangles
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const aVal = gl.getAttribLocation(prog, 'a_val');
    gl.bindBuffer(gl.ARRAY_BUFFER, g.valBuf);
    gl.enableVertexAttribArray(aVal);
    gl.vertexAttribPointer(aVal, 1, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'u_transform'), false, mat);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.cmTex);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_colormap'), 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idxBuf);
    gl.drawElements(gl.TRIANGLES, g.triCount, gl.UNSIGNED_INT, 0);
  }, []);

  useEffect(() => () => { destroy(); }, [destroy]);

  return { canvasRef, updateGeometry, render, destroy };
}
