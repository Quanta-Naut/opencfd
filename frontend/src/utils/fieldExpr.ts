// Expressions for calculator fields, e.g. `0.5*rho*U^2` or `atan2(Uy, Ux)`.
// Parsed into a small tree (no eval) and evaluated over whole arrays at once:
// every node of the tree becomes either one number or one value per point.

export type ExprNode =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string; pos: number }
  | { t: 'neg'; a: ExprNode }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: ExprNode; b: ExprNode }
  | { t: 'call'; fn: string; args: ExprNode[]; pos: number };

export interface ExprError {
  message: string;
  /** Character offset in the source, for pointing at the problem. */
  pos: number;
}

type Fn = { n: [number, number]; f: (...a: number[]) => number };
export const EXPR_FUNCTIONS: Record<string, Fn> = {
  sqrt: { n: [1, 1], f: Math.sqrt },
  abs: { n: [1, 1], f: Math.abs },
  exp: { n: [1, 1], f: Math.exp },
  log: { n: [1, 1], f: Math.log },
  log10: { n: [1, 1], f: Math.log10 },
  sin: { n: [1, 1], f: Math.sin },
  cos: { n: [1, 1], f: Math.cos },
  tan: { n: [1, 1], f: Math.tan },
  atan: { n: [1, 1], f: Math.atan },
  atan2: { n: [2, 2], f: Math.atan2 },
  pow: { n: [2, 2], f: Math.pow },
  min: { n: [2, 8], f: Math.min },
  max: { n: [2, 8], f: Math.max },
  sign: { n: [1, 1], f: Math.sign },
};

type Tok = { k: 'num' | 'id' | 'op' | '(' | ')' | ',' | 'end'; s: string; pos: number };

function tokenize(src: string): Tok[] | ExprError {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', s: num[0], pos: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', s: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    if ('+-*/^'.includes(c)) out.push({ k: 'op', s: c, pos: i });
    else if (c === '(' || c === ')' || c === ',') out.push({ k: c, s: c, pos: i });
    else return { message: `Unexpected "${c}"`, pos: i };
    i++;
  }
  out.push({ k: 'end', s: '', pos: src.length });
  return out;
}

class ParseError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
  }
}

/** Parse an expression. Precedence: unary minus, then ^ (right to left),
 *  then * /, then + -. */
