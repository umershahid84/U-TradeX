import { ChartData } from '../types';
import { AutoPlan, buildPlan } from './autoPlan';
import { etClock } from './lateDay';

export interface Ghost {
  date: string;
  /** Price path after that day's break, scaled to today's entry and lined up with today's break time */
  points: { time: number; value: number }[];
  /** Move from that day's entry to the end of its session, in percent (positive = the trade would have won) */
  resultPct: number;
}

/**
 * Past breaks of the same cloud in the same direction, drawn faintly from today's entry so you can compare how
 * those went. Each earlier day is replayed to the end of its session with the same plan rules.
 */
export const buildGhosts = (bars: ChartData[], plan: AutoPlan, maxDays = 4): Ghost[] => {
  if (!plan.triggered || plan.breakTime === null || !bars.length) return [];
  const today = etClock(bars[bars.length - 1].time).date;
  const lastTime = bars[bars.length - 1].time;
  const days = [...new Set(bars.map((b) => etClock(b.time).date))].filter((d) => d < today).slice(-maxDays);
  const out: Ghost[] = [];
  for (const d of days) {
    let end = -1;
    for (let i = 0; i < bars.length; i++) if (etClock(bars[i].time).date === d) end = i;
    if (end < 0) continue;
    const sub = bars.slice(0, end + 1);
    const p = buildPlan(sub, { now: sub[sub.length - 1].time + plan.barMs });
    if (!p || !p.triggered || p.side !== plan.side || p.breakIdx === null) continue;
    const from = p.breakIdx;
    const k = plan.entry / p.entry;
    const points: Ghost['points'] = [];
    for (let i = from; i < sub.length; i++) {
      if (etClock(sub[i].time).date !== d) continue;
      const t = plan.breakTime + (sub[i].time - sub[from].time);
      if (t > lastTime) break;
      points.push({ time: t, value: Math.round(sub[i].close * k * 100) / 100 });
    }
    if (points.length < 2) continue;
    const sign = plan.side === 'long' ? 1 : -1;
    out.push({ date: d, points, resultPct: sign * (sub[sub.length - 1].close / p.entry - 1) * 100 });
  }
  return out;
};
