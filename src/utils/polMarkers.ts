import { ChartData } from '../types';
import { PoliticianTrade, tradeSide } from '../services/politicians';
import { chartIntervalMs } from './htfEma';
import { etClock } from './lateDay';

export interface PolMarker {
  /** Chart time in seconds, always the time of a real bar */
  time: number;
  side: 'buy' | 'sell';
  count: number;
}

/**
 * Politicians' trades as one marker per bar and side. A trade only has a date, so on an intraday chart it sits on the
 * last bar of that day before noon New York time (or the day's first bar), and on daily and longer charts on the bar
 * that contains the date. Trades before the first bar are skipped.
 */
export const buildPolMarkers = (trades: PoliticianTrade[], bars: ChartData[]): PolMarker[] => {
  if (!bars.length || !trades.length) return [];
  const ms = chartIntervalMs(bars);
  const daily = ms >= 20 * 3600 * 1000;
  const first = bars[0].time;
  const lastEnd = bars[bars.length - 1].time + (ms || 0);

  // intraday: bars grouped by New York date
  const byDate = new Map<string, number[]>();
  if (!daily) bars.forEach((b, i) => {
    const d = etClock(b.time).date;
    const arr = byDate.get(d);
    if (arr) arr.push(i);
    else byDate.set(d, [i]);
  });

  const acc = new Map<string, PolMarker>();
  for (const t of trades) {
    const side = tradeSide(t);
    if (side === 'other') continue;
    let idx = -1;
    if (daily) {
      const at = Date.parse(`${t.tradeDate}T12:00:00Z`);
      if (!(at >= first - (ms || 0) && at < lastEnd)) continue;
      // last bar that starts on or before the trade date
      for (let i = bars.length - 1; i >= 0; i--) {
        if (bars[i].time <= at) {
          idx = i;
          break;
        }
      }
    } else {
      const list = byDate.get(t.tradeDate);
      if (!list) continue;
      // the last regular-session bar up to noon ET, else the first bar of the day
      const noon = list.filter((i) => etClock(bars[i].time).minutes <= 12 * 60 && etClock(bars[i].time).minutes >= 9 * 60 + 30);
      idx = noon.length ? noon[noon.length - 1] : list[0];
    }
    if (idx < 0) continue;
    const time = Math.floor(bars[idx].time / 1000);
    const key = `${time}|${side}`;
    const m = acc.get(key);
    if (m) m.count++;
    else acc.set(key, { time, side, count: 1 });
  }
  return [...acc.values()].sort((a, b) => a.time - b.time);
};
