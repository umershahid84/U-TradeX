import { PineError, Token, tokenize } from './lexer';

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'color'; v: string }
  | { k: 'name'; name: string; id: number; line: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'tern'; c: Expr; a: Expr; b: Expr }
  | { k: 'index'; obj: Expr; idx: Expr; line: number }
  | { k: 'call'; name: string; args: { name?: string; value: Expr }[]; id: number; line: number }
  | { k: 'arr'; items: Expr[] }
  | { k: 'ifx'; stmt: Stmt };

export type Stmt =
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'decl'; name: string; init: Expr; persistent: boolean; line: number }
  | { k: 'assign'; name: string; op: string; e: Expr; line: number }
  | { k: 'tuple'; names: string[]; e: Expr; line: number }
  | { k: 'if'; cond: Expr; then: Stmt[]; else?: Stmt[]; line: number }
  | { k: 'for'; v: string; from: Expr; to: Expr; by?: Expr; body: Stmt[]; line: number }
  | { k: 'while'; cond: Expr; body: Stmt[]; line: number }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'fn'; name: string; params: string[]; body: Stmt[]; line: number };

const TYPE_WORDS = new Set(['int', 'float', 'bool', 'string', 'color', 'series', 'simple', 'const', 'label', 'line', 'box']);
const ASSIGN_OPS = new Set(['=', ':=', '+=', '-=', '*=', '/=', '%=']);

class Parser {
  private p = 0;
  private nextId = 1;
  constructor(private toks: Token[]) {}

  private get cur(): Token { return this.toks[this.p]; }
  private kind(): string { return this.toks[this.p].t; }
  private peek(n = 1) { return this.toks[this.p + n] ?? this.toks[this.toks.length - 1]; }
  private isOp(v: string, tok = this.cur) { return tok.t === 'op' && tok.v === v; }
  private isKw(v: string, tok = this.cur) { return tok.t === 'id' && tok.v === v; }
  private fail(msg: string, tok = this.cur): never { throw new PineError(msg, tok.line); }

  private expectOp(v: string) {
    if (!this.isOp(v)) this.fail(`Expected '${v}' but found '${this.cur.v || this.cur.t}'`);
    return this.toks[this.p++];
  }

  parseProgram(): Stmt[] {
    const out: Stmt[] = [];
    while (this.cur.t !== 'eof') {
      if (this.cur.t === 'nl') { this.p++; continue; }
      if (this.cur.t === 'indent') this.fail('Unexpected indentation');
      out.push(this.statement());
    }
    return out;
  }

  private block(): Stmt[] {
    if (this.cur.t !== 'nl') this.fail('Expected a new line and an indented block');
    this.p++;
    if (this.kind() !== 'indent') this.fail('Expected an indented block');
    this.p++;
    const out: Stmt[] = [];
    while (this.kind() !== 'dedent' && this.kind() !== 'eof') {
      if (this.cur.t === 'nl') { this.p++; continue; }
      out.push(this.statement());
    }
    if (this.kind() === 'dedent') this.p++;
    return out;
  }

  private endOfStatement() {
    // a statement ending in an indented block (e.g. `x = if ...`) has already consumed its newline
    if (this.p > 0 && this.toks[this.p - 1].t === 'dedent') return;
    if (this.cur.t === 'nl') this.p++;
    else if (this.cur.t !== 'eof' && this.cur.t !== 'dedent') this.fail(`Unexpected '${this.cur.v}'`);
  }

