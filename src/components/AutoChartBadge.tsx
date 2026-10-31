import React, { useState } from 'react';
import { AutoChartResult, MIN_AUTOCHART_BARS } from '../utils/autoChart';
import './AutoChartBadge.css';

interface Props {
  result: AutoChartResult | null;
  barCount: number;
  timeframe: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Summary card for the auto-chart reading: pattern, bullish/bearish bias and how it was reached */
export const AutoChartBadge: React.FC<Props> = ({ result, barCount, timeframe }) => {
  const [open, setOpen] = useState(false);

  if (!result) {
    return (
      <div className="auto-badge neutral">
        <span className="ab-title">Auto Chart</span>
        <span className="ab-note">Needs {MIN_AUTOCHART_BARS}+ bars to analyse ({barCount} loaded). Try a shorter timeframe or longer range.</span>
      </div>
    );
  }

  const p = result.pattern;
  const top = p?.type === 'double_top';
  const biasLabel = result.bias === 'bullish' ? 'BULLISH' : result.bias === 'bearish' ? 'BEARISH' : 'NEUTRAL';

  return (
    <div className={`auto-badge ${result.bias}`}>
      <span className="ab-title">Auto Chart</span>
      <span className={`ab-pill bias ${result.bias}`}>{biasLabel}</span>
      {p ? (
        <span className={`ab-pill pattern ${p.status}`}>
          {top ? 'Double Top' : 'Double Bottom'} · {p.status}
        </span>
      ) : (
        <span className="ab-pill none">No double top/bottom</span>
      )}
      <span className="ab-headline">{result.headline}</span>
      <span className="ab-tf">{timeframe} · {result.bars} bars</span>
      <button type="button" className="ab-toggle" onClick={() => setOpen(!open)}>
        {open ? 'Hide details ▾' : 'Details ▴'}
      </button>

      {open && (
        <div className="ab-popover">
          <ul className="ab-details">
            <li><b>Structure:</b> {result.structure}</li>
            {p && (
              <>
                <li><b>{top ? 'Tops' : 'Bottoms'}:</b> {money(p.first.price)} and {money(p.second.price)}</li>
                <li><b>Neckline:</b> {money(p.neckline)} {p.status === 'confirmed' ? '(broken)' : `(a ${top ? 'close below' : 'close above'} confirms it)`}</li>
                <li><b>Measured target:</b> {money(p.target)}</li>
              </>
            )}
            {result.levels.length > 0 && (
              <li>
                <b>Levels:</b>{' '}
                {result.levels.map((l) => `${l.kind === 'support' ? 'S' : 'R'} ${money(l.price)} (×${l.touches})`).join(', ')}
              </li>
            )}
            <li className="ab-fine">Swings of {money(result.swingSize)}+ on this timeframe. Switching timeframe redraws everything. Automatic technical read, not advice.</li>
          </ul>
        </div>
      )}
    </div>
  );
};
