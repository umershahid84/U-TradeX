// Bar-by-bar interpreter for the Pine Script subset parsed in parser.ts.
import { PineError } from './lexer';
import { Expr, Stmt, parse } from './parser';

export interface PineBar {
  time: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PinePlot {
  id: number;
  title: string;
  color: string;
  lineWidth: number;
  style: 'line' | 'histogram' | 'step' | 'circles' | 'cross';
  values: (number | null)[];
  colors: (string | undefined)[];
}

export interface PineFill {
  a: number | { hline: number };
  b: number | { hline: number };
  color: string;
  colors: (string | undefined)[];
}

export interface PineMarker {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  color: string;
  text: string;
}

export interface PineInput {
  id: number;
  title: string;
  type: 'int' | 'float' | 'bool' | 'string' | 'source' | 'color';
  value: number | boolean | string;
  defval: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface PineResult {
  title: string;
  overlay: boolean;
  plots: PinePlot[];
  hlines: { price: number; color: string; title: string }[];
  fills: PineFill[];
  markers: PineMarker[];
  inputs: PineInput[];
  warnings: string[];
}

type Val = any;
type Frame = Map<string, Val[]>;

const MAX_STEPS = 60_000_000;

class BreakSignal {}
class ContinueSignal {}

const COLORS: Record<string, string> = {
  aqua: '#00BCD4', black: '#363A45', blue: '#2962FF', fuchsia: '#E040FB', gray: '#787B86',
  green: '#4CAF50', lime: '#00E676', maroon: '#880E4F', navy: '#311B92', olive: '#808000',
  orange: '#FF9800', purple: '#9C27B0', red: '#F23645', silver: '#B2B5BE', teal: '#089981',
  white: '#FFFFFF', yellow: '#FDD835',
};

const NAMESPACES_AS_STRING = new Set([
  'shape', 'location', 'size', 'plot', 'hline', 'display', 'format', 'extend', 'line', 'label',
  'xloc', 'yloc', 'scale', 'position', 'text', 'font', 'alert', 'barmerge', 'currency', 'session',
]);

const IGNORED = new Set([
  'bgcolor', 'barcolor', 'alertcondition', 'alert', 'plotcandle', 'plotbar', 'plotarrow',
  'label.new', 'label.set_text', 'label.set_xy', 'label.delete', 'line.new', 'line.set_xy1',
  'line.set_xy2', 'line.delete', 'box.new', 'box.delete', 'table.new', 'table.cell', 'log.info',
  'log.warning', 'log.error', 'runtime.error', 'max_bars_back', 'timeframe.change',
]);

const nyParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
});
const WEEKDAYS: Record<string, number> = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 };

const isNum = (v: Val): v is number => typeof v === 'number' && Number.isFinite(v);
const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);

function toRGBA(color: string, transp: number): string {
  let r = 0, g = 0, b = 0, a = 1;
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16); g = parseInt(hex[1].slice(2, 4), 16); b = parseInt(hex[1].slice(4, 6), 16);
    if (hex[2]) a = parseInt(hex[2], 16) / 255;
  } else if (rgba) {
    r = +rgba[1]; g = +rgba[2]; b = +rgba[3];
    if (rgba[4] !== undefined) a = +rgba[4];
  }
  const alpha = Math.max(0, Math.min(1, a * (1 - transp / 100)));
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

// ---- incremental indicator helpers; `st` is per-call-site state ----
type St = Record<string, any>;
const sub = (st: St, k: string): St => (st[k] ||= {});
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

function win(st: St, x: Val, n: number): Val[] | null {
  (st.buf ||= []).push(x);
  if (st.buf.length < n) return null;
  const w = st.buf.slice(-n);
  return w.some((v: Val) => v == null) ? null : w;
}
const smaStep = (st: St, x: Val, n: number) => { const w = win(st, x, n); return w ? avg(w) : null; };
function emaStep(st: St, x: Val, n: number, alpha = 2 / (n + 1)) {
  if (x == null) return null;
  if (st.v == null) {
    (st.seed ||= []).push(x);
    if (st.seed.length < n) return null;
    st.v = avg(st.seed);
    return st.v;
  }
  st.v = alpha * x + (1 - alpha) * st.v;
  return st.v;
}
const rmaStep = (st: St, x: Val, n: number) => emaStep(st, x, n, 1 / n);
function wmaStep(st: St, x: Val, n: number) {
  const w = win(st, x, n);
  if (!w) return null;
  let s = 0;
  w.forEach((v: number, i: number) => (s += v * (i + 1)));
  return s / ((n * (n + 1)) / 2);
}
function stdevStep(st: St, x: Val, n: number) {
  const w = win(st, x, n);
  if (!w) return null;
  const m = avg(w);
  return Math.sqrt(avg(w.map((v: number) => (v - m) ** 2)));
}
const highestStep = (st: St, x: Val, n: number) => { const w = win(st, x, n); return w ? Math.max(...w) : null; };
const lowestStep = (st: St, x: Val, n: number) => { const w = win(st, x, n); return w ? Math.min(...w) : null; };

