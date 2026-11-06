/**
 * A tiny, safe expression language for strategy conditions and amounts.
 *
 *   pointOn && !hasBet('place', 6)
 *   2u                        -> 2 * unit
 *   bet.payout >= 14 ? 24 : 12
 *   roundUp(bankroll * 0.02, 6)
 */

export type Ast =
  | { t: 'num'; v: number }
  | { t: 'units'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'id'; name: string }
  | { t: 'member'; obj: Ast; name: string }
  | { t: 'call'; name: string; args: Ast[] }
  | { t: 'un'; op: '-' | '!'; x: Ast }
  | { t: 'bin'; op: string; l: Ast; r: Ast }
  | { t: 'cond'; c: Ast; a: Ast; b: Ast };

type Tok =
  | { k: 'num'; v: number; units: boolean }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'eof' };

const OPS = ['&&', '||', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%', '(', ')', ',', '.', '!', '?', ':'];

export class ExprError extends Error {
  constructor(message: string, public readonly source: string) {
    super(`${message} in "${source}"`);
  }
}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const v = parseFloat(src.slice(i, j));
      let units = false;
      if (src[j] === 'u' && !/[A-Za-z0-9_]/.test(src[j + 1] ?? '')) {
        units = true;
        j++;
      }
      out.push({ k: 'num', v, units });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ k: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        s += src[j];
        j++;
      }
      if (src[j] !== c) throw new ExprError('unterminated string', src);
      out.push({ k: 'str', v: s });
      i = j + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected character "${c}"`, src);
    out.push({ k: 'op', v: op });
    i += op.length;
  }
  out.push({ k: 'eof' });
  return out;
}

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly src: string,
  ) {}

  private peek(): Tok {
    return this.toks[this.i]!;
  }
  private next(): Tok {
    return this.toks[this.i++]!;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }
  private expectOp(v: string): void {
    if (!this.isOp(v)) throw new ExprError(`expected "${v}"`, this.src);
    this.next();
  }

  parse(): Ast {
    const e = this.ternary();
    if (this.peek().k !== 'eof') throw new ExprError('unexpected trailing input', this.src);
    return e;
  }

  private ternary(): Ast {
    const c = this.or();
    if (this.isOp('?')) {
      this.next();
      const a = this.ternary();
      this.expectOp(':');
      const b = this.ternary();
      return { t: 'cond', c, a, b };
    }
    return c;
  }
  private or(): Ast {
    let l = this.and();
    while (this.isOp('||')) {
      this.next();
      l = { t: 'bin', op: '||', l, r: this.and() };
    }
    return l;
  }
  private and(): Ast {
    let l = this.not();
    while (this.isOp('&&')) {
      this.next();
      l = { t: 'bin', op: '&&', l, r: this.not() };
    }
    return l;
  }
  private not(): Ast {
    if (this.isOp('!')) {
      this.next();
      return { t: 'un', op: '!', x: this.not() };
    }
    return this.cmp();
  }
  private cmp(): Ast {
    const l = this.add();
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.isOp(op)) {
        this.next();
        return { t: 'bin', op, l, r: this.add() };
      }
    }
    return l;
  }
  private add(): Ast {
    let l = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { v: string }).v;
      l = { t: 'bin', op, l, r: this.mul() };
    }
    return l;
  }
  private mul(): Ast {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.next() as { v: string }).v;
      l = { t: 'bin', op, l, r: this.unary() };
    }
    return l;
  }
  private unary(): Ast {
    if (this.isOp('-')) {
      this.next();
      return { t: 'un', op: '-', x: this.unary() };
    }
    return this.postfix();
  }
  private postfix(): Ast {
    let e = this.primary();
    for (;;) {
      if (this.isOp('(') && e.t === 'id') {
        this.next();
        const args: Ast[] = [];
        if (!this.isOp(')')) {
          args.push(this.ternary());
          while (this.isOp(',')) {
            this.next();
            args.push(this.ternary());
          }
        }
        this.expectOp(')');
        e = { t: 'call', name: e.name, args };
      } else if (this.isOp('.')) {
        this.next();
        const t = this.next();
        if (t.k !== 'id') throw new ExprError('expected property name after "."', this.src);
        e = { t: 'member', obj: e, name: t.v };
      } else return e;
    }
  }
  private primary(): Ast {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return t.units ? { t: 'units', v: t.v } : { t: 'num', v: t.v };
      case 'str':
        return { t: 'str', v: t.v };
      case 'id':
        if (t.v === 'true') return { t: 'bool', v: true };
        if (t.v === 'false') return { t: 'bool', v: false };
        return { t: 'id', name: t.v };
      case 'op':
        if (t.v === '(') {
          const e = this.ternary();
          this.expectOp(')');
          return e;
        }
        throw new ExprError(`unexpected "${t.v}"`, this.src);
      default:
        throw new ExprError('unexpected end of expression', this.src);
    }
  }
}

const cache = new Map<string, Ast>();

export function parseExpr(src: string): Ast {
  let ast = cache.get(src);
  if (!ast) {
    ast = new Parser(lex(src), src).parse();
    cache.set(src, ast);
  }
  return ast;
}

/** Names an expression reads (identifiers and function names), for validation. */
export function collectNames(ast: Ast, out = { ids: new Set<string>(), fns: new Set<string>() }): { ids: Set<string>; fns: Set<string> } {
  switch (ast.t) {
    case 'id':
      out.ids.add(ast.name);
      break;
    case 'member':
      collectNames(ast.obj, out);
      break;
    case 'call':
      out.fns.add(ast.name);
      ast.args.forEach((a) => collectNames(a, out));
      break;
    case 'un':
      collectNames(ast.x, out);
      break;
    case 'bin':
      collectNames(ast.l, out);
      collectNames(ast.r, out);
      break;
    case 'cond':
      collectNames(ast.c, out);
      collectNames(ast.a, out);
      collectNames(ast.b, out);
      break;
  }
  return out;
}

export type Value = number | string | boolean | null | undefined | Record<string, unknown>;

export interface Scope {
  get(name: string): Value;
  call(name: string, args: Value[]): Value;
  unit: number;
}

function num(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null) return 0;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`expected a number, got ${JSON.stringify(v)}`);
}

export function truthy(v: Value): boolean {
  return v !== undefined && v !== null && v !== false && v !== 0 && v !== '';
}

export function evaluate(ast: Ast, scope: Scope): Value {
  switch (ast.t) {
    case 'num':
      return ast.v;
    case 'units':
      return ast.v * scope.unit;
    case 'str':
      return ast.v;
    case 'bool':
      return ast.v;
    case 'id':
      return scope.get(ast.name);
    case 'member': {
      const o = evaluate(ast.obj, scope);
      if (o && typeof o === 'object') return (o as Record<string, Value>)[ast.name];
      return undefined;
    }
    case 'call':
      return scope.call(
        ast.name,
        ast.args.map((a) => evaluate(a, scope)),
      );
    case 'un':
      return ast.op === '!' ? !truthy(evaluate(ast.x, scope)) : -num(evaluate(ast.x, scope));
    case 'cond':
      return truthy(evaluate(ast.c, scope)) ? evaluate(ast.a, scope) : evaluate(ast.b, scope);
    case 'bin': {
      if (ast.op === '&&') return truthy(evaluate(ast.l, scope)) ? evaluate(ast.r, scope) : false;
      if (ast.op === '||') {
        const l = evaluate(ast.l, scope);
        return truthy(l) ? l : evaluate(ast.r, scope);
      }
      const l = evaluate(ast.l, scope);
      const r = evaluate(ast.r, scope);
      switch (ast.op) {
        case '==':
          return looseEq(l, r);
        case '!=':
          return !looseEq(l, r);
        case '<':
          return num(l) < num(r);
        case '<=':
          return num(l) <= num(r);
        case '>':
          return num(l) > num(r);
        case '>=':
          return num(l) >= num(r);
        case '+':
          return typeof l === 'string' || typeof r === 'string' ? String(l ?? '') + String(r ?? '') : num(l) + num(r);
        case '-':
          return num(l) - num(r);
        case '*':
          return num(l) * num(r);
        case '/': {
          const d = num(r);
          return d === 0 ? 0 : num(l) / d;
        }
        case '%': {
          const d = num(r);
          return d === 0 ? 0 : num(l) % d;
        }
      }
      throw new Error(`unknown operator ${ast.op}`);
    }
  }
}

function looseEq(a: Value, b: Value): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    if (a == null || b == null) return false;
    return num(a) === num(b);
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b);
  return a === b;
}

export function evalExpr(src: string, scope: Scope): Value {
  return evaluate(parseExpr(src), scope);
}

export function evalNumber(src: string | number, scope: Scope): number {
  if (typeof src === 'number') return src;
  return num(evaluate(parseExpr(src), scope));
}

export function evalBool(src: string, scope: Scope): boolean {
  return truthy(evaluate(parseExpr(src), scope));
}

/** Interpolate `{expr}` segments inside a log message. */
export function interpolate(template: string, scope: Scope): string {
  return template.replace(/\{([^{}]+)\}/g, (_, e: string) => {
    try {
      const v = evalExpr(e.trim(), scope);
      return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    } catch (err) {
      return `{${e}: ${(err as Error).message}}`;
    }
  });
}
