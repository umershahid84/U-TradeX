export interface PnLCardRow {
  label: string;
  value: string;
  /** Dollar amounts: left off the card when the user chooses to hide them */
  money?: boolean;
}

export interface PnLCardData {
  kind: 'trade' | 'day';
  headline: string;
  tag?: string;
  status: string;
  pnl: number;
  /** Return in percent; null when it can't be computed */
  pnlPct: number | null;
  rows: PnLCardRow[];
  dateLabel: string;
}

export const CARD_W = 1200;
export const CARD_H = 675;

const UP = '#26a69a';
const DOWN = '#ef5350';

const fmtMoney = (n: number) =>
  `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The "Rising Bars" mark, drawn to match the app logo */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / 100;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  const bar = (cx: number, wickTop: number, wickBot: number, bx: number, by: number, bh: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(cx, wickTop);
    ctx.lineTo(cx, wickBot);
    ctx.stroke();
    ctx.fillStyle = color;
    roundRect(ctx, bx, by, 16, bh, 3);
    ctx.fill();
  };
  bar(22, 44, 88, 14, 54, 24, '#26a69a');
  bar(50, 26, 82, 42, 38, 32, '#2fb8aa');
  bar(78, 8, 72, 70, 18, 42, '#FFB300');
  ctx.restore();
}

/** Draws a P&L card onto a new canvas (profit green, loss red) */
export function renderPnLCard(data: PnLCardData, opts: { showAmounts: boolean; theme: 'dark' | 'light' }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  const dark = opts.theme === 'dark';
  const win = data.pnl >= 0;
  const accent = win ? UP : DOWN;
  const text = dark ? '#f1f2fa' : '#161a33';
  const sub = dark ? '#8a8fb5' : '#5d6285';

  // background
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  if (dark) {
    bg.addColorStop(0, '#0a0e27');
    bg.addColorStop(1, win ? '#0d2a2a' : '#2a1218');
  } else {
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(1, win ? '#e6f6f3' : '#fdeaea');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // soft glow behind the result
  const glow = ctx.createRadialGradient(900, 260, 10, 900, 260, 420);
  glow.addColorStop(0, win ? 'rgba(38,166,154,0.28)' : 'rgba(239,83,80,0.28)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // accent bar
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 14, CARD_H);

  // brand
  drawLogo(ctx, 64, 44, 56);
  ctx.fillStyle = text;
  ctx.font = '700 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('U-Trade', 132, 74);
  const w1 = ctx.measureText('U-Trade').width;
  ctx.fillStyle = '#FFB300';
  ctx.fillText('X', 132 + w1, 74);
  ctx.fillStyle = sub;
  ctx.font = '500 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(data.dateLabel, CARD_W - 64, 74);
  ctx.textAlign = 'left';

  // headline + tag
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = text;
  ctx.font = '800 84px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(data.headline, 64, 190);
  let tagX = 64;
  if (data.tag) {
    ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const tw = ctx.measureText(data.tag).width + 36;
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    roundRect(ctx, tagX, 214, tw, 44, 22);
    ctx.fill();
    ctx.fillStyle = text;
    ctx.fillText(data.tag, tagX + 18, 245);
    tagX += tw + 14;
  }
  ctx.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const st = data.status.toUpperCase();
  const sw = ctx.measureText(st).width + 32;
  ctx.fillStyle = accent;
  roundRect(ctx, tagX, 214, sw, 44, 22);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(st, tagX + 16, 244);

  // the result
  // dollar amount, or just the percentage when amounts are hidden
  const big = opts.showAmounts || data.pnlPct === null ? fmtMoney(data.pnl) : fmtPct(data.pnlPct);
  ctx.fillStyle = accent;
  ctx.font = '800 150px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(big, 64, 410);
  if (opts.showAmounts && data.pnlPct !== null) {
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)';
    ctx.font = '700 44px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(fmtPct(data.pnlPct), 70, 468);
  }

  // detail rows
  const rows = data.rows.filter((r) => opts.showAmounts || !r.money);
  const cols = Math.min(4, Math.max(1, rows.length));
  const colW = (CARD_W - 128) / cols;
  rows.slice(0, 8).forEach((r, i) => {
    const cx = 64 + (i % cols) * colW;
    const cy = 530 + Math.floor(i / cols) * 66;
    ctx.fillStyle = sub;
    ctx.font = '600 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(r.label.toUpperCase(), cx, cy);
    ctx.fillStyle = text;
    ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(r.value, cx, cy + 32);
  });

  // footer
  ctx.fillStyle = sub;
  ctx.font = '500 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Paper trading · simulated results', CARD_W - 64, CARD_H - 24);
  ctx.textAlign = 'left';
  return canvas;
}
