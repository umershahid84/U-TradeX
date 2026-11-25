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

/** An on-chart table (table.new / table.cell): its final state after the last bar */
export interface PineTable {
  id: number;
  position: string;
  columns: number;
  rows: number;
  bgcolor?: string;
  borderColor?: string;
  cells: {
    col: number;
    row: number;
    text: string;
    textColor?: string;
    bgcolor?: string;
    size?: string;
    halign?: string;
    colspan: number;
    rowspan: number;
  }[];
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
  tables: PineTable[];
  /** The Pine version from //@version=N (5 when the script does not say) */
  version: number;
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
  // request.security: the script's own top-level definitions (so another timeframe can re-evaluate them), the
  // per-call-site results, and whether this interpreter is the helper that runs on the other timeframe's candles
  declSrc = new Map<string, Stmt>();
  secCache = new Map<string, { vals: Val[]; map: number[]; last: boolean[] }>();
  isSub = false;
  tableList = new Map<number, PineTable & { deleted?: boolean }>();
  nextTable = 1;
  stack: Frame[] = [];
  i = 0;
  steps = 0;
  inputIndex = 0;
  currentLine = 0;

  result: PineResult = {
    title: 'Custom Indicator', overlay: false, plots: [], hlines: [], fills: [],
    markers: [], inputs: [], warnings: [], tables: [], version: 5,
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
    // remember top-level definitions for request.security
    const collect = (list: Stmt[]) => list.forEach((s) => {
      if (s.k === 'decl') this.declSrc.set(s.name, s);
      else if (s.k === 'tuple') s.names.forEach((n) => this.declSrc.set(n, s));
      else if (s.k === 'seq') collect(s.body);
    });
    if (!this.isSub) collect(stmts);
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
        // v6 re-evaluates the end of the loop each time round (v4 and v5 evaluate it once)
        const bound = () => (this.result.version >= 6 ? this.eval(s.to) : to);
        for (let k = from; by > 0 ? k <= bound() : k >= bound(); k += by) {
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
      case 'forin': {
        this.currentLine = s.line;
        const list = this.eval(s.iter);
        if (!Array.isArray(list)) this.err('for ... in needs an array', s.line);
        let last: Val = null;
        // iterate over a copy of the length at the start, like Pine
        for (let k = 0; k < list.length; k++) {
          this.tick(s.line);
          this.setVar(s.v, list[k] ?? null);
          if (s.idx) this.setVar(s.idx, k);
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
      case 'seq': { let last: Val = null; for (const x of s.body) last = this.exec(x); return last; }
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
      case 'switch': {
        this.currentLine = e.line;
        const subject = e.subject ? this.eval(e.subject) : undefined;
        for (const c of e.cases) {
          // `=> default` has no condition; with a subject cases compare to it, without one they are true/false tests
          const hit = !c.cond || (e.subject ? this.eval(c.cond) === subject : this.truthy(this.eval(c.cond)));
          if (hit) return this.execBlock(c.body);
        }
        return null;
      }
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
    if (name === 'weekofyear') {
      const p: Record<string, string> = {};
      nyParts.formatToParts(new Date(b.time)).forEach((x) => (p[x.type] = x.value));
      return Math.floor((Date.UTC(+p.year, +p.month - 1, +p.day) - Date.UTC(+p.year, 0, 1)) / 604800000) + 1;
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

  /** Chart bar length in ms (the smallest typical gap between bars) */
  barMs(): number {
    if (this.bars.length < 2) return 60_000;
    const gaps = this.bars.slice(1, 200).map((b, k) => b.time - this.bars[k].time).filter((g) => g > 0).sort((x, y) => x - y);
    return gaps[Math.floor(gaps.length / 2)] ?? 60_000;
  }

  trueRange(j: number): number {
    const b = this.bars[j];
    if (j === 0) return b.high - b.low;
    const pc = this.bars[j - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }

  /** In a request.security helper: evaluate one of the script's own variables on this timeframe's candles */
  materialize(name: string) {
    const src = this.declSrc.get(name);
    if (!src || this.findFrame(name)?.get(name)?.[this.i] !== undefined) return;
    if (src.k === 'decl') this.setVar(name, this.eval(src.init), this.global);
    else if (src.k === 'tuple') {
      const v = this.eval(src.e);
      src.names.forEach((n, k) => this.setVar(n, Array.isArray(v) ? v[k] ?? null : null, this.global));
    }
  }

  evalName(name: string, off: number, line: number): Val {
    if (this.isSub && this.declSrc.has(name) && !this.global.has(name)) this.materialize(name);
    else if (this.isSub && off === 0 && this.declSrc.has(name) && this.global.get(name)?.[this.i] === undefined) this.materialize(name);
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
    if (name === 'syminfo.root') return 'SYMBOL';
    if (name === 'syminfo.type') return 'stock';
    if (name === 'syminfo.pointvalue') return 1;
    if (name === 'syminfo.mintick') return 0.01;
    if (name === 'timeframe.period') return 'chart';
    if (name === 'timeframe.isintraday') return this.barMs() < 20 * 3600 * 1000;
    if (name === 'timeframe.isdaily') return this.barMs() >= 20 * 3600 * 1000 && this.barMs() < 6 * 86400000;
    if (name === 'timeframe.isweekly') return this.barMs() >= 6 * 86400000 && this.barMs() < 27 * 86400000;
    if (name === 'timeframe.ismonthly') return this.barMs() >= 27 * 86400000;
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

    if (name === 'request.security') return record(this.security(e));

    // v5/v6 method syntax on arrays: arr.push(x) is array.push(arr, x)
    let args0 = e.args;
    const dot = name.indexOf('.');
    if (dot > 0 && !LIB[name]) {
      const head = name.slice(0, dot);
      const f = this.findFrame(head);
      if (f && Array.isArray(f.get(head)![this.i])) {
        name = 'array.' + name.slice(dot + 1);
        args0 = [{ value: { k: 'name', name: head, id: e.id, line: e.line } }, ...e.args];
      }
    }

    // user-defined functions
    const user = this.fnDefs.get(name);
    if (user) {
      const frameKey = key;
      let frame = this.frames.get(frameKey);
      if (!frame) { frame = new Map(); this.frames.set(frameKey, frame); this.persistent.set(frame, new Set()); }
      const vals = args0.map((a) => this.eval(a.value));
      this.callPath.push(String(e.id));
      this.stack.push(frame);
      user.params.forEach((p, k) => this.setVar(p, vals[k] ?? null));
      let out: Val;
      try { out = this.execBlock(user.body); } finally { this.stack.pop(); this.callPath.pop(); }
      return record(out);
    }

    if (!LIB[name] && (IGNORED.has(name) || /^(strategy|table|label|line|box|linefill|polyline|chart)\./.test(name))) {
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
    args0.forEach((a, k) => {
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

  // ---- request.security ----
  /** Candles of another timeframe built from the chart's own candles (only timeframes longer than the chart's) */
  private higherBars(tf: string): { bars: PineBar[]; map: number[]; last: boolean[] } | null {
    const t = tf.trim().toUpperCase();
    const m = /^(\d*)(S|D|W|M)?$/.exec(t);
    if (!m) return null;
    const n = m[1] ? +m[1] : 1;
    const unit = m[2] ?? (m[1] ? 'MIN' : '');
    if (!unit) return null;
    const key = (time: number): string => {
      if (unit === 'MIN' || unit === 'S') {
        const ms = n * (unit === 'S' ? 1000 : 60_000);
        return String(Math.floor(time / ms));
      }
      const d = new Date(time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      if (unit === 'D') return n === 1 ? d : String(Math.floor(Date.parse(d + 'T12:00:00Z') / 86400000 / n));
      if (unit === 'W') { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); }
      return d.slice(0, 7);
    };
    const bars: PineBar[] = [];
    const map: number[] = [];
    const last: boolean[] = [];
    let cur = '';
    this.bars.forEach((b, i) => {
      const k = key(b.time);
      if (k !== cur) {
        cur = k;
        bars.push({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
      } else {
        const h = bars[bars.length - 1];
        h.high = Math.max(h.high, b.high);
        h.low = Math.min(h.low, b.low);
        h.close = b.close;
        h.volume += b.volume;
      }
      map[i] = bars.length - 1;
    });
    this.bars.forEach((_b, i) => { last[i] = i === this.bars.length - 1 || map[i + 1] !== map[i]; });
    // not longer than the chart's own candles: nothing to build
    return bars.length < this.bars.length ? { bars, map, last } : null;
  }

  security(e: Extract<Expr, { k: 'call' }>): Val {
    const pos = e.args.filter((a) => !a.name).map((a) => a.value);
    const named = (n: string) => e.args.find((a) => a.name === n)?.value;
    const symExpr = named('symbol') ?? pos[0];
    const tfExpr = named('timeframe') ?? pos[1];
    const exprNode = named('expression') ?? pos[2];
    if (!symExpr || !tfExpr || !exprNode) return this.err('request.security(symbol, timeframe, expression) needs three arguments', e.line);
    const sym = String(this.eval(symExpr) ?? '');
    const tf = String(this.eval(tfExpr) ?? '');
    const lookahead = String(named('lookahead') ? this.eval(named('lookahead')!) : 'barmerge.lookahead_off').includes('on');
    const nas = (): Val => (exprNode.k === 'arr' ? exprNode.items.map(() => null) : null);

    const own = sym === '' || sym === 'SYMBOL' || sym === 'syminfo.tickerid';
    if (!own) {
      this.warn(`request.security() for another symbol (${sym}) is not available here, so it returns na`);
      return nas();
    }
    if (tf === 'chart' || tf === '') return this.eval(exprNode);

    const key = this.callPath.join('>') + '|' + e.id;
    let res = this.secCache.get(key);
    if (!res) {
      const hb = this.higherBars(tf);
      if (!hb) {
        this.warn(`request.security() timeframe "${tf}" is not longer than the chart's, so the chart's own candles were used`);
        return this.eval(exprNode);
      }
      // run the expression over every candle of that timeframe once, with the script's own definitions available
      const sub = new Interp(hb.bars, this.userInputs);
      sub.isSub = true;
      sub.declSrc = this.declSrc;
      sub.fnDefs = this.fnDefs;
      sub.result.version = this.result.version;
      const vals: Val[] = [];
      for (sub.i = 0; sub.i < hb.bars.length; sub.i++) vals.push(sub.eval(exprNode));
      res = { vals, map: hb.map, last: hb.last };
      this.secCache.set(key, res);
      if (hb.bars.length < 30) this.warn(`request.security(${tf}) only had ${hb.bars.length} candles of that timeframe to work with: load a longer range for reliable values`);
    }
    // without lookahead a higher-timeframe candle's value appears when it closes; with it, as the candle forms
    const idx = res.map[this.i];
    const k = lookahead || res.last[this.i] ? idx : idx - 1;
    return k >= 0 ? res.vals[k] ?? nas() : nas();
  }

  // ---- output ----
  addPlot(e: { id: number }, a: Record<string, Val>, defaultStyle: PinePlot['style'] = 'line') {
    const pid = e.id + this.callPath.length * 1e6;
    // display=display.status_line / data_window / none: not drawn on the chart (only display.pane or display.all are)
    const disp = a.display == null ? '' : String(a.display);
    if (disp && !disp.includes('pane') && !disp.includes('all')) return { __plot: pid };
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
def('str.tostring', ['x', 'format'], (_c, a) => {
  if (a.x == null) return 'NaN';
  if (!isNum(a.x)) return String(a.x);
  const f = String(a.format ?? '');
  if (!f) return String(a.x);
  if (f === 'format.mintick' || f === 'mintick') return a.x.toFixed(2);
  const m = /^[#0,]*(?:\.([#0]+))?$/.exec(f);
  if (!m) return String(a.x);
  const dec = m[1] ? m[1].length : 0;
  const out = a.x.toFixed(dec);
  // '#' decimals are optional, '0' decimals are kept
  return m[1] && !m[1].includes('0') ? String(+out) : out;
});
def('str.format', ['f'], (_c, a) => String(a.f));
def('str.length', ['s'], (_c, a) => String(a.s ?? '').length);
def('str.lower', ['s'], (_c, a) => String(a.s ?? '').toLowerCase());
def('str.upper', ['s'], (_c, a) => String(a.s ?? '').toUpperCase());
def('str.contains', ['s', 'sub'], (_c, a) => String(a.s ?? '').includes(String(a.sub ?? '')));
def('str.startswith', ['s', 'sub'], (_c, a) => String(a.s ?? '').startsWith(String(a.sub ?? '')));
def('str.endswith', ['s', 'sub'], (_c, a) => String(a.s ?? '').endsWith(String(a.sub ?? '')));
def('str.substring', ['s', 'from', 'to'], (_c, a) => String(a.s ?? '').substring(a.from ?? 0, a.to ?? undefined));
def('str.pos', ['s', 'sub'], (_c, a) => { const k = String(a.s ?? '').indexOf(String(a.sub ?? '')); return k < 0 ? null : k; });
def('str.replace_all', ['s', 'target', 'replacement'], (_c, a) => String(a.s ?? '').split(String(a.target ?? '')).join(String(a.replacement ?? '')));
def('str.tonumber', ['s'], (_c, a) => { const n = Number(a.s); return Number.isFinite(n) ? n : null; });
// calendar parts of a time in a time zone (America/New_York unless one is given)
const zoneParts = (ms: number, tz: string | undefined) => {
  let fmt = nyParts;
  if (typeof tz === 'string' && tz !== 'America/New_York') {
    try { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', hour12: false }); } catch { /* unknown zone: New York */ }
  }
  const p: Record<string, string> = {};
  fmt.formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
  return p;
};
for (const part of ['hour', 'minute', 'second', 'dayofweek', 'dayofmonth', 'month', 'year', 'weekofyear']) {
  def(part, ['time', 'timezone'], (c, a) => {
    const t = isNum(a.time) ? a.time : c.series('time', 0);
    const p = zoneParts(t, a.timezone);
    if (part === 'hour') return +p.hour % 24;
    if (part === 'minute') return +p.minute;
    if (part === 'second') return +(p.second ?? 0);
    if (part === 'dayofweek') return WEEKDAYS[p.weekday];
    if (part === 'dayofmonth') return +p.day;
    if (part === 'month') return +p.month;
    if (part === 'year') return +p.year;
    const d = Date.UTC(+p.year, +p.month - 1, +p.day);
    return Math.floor((d - Date.UTC(+p.year, 0, 1)) / 604800000) + 1;
  });
}
def('timeframe.in_seconds', ['timeframe'], (c) => Math.round(c.barMs() / 1000));
def('timeframe.from_seconds', ['seconds'], (_c, a) => String(a.seconds));
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
// timeframes, symbols, sessions and times are plain text settings here
for (const t of ['timeframe', 'symbol', 'session']) def(`input.${t}`, ['defval', 'title', 'options'], inputDef('string'));
def('input.time', ['defval', 'title'], inputDef('float'));
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
def('ta.correlation', ['source1', 'source2', 'length'], (_c, a, _n, st) => {
  const n = a.length;
  (st.x ||= []).push(num(a.source1));
  (st.y ||= []).push(num(a.source2));
  if (st.x.length > n) { st.x.shift(); st.y.shift(); }
  if (st.x.length < n || st.x.some((v: any) => v === null) || st.y.some((v: any) => v === null)) return null;
  const mx = avg(st.x), my = avg(st.y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { const dx = st.x[k] - mx, dy = st.y[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
});
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

// ---- arrays (v5 / v6) ----
const MAX_ARRAY = 100_000;
const arr = (c: Interp, v: Val, fn: string): Val[] => (Array.isArray(v) ? v : c.err(`${fn}() needs an array`));
const at = (a: Val[], i: Val, c: Interp, fn: string) => {
  if (!isNum(i)) return c.err(`${fn}(): the index must be a number`);
  const k = i < 0 ? a.length + i : i;
  if (k < 0 || k >= a.length) return c.err(`${fn}(): index ${i} is out of bounds (size ${a.length})`);
  return k;
};
const nums = (a: Val[]) => a.filter(isNum);
for (const t of ['float', 'int', 'bool', 'string', 'color', 'box', 'label', 'line', 'table', 'linefill']) {
  def(`array.new_${t}`, ['size', 'initial_value'], (c, a) => {
    const n = isNum(a.size) ? Math.floor(a.size) : 0;
    if (n < 0 || n > MAX_ARRAY) return c.err(`array.new_${t}(): the size must be between 0 and ${MAX_ARRAY}`);
    return Array.from({ length: n }, () => a.initial_value ?? null);
  });
}
LIB['array.from'] = { params: [], pre: (a, r) => { a.r = r; }, fn: (_c, a) => [...a.r] };
def('array.size', ['id'], (c, a) => arr(c, a.id, 'array.size').length);
def('array.push', ['id', 'value'], (c, a) => {
  const x = arr(c, a.id, 'array.push');
  if (x.length >= MAX_ARRAY) return c.err(`array.push(): arrays are limited to ${MAX_ARRAY} elements`);
  x.push(a.value ?? null);
  return null;
});
def('array.unshift', ['id', 'value'], (c, a) => { arr(c, a.id, 'array.unshift').unshift(a.value ?? null); return null; });
def('array.pop', ['id'], (c, a) => arr(c, a.id, 'array.pop').pop() ?? null);
def('array.shift', ['id'], (c, a) => arr(c, a.id, 'array.shift').shift() ?? null);
def('array.get', ['id', 'index'], (c, a) => { const x = arr(c, a.id, 'array.get'); return x[at(x, a.index, c, 'array.get')] ?? null; });
def('array.set', ['id', 'index', 'value'], (c, a) => { const x = arr(c, a.id, 'array.set'); x[at(x, a.index, c, 'array.set')] = a.value ?? null; return null; });
def('array.insert', ['id', 'index', 'value'], (c, a) => {
  const x = arr(c, a.id, 'array.insert');
  const k = isNum(a.index) ? (a.index < 0 ? x.length + a.index : a.index) : -1;
  if (k < 0 || k > x.length) return c.err(`array.insert(): index ${a.index} is out of bounds`);
  x.splice(k, 0, a.value ?? null);
  return null;
});
def('array.remove', ['id', 'index'], (c, a) => { const x = arr(c, a.id, 'array.remove'); return x.splice(at(x, a.index, c, 'array.remove'), 1)[0] ?? null; });
def('array.clear', ['id'], (c, a) => { arr(c, a.id, 'array.clear').length = 0; return null; });
def('array.first', ['id'], (c, a) => { const x = arr(c, a.id, 'array.first'); return x.length ? x[0] : c.err('array.first(): the array is empty'); });
def('array.last', ['id'], (c, a) => { const x = arr(c, a.id, 'array.last'); return x.length ? x[x.length - 1] : c.err('array.last(): the array is empty'); });
def('array.includes', ['id', 'value'], (c, a) => arr(c, a.id, 'array.includes').includes(a.value));
def('array.indexof', ['id', 'value'], (c, a) => arr(c, a.id, 'array.indexof').indexOf(a.value));
def('array.lastindexof', ['id', 'value'], (c, a) => arr(c, a.id, 'array.lastindexof').lastIndexOf(a.value));
def('array.sum', ['id'], (c, a) => nums(arr(c, a.id, 'array.sum')).reduce((x, y) => x + y, 0));
def('array.avg', ['id'], (c, a) => { const n = nums(arr(c, a.id, 'array.avg')); return n.length ? avg(n) : null; });
def('array.min', ['id', 'nth'], (c, a) => { const n = nums(arr(c, a.id, 'array.min')).sort((x, y) => x - y); return n[isNum(a.nth) ? a.nth : 0] ?? null; });
def('array.max', ['id', 'nth'], (c, a) => { const n = nums(arr(c, a.id, 'array.max')).sort((x, y) => y - x); return n[isNum(a.nth) ? a.nth : 0] ?? null; });
def('array.median', ['id'], (c, a) => {
  const n = nums(arr(c, a.id, 'array.median')).sort((x, y) => x - y);
  if (!n.length) return null;
  const m = Math.floor(n.length / 2);
  return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
});
def('array.variance', ['id', 'biased'], (c, a) => {
  const n = nums(arr(c, a.id, 'array.variance'));
  const biased = a.biased !== false;
  if (n.length < (biased ? 1 : 2)) return null;
  const m = avg(n);
  return n.reduce((s, v) => s + (v - m) ** 2, 0) / (biased ? n.length : n.length - 1);
});
def('array.stdev', ['id', 'biased'], (c, a) => {
  const n = nums(arr(c, a.id, 'array.stdev'));
  const biased = a.biased !== false;
  if (n.length < (biased ? 1 : 2)) return null;
  const m = avg(n);
  return Math.sqrt(n.reduce((s, v) => s + (v - m) ** 2, 0) / (biased ? n.length : n.length - 1));
});
def('array.range', ['id'], (c, a) => { const n = nums(arr(c, a.id, 'array.range')); return n.length ? Math.max(...n) - Math.min(...n) : null; });
def('array.sort', ['id', 'order'], (c, a) => {
  const x = arr(c, a.id, 'array.sort');
  const desc = String(a.order ?? '').includes('desc');
  x.sort((p: Val, q: Val) => (isNum(p) && isNum(q) ? (desc ? q - p : p - q) : String(p).localeCompare(String(q)) * (desc ? -1 : 1)));
  return null;
});
def('array.reverse', ['id'], (c, a) => { arr(c, a.id, 'array.reverse').reverse(); return null; });
def('array.copy', ['id'], (c, a) => [...arr(c, a.id, 'array.copy')]);
def('array.slice', ['id', 'index_from', 'index_to'], (c, a) => arr(c, a.id, 'array.slice').slice(a.index_from ?? 0, a.index_to ?? undefined));
def('array.concat', ['id1', 'id2'], (c, a) => { arr(c, a.id1, 'array.concat').push(...arr(c, a.id2, 'array.concat')); return a.id1; });
def('array.fill', ['id', 'value', 'index_from', 'index_to'], (c, a) => { arr(c, a.id, 'array.fill').fill(a.value ?? null, a.index_from ?? 0, a.index_to ?? undefined); return null; });
def('array.join', ['id', 'separator'], (c, a) => arr(c, a.id, 'array.join').map((v: Val) => String(v ?? 'na')).join(a.separator ?? ','));

// ---- tables ----
const tableOf = (c: Interp, h: Val, fn: string) => {
  const t = h && typeof h === 'object' && typeof h.__table === 'number' ? c.tableList.get(h.__table) : undefined;
  if (!t) return c.err(`${fn}(): not a table (or it was deleted)`);
  return t;
};
def('table.new', ['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width'], (c, a) => {
  const id = c.nextTable++;
  c.tableList.set(id, {
    id, position: String(a.position ?? 'position.top_right'),
    columns: Math.max(1, Math.min(50, Math.floor(isNum(a.columns) ? a.columns : 1))),
    rows: Math.max(1, Math.min(100, Math.floor(isNum(a.rows) ? a.rows : 1))),
    bgcolor: typeof a.bgcolor === 'string' ? a.bgcolor : undefined,
    borderColor: typeof a.border_color === 'string' ? a.border_color : typeof a.frame_color === 'string' ? a.frame_color : undefined,
    cells: [],
  });
  return { __table: id };
});
def('table.delete', ['table_id'], (c, a) => { const t = a.table_id?.__table !== undefined ? c.tableList.get(a.table_id.__table) : undefined; if (t) (t as any).deleted = true; return null; });
def('table.clear', ['table_id', 'start_column', 'start_row', 'end_column', 'end_row'], (c, a) => {
  const t = tableOf(c, a.table_id, 'table.clear');
  const c0 = a.start_column ?? 0, r0 = a.start_row ?? 0, c1 = a.end_column ?? c0, r1 = a.end_row ?? r0;
  t.cells = t.cells.filter((x) => !(x.col >= c0 && x.col <= c1 && x.row >= r0 && x.row <= r1));
  return null;
});
def('table.cell', ['table_id', 'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip', 'text_font_family'], (c, a) => {
  const t = tableOf(c, a.table_id, 'table.cell');
  if (!isNum(a.column) || !isNum(a.row)) return c.err('table.cell(): the column and row must be numbers');
  if (a.column < 0 || a.column >= t.columns || a.row < 0 || a.row >= t.rows) return c.err(`table.cell(): cell (${a.column}, ${a.row}) is outside the ${t.columns} x ${t.rows} table`);
  let cell = t.cells.find((x) => x.col === a.column && x.row === a.row);
  if (!cell) { cell = { col: a.column, row: a.row, text: '', colspan: 1, rowspan: 1 }; t.cells.push(cell); }
  cell.text = a.text == null ? '' : String(a.text);
  if (typeof a.text_color === 'string') cell.textColor = a.text_color;
  if (typeof a.bgcolor === 'string') cell.bgcolor = a.bgcolor;
  if (a.text_size != null) cell.size = String(a.text_size);
  if (a.text_halign != null) cell.halign = String(a.text_halign);
  return null;
});
def('table.merge_cells', ['table_id', 'start_column', 'start_row', 'end_column', 'end_row'], (c, a) => {
  const t = tableOf(c, a.table_id, 'table.merge_cells');
  const cell = t.cells.find((x) => x.col === a.start_column && x.row === a.start_row);
  if (cell && isNum(a.end_column) && isNum(a.end_row)) {
    cell.colspan = Math.max(1, a.end_column - a.start_column + 1);
    cell.rowspan = Math.max(1, a.end_row - a.start_row + 1);
  }
  return null;
});
def('table.set_position', ['table_id', 'position'], (c, a) => { tableOf(c, a.table_id, 'table.set_position').position = String(a.position); return null; });
def('table.set_bgcolor', ['table_id', 'bgcolor'], (c, a) => { tableOf(c, a.table_id, 'table.set_bgcolor').bgcolor = String(a.bgcolor); return null; });
for (const [fn, prop] of [['cell_set_text', 'text'], ['cell_set_text_color', 'textColor'], ['cell_set_bgcolor', 'bgcolor']] as const) {
  def(`table.${fn}`, ['table_id', 'column', 'row', 'value'], (c, a) => {
    const t = tableOf(c, a.table_id, `table.${fn}`);
    const cell = t.cells.find((x) => x.col === a.column && x.row === a.row);
    if (cell) (cell as any)[prop] = prop === 'text' ? String(a.value ?? '') : String(a.value);
    return null;
  });
}

// request.security: only the chart's own symbol and timeframe are available here, so only that form is accepted
def('request.security', ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead'], (c, a) => {
  const tf = String(a.timeframe ?? '');
  if (tf === 'chart' || tf === '') return a.expression ?? null;
  return c.err("request.security() only works for the chart's own timeframe (timeframe.period) in this app");
});

export function runPine(
  source: string,
  bars: PineBar[],
  userInputs: Record<string, number | boolean | string> = {}
): PineResult {
  const program = parse(source);
  const interp = new Interp(bars, userInputs);
  // the version comment: 4, 5 and 6 are accepted
  const ver = /^\s*\/\/\s*@version\s*=\s*(\d+)/m.exec(source);
  if (ver) {
    interp.result.version = +ver[1];
    if (+ver[1] < 4 || +ver[1] > 6) interp.warn(`//@version=${ver[1]} is not a version this interpreter knows (4, 5 and 6 are supported); it was run as version 5`);
    if (+ver[1] < 4 || +ver[1] > 6) interp.result.version = 5;
  }
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
  // the tables still alive after the last bar (the latest few, in case a script never deletes the ones it recreates)
  r.tables = [...interp.tableList.values()].filter((t: any) => !t.deleted).slice(-6).map(({ deleted: _d, ...t }: any) => t);
  // offsets can leave holes; normalise plot arrays to bar length
  r.plots.forEach((p) => {
    for (let k = 0; k < bars.length; k++) if (p.values[k] === undefined) p.values[k] = null;
  });
  return r;
}