  private statement(): Stmt {
    const tok = this.cur;
    const line = tok.line;

    if (this.isKw('if')) return this.ifStatement();

    if (this.isKw('for')) {
      this.p++;
      const v = this.ident();
      this.expectOp('=');
      const from = this.expr();
      if (!this.isKw('to')) this.fail("Expected 'to' in for loop");
      this.p++;
      const to = this.expr();
      let by: Expr | undefined;
      if (this.isKw('by')) { this.p++; by = this.expr(); }
      return { k: 'for', v, from, to, by, body: this.block(), line };
    }

    if (this.isKw('while')) {
      this.p++;
      const cond = this.expr();
      return { k: 'while', cond, body: this.block(), line };
    }

    if (this.isKw('break')) { this.p++; this.endOfStatement(); return { k: 'break' }; }
    if (this.isKw('continue')) { this.p++; this.endOfStatement(); return { k: 'continue' }; }

    // var / varip declarations
    let persistent = false;
    if ((this.isKw('var') || this.isKw('varip')) && this.peek().t === 'id') {
      persistent = true;
      this.p++;
    }

    // optional type annotation: `float x = ...`
    if (this.cur.t === 'id' && TYPE_WORDS.has(this.cur.v) && this.peek().t === 'id' &&
        ASSIGN_OPS.has(this.peek(2).v) && this.peek(2).t === 'op') {
      this.p++;
    }

    // tuple destructuring: [a, b] = expr
    if (this.isOp('[')) {
      const save = this.p;
      this.p++;
      const names: string[] = [];
      let ok = true;
      while (!this.isOp(']')) {
        if (this.cur.t !== 'id') { ok = false; break; }
        names.push(this.cur.v);
        this.p++;
        if (this.isOp(',')) this.p++;
        else if (!this.isOp(']')) { ok = false; break; }
      }
      if (ok && this.isOp(']') && this.isOp('=', this.peek())) {
        this.p += 2;
        const e = this.expr();
        this.endOfStatement();
        return { k: 'tuple', names, e, line };
      }
      this.p = save;
    }

    if (this.cur.t === 'id') {
      // function definition: name(params) =>
      if (this.isOp('(', this.peek()) && this.isFunctionDef()) {
        const name = this.ident();
        this.p++; // (
        const params: string[] = [];
        while (!this.isOp(')')) {
          if (this.cur.t === 'id' && TYPE_WORDS.has(this.cur.v) && this.peek().t === 'id') this.p++;
          params.push(this.ident());
          if (this.isOp('=')) { this.p++; this.expr(); } // default values are ignored
          if (this.isOp(',')) this.p++;
        }
        this.p++; // )
        this.expectOp('=>');
        let body: Stmt[];
        if (this.kind() === 'nl') body = this.block();
        else {
          const e = this.expr();
          this.endOfStatement();
          body = [{ k: 'expr', e, line }];
        }
        return { k: 'fn', name, params, body, line };
      }

      const next = this.peek();
      if (next.t === 'op' && ASSIGN_OPS.has(next.v)) {
        const name = this.ident();
        const op = this.toks[this.p++].v;
        const e = this.expr();
        this.endOfStatement();
        if (op === '=') return { k: 'decl', name, init: e, persistent, line };
        return { k: 'assign', name, op, e, line };
      }
    }

    const e = this.expr();
    this.endOfStatement();
    return { k: 'expr', e, line };
  }

