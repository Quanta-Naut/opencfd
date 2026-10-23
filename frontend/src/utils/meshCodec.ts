/**
 * Binary mesh container. Must stay in sync with backend/app/services/mesh_codec.py,
 * which documents the layout. A 200k-cell mesh is ~17 MB as JSON and ~8 MB
 * here, and decoding is a few typed-array views instead of a JSON.parse of
 * every number.
 */

export const MESH_MEDIA_TYPE = 'application/x-opencfd-mesh';

const MAGIC = 'OCFDMSH1';

const pad8 = (n: number) => (8 - (n % 8)) % 8;

export function isBinaryMesh(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const head = new Uint8Array(buf, 0, 8);
  for (let i = 0; i < 8; i++) if (head[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

/**
 * Decode into the same shape the JSON API returns (`nodes` as [x, y, z]
 * arrays, `elements` as node-id arrays), so every consumer keeps working.
 */
export function decodeMesh(buf: ArrayBuffer): any {
  if (!isBinaryMesh(buf)) throw new Error('Not an OpenCFD binary mesh');
  const view = new DataView(buf);
  const hlen = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen)));
  const { n, dim, zdim, m, conn: nconn } = header._bin;
  delete header._bin;
  let pos = 12 + hlen;
  pos += pad8(pos);
  if (buf.byteLength !== pos + n * dim * 8 + (m + 1) * 4 + nconn * 4) {
    throw new Error('Binary mesh is truncated');
  }

  // Typed-array views need aligned offsets; the layout guarantees 8 for the
  // float64 block and 4 for the uint32 blocks after it.
  const coords = new Float64Array(buf, pos, n * dim);
  pos += n * dim * 8;
  const offsets = new Uint32Array(buf, pos, m + 1);
  pos += (m + 1) * 4;
  const conn = new Uint32Array(buf, pos, nconn);

  const nodes: number[][] = new Array(n);
  if (dim === 2) {
    const z = zdim === 3;
    for (let i = 0; i < n; i++) {
      nodes[i] = z ? [coords[2 * i], coords[2 * i + 1], 0] : [coords[2 * i], coords[2 * i + 1]];
    }
  } else {
    for (let i = 0; i < n; i++) nodes[i] = [coords[3 * i], coords[3 * i + 1], coords[3 * i + 2]];
  }
  const elements: number[][] = new Array(m);
  for (let e = 0; e < m; e++) {
    const a = offsets[e];
    const b = offsets[e + 1];
    const el = new Array(b - a);
    for (let k = a; k < b; k++) el[k - a] = conn[k];
    elements[e] = el;
  }
  header.nodes = nodes;
  header.elements = elements;
  return header;
}

/** Encode a mesh object (nodes / elements plus any other keys) for upload. */
export function encodeMesh(mesh: any): ArrayBuffer {
  const nodes: number[][] = mesh?.nodes ?? [];
  const elements: number[][] = mesh?.elements ?? [];
  const n = nodes.length;
  const m = elements.length;
  const zdim = n ? nodes[0].length : 2;
  let flatZ = true;
  if (zdim === 3) {
    for (let i = 0; i < n; i++) {
      if (nodes[i][2]) {
        flatZ = false;
        break;
      }
    }
  }
  const dim = zdim === 3 && !flatZ ? 3 : 2;
  let nconn = 0;
  for (let e = 0; e < m; e++) nconn += elements[e].length;

  const { nodes: _n, elements: _e, ...rest } = mesh ?? {};
  void _n;
  void _e;
  const hbytes = new TextEncoder().encode(
    JSON.stringify({ ...rest, _bin: { n, dim, zdim, m, conn: nconn } }),
  );
  let pos = 12 + hbytes.length;
  pos += pad8(pos);
  const total = pos + n * dim * 8 + (m + 1) * 4 + nconn * 4;
  const buf = new ArrayBuffer(total);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < 8; i++) bytes[i] = MAGIC.charCodeAt(i);
  new DataView(buf).setUint32(8, hbytes.length, true);
  bytes.set(hbytes, 12);

  const coords = new Float64Array(buf, pos, n * dim);
  for (let i = 0; i < n; i++) {
    const nd = nodes[i];
    coords[dim * i] = nd[0];
    coords[dim * i + 1] = nd[1];
    if (dim === 3) coords[dim * i + 2] = nd[2];
  }
  pos += n * dim * 8;
  const offsets = new Uint32Array(buf, pos, m + 1);
  pos += (m + 1) * 4;
  const conn = new Uint32Array(buf, pos, nconn);
  let k = 0;
  for (let e = 0; e < m; e++) {
    offsets[e] = k;
    const el = elements[e];
    for (let j = 0; j < el.length; j++) conn[k++] = el[j];
  }
  offsets[m] = k;
  return buf;
}

/**
 * Read a mesh endpoint's response: binary when the server honoured our
 * Accept header, otherwise the `{ success, data }` JSON envelope.
 */
export async function readMeshResponse(res: Response): Promise<any> {
  if ((res.headers.get('content-type') ?? '').includes(MESH_MEDIA_TYPE)) {
    return decodeMesh(await res.arrayBuffer());
  }
  return (await res.json()).data;
}
