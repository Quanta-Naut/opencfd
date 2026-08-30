import { YPlusCalculation, GeometryConfig, PhysicsConfig, BoundaryConditions, SolverControls } from '../types/cfd';
import { API_BASE, WS_BASE } from './backend';

export { WS_BASE };

// Throws on an unreachable backend so the caller can show a real state; a
// reachable-but-error response still resolves (with an empty-ish object).
export async function setupStatus(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/setup/status`);
  if (!res.ok) return { os: 'unknown', needs_provision: false, detail: `status ${res.status}` };
  return (await res.json()).data;
}

export async function fetchSolverResults(
  mesh: any,
  projectId?: string,
): Promise<{ data: any | null; detail?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/solver/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId ?? null, mesh }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, detail: j.detail || `HTTP ${res.status}` };
    return j.success ? { data: j.data } : { data: null, detail: j.detail || 'no results' };
  } catch (e: any) {
    return { data: null, detail: e?.message || 'request failed' };
  }
}

export async function backendReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/setup/status`, { method: 'GET' });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export function computeFallbackYPlus(params: {
  velocity: number;
  length: number;
  density: number;
  viscosity: number;
  target_yplus: number;
  expansion_ratio: number;
  flow_regime: string;
}): YPlusCalculation {
  const { velocity, length, density, viscosity, target_yplus, expansion_ratio, flow_regime } = params;
  const nu = viscosity / density;
  const reynolds = (density * velocity * length) / viscosity;

  let cf = 0.004;
  let delta = 0.02;
  if (flow_regime === 'laminar' || reynolds < 5e5) {
    cf = 1.328 / Math.sqrt(Math.max(reynolds, 1.0));
    delta = (5.0 * length) / Math.sqrt(Math.max(reynolds, 1.0));
  } else {
    const logRe = Math.log10(Math.max(reynolds, 100.0));
    cf = Math.pow(2.0 * logRe - 0.65, -2.3);
    delta = (0.37 * length) / Math.pow(reynolds, 0.2);
  }

  const tau_w = 0.5 * cf * density * (velocity * velocity);
  const u_tau = Math.sqrt(tau_w / density);
  const first_layer_height = (target_yplus * nu) / Math.max(u_tau, 1e-6);

  const r = Math.max(expansion_ratio, 1.01);
  let num_layers = 15;
  if (first_layer_height < delta) {
    try {
      num_layers = Math.ceil(Math.log(1.0 + (delta * (r - 1.0)) / first_layer_height) / Math.log(r));
      num_layers = Math.max(1, Math.min(num_layers, 100));
    } catch {
      num_layers = 15;
    }
  }

  const total_layer_thickness = (first_layer_height * (Math.pow(r, num_layers) - 1.0)) / (r - 1.0);

  return {
    velocity,
    length,
    density,
    viscosity,
    target_yplus,
    expansion_ratio: r,
    reynolds_number: Math.round(reynolds),
    skin_friction_coefficient: Number(cf.toFixed(6)),
    wall_shear_stress: Number(tau_w.toFixed(4)),
    friction_velocity: Number(u_tau.toFixed(4)),
    first_layer_height_m: Number(first_layer_height.toExponential(4)),
    first_layer_height_mm: Number((first_layer_height * 1000).toFixed(4)),
    boundary_layer_thickness_mm: Number((delta * 1000).toFixed(2)),
    recommended_layers: num_layers,
    total_layer_thickness_mm: Number((total_layer_thickness * 1000).toFixed(2)),
  };
}

export function computeFallbackInflow(velocity: number, length_scale: number, intensity_percent: number) {
  const intensity = intensity_percent / 100.0;
  const l_t = 0.07 * length_scale;
  const k = 1.5 * Math.pow(velocity * intensity, 2);
  const c_mu = 0.09;
  const omega = Math.sqrt(k) / (Math.pow(c_mu, 0.25) * l_t);
  const epsilon = (Math.pow(c_mu, 0.75) * Math.pow(k, 1.5)) / l_t;
  const nut = k / Math.max(omega, 1e-4);

  return {
    turbulence_intensity_percent: intensity_percent,
    turbulent_length_scale_m: l_t,
    k: Number(k.toFixed(4)),
    omega: Number(omega.toFixed(2)),
    epsilon: Number(epsilon.toFixed(4)),
    nut: Number(nut.toFixed(6)),
  };
}

