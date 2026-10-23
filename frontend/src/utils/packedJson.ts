/**
 * Packed JSON: a JSON document whose large numeric arrays travel as typed-array
 * blocks. Must stay in sync with backend/app/services/packed_json.py, which
 * documents the layout. Used for field data (live previews, results, run
 * snapshots, the autosaved fieldData).
 *
 * Unpacked arrays come back as plain `number[]` / `number[][]`, the same shape
 * the JSON API produced, so existing consumers need no changes.
 */

export const PACKED_MEDIA_TYPE = 'application/x-opencfd-packed';

const MAGIC = 'OCFDPAK1';
const MIN_LEN = 256;

const pad8 = (n: number) => (8 - (n % 8)) % 8;

type DType = 'f4' | 'f8' | 'i4';
interface ArraySpec {
  dtype: DType;
  shape: number[];
  offset: number;
}

const CTORS = { f4: Float32Array, f8: Float64Array, i4: Int32Array } as const;

export function isPacked(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const head = new Uint8Array(buf, 0, 8);
  for (let i = 0; i < 8; i++) if (head[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

export function unpack(buf: ArrayBuffer): any {
  if (!isPacked(buf)) throw new Error('Not an OpenCFD packed document');
  const hlen = new DataView(buf).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen)));
  let base = 12 + hlen;
  base += pad8(base);

  const arrays = (header.arrays as ArraySpec[]).map((spec) => {
    const Ctor = CTORS[spec.dtype];
    const count = spec.shape.reduce((a, b) => a * b, 1);
    if (base + spec.offset + count * Ctor.BYTES_PER_ELEMENT > buf.byteLength) {
      throw new Error('Packed document is truncated');
    }
    const flat = new Ctor(buf, base + spec.offset, count);
    if (spec.shape.length === 1) return Array.from(flat);
    const [rows, k] = spec.shape;
    const out: number[][] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      const row = new Array(k);
      for (let c = 0; c < k; c++) row[c] = flat[r * k + c];
      out[r] = row;
    }
    return out;
  });

  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$pk') return arrays[v.$pk];
      const o: any = {};
      for (const key of keys) o[key] = walk(v[key]);
      return o;
    }
    return v;
  };
  return walk(header.doc);
}

const isNum = (v: unknown): v is number => typeof v === 'number';

/** Pack a document for upload; same rules as the Python `pack` (float32 for
 * non-integer data, int32 when every value is an integer in range). */
export function pack(doc: unknown): ArrayBuffer {
  const specs: ArraySpec[] = [];
  const blocks: ArrayBufferView[] = [];
  let offset = 0;

  const addBlock = (values: ArrayLike<number>, shape: number[]) => {
    let allInt = true;
    for (let i = 0; i < values.length; i++) {
      const x = values[i];
      if (!Number.isInteger(x) || x < -2147483648 || x > 2147483647) {
        allInt = false;
        break;
      }
    }
    const dtype: DType = allInt ? 'i4' : 'f4';
    const arr = allInt ? Int32Array.from(values) : Float32Array.from(values);
    specs.push({ dtype, shape, offset });
    blocks.push(arr);
    offset += arr.byteLength + pad8(arr.byteLength);
    return { $pk: specs.length - 1 };
  };

  const walk = (v: any): any => {
    if (Array.isArray(v)) {
      if (v.length >= MIN_LEN) {
        if (v.every(isNum)) return addBlock(v, [v.length]);
        const k = Array.isArray(v[0]) ? v[0].length : 0;
        if (k > 0 && v.every((r) => Array.isArray(r) && r.length === k && r.every(isNum))) {
          const flat = new Float64Array(v.length * k);
          for (let r = 0; r < v.length; r++) for (let c = 0; c < k; c++) flat[r * k + c] = v[r][c];
          return addBlock(flat, [v.length, k]);
        }
      }
      return v.map(walk);
    }
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const t = v as unknown as ArrayLike<number>;
      return t.length > 0 ? addBlock(t, [t.length]) : [];
    }
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const key of Object.keys(v)) o[key] = walk(v[key]);
      return o;
    }
    return v;
  };

  const packedDoc = walk(doc);
  const hbytes = new TextEncoder().encode(JSON.stringify({ doc: packedDoc, arrays: specs }));
  let base = 12 + hbytes.length;
  base += pad8(base);
  const buf = new ArrayBuffer(base + offset);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < 8; i++) bytes[i] = MAGIC.charCodeAt(i);
  new DataView(buf).setUint32(8, hbytes.length, true);
  bytes.set(hbytes, 12);
  specs.forEach((spec, i) => {
    const b = blocks[i];
    bytes.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), base + spec.offset);
  });
  return buf;
}

/** Read a response that may be packed (when the server honoured our Accept
 * header) or the usual JSON body. */
export async function readPackedOrJson(res: Response): Promise<any> {
  if ((res.headers.get('content-type') ?? '').includes(PACKED_MEDIA_TYPE)) {
    return unpack(await res.arrayBuffer());
  }
  return res.json();
}
