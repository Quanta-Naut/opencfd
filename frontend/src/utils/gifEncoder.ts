// A small animated GIF encoder: each frame gets its own 256-colour palette
// (median cut over a sample of its pixels), LZW-compressed, looping forever.
// Frames are encoded as they are added, so only the compressed bytes are
// kept in memory however long the animation is.

export class GifEncoder {
  private bytes: number[] = [];
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const b = this.bytes;
    b.push(...ascii('GIF89a'));
    word(b, width);
    word(b, height);
    // No global colour table; every frame carries its own.
    b.push(0x00, 0, 0);
    // Loop forever (NETSCAPE2.0 application extension).
    b.push(0x21, 0xff, 0x0b, ...ascii('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0x00);
  }

  /** Add one frame (RGBA, this encoder's size), shown for `delayMs`. */
  addFrame(rgba: Uint8ClampedArray, delayMs: number): void {
    const { palette, index } = quantize(rgba);
    const b = this.bytes;
    // Graphic control extension: the frame delay in hundredths of a second.
    b.push(0x21, 0xf9, 0x04, 0x00);
    word(b, Math.max(2, Math.round(delayMs / 10)));
    b.push(0x00, 0x00);
    // Image descriptor with a 256-entry local colour table.
    b.push(0x2c);
    word(b, 0);
    word(b, 0);
    word(b, this.width);
    word(b, this.height);
    b.push(0x87);
    for (let i = 0; i < 256; i++) b.push(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]);
    lzw(index, 8, b);
  }

  /** The finished file. */
  finish(): Blob {
    return new Blob([new Uint8Array([...this.bytes, 0x3b])], { type: 'image/gif' });
  }
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const word = (b: number[], v: number) => b.push(v & 0xff, (v >> 8) & 0xff);

/** Median cut to 256 colours, then each pixel to its nearest palette entry
 *  (looked up through a 5-bit-per-channel cache). */
function quantize(rgba: Uint8ClampedArray): { palette: Uint8Array; index: Uint8Array } {
  const n = rgba.length / 4;
  // Sample at most ~60k pixels for the cut.
  const stride = Math.max(1, Math.floor(n / 60000));
  const sample: number[] = [];
  for (let i = 0; i < n; i += stride) sample.push(i * 4);

  type Box = number[];
  let boxes: Box[] = [sample];
  while (boxes.length < 256) {
    // Split the box with the widest channel spread.
    let best = -1,
      bestSpread = 0,
      bestCh = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255,
          hi = 0;
        for (const p of box) {
          const v = rgba[p + ch];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > bestSpread) {
          bestSpread = hi - lo;
          best = bi;
          bestCh = ch;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best];
    box.sort((a, b) => rgba[a + bestCh] - rgba[b + bestCh]);
    const mid = box.length >> 1;
    boxes = [...boxes.slice(0, best), box.slice(0, mid), box.slice(mid), ...boxes.slice(best + 1)];
  }

  const palette = new Uint8Array(256 * 3);
  boxes.forEach((box, i) => {
    let r = 0,
      g = 0,
      b = 0;
    for (const p of box) {
      r += rgba[p];
      g += rgba[p + 1];
      b += rgba[p + 2];
    }
    const k = Math.max(1, box.length);
    palette[i * 3] = Math.round(r / k);
    palette[i * 3 + 1] = Math.round(g / k);
    palette[i * 3 + 2] = Math.round(b / k);
  });
  const used = boxes.length;

  const cache = new Int16Array(32 * 32 * 32).fill(-1);
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4],
      g = rgba[i * 4 + 1],
      b = rgba[i * 4 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let c = cache[key];
    if (c < 0) {
      let bestD = Infinity;
      c = 0;
      for (let j = 0; j < used; j++) {
        const dr = palette[j * 3] - r,
          dg = palette[j * 3 + 1] - g,
          db = palette[j * 3 + 2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          c = j;
        }
      }
      cache[key] = c;
    }
    index[i] = c;
  }
  return { palette, index };
}

/** GIF-flavoured LZW of colour indices, written as data sub-blocks. */
function lzw(index: Uint8Array, minCodeSize: number, out: number[]): void {
  out.push(minCodeSize);
  const clear = 1 << minCodeSize,
    eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();

  const block: number[] = [];
  let acc = 0,
    bits = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      block.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
      if (block.length === 255) {
        out.push(255, ...block);
        block.length = 0;
      }
    }
  };

  emit(clear);
  let prefix = index[0];
  for (let i = 1; i < index.length; i++) {
    const k = index[i];
    // Key: the prefix code and the next index.
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      // The decoder widens one code later than the encoder adds it.
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) block.push(acc & 0xff);
  if (block.length) out.push(block.length, ...block);
  out.push(0x00);
}