class Interp {
  frames = new Map<string, Frame>();
  global: Frame = new Map();
  persistent = new Map<Frame, Set<string>>();
  states = new Map<string, St>();
  callHist = new Map<string, Val[]>();
  callPath: string[] = [];
  stack: Frame[] = [];
  i = 0;
  steps = 0;
  inputIndex = 0;
  currentLine = 0;

  result: PineResult = {
    title: 'Custom Indicator', overlay: false, plots: [], hlines: [], fills: [],
    markers: [], inputs: [], warnings: [],
  };
  plotById = new Map<number, PinePlot>();
  hlineById = new Map<number, number>();
  fnDefs = new Map<string, { params: string[]; body: Stmt[] }>();
  warned = new Set<string>();
  userInputs: Record<string, number | boolean | string>;

  constructor(private bars: PineBar[], userInputs: Record<string, number | boolean | string>) {
    this.userInputs = userInputs;
    this.stack = [this.global];
    this.persistent.set(this.global, new Set());
  }

  // ---- helpers ----
  get frame() { return this.stack[this.stack.length - 1]; }
  err(msg: string, line = this.currentLine): never { throw new PineError(msg, line); }
  warn(msg: string) {
    if (!this.warned.has(msg)) { this.warned.add(msg); this.result.warnings.push(msg); }
  }
  tick(line: number) {
    if (++this.steps > MAX_STEPS) this.err('Script is too slow (infinite loop?)', line);
  }
  stateFor(node: { id: number }): St {
    const key = this.callPath.join('>') + '|' + node.id;
    let st = this.states.get(key);
    if (!st) { st = {}; this.states.set(key, st); }
    return st;
  }

  run(stmts: Stmt[]) {
    // hoist function definitions
    const hoist = (list: Stmt[]) => list.forEach((s) => { if (s.k === 'fn') this.fnDefs.set(s.name, s); });
    hoist(stmts);

    for (this.i = 0; this.i < this.bars.length; this.i++) {
      // carry `var` variables forward
      for (const [frame, names] of this.persistent) {
        names.forEach((n) => {
          const h = frame.get(n)!;
          if (this.i > 0 && h[this.i] === undefined) h[this.i] = h[this.i - 1];
        });
      }
      this.execBlock(stmts);
    }
  }

  // ---- statements ----
  execBlock(stmts: Stmt[]): Val {
    let last: Val = null;
    for (const s of stmts) last = this.exec(s);
    return last;
  }

  setVar(name: string, value: Val, frame = this.frame) {
    let h = frame.get(name);
    if (!h) { h = []; frame.set(name, h); }
    h[this.i] = value;
  }

  findFrame(name: string): Frame | undefined {
    if (this.frame.has(name)) return this.frame;
    if (this.global.has(name)) return this.global;
    return undefined;
  }

