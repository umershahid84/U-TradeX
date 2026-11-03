import { ClosedTrade, Order, OptionContract, PaperTradingAccount, Position } from '../types';
import { PnLCardData } from './pnlCard';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const signed = (n: number) => `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}`;
const dateLabel = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const positionCard = (p: Position): PnLCardData => {
  const short = p.quantity < 0;
  const qty = Math.abs(p.quantity);
  return {
    kind: 'trade',
    headline: p.symbol,
    tag: `${short ? 'SHORT' : 'LONG'} ${qty}`,
    status: 'Open',
    pnl: p.pnl,
    pnlPct: p.pnlPercent,
    dateLabel: dateLabel(),
    rows: [
      { label: 'Avg price', value: money(p.avgPrice) },
      { label: 'Current price', value: money(p.currentPrice) },
      { label: 'Quantity', value: String(qty) },
      { label: 'Position value', value: money(qty * p.currentPrice), money: true },
    ],
  };
};

export const optionCard = (o: OptionContract): PnLCardData => {
  const cost = o.premium * o.quantity * 100;
  const value = (o.currentPremium ?? o.premium) * o.quantity * 100;
  return {
    kind: 'trade',
    headline: o.symbol,
    tag: `${o.type.toUpperCase()} $${o.strike} · ${o.expiry}`,
    status: 'Open',
    pnl: value - cost,
    pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : null,
    dateLabel: dateLabel(),
    rows: [
      { label: 'Avg price / share', value: money(o.premium) },
      { label: 'Current price / share', value: money(o.currentPremium ?? o.premium) },
      { label: 'Contracts', value: String(o.quantity) },
      { label: 'Cost', value: money(cost), money: true },
    ],
  };
};

/** Card for one fill: its locked-in result if it closed something, or its open result if it is still held */
export const orderCard = (o: Order, positions: Position[], allOrders: Order[]): PnLCardData | null => {
  if (o.status !== 'filled') return null;
  const optLabel = o.option ? `${o.option.type.toUpperCase()} $${o.option.strike} · ${o.option.expiry}` : undefined;

  if (o.realizedPnl !== undefined && o.entryPrice !== undefined) {
    const dir = o.option ? 1 : o.side === 'sell' ? 1 : -1; // closing a long is a sell, closing a short is a buy
    const pct = o.entryPrice > 0 ? ((o.price - o.entryPrice) / o.entryPrice) * 100 * dir : null;
    return {
      kind: 'trade',
      headline: o.symbol,
      tag: optLabel ?? `${dir === 1 ? 'LONG' : 'SHORT'} ${o.quantity}`,
      status: 'Closed',
      pnl: o.realizedPnl,
      pnlPct: pct,
      dateLabel: dateLabel(o.timestamp),
      rows: [
        { label: 'Avg price', value: money(o.entryPrice) },
        { label: 'Closed price', value: money(o.price) },
        { label: o.option ? 'Contracts' : 'Quantity', value: String(o.quantity) },
        { label: 'Closed', value: timeLabel(o.timestamp) },
        { label: 'Realized P&L', value: signed(o.realizedPnl), money: true },
      ],
    };
  }

  // an opening fill: show how it is doing if the position is still open (not once a later close has settled it)
  const at = allOrders.findIndex((x) => x.id === o.id);
  if (allOrders.some((x, i) => i > at && x.symbol === o.symbol && x.status === 'filled' && x.realizedPnl !== undefined)) return null;
  const pos = positions.find((p) => p.symbol === o.symbol);
  if (!pos) return null;
  const dir = o.side === 'buy' ? 1 : -1;
  if (Math.sign(pos.quantity) !== dir) return null;
  const pnl = (pos.currentPrice - o.price) * o.quantity * dir;
  return {
    kind: 'trade',
    headline: o.symbol,
    tag: `${dir === 1 ? 'LONG' : 'SHORT'} ${o.quantity}`,
    status: 'Open',
    pnl,
    pnlPct: o.price > 0 ? ((pos.currentPrice - o.price) / o.price) * 100 * dir : null,
    dateLabel: dateLabel(o.timestamp),
    rows: [
      { label: 'Avg price', value: money(o.price) },
      { label: 'Current price', value: money(pos.currentPrice) },
      { label: 'Quantity', value: String(o.quantity) },
      { label: 'Opened', value: timeLabel(o.timestamp) },
    ],
  };
};

const heldFor = (from: number, to: number) => {
  const mins = Math.max(0, Math.round((to - from) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

export const closedTradeCard = (t: ClosedTrade): PnLCardData => ({
  kind: 'trade',
  headline: t.symbol,
  tag: t.option ? `${t.option.type.toUpperCase()} $${t.option.strike} · ${t.option.expiry}` : `${t.side === 'long' ? 'LONG' : 'SHORT'} ${t.quantity}`,
  status: 'Closed',
  pnl: t.pnl,
  pnlPct: t.pnlPct,
  dateLabel: dateLabel(t.closedAt),
  rows: [
    { label: t.option ? 'Avg price / share' : 'Avg price', value: money(t.entryPrice) },
    { label: t.option ? 'Closed price / share' : 'Closed price', value: money(t.exitPrice) },
    { label: t.option ? 'Contracts' : 'Quantity', value: String(t.quantity) },
    t.openedAt ? { label: 'Held', value: heldFor(t.openedAt, t.closedAt) } : { label: 'Closed', value: timeLabel(t.closedAt) },
    { label: 'Realized P&L', value: signed(t.pnl), money: true },
  ],
});

/** Today's result: profit locked in by closed trades plus what open positions currently show */
export const dayCard = (account: PaperTradingAccount): PnLCardData => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const closed = account.closedTrades.filter((t) => t.closedAt >= start.getTime());
  const realized = closed.reduce((s, t) => s + t.pnl, 0);
  const open =
    account.positions.reduce((s, p) => s + p.pnl, 0) +
    account.options.reduce((s, o) => s + ((o.currentPremium ?? o.premium) - o.premium) * o.quantity * 100, 0);
  const net = realized + open;
  const wins = closed.filter((t) => t.pnl > 0).length;
  const best = closed.reduce<number | null>((m, t) => (m === null || t.pnl > m ? t.pnl : m), null);
  const worst = closed.reduce<number | null>((m, t) => (m === null || t.pnl < m ? t.pnl : m), null);
  const base = account.totalValue - net;
  return {
    kind: 'day',
    headline: 'Daily P&L',
    tag: `${closed.length} closed trade${closed.length === 1 ? '' : 's'}`,
    status: 'Today',
    pnl: net,
    pnlPct: base > 0 ? (net / base) * 100 : null,
    dateLabel: dateLabel(),
    rows: [
      { label: 'Realized', value: signed(realized), money: true },
      { label: 'Open P&L', value: signed(open), money: true },
      { label: 'Win rate', value: closed.length ? `${Math.round((wins / closed.length) * 100)}% (${wins}/${closed.length})` : '—' },
      { label: 'Open positions', value: String(account.positions.length + account.options.length) },
      { label: 'Best trade', value: best === null ? '—' : signed(best), money: true },
      { label: 'Worst trade', value: worst === null ? '—' : signed(worst), money: true },
    ],
  };
};
