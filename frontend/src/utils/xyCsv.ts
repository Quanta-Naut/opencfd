// Read measured data from a CSV (or tab / semicolon separated) text: the
// first two numeric columns are x and y. A first row of names is used as the
// label; rows that do not start with two numbers (notes, blank lines) are
// skipped.

export interface XYData {
  name: string;
  x: number[];
  y: number[];
}

export function parseXYText(
  text: string,
  fallbackName: string,
): { data: XYData | null; error: string | null } {
  const x: number[] = [];
  const y: number[] = [];
  let header: string[] | null = null;
  let skipped = 0;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const cells = line
      .split(/[,;\t]+|\s{2,}|\s(?=[-+.\d])/)
      .map((c) => c.trim())
      .filter(Boolean);
    const a = Number(cells[0]);
    const b = Number(cells[1]);
    if (cells.length >= 2 && Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a);
      y.push(b);
    } else if (!x.length && !header && cells.length >= 2) header = cells;
    else skipped++;
  }
  if (x.length < 2)
    return { data: null, error: 'Needs at least two rows with an x and a y number.' };
  const name = header?.[1]?.replace(/^["']|["']$/g, '') || fallbackName;
  void skipped;
  return { data: { name, x, y }, error: null };
}
