import React, { useEffect, useState } from 'react';
import { RealMarketDataService } from '../services/realMarketData';
import { lateDayPressure, LateDayRead, etClock } from '../utils/lateDay';
import './LateDayChip.css';

interface Props {
  symbol: string;
}

/** Late-day pressure for the charted symbol. Shown from 2 pm ET, and as the closing read until 8 pm. */
export const LateDayChip: React.FC<Props> = ({ symbol }) => {
  const [read, setRead] = useState<LateDayRead | null>(null);
  const [open, setOpen] = useState(false);
  const [inWindow, setInWindow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const svc = RealMarketDataService.getInstance();
    const tick = async () => {
      const et = etClock(Date.now());
      const show = et.weekday >= 1 && et.weekday <= 5 && et.minutes >= 14 * 60 && et.minutes < 20 * 60;
      if (!cancelled) setInWindow(show);
      if (!show) return;
      try {
        const bars = await svc.fetchChartData(symbol, '5m', '5d', false);
        if (!cancelled) setRead(lateDayPressure(bars));
      } catch {
        if (!cancelled) setRead(null);
      }
    };
    setRead(null);
    void tick();
    const id = setInterval(() => void tick(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  if (!inWindow || !read) return null;
  const tone = read.label === 'Buy pressure' ? 'up' : read.label === 'Sell pressure' ? 'down' : 'flat';
  const time = new Date(read.asOf).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="lateday">
      <button type="button" className={`lateday-chip ${tone}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="ld-name">{read.phase === 'close' ? 'Closing read' : 'Late-day'}</span>
        <b>{read.label}</b>
        <span className="ld-score">{read.score > 0 ? '+' : ''}{read.score}</span>
        <i className="ld-proxy">proxy</i>
      </button>
      {open && (
        <div className="lateday-card" role="dialog" aria-label="Late-day pressure details">
          <div className="ld-warn">
            Estimate from price, volume and VWAP over the last hour (as of {time} ET). It is <b>not</b> the exchange
            closing-auction (MOC) imbalance. That needs a paid NYSE / Nasdaq feed this app does not have.
          </div>
          <table>
            <tbody>
              <tr><td>Last-hour move</td><td className={read.driftPct >= 0 ? 'up' : 'down'}>{read.driftPct >= 0 ? '+' : ''}{read.driftPct.toFixed(2)}%</td></tr>
              <tr><td>Vs day VWAP</td><td className={read.vwapDevPct >= 0 ? 'up' : 'down'}>{read.vwapDevPct >= 0 ? '+' : ''}{read.vwapDevPct.toFixed(2)}%</td></tr>
              <tr><td>Position in day's range</td><td>{Math.round(read.rangePos * 100)}%</td></tr>
              <tr>
                <td>Last-hour volume</td>
                <td>{read.volumeRatio == null ? 'no history' : `${read.volumeRatio.toFixed(2)}× normal`}{read.heavyVolume ? ' 🔥' : ''}</td>
              </tr>
            </tbody>
          </table>
          <div className="ld-note">Score runs from -100 (selling) to +100 (buying). Volume above normal strengthens the read.</div>
        </div>
      )}
    </div>
  );
};