  private isFunctionDef(): boolean {
    let depth = 0;
    let i = this.p + 1;
    for (; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t.t === 'op' && t.v === '(') depth++;
      else if (t.t === 'op' && t.v === ')') { depth--; if (depth === 0) break; }
      else if (t.t === 'nl' || t.t === 'eof') return false;
    }
    const after = this.toks[i + 1];
    return !!after && after.t === 'op' && after.v === '=>';
  }

  private ifStatement(): Stmt {
    const line = this.cur.line;
    this.p++; // if
    const cond = this.expr();
    const then = this.block();
    let els: Stmt[] | undefined;
    if (this.isKw('else')) {
      this.p++;
      if (this.isKw('if')) els = [this.ifStatement()];
      else els = this.block();
    }
    return { k: 'if', cond, then, else: els, line };
  }

  private ident(): string {
    if (this.cur.t !== 'id') this.fail(`Expected a name but found '${this.cur.v || this.cur.t}'`);
    return this.toks[this.p++].v;
  }

  // ---- expressions ----
  expr(): Expr { return this.ternary(); }

  private ternary(): Expr {
    const c = this.or();
    if (this.isOp('?')) {
      this.p++;
      const a = this.ternary();
      this.expectOp(':');
      const b = this.ternary();
      return { k: 'tern', c, a, b };
    }
    return c;
  }

  private or(): Expr {
    let l = this.and();
    while (this.isKw('or')) { const line = this.cur.line; this.p++; l = { k: 'bin', op: 'or', l, r: this.and(), line }; }
    return l;
  }

  private and(): Expr {
    let l = this.not();
    while (this.isKw('and')) { const line = this.cur.line; this.p++; l = { k: 'bin', op: 'and', l, r: this.not(), line }; }
    return l;
  }

  private not(): Expr {
    if (this.isKw('not')) { this.p++; return { k: 'un', op: 'not', e: this.not() }; }
    return this.comparison();
  }

  private comparison(): Expr {
    let l = this.additive();
    while (this.cur.t === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(this.cur.v)) {
      const { v: op, line } = this.toks[this.p++];
      l = { k: 'bin', op, l, r: this.additive(), line };
    }
    return l;
  }

  private additive(): Expr {
    let l = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const { v: op, line } = this.toks[this.p++];
      l = { k: 'bin', op, l, r: this.multiplicative(), line };
    }
    return l;
  }

  private multiplicative(): Expr {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const { v: op, line } = this.toks[this.p++];
      l = { k: 'bin', op, l, r: this.unary(), line };
    }
    return l;
  }

  private unary(): Expr {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.toks[this.p++].v;
      return { k: 'un', op, e: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    while (this.isOp('[')) {
      const line = this.cur.line;
      this.p++;
      const idx = this.expr();
      this.expectOp(']');
      e = { k: 'index', obj: e, idx, line };
    }
    return e;
  }

  private primary(): Expr {
    const tok = this.cur;
    switch (tok.t) {
      case 'num': this.p++; return { k: 'num', v: parseFloat(tok.v) };
      case 'str': this.p++; return { k: 'str', v: tok.v };
      case 'color': this.p++; return { k: 'color', v: tok.v };
      case 'id': {
        if (tok.v === 'true' || tok.v === 'false') { this.p++; return { k: 'bool', v: tok.v === 'true' }; }
        if (tok.v === 'if') return { k: 'ifx', stmt: this.ifStatement() };
        this.p++;
        let name = tok.v;
        while (this.isOp('.') && this.peek().t === 'id') {
          this.p++;
          name += '.' + this.toks[this.p++].v;
        }
        if (this.isOp('(')) {
          this.p++;
          const args: { name?: string; value: Expr }[] = [];
          while (!this.isOp(')')) {
            if (this.cur.t === 'id' && this.isOp('=', this.peek())) {
              const argName = this.cur.v;
              this.p += 2;
              args.push({ name: argName, value: this.expr() });
            } else {
              args.push({ value: this.expr() });
            }
            if (this.isOp(',')) this.p++;
            else if (!this.isOp(')')) this.fail(`Expected ',' or ')' but found '${this.cur.v || this.cur.t}'`);
          }
          this.p++;
          return { k: 'call', name, args, id: this.nextId++, line: tok.line };
        }
        return { k: 'name', name, id: this.nextId++, line: tok.line };
      }
      case 'op':
        if (tok.v === '(') {
          this.p++;
          const e = this.expr();
          this.expectOp(')');
          return e;
        }
        if (tok.v === '[') {
          this.p++;
          const items: Expr[] = [];
          while (!this.isOp(']')) {
            items.push(this.expr());
            if (this.isOp(',')) this.p++;
          }
          this.p++;
          return { k: 'arr', items };
        }
    }
    return this.fail(`Unexpected '${tok.v || tok.t}'`);
  }
}

export function parse(src: string): Stmt[] {
  return new Parser(tokenize(src)).parseProgram();
}
