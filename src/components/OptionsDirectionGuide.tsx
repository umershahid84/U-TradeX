import React, { useMemo, useState } from 'react';
import { ChartData } from '../types';
import { analyzeBias, MIN_BARS } from '../utils/optionsBias';

interface Props {
  symbol: string;
  data: ChartData[];
  chartLabel: string;
  onUseSuggestion: (side: 'call' | 'put') => void;
}

export const OptionsDirectionGuide: React.FC<Props> = ({ symbol, data, chartLabel, onUseSuggestion }) => {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => analyzeBias(data), [data]);

  if (!result) {
    return (
      <div className="direction-guide neutral">
        <div className="guide-head">Calls or Puts?</div>
        <div className="guide-note">Not enough chart data yet ({MIN_BARS}+ bars needed) to read {symbol}.</div>
      </div>
    );
  }

  const { bias, score, signals, cautions, headline } = result;
  // Marker position along the bearish-to-bullish gauge
  const pos = (score + 100) / 2;

  return (
    <div className={`direction-guide ${bias}`}>
      <div className="guide-head">
        <span>Calls or Puts?</span>
        <span className="guide-chart">{symbol} · {chartLabel}</span>
      </div>

      <div className="guide-verdict">{headline}</div>

      <div className="guide-gauge" title={`Score ${score} (-100 bearish to +100 bullish)`}>
        <span className="gauge-marker" style={{ left: `${pos}%` }} />
        <div className="gauge-labels"><span>Puts</span><span>Wait</span><span>Calls</span></div>
      </div>

      {bias !== 'neutral' && (
        <button type="button" className={`guide-use ${bias}`} onClick={() => onUseSuggestion(bias === 'calls' ? 'call' : 'put')}>
          Show best {bias === 'calls' ? 'CALL' : 'PUT'} contracts
        </button>
      )}

      {cautions.length > 0 && (
        <ul className="guide-cautions">
          {cautions.map((c) => <li key={c}>⚠ {c}</li>)}
        </ul>
      )}

      <button type="button" className="guide-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Why? ({signals.length} indicators)
      </button>
      {open && (
        <ul className="guide-signals">
          {signals.map((s) => (
            <li key={s.name}>
              <span className={`dot ${s.value > 0.25 ? 'bull' : s.value < -0.25 ? 'bear' : 'flat'}`} />
              <span className="sig-name">{s.name}</span>
              <span className="sig-detail">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="guide-disclaimer">
        Based on the chart you are viewing. Changing the timeframe or range changes the reading. This is a
        technical read, not financial advice or a prediction.
      </div>
    </div>
  );
};
