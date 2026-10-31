// Tokenizer for a practical subset of Pine Script (v4/v5). Pine is indentation-sensitive,
// so this emits INDENT/DEDENT/NEWLINE tokens like a Python lexer.

export class PineError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

export type TokType = 'num' | 'str' | 'id' | 'op' | 'color' | 'nl' | 'indent' | 'dedent' | 'eof';

export interface Token {
  t: TokType;
  v: string;
  line: number;
}

// A line ending in one of these continues on the next line
const CONTINUATION = new Set([
  '+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '?', ':', ',', '=', ':=',
  '+=', '-=', '*=', '/=', '%=', '(', '[', 'and', 'or',
]);

const OPS = [':=', '==', '!=', '<=', '>=', '=>', '+=', '-=', '*=', '/=', '%='];

const stripComment = (line: string): string => {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
};

export function tokenize(src: string): Token[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const tokens: Token[] = [];
  const indents = [0];
  let depth = 0;

  const push = (t: TokType, v: string, line: number) => tokens.push({ t, v, line });
  const last = () => tokens[tokens.length - 1];

  lines.forEach((rawLine, li) => {
    const line = li + 1;
    const text = stripComment(rawLine);
    if (text.trim() === '') return;

    if (depth === 0) {
      const ws = /^[ \t]*/.exec(text)![0];
      const indent = [...ws].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0);
      const prev = last();
      const prevContinues = prev && prev.t !== 'nl' && prev.t !== 'indent' && prev.t !== 'dedent' &&
        (prev.t === 'op' || prev.v === 'and' || prev.v === 'or') && CONTINUATION.has(prev.v);

      if (prevContinues) {
        // continuation of the previous logical line
      } else if (indent > indents[indents.length - 1] && indent % 4 !== 0 && last()?.t === 'nl') {
        // Pine: a deeper, non-multiple-of-4 indent continues the previous line
        tokens.pop();
      } else {
        while (indent < indents[indents.length - 1]) {
          indents.pop();
          push('dedent', '', line);
        }
        if (indent > indents[indents.length - 1]) {
          indents.push(indent);
          push('indent', '', line);
        }
      }
    }

    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }

      const prev = last();
      const afterValue = prev && (prev.t === 'id' || prev.t === 'num' || prev.v === ')' || prev.v === ']');

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] ?? '') && !afterValue)) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i))!;
        push('num', m[0], line);
        i += m[0].length;
      } else if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))!;
        push('id', m[0], line);
        i += m[0].length;
      } else if (ch === '"' || ch === "'") {
        let j = i + 1;
        let s = '';
        while (j < text.length && text[j] !== ch) {
          if (text[j] === '\\' && j + 1 < text.length) j++;
          s += text[j++];
        }
        if (j >= text.length) throw new PineError('Unterminated string', line);
        push('str', s, line);
        i = j + 1;
      } else if (ch === '#') {
        const m = /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})/.exec(text.slice(i));
        if (!m) throw new PineError('Invalid colour literal', line);
        push('color', m[0], line);
        i += m[0].length;
      } else {
        const two = OPS.find((o) => text.startsWith(o, i));
        const op = two ?? ch;
        if (!two && !'+-*/%<>=()[],.?:{}'.includes(ch)) {
          throw new PineError(`Unexpected character '${ch}'`, line);
        }
        if (op === '(' || op === '[' || op === '{') depth++;
        if (op === ')' || op === ']' || op === '}') depth = Math.max(0, depth - 1);
        push('op', op, line);
        i += op.length;
      }
    }

    if (depth === 0) {
      const l = last();
      const continues = l && (l.t === 'op' || l.v === 'and' || l.v === 'or') && CONTINUATION.has(l.v) && l.v !== '=>';
      if (!continues) push('nl', '', line);
    }
  });

  if (last() && last().t !== 'nl') push('nl', '', lines.length);
  while (indents.length > 1) {
    indents.pop();
    push('dedent', '', lines.length);
  }
  push('eof', '', lines.length);
  return tokens;
}