  exec(s: Stmt): Val {
    switch (s.k) {
      case 'expr': this.currentLine = s.line; return this.eval(s.e);
      case 'decl': {
        this.currentLine = s.line;
        const frame = this.frame;
        if (s.persistent) {
          const names = this.persistent.get(frame) ?? new Set<string>();
          this.persistent.set(frame, names);
          const first = !names.has(s.name);
          names.add(s.name);
          // initialise once; later bars are carried forward at the start of each bar
          if (first) this.setVar(s.name, this.eval(s.init));
          return null;
        }
        this.setVar(s.name, this.eval(s.init));
        return null;
      }
      case 'assign': {
        this.currentLine = s.line;
        const frame = this.findFrame(s.name) ?? this.err(`Undeclared variable '${s.name}'`, s.line);
        let v = this.eval(s.e);
        if (s.op !== ':=') {
          const cur = frame.get(s.name)![this.i] ?? frame.get(s.name)![this.i - 1] ?? null;
          v = this.binop(s.op[0], cur, v);
        }
        this.setVar(s.name, v, frame);
        return null;
      }
      case 'tuple': {
        this.currentLine = s.line;
        const v = this.eval(s.e);
        if (!Array.isArray(v)) this.err('Expected a tuple on the right-hand side', s.line);
        s.names.forEach((n, k) => this.setVar(n, v[k] ?? null));
        return null;
      }
      case 'if': {
        this.currentLine = s.line;
        if (this.truthy(this.eval(s.cond))) return this.execBlock(s.then);
        return s.else ? this.execBlock(s.else) : null;
      }
      case 'for': {
        this.currentLine = s.line;
        const from = this.eval(s.from), to = this.eval(s.to);
        const by = s.by ? this.eval(s.by) : from <= to ? 1 : -1;
        if (!isNum(from) || !isNum(to) || !isNum(by) || by === 0) this.err('Invalid for-loop bounds', s.line);
        let last: Val = null;
        for (let k = from; by > 0 ? k <= to : k >= to; k += by) {
          this.tick(s.line);
          this.setVar(s.v, k);
          try { last = this.execBlock(s.body); } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return last;
      }
      case 'while': {
        this.currentLine = s.line;
        let last: Val = null;
        while (this.truthy(this.eval(s.cond))) {
          this.tick(s.line);
          try { last = this.execBlock(s.body); } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return last;
      }
      case 'break': throw new BreakSignal();
      case 'continue': throw new ContinueSignal();
      case 'fn': this.fnDefs.set(s.name, s); return null;
    }
  }

  truthy(v: Val): boolean { return v === true || (isNum(v) && v !== 0); }

  // ---- expressions ----
  binop(op: string, a: Val, b: Val): Val {
    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return String(a ?? 'na') + String(b ?? 'na');
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
    if (a == null || b == null) return ['<', '>', '<=', '>='].includes(op) ? false : null;
    a = typeof a === 'boolean' ? +a : a;
    b = typeof b === 'boolean' ? +b : b;
    switch (op) {
      case '+': return fin(a + b);
      case '-': return fin(a - b);
      case '*': return fin(a * b);
      case '/': return fin(a / b);
      case '%': return fin(a % b);
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
    }
    return this.err(`Unknown operator ${op}`);
  }

  eval(e: Expr): Val {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'bool': return e.v;
      case 'color': return e.v.length === 9 ? toRGBA(e.v, 0) : e.v;
      case 'arr': return e.items.map((x) => this.eval(x));
      case 'ifx': return this.exec(e.stmt);
      case 'tern': return this.truthy(this.eval(e.c)) ? this.eval(e.a) : this.eval(e.b);
      case 'un': {
        const v = this.eval(e.e);
        if (e.op === 'not') return !this.truthy(v);
        if (v == null) return null;
        return e.op === '-' ? -v : +v;
      }
      case 'bin': {
        if (e.op === 'and') return this.truthy(this.eval(e.l)) && this.truthy(this.eval(e.r));
        if (e.op === 'or') return this.truthy(this.eval(e.l)) || this.truthy(this.eval(e.r));
        return this.binop(e.op, this.eval(e.l), this.eval(e.r));
      }
      case 'index': return this.evalIndex(e);
      case 'name': return this.evalName(e.name, 0, e.line);
      case 'call': return this.evalCall(e);
    }
  }

  evalIndex(e: Extract<Expr, { k: 'index' }>): Val {
    const off = this.eval(e.idx);
    if (!isNum(off)) return null;
    const o = e.obj;
    if (o.k === 'name') return this.evalName(o.name, off, o.line);
    if (o.k === 'call') {
      const key = this.callPath.join('>') + '|' + o.id;
      const cur = this.evalCall(o);
      if (off === 0) return cur;
      const h = this.callHist.get(key);
      return h?.[this.i - off] ?? null;
    }
    return this.err('History [] is only supported on variables and function calls', e.line);
  }

  series(name: string, off: number): Val {
    const j = this.i - off;
    if (j < 0 || j >= this.bars.length) return null;
    const b = this.bars[j];
    switch (name) {
      case 'open': return b.open;
      case 'high': return b.high;
      case 'low': return b.low;
      case 'close': return b.close;
      case 'volume': return b.volume;
      case 'hl2': return (b.high + b.low) / 2;
      case 'hlc3': return (b.high + b.low + b.close) / 3;
      case 'ohlc4': return (b.open + b.high + b.low + b.close) / 4;
      case 'hlcc4': return (b.high + b.low + 2 * b.close) / 4;
      case 'time': return b.time;
      case 'bar_index': return j;
      case 'last_bar_index': return this.bars.length - 1;
      case 'tr': return this.trueRange(j);
    }
    if (['hour', 'minute', 'dayofweek', 'dayofmonth', 'month', 'year'].includes(name)) {
      const p: Record<string, string> = {};
      nyParts.formatToParts(new Date(b.time)).forEach((x) => (p[x.type] = x.value));
      switch (name) {
        case 'hour': return +p.hour % 24;
        case 'minute': return +p.minute;
        case 'dayofweek': return WEEKDAYS[p.weekday];
        case 'dayofmonth': return +p.day;
        case 'month': return +p.month;
        default: return +p.year;
      }
    }
    return undefined;
  }

  trueRange(j: number): number {
    const b = this.bars[j];
    if (j === 0) return b.high - b.low;
    const pc = this.bars[j - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }

  evalName(name: string, off: number, line: number): Val {
    const frame = this.findFrame(name);
    if (frame) {
      const j = this.i - off;
      if (j < 0) return null;
      return frame.get(name)![j] ?? null;
    }
    const s = this.series(name, off);
    if (s !== undefined) return s;
    if (name === 'na') return null;
    if (name.startsWith('color.')) {
      const c = COLORS[name.slice(6)];
      if (c) return c;
    }
    if (name === 'math.pi') return Math.PI;
    if (name === 'math.e') return Math.E;
    if (name === 'barstate.islast') return this.i === this.bars.length - 1;
    if (name === 'barstate.isfirst') return this.i === 0;
    if (name === 'barstate.isconfirmed' || name === 'barstate.ishistory') return true;
    if (name === 'barstate.isrealtime' || name === 'barstate.isnew') return false;
    if (name === 'syminfo.tickerid' || name === 'syminfo.ticker') return 'SYMBOL';
    if (name === 'timeframe.period') return 'chart';
    if (name === 'timeframe.isintraday') return true;
    if (name === 'ta.tr') return this.trueRange(this.i);
    if (name === 'ta.vwap' || name === 'vwap') return this.vwap(this.stateFor({ id: -1 }), this.series('hlc3', 0));
    if (name === 'ta.obv' || name === 'obv') return this.obv(this.stateFor({ id: -2 }));
    if (name.startsWith('ta.') && this.series(name.slice(3), off) !== undefined) return this.series(name.slice(3), off);
    const ns = name.split('.')[0];
    if (name.includes('.') && NAMESPACES_AS_STRING.has(ns)) return name;
    return this.err(`Undeclared identifier '${name}'`, line);
  }

  vwap(st: St, src: number): number | null {
    const b = this.bars[this.i];
    const day = new Date(b.time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (st.day !== day) { st.day = day; st.pv = 0; st.v = 0; }
    st.pv += src * b.volume;
    st.v += b.volume;
    return st.v > 0 ? st.pv / st.v : src;
  }

  obv(st: St): number {
    const j = this.i;
    const dir = j === 0 ? 0 : Math.sign(this.bars[j].close - this.bars[j - 1].close);
    st.v = (st.v ?? 0) + dir * this.bars[j].volume;
    return st.v;
  }

  // ---- calls ----
  evalCall(e: Extract<Expr, { k: 'call' }>): Val {
    this.currentLine = e.line;
    this.tick(e.line);
    let name = e.name;

    const key = this.callPath.join('>') + '|' + e.id;
    const record = (v: Val) => {
      let h = this.callHist.get(key);
      if (!h) { h = []; this.callHist.set(key, h); }
      h[this.i] = v;
      return v;
    };

    // user-defined functions
    const user = this.fnDefs.get(name);
    if (user) {
      const frameKey = key;
      let frame = this.frames.get(frameKey);
      if (!frame) { frame = new Map(); this.frames.set(frameKey, frame); this.persistent.set(frame, new Set()); }
      const vals = e.args.map((a) => this.eval(a.value));
      this.callPath.push(String(e.id));
      this.stack.push(frame);
      user.params.forEach((p, k) => this.setVar(p, vals[k] ?? null));
      let out: Val;
      try { out = this.execBlock(user.body); } finally { this.stack.pop(); this.callPath.pop(); }
      return record(out);
    }

    if (IGNORED.has(name) || name.startsWith('strategy.') || name.startsWith('table.')) {
      this.warn(`${name}() is not supported and was ignored`);
      return null;
    }

    // v4-style names without namespace
    let def = LIB[name];
    if (!def && !name.includes('.')) {
      for (const ns of ['ta.', 'math.']) if (LIB[ns + name]) { name = ns + name; def = LIB[name]; break; }
    }
    if (!def && name === 'study') def = LIB.indicator;
    if (!def && name === 'input') def = LIB['input.auto'];
    if (!def) this.err(`Unsupported function: ${e.name}()`, e.line);

    // map args
    const args: Record<string, Val> = {};
    const raw: Val[] = [];
    e.args.forEach((a, k) => {
      const v = this.eval(a.value);
      raw.push(v);
      if (a.name) args[a.name] = v;
      else if (def.params[k]) args[def.params[k]] = v;
    });
    if (def.pre) def.pre(args, raw);
    const fn = def.fn;
    const result = fn(this, args, e, this.stateFor(e));
    return record(result);
  }

  // ---- output ----
  addPlot(e: { id: number }, a: Record<string, Val>, defaultStyle: PinePlot['style'] = 'line') {
    const pid = e.id + this.callPath.length * 1e6;
    let plot = this.plotById.get(pid);
    if (!plot) {
      const styleStr = String(a.style ?? 'plot.style_line');
      const style: PinePlot['style'] =
        styleStr.includes('histogram') || styleStr.includes('columns') ? 'histogram'
        : styleStr.includes('stepline') ? 'step'
        : styleStr.includes('circles') ? 'circles'
        : styleStr.includes('cross') ? 'cross'
        : defaultStyle;
      plot = {
        id: pid, title: a.title ? String(a.title) : `Plot ${this.result.plots.length + 1}`,
        color: typeof a.color === 'string' ? a.color : COLORS.blue,
        lineWidth: isNum(a.linewidth) ? Math.max(1, Math.min(4, Math.round(a.linewidth))) : 1,
        style, values: [], colors: [],
      };
      this.plotById.set(pid, plot);
      this.result.plots.push(plot);
    }
    const off = isNum(a.offset) ? a.offset : 0;
    const j = this.i + off;
    if (j >= 0 && j < this.bars.length) {
      plot.values[j] = isNum(a.series) ? a.series : null;
      plot.colors[j] = typeof a.color === 'string' ? a.color : undefined;
    }
    return { __plot: pid };
  }
}

// ---- standard library ----
interface LibDef {
  params: string[];
  pre?: (args: Record<string, Val>, raw: Val[]) => void;
  fn: (c: Interp, a: Record<string, Val>, node: { id: number }, st: St) => Val;
}
const LIB: Record<string, LibDef> = {};
const def = (name: string, params: string[], fn: LibDef['fn'], pre?: LibDef['pre']) => {
  LIB[name] = { params, fn, pre };
};

// math
const m1 = (n: string, f: (x: number) => number) =>
  def(`math.${n}`, ['x'], (_c, a) => (isNum(a.x) ? fin(f(a.x)) : null));
m1('abs', Math.abs); m1('sqrt', Math.sqrt); m1('log', Math.log); m1('log10', Math.log10);
m1('exp', Math.exp); m1('floor', Math.floor); m1('ceil', Math.ceil); m1('sign', Math.sign);
m1('sin', Math.sin); m1('cos', Math.cos); m1('tan', Math.tan); m1('asin', Math.asin);
m1('acos', Math.acos); m1('atan', Math.atan);
m1('todegrees', (x) => (x * 180) / Math.PI); m1('toradians', (x) => (x * Math.PI) / 180);
def('math.round', ['x', 'precision'], (_c, a) => {
  if (!isNum(a.x)) return null;
  const p = 10 ** (a.precision ?? 0);
  return Math.round(a.x * p) / p;
});
def('math.pow', ['base', 'exp'], (_c, a) => (isNum(a.base) && isNum(a.exp) ? fin(a.base ** a.exp) : null));
// variadic functions need the raw positional arguments
LIB['math.max'] = { params: [], pre: (a, r) => { a.r = r; }, fn: (_c, a) => (a.r.some((v: Val) => !isNum(v)) ? null : Math.max(...a.r)) };
LIB['math.min'] = { params: [], pre: (a, r) => { a.r = r; }, fn: (_c, a) => (a.r.some((v: Val) => !isNum(v)) ? null : Math.min(...a.r)) };
LIB['math.avg'] = { params: [], pre: (a, r) => { a.r = r; }, fn: (_c, a) => (a.r.some((v: Val) => !isNum(v)) ? null : avg(a.r)) };

// core
def('nz', ['x', 'replacement'], (_c, a) => (a.x == null || (typeof a.x === 'number' && !Number.isFinite(a.x)) ? (a.replacement ?? 0) : a.x));
def('na', ['x'], (_c, a) => a.x == null);
def('fixnan', ['x'], (_c, a, _n, st) => { if (a.x != null) st.v = a.x; return st.v ?? null; });
def('str.tostring', ['x'], (_c, a) => String(a.x));
def('str.format', ['f'], (_c, a) => String(a.f));
def('int', ['x'], (_c, a) => (isNum(a.x) ? Math.trunc(a.x) : null));
def('float', ['x'], (_c, a) => a.x ?? null);
def('bool', ['x'], (_c, a) => !!a.x);

// colours
def('color.new', ['color', 'transp'], (_c, a) => toRGBA(String(a.color), a.transp ?? 0));
def('color.rgb', ['r', 'g', 'b', 'transp'], (_c, a) => `rgba(${a.r}, ${a.g}, ${a.b}, ${(1 - (a.transp ?? 0) / 100).toFixed(3)})`);

// meta + inputs
def('indicator', ['title', 'shorttitle', 'overlay'], (c, a) => {
  if (c.i === 0) {
    if (a.title) c.result.title = String(a.title);
    c.result.overlay = !!a.overlay;
  }
  return null;
});

const inputDef = (type: PineInput['type']) => (c: Interp, a: Record<string, Val>, node: { id: number }) => {
  const id = node.id;
  let meta = c.result.inputs.find((x) => x.id === id);
  if (!meta) {
    const inferred = type;
    meta = {
      id, title: a.title ? String(a.title) : `Input ${c.result.inputs.length + 1}`, type: inferred,
      value: inferred === 'source' ? String(a.__srcName ?? 'close') : a.defval,
      defval: inferred === 'source' ? String(a.__srcName ?? 'close') : a.defval,
      min: a.minval, max: a.maxval, step: a.step, options: Array.isArray(a.options) ? a.options : undefined,
    };
    const override = c.userInputs[String(id)];
    if (override !== undefined) meta.value = override;
    c.result.inputs.push(meta);
  }
  if (type === 'source') {
    const v = c.series(String(meta.value), 0);
    return v === undefined ? c.series('close', 0) : v;
  }
  if (type === 'int') return isNum(meta.value) ? Math.round(meta.value as number) : meta.defval;
  if (type === 'float') return isNum(meta.value) ? meta.value : meta.defval;
  return meta.value;
};
(['int', 'float', 'bool', 'string', 'color'] as const).forEach((t) => {
  def(`input.${t}`, ['defval', 'title', 'minval', 'maxval', 'step', 'options'], inputDef(t));
});
def('input.source', ['defval', 'title'], inputDef('source'));
LIB['input.auto'] = {
  params: ['defval', 'title', 'type'],
  fn: (c, a, n) => {
    const t = typeof a.defval === 'boolean' ? 'bool' : typeof a.defval === 'string' ? 'string'
      : Number.isInteger(a.defval) ? 'int' : 'float';
    return inputDef(t)(c, a, n);
  },
};

// ta.* implementations
const num = (v: Val) => (isNum(v) ? v : null);
def('ta.sma', ['source', 'length'], (_c, a, _n, st) => smaStep(st, num(a.source), a.length));
def('ta.ema', ['source', 'length'], (_c, a, _n, st) => emaStep(st, num(a.source), a.length));
def('ta.rma', ['source', 'length'], (_c, a, _n, st) => rmaStep(st, num(a.source), a.length));
def('ta.wma', ['source', 'length'], (_c, a, _n, st) => wmaStep(st, num(a.source), a.length));
def('ta.hma', ['source', 'length'], (_c, a, _n, st) => {
  const n = a.length;
  const w1 = wmaStep(sub(st, 'a'), num(a.source), Math.max(1, Math.floor(n / 2)));
  const w2 = wmaStep(sub(st, 'b'), num(a.source), n);
  return wmaStep(sub(st, 'c'), w1 != null && w2 != null ? 2 * w1 - w2 : null, Math.max(1, Math.floor(Math.sqrt(n))));
});
def('ta.vwma', ['source', 'length'], (c, a, _n, st) => {
  const pv = smaStep(sub(st, 'pv'), isNum(a.source) ? a.source * c.series('volume', 0) : null, a.length);
  const v = smaStep(sub(st, 'v'), c.series('volume', 0), a.length);
  return pv != null && v ? pv / v : null;
});
def('ta.stdev', ['source', 'length'], (_c, a, _n, st) => stdevStep(st, num(a.source), a.length));
def('ta.highest', ['source', 'length'], (_c, a, _n, st) => highestStep(st, num(a.source), a.length), (a) => {
  if (a.length === undefined && isNum(a.source)) { a.length = a.source; a.source = undefined; a.__high = true; }
});
LIB['ta.highest'].fn = (c, a, _n, st) => highestStep(st, num(a.__high ? c.series('high', 0) : a.source), a.length);
def('ta.lowest', ['source', 'length'], () => null, (a) => {
  if (a.length === undefined && isNum(a.source)) { a.length = a.source; a.source = undefined; a.__low = true; }
});
LIB['ta.lowest'].fn = (c, a, _n, st) => lowestStep(st, num(a.__low ? c.series('low', 0) : a.source), a.length);
def('ta.sum', ['source', 'length'], (_c, a, _n, st) => { const w = win(st, num(a.source), a.length); return w ? w.reduce((x: number, y: number) => x + y, 0) : null; });
def('ta.cum', ['source'], (_c, a, _n, st) => { st.v = (st.v ?? 0) + (num(a.source) ?? 0); return st.v; });
def('ta.change', ['source', 'length'], (_c, a, _n, st) => {
  const n = a.length ?? 1;
  (st.buf ||= []).push(num(a.source));
  const prev = st.buf[st.buf.length - 1 - n];
  const cur = st.buf[st.buf.length - 1];
  return cur != null && prev != null ? cur - prev : null;
});
LIB['ta.mom'] = LIB['ta.change'];
def('ta.roc', ['source', 'length'], (_c, a, _n, st) => {
  (st.buf ||= []).push(num(a.source));
  const prev = st.buf[st.buf.length - 1 - a.length];
  const cur = st.buf[st.buf.length - 1];
  return cur != null && prev ? (100 * (cur - prev)) / prev : null;
});
def('ta.rsi', ['source', 'length'], (_c, a, _n, st) => {
  const x = num(a.source);
  if (x == null) return null;
  const prev = st.prev;
  st.prev = x;
  if (prev == null) return null;
  const ch = x - prev;
  const g = rmaStep(sub(st, 'g'), Math.max(ch, 0), a.length);
  const l = rmaStep(sub(st, 'l'), Math.max(-ch, 0), a.length);
  if (g == null || l == null) return null;
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
});
def('ta.macd', ['source', 'fastlen', 'slowlen', 'siglen'], (_c, a, _n, st) => {
  const x = num(a.source);
  const f = emaStep(sub(st, 'f'), x, a.fastlen ?? 12);
  const s = emaStep(sub(st, 's'), x, a.slowlen ?? 26);
  const m = f != null && s != null ? f - s : null;
  const g = emaStep(sub(st, 'g'), m, a.siglen ?? 9);
  return [m, g, m != null && g != null ? m - g : null];
});
def('ta.bb', ['series', 'length', 'mult'], (_c, a, _n, st) => {
  const basis = smaStep(sub(st, 'm'), num(a.series), a.length);
  const dev = stdevStep(sub(st, 'd'), num(a.series), a.length);
  if (basis == null || dev == null) return [null, null, null];
  return [basis, basis + (a.mult ?? 2) * dev, basis - (a.mult ?? 2) * dev];
});
def('ta.tr', ['handle_na'], (c) => c.trueRange(c.i));
def('ta.atr', ['length'], (c, a, _n, st) => rmaStep(st, c.trueRange(c.i), a.length));
def('ta.stoch', ['source', 'high', 'low', 'length'], (_c, a, _n, st) => {
  const hh = highestStep(sub(st, 'h'), num(a.high), a.length);
  const ll = lowestStep(sub(st, 'l'), num(a.low), a.length);
  if (hh == null || ll == null || !isNum(a.source)) return null;
  return hh === ll ? 0 : (100 * (a.source - ll)) / (hh - ll);
});
def('ta.wpr', ['length'], (c, a, _n, st) => {
  const hh = highestStep(sub(st, 'h'), c.series('high', 0), a.length);
  const ll = lowestStep(sub(st, 'l'), c.series('low', 0), a.length);
  if (hh == null || ll == null) return null;
  return hh === ll ? 0 : (-100 * (hh - c.series('close', 0))) / (hh - ll);
});
def('ta.cci', ['source', 'length'], (_c, a, _n, st) => {
  const w = win(st, num(a.source), a.length);
  if (!w) return null;
  const m = avg(w);
  const dev = avg(w.map((v: number) => Math.abs(v - m)));
  return dev === 0 ? 0 : (a.source - m) / (0.015 * dev);
});
def('ta.mfi', ['series', 'length'], (c, a, _n, st) => {
  const x = num(a.series);
  if (x == null) return null;
  const flow = x * c.series('volume', 0);
  const prev = st.prev;
  st.prev = x;
  if (prev == null) return null;
  const pos = smaStep(sub(st, 'p'), x > prev ? flow : 0, a.length);
  const neg = smaStep(sub(st, 'n'), x < prev ? flow : 0, a.length);
  if (pos == null || neg == null) return null;
  return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
});
def('ta.dmi', ['diLength', 'adxSmoothing'], (c, a, _n, st) => {
  const j = c.i;
  if (j === 0) return [null, null, null];
  const up = c.series('high', 0) - c.series('high', 1);
  const down = c.series('low', 1) - c.series('low', 0);
  const plusDM = up > down && up > 0 ? up : 0;
  const minusDM = down > up && down > 0 ? down : 0;
  const tr = rmaStep(sub(st, 't'), c.trueRange(j), a.diLength);
  const p = rmaStep(sub(st, 'p'), plusDM, a.diLength);
  const m = rmaStep(sub(st, 'm'), minusDM, a.diLength);
  if (tr == null || p == null || m == null || tr === 0) return [null, null, null];
  const plus = (100 * p) / tr, minus = (100 * m) / tr;
  const sum = plus + minus;
  const dx = (100 * Math.abs(plus - minus)) / (sum === 0 ? 1 : sum);
  return [plus, minus, rmaStep(sub(st, 'x'), dx, a.adxSmoothing ?? a.diLength)];
});
def('ta.supertrend', ['factor', 'atrPeriod'], (c, a, _n, st) => {
  const atr = rmaStep(sub(st, 'a'), c.trueRange(c.i), a.atrPeriod);
  const close = c.series('close', 0);
  if (atr == null) { st.pc = close; return [null, null]; }
  const src = c.series('hl2', 0);
  let up = src - a.factor * atr;
  let dn = src + a.factor * atr;
  const pUp = st.up ?? up, pDn = st.dn ?? dn, pc = st.pc ?? close;
  if (pc > pUp) up = Math.max(up, pUp);
  if (pc < pDn) dn = Math.min(dn, pDn);
  let dir = st.dir ?? 1;
  if (dir === -1 && close > pDn) dir = 1;
  else if (dir === 1 && close < pUp) dir = -1;
  st.up = up; st.dn = dn; st.dir = dir; st.pc = close;
  return [dir === 1 ? up : dn, dir === 1 ? -1 : 1];
});
def('ta.crossover', ['source1', 'source2'], (_c, a, _n, st) => {
  const r = isNum(a.source1) && isNum(a.source2) && isNum(st.a) && isNum(st.b) && a.source1 > a.source2 && st.a <= st.b;
  st.a = a.source1; st.b = a.source2;
  return r;
});
def('ta.crossunder', ['source1', 'source2'], (_c, a, _n, st) => {
  const r = isNum(a.source1) && isNum(a.source2) && isNum(st.a) && isNum(st.b) && a.source1 < a.source2 && st.a >= st.b;
  st.a = a.source1; st.b = a.source2;
  return r;
});
def('ta.cross', ['source1', 'source2'], (_c, a, _n, st) => {
  const r = isNum(a.source1) && isNum(a.source2) && isNum(st.a) && isNum(st.b) &&
    ((a.source1 > a.source2 && st.a <= st.b) || (a.source1 < a.source2 && st.a >= st.b));
  st.a = a.source1; st.b = a.source2;
  return r;
});
def('ta.barssince', ['condition'], (_c, a, _n, st) => {
  st.c = a.condition ? 0 : st.c == null ? null : st.c + 1;
  return st.c;
});
def('ta.valuewhen', ['condition', 'source', 'occurrence'], (_c, a, _n, st) => {
  const list = (st.list ||= []);
  if (a.condition) list.push(a.source);
  return list[list.length - 1 - (a.occurrence ?? 0)] ?? null;
});
const pivot = (isHigh: boolean) => (c: Interp, a: Record<string, Val>, _n: unknown, st: St) => {
  let { source, leftbars: left, rightbars: right } = a;
  if (right === undefined) { right = left; left = source; source = c.series(isHigh ? 'high' : 'low', 0); }
  (st.buf ||= []).push(num(source));
  const p = st.buf.length - 1 - right;
  if (p < left) return null;
  const v = st.buf[p];
  if (v == null) return null;
  for (let k = p - left; k <= p + right; k++) {
    if (k === p) continue;
    const o = st.buf[k];
    if (o == null) return null;
    if (isHigh ? o > v || (k > p && o === v) : o < v || (k > p && o === v)) return null;
  }
  return v;
};
def('ta.pivothigh', ['source', 'leftbars', 'rightbars'], pivot(true));
def('ta.pivotlow', ['source', 'leftbars', 'rightbars'], pivot(false));
def('ta.vwap', ['source'], (c, a, _n, st) => c.vwap(st, a.source ?? c.series('hlc3', 0)));

// output
def('plot', ['series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'offset'], (c, a, n) => c.addPlot(n, a));
def('hline', ['price', 'title', 'color', 'linestyle', 'linewidth'], (c, a, n) => {
  if (!c.hlineById.has(n.id) && isNum(a.price)) {
    c.hlineById.set(n.id, a.price);
    c.result.hlines.push({ price: a.price, color: typeof a.color === 'string' ? a.color : COLORS.gray, title: a.title ?? '' });
  }
  return { __hline: a.price };
});
def('fill', ['plot1', 'plot2', 'color', 'title'], (c, a, n) => {
  const ref = (h: Val) => (h && h.__plot !== undefined ? h.__plot : h && h.__hline !== undefined ? { hline: h.__hline } : null);
  const pa = ref(a.plot1), pb = ref(a.plot2);
  if (pa === null || pb === null) return c.err('fill() needs two plot() or hline() values', 0);
  let f = c.result.fills.find((x: any) => x.__id === n.id + c.callPath.length * 1e6) as any;
  if (!f) {
    f = { a: pa, b: pb, color: typeof a.color === 'string' ? a.color : 'rgba(41, 98, 255, 0.2)', colors: [], __id: n.id + c.callPath.length * 1e6 };
    c.result.fills.push(f);
  }
  f.colors[c.i] = typeof a.color === 'string' ? a.color : undefined;
  return null;
});
const marker = (c: Interp, a: Record<string, Val>, shape: PineMarker['shape'] | null) => {
  if (!a.series) return null;
  const loc = String(a.location ?? 'location.abovebar');
  const style = String(a.style ?? '');
  const s: PineMarker['shape'] = shape ?? (
    style.includes('down') ? 'arrowDown' : style.includes('up') ? 'arrowUp'
    : style.includes('square') ? 'square' : 'circle');
  const position = loc.includes('below') || loc.includes('bottom') ? 'belowBar' : loc.includes('absolute') ? 'inBar' : 'aboveBar';
  c.result.markers.push({
    time: c.series('time', 0), position, shape: s,
    color: typeof a.color === 'string' ? a.color : COLORS.blue, text: a.text ? String(a.text) : '',
  });
  return null;
};
def('plotshape', ['series', 'title', 'style', 'location', 'color', 'offset', 'text'], (c, a) => marker(c, a, null));
def('plotchar', ['series', 'title', 'char', 'location', 'color', 'offset', 'text'], (c, a) => marker(c, a, 'circle'));

export function runPine(
  source: string,
  bars: PineBar[],
  userInputs: Record<string, number | boolean | string> = {}
): PineResult {
  const program = parse(source);
  const interp = new Interp(bars, userInputs);
  // `input.source(close)` needs the *name* of its default argument
  const patchSources = (list: Stmt[]) => list.forEach((s) => {
    const visit = (e: Expr | undefined): void => {
      if (!e) return;
      if (e.k === 'call') {
        if (e.name === 'input.source' && e.args[0]?.value.k === 'name') {
          e.args.push({ name: '__srcName', value: { k: 'str', v: (e.args[0].value as any).name } });
        }
        e.args.forEach((a) => visit(a.value));
      } else if (e.k === 'bin') { visit(e.l); visit(e.r); }
      else if (e.k === 'tern') { visit(e.c); visit(e.a); visit(e.b); }
    };
    if (s.k === 'decl') visit(s.init);
    else if (s.k === 'expr') visit(s.e);
    else if (s.k === 'if') { patchSources(s.then); if (s.else) patchSources(s.else); }
  });
  patchSources(program);

  if (bars.length === 0) return interp.result;
  interp.run(program);

  const r = interp.result;
  // offsets can leave holes; normalise plot arrays to bar length
  r.plots.forEach((p) => {
    for (let k = 0; k < bars.length; k++) if (p.values[k] === undefined) p.values[k] = null;
  });
  return r;
}
