import React, { useMemo, useState } from 'react';
import { ClosedTrade } from '../types';
import { PeriodUnit, Tally, byPeriod, currentPeriod, profitableDays, tally } from '../utils/winRate';
import './TradeStats.css';

interface Props {
  trades: ClosedTrade[];
  openPositions: number;
}

type Filter = 'all' | 'stock' | 'option';

const money = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const plain = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const rate = (n: number | null) => (n === null ? '—' : `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`);

const UNITS: { id: PeriodUnit; label: string; plural: string }[] = [
  { id: 'day', label: 'Daily', plural: 'days' },
  { id: 'week', label: 'Weekly', plural: 'weeks' },
  { id: 'month', label: 'Monthly', plural: 'months' },
  { id: 'year', label: 'Yearly', plural: 'years' },
];

const RateCell: React.FC<{ t: Tally }> = ({ t }) => (
  <td className="ts-rate">
    <span className="ts-bar" aria-hidden>
      <i style={{ width: `${t.winRate ?? 0}%` }} className={(t.winRate ?? 0) >= 50 ? 'good' : 'bad'} />
    </span>
    <b className={t.winRate === null ? '' : t.winRate >= 50 ? 'up' : 'down'}>{rate(t.winRate)}</b>
  </td>
);

const Row: React.FC<{ label: string; t: Tally; showEven: boolean }> = ({ label, t, showEven }) => (
  <tr>
    <td>{label}</td>
    <td>{t.trades}</td>
    <td className="up">{t.wins}</td>
    <td className="down">{t.losses}</td>
    {showEven && <td>{t.even}</td>}
    <RateCell t={t} />
    <td className={t.pnl >= 0 ? 'up' : 'down'}>{t.trades ? money(t.pnl) : '—'}</td>
  </tr>
);

/** Win rate (today, this week, this month, this year, all time), trade counts, and the history by day, week, month or year */
export const TradeStats: React.FC<Props> = ({ trades, openPositions }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [unit, setUnit] = useState<PeriodUnit>('day');

  const list = useMemo(() => (filter === 'all' ? trades : trades.filter((t) => t.kind === filter)), [trades, filter]);
  const all = useMemo(() => tally(list), [list]);
  const periods = useMemo(
    () => (['day', 'week', 'month', 'year'] as PeriodUnit[]).map((u) => ({ u, t: currentPeriod(list, u) })),
    [list]
  );
  const history = useMemo(() => byPeriod(list, unit).slice(0, 30), [list, unit]);
  const days = useMemo(() => profitableDays(list), [list]);
  const showEven = all.even > 0;
  const colSpan = showEven ? 7 : 6;
  const unitMeta = UNITS.find((x) => x.id === unit)!;

  if (trades.length === 0) {
    return (
      <div className="ps-empty">
        No closed trades yet. Your win rate, wins and losses appear here once you close a position
        {openPositions ? ` (${openPositions} open now)` : ''}.
      </div>
    );
  }

  return (
    <div className="trade-stats">
      <div className="ts-top">
        <div className="ts-filter" role="tablist">
          {(['all', 'stock', 'option'] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All trades' : f === 'stock' ? 'Stocks' : 'Options'}
            </button>
          ))}
        </div>
        <span className="ts-open">{openPositions} open now (counted once closed)</span>
      </div>

      <div className="ts-cards">
        <div><span>Trades taken</span><b>{all.trades}</b></div>
        <div><span>In profit</span><b className="up">{all.wins}</b></div>
        <div><span>In loss</span><b className="down">{all.losses}</b></div>
        <div><span>Win rate</span><b className={all.winRate !== null && all.winRate >= 50 ? 'up' : 'down'}>{rate(all.winRate)}</b></div>
        <div><span>Net P&amp;L</span><b className={all.pnl >= 0 ? 'up' : 'down'}>{money(all.pnl)}</b></div>
        <div><span>Profit factor</span><b>{all.profitFactor === null ? (all.wins ? '∞' : '—') : all.profitFactor.toFixed(2)}</b></div>
        <div><span>Avg win / loss</span><b>{plain(all.avgWin)} / {plain(all.avgLoss)}</b></div>
        <div><span>Winning days</span><b>{days.pct === null ? '—' : `${days.green}/${days.days} (${rate(days.pct)})`}</b></div>
      </div>

      <table className="ts-table">
        <thead>
          <tr><th>Win rate</th><th>Trades</th><th>Won</th><th>Lost</th>{showEven && <th>Even</th>}<th>Rate</th><th>Net P&amp;L</th></tr>
        </thead>
        <tbody>
          <Row label="Today" t={periods[0].t} showEven={showEven} />
          <Row label="This week" t={periods[1].t} showEven={showEven} />
          <Row label="This month" t={periods[2].t} showEven={showEven} />
          <Row label="This year" t={periods[3].t} showEven={showEven} />
          <Row label="All time" t={all} showEven={showEven} />
        </tbody>
      </table>

      <div className="ts-history-head">
        <strong>History</strong>
        <div className="ts-filter" role="tablist">
          {UNITS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={unit === x.id} className={unit === x.id ? 'active' : ''} onClick={() => setUnit(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <table className="ts-table">
        <thead>
          <tr><th>{unitMeta.label} win rate</th><th>Trades</th><th>Won</th><th>Lost</th>{showEven && <th>Even</th>}<th>Rate</th><th>Net P&amp;L</th></tr>
        </thead>
        <tbody>
          {history.length === 0 ? (
            <tr><td colSpan={colSpan} className="ts-none">No trades in this view.</td></tr>
          ) : (
            history.map((p) => <Row key={p.key} label={p.label} t={p} showEven={showEven} />)
          )}
        </tbody>
      </table>

      <div className="ts-note">
        A trade is one closing fill (selling part of a position counts as its own trade, and each option sale counts too). In profit means it closed above its
        average price, in loss below it. Win rate is trades in profit divided by all trades closed in that period. Days, weeks (Monday to Sunday), months and
        years follow the New York calendar. Open positions are not counted until they close.
      </div>
    </div>
  );
};