export function generateFallbackMesh(geometryType: string, params: any) {
  const nodes: number[][] = [];
  const triangles: number[][] = [];
  const boundaries: Record<string, number[]> = {};

  const chord = params.chord || 1.0;
  const aoaDeg = params.angleOfAttackDeg || 0.0;
  const aoaRad = (aoaDeg * Math.PI) / 180;
  const cosA = Math.cos(aoaRad);
  const sinA = Math.sin(aoaRad);

  const nx = 45;
  const ny = 25;
  const domainL = params.domainLength || 8.0;
  const domainH = params.domainHeight || 5.0;

  const gridNodes: number[][] = [];
  let currId = 0;

  for (let j = 0; j < ny; j++) {
    const yVal = -domainH / 2 + (j / (ny - 1)) * domainH;
    const row: number[] = [];
    for (let i = 0; i < nx; i++) {
      const xVal = -domainL * 0.3 + (i / (nx - 1)) * domainL;
      nodes.push([xVal, yVal, 0.0]);
      row.push(currId);
      currId++;
    }
    gridNodes.push(row);
  }

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const n0 = gridNodes[j][i];
      const n1 = gridNodes[j][i + 1];
      const n2 = gridNodes[j + 1][i + 1];
      const n3 = gridNodes[j + 1][i];
      triangles.push([n0, n1, n2]);
      triangles.push([n0, n2, n3]);
    }
  }

  const airfoilNodes: number[] = [];
  const numAirfoilPts = 40;
  for (let i = 0; i <= numAirfoilPts; i++) {
    const beta = (i / numAirfoilPts) * 2 * Math.PI;
    const xNorm = 0.5 * (1 - Math.cos(beta));
    const yt = 5 * 0.12 * chord * (0.2969 * Math.sqrt(xNorm) - 0.126 * xNorm - 0.3516 * xNorm * xNorm + 0.2843 * Math.pow(xNorm, 3) - 0.1015 * Math.pow(xNorm, 4));
    const sign = beta <= Math.PI ? 1 : -1;
    const rawX = xNorm * chord - 0.25 * chord;
    const rawY = sign * yt;
    const rotX = rawX * cosA - rawY * sinA;
    const rotY = rawX * sinA + rawY * cosA;

    nodes.push([rotX, rotY, 0.0]);
    airfoilNodes.push(currId);
    currId++;
  }

  boundaries['airfoil'] = airfoilNodes;
  boundaries['inlet'] = gridNodes.map((r) => r[0]);
  boundaries['outlet'] = gridNodes.map((r) => r[nx - 1]);

  return {
    num_nodes: nodes.length,
    num_elements: triangles.length,
    nodes,
    elements: triangles,
    boundaries,
  };
}

export function generateFallbackFields(meshData: any, velocity: number = 25.0) {
  const nodes = meshData.nodes || [];
  const uMag: number[] = [];
  const p: number[] = [];
  const kField: number[] = [];
  const omegaField: number[] = [];

  for (const [x, y] of nodes) {
    const rSq = x * x + y * y + 0.05;
    const speed = velocity * (1.0 + 0.12 / rSq);
    uMag.push(Number(speed.toFixed(3)));
    p.push(Number((0.5 * 1.225 * (velocity * velocity - speed * speed)).toFixed(2)));
    const kVal = 0.05 * speed * speed * Math.exp(-Math.abs(y) * 2.0);
    kField.push(Number(kVal.toFixed(4)));
    omegaField.push(Number((Math.sqrt(kVal) / 0.07).toFixed(1)));
  }

  const streamlines: number[][][] = [];
  const numLines = 10;
  for (let i = 0; i < numLines; i++) {
    const y0 = -2.0 + (i / (numLines - 1)) * 4.0;
    const pts: number[][] = [];
    for (let s = 0; s < 35; s++) {
      const x = -2.5 + (s / 34) * 6.0;
      let y = y0;
      if (Math.abs(x) < 0.6 && Math.abs(y0) < 0.4) {
        y += y0 >= 0 ? 0.15 : -0.15;
      }
      pts.push([Number(x.toFixed(3)), Number(y.toFixed(3)), 0.0]);
    }
    streamlines.push(pts);
  }

  const minU = Math.min(...uMag);
  const maxU = Math.max(...uMag);
  const minP = Math.min(...p);
  const maxP = Math.max(...p);

  return {
    fields: {
      U_mag: uMag,
      p,
      k: kField,
      omega: omegaField,
      vorticity: uMag.map((v) => Number((v * 0.1).toFixed(3))),
    },
    ranges: {
      U_mag: [minU, maxU],
      p: [minP, maxP],
      k: [Math.min(...kField), Math.max(...kField)],
      omega: [Math.min(...omegaField), Math.max(...omegaField)],
    },
    streamlines,
  };
}