export function parseExpr(src: string): ExprNode | ExprError {
  const toks = tokenize(src);
  if (!Array.isArray(toks)) return toks;
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const expect = (k: Tok['k'], what: string) => {
    const t = take();
    if (t.k !== k) throw new ParseError(`Expected ${what}`, t.pos);
    return t;
  };

  const sum = (): ExprNode => {
    let a = product();
    while (peek().k === 'op' && (peek().s === '+' || peek().s === '-')) {
      const op = take().s as '+' | '-';
      a = { t: 'bin', op, a, b: product() };
    }
    return a;
  };
  const product = (): ExprNode => {
    let a = unary();
    while (peek().k === 'op' && (peek().s === '*' || peek().s === '/')) {
      const op = take().s as '*' | '/';
      a = { t: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): ExprNode => {
    if (peek().k === 'op' && (peek().s === '-' || peek().s === '+')) {
      const neg = take().s === '-';
      const a = unary();
      return neg ? { t: 'neg', a } : a;
    }
    return power();
  };
  const power = (): ExprNode => {
    const a = atom();
    if (peek().k === 'op' && peek().s === '^') {
      take();
      return { t: 'bin', op: '^', a, b: unary() };
    }
    return a;
  };
  const atom = (): ExprNode => {
    const t = take();
    if (t.k === 'num') return { t: 'num', v: parseFloat(t.s) };
    if (t.k === '(') {
      const e = sum();
      expect(')', 'a closing bracket');
      return e;
    }
    if (t.k === 'id') {
      if (peek().k !== '(') return { t: 'var', name: t.s, pos: t.pos };
      const fn = EXPR_FUNCTIONS[t.s];
      if (!fn) throw new ParseError(`Unknown function "${t.s}"`, t.pos);
      take();
      const args: ExprNode[] = [];
      if (peek().k !== ')') {
        args.push(sum());
        while (peek().k === ',') {
          take();
          args.push(sum());
        }
      }
      expect(')', 'a closing bracket');
      if (args.length < fn.n[0] || args.length > fn.n[1])
        throw new ParseError(
          `${t.s} takes ${fn.n[0] === fn.n[1] ? fn.n[0] : `${fn.n[0]} to ${fn.n[1]}`} argument${fn.n[1] > 1 ? 's' : ''}`,
          t.pos,
        );
      return { t: 'call', fn: t.s, args, pos: t.pos };
    }
    if (t.k === 'end') throw new ParseError('Expression ends too early', t.pos);
    throw new ParseError(`Unexpected "${t.s}"`, t.pos);
  };

  try {
    if (peek().k === 'end') return { message: 'Type an expression', pos: 0 };
    const e = sum();
    if (peek().k !== 'end') throw new ParseError(`Unexpected "${peek().s}"`, peek().pos);
    return e;
  } catch (e) {
    if (e instanceof ParseError) return { message: e.message, pos: e.pos };
    throw e;
  }
}

export const isExprError = (x: unknown): x is ExprError =>
  !!x && typeof x === 'object' && 'message' in x && 'pos' in x;

/** Every variable an expression reads, with where it first appears. */
export function exprVars(e: ExprNode, out = new Map<string, number>()): Map<string, number> {
  if (e.t === 'var') {
    if (!out.has(e.name)) out.set(e.name, e.pos);
  } else if (e.t === 'neg') exprVars(e.a, out);
  else if (e.t === 'bin') {
    exprVars(e.a, out);
    exprVars(e.b, out);
  } else if (e.t === 'call') e.args.forEach((a) => exprVars(a, out));
  return out;
}

type Val = number | Float64Array;

/** Evaluate over `n` points. Variables are one number (a constant) or one
 *  value per point. */
export function evalExpr(
  e: ExprNode,
  vars: Record<string, number | ArrayLike<number>>,
  n: number,
): Float64Array {
  const map1 = (a: Val, f: (x: number) => number): Val => {
    if (typeof a === 'number') return f(a);
    const o = new Float64Array(n);
    for (let i = 0; i < n; i++) o[i] = f(a[i]);
    return o;
  };
  const mapN = (args: Val[], f: (...x: number[]) => number): Val => {
    if (args.every((a) => typeof a === 'number')) return f(...(args as number[]));
    const o = new Float64Array(n);
    const xs = new Array<number>(args.length);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < args.length; j++) {
        const a = args[j];
        xs[j] = typeof a === 'number' ? a : a[i];
      }
      o[i] = f(...xs);
    }
    return o;
  };
  const ops = {
    '+': (x: number, y: number) => x + y,
    '-': (x: number, y: number) => x - y,
    '*': (x: number, y: number) => x * y,
    '/': (x: number, y: number) => x / y,
    '^': Math.pow,
  };
  const ev = (e: ExprNode): Val => {
    switch (e.t) {
      case 'num':
        return e.v;
      case 'var': {
        const v = vars[e.name];
        if (typeof v === 'number') return v;
        if (!v) return NaN;
        return v instanceof Float64Array ? v : Float64Array.from(v);
      }
      case 'neg':
        return map1(ev(e.a), (x) => -x);
      case 'bin':
        return mapN([ev(e.a), ev(e.b)], ops[e.op]);
      case 'call':
        return mapN(e.args.map(ev), EXPR_FUNCTIONS[e.fn].f);
    }
  };
  const r = ev(e);
  return typeof r === 'number' ? new Float64Array(n).fill(r) : r;
}