export async function fetchYPlus(params: any): Promise<YPlusCalculation> {
  try {
    const res = await fetch(`${API_BASE}/api/physics/yplus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('API failed');
    const data = await res.json();
    return data.data;
  } catch {
    return computeFallbackYPlus(params);
  }
}

export async function fetchTurbulenceInflow(params: any) {
  try {
    const res = await fetch(`${API_BASE}/api/physics/turbulence-inflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('API failed');
    const data = await res.json();
    return data.data;
  } catch {
    return computeFallbackInflow(params.velocity, params.length_scale, params.intensity_percent);
  }
}

export async function generateMesh(geometryType: string, params: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${API_BASE}/api/geometry/mesh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geometry_type: geometryType, params }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      throw new Error(errorBody?.detail || `Mesh generation failed (${res.status})`);
    }
    const data = await res.json();
    return data.data;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Meshing timed out (>2 min). Use a coarser Resolution, a larger Local wall / Max size, or fewer prism layers.');
    }
    throw error instanceof Error ? error : new Error('Mesh generation service is unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateStructuredMesh(blocking: any, opts?: { smooth?: boolean }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${API_BASE}/api/geometry/mesh-structured`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geometry_type: 'structured',
        params: { blocking, smooth: opts?.smooth !== false },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || `Structured meshing failed (${res.status})`);
    }
    return (await res.json()).data;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Structured meshing timed out (>2 min).');
    throw error instanceof Error ? error : new Error('Mesh service is unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

// 2D CAD API Integrations
export async function uploadAndParseAirfoil(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/cad/parse-airfoil`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to parse airfoil coordinate file');
  const data = await res.json();
  return data.data;
}

export async function fetchAndParseAirfoilFromUrl(url: string) {
  try {
    const res = await fetch(`${API_BASE}/api/cad/parse-airfoil-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.data;
    }
    const err = await res.json().catch(() => ({ detail: 'Failed to fetch airfoil from URL' }));
    throw new Error(err.detail || `Server error (${res.status})`);
  } catch (backendErr: any) {
    // If backend proxy fails or is unreachable, attempt direct browser fetch as fallback
    try {
      const directRes = await fetch(url);
      if (directRes.ok) {
        const text = await directRes.text();
        const file = new File([text], url.split('/').pop() || 'airfoil.dat');
        return await uploadAndParseAirfoil(file);
      }
    } catch {
      // Ignore direct fetch fallback error
    }
    throw new Error(backendErr.message || 'Failed to fetch airfoil from URL');
  }
}

export async function uploadAndParseDxf(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/cad/parse-dxf`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to parse DXF CAD file');
  const data = await res.json();
  return data.data;
}

export async function requestOffset(points: number[][], distance: number): Promise<number[][]> {
  const res = await fetch(`${API_BASE}/api/cad/offset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points, distance }),
  });
  if (!res.ok) throw new Error('Failed to compute offset');
  const data = await res.json();
  return data.points;
}

export async function requestFillet(points: number[][], radius: number): Promise<number[][]> {
  const res = await fetch(`${API_BASE}/api/cad/fillet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points, radius }),
  });
  if (!res.ok) throw new Error('Failed to compute fillet');
  const data = await res.json();
  return data.points;
}

export async function requestMeshFromSketch(params: {
  sketch_points: number[][];
  domain_length: number;
  domain_height: number;
  resolution: string;
  first_layer_mm: number;
}) {
  const res = await fetch(`${API_BASE}/api/cad/mesh-from-sketch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to mesh CAD sketch');
  const data = await res.json();
  return data.data;
}

export async function solverEnvironment(): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}/api/solver/environment`);
    if (!res.ok) throw new Error('API failed');
    return (await res.json()).data;
  } catch {
    return { platform: 'unknown', adapters: { mock: { ok: true, detail: 'Built-in mock solver.' } }, active: 'mock' };
  }
}

export async function generateCaseFiles(
  physics: any,
  boundaries: any,
  solverControls: any,
  patches: any[] = [],
  refLength = 1,
  solution: any = {},
  projectId?: string,
) {
  try {
    const res = await fetch(`${API_BASE}/api/solver/case-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        case_dir: '/tmp/opencfd_case',
        project_id: projectId ?? null,
        physics,
        boundaries,
        solver_controls: solverControls,
        patches,
        ref_length: refLength,
        solution,
      }),
    });
    if (!res.ok) throw new Error('API failed');
    const data = await res.json();
    return data.files;
  } catch {
    return {
      'system/controlDict': `application simpleFoam;\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\nendTime ${solverControls.iterations};\n`,
      '0/U': `dimensions [0 1 -1 0 0 0 0];\ninternalField uniform (${boundaries.inletVelocity} 0 0);\n`,
      '0/p': `dimensions [0 2 -2 0 0 0 0];\ninternalField uniform 0;\n`,
      'constant/momentumTransport': `simulationType RAS;\nRAS { model ${physics.turbulenceModel}; turbulence on; }\n`,
    };
  }
}

export async function fetchFieldSolution(meshData: any, geometryType: string, velocity: number, regime: string) {
  try {
    const res = await fetch(`${API_BASE}/api/postprocess/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mesh_data: meshData,
        geometry_type: geometryType,
        velocity,
        regime,
      }),
    });
    if (!res.ok) throw new Error('API failed');
    const data = await res.json();
    return data.data;
  } catch {
    return generateFallbackFields(meshData, velocity);
  }
}
