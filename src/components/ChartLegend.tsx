import React from 'react';
import './ChartLegend.css';

export interface LegendItem {
  id: string;
  name: string;
  /** Key settings, shown after the name like TradingView's indicator legend */
  params?: string;
  color?: string;
  /** Dimmed and drawn as hidden */
  hidden?: boolean;
  onToggle?: () => void;
  onSettings?: () => void;
  onRemove?: () => void;
}

interface Props {
  items: LegendItem[];
  /** Every indicator is hidden from the chart */
  allHidden: boolean;
  /** Hide all indicators from the chart, or show them again */
  onToggleAll: () => void;
}

/**
 * Indicators on the chart, listed top-left with their settings. The arrow hides every indicator
 * from the chart while keeping it selected; hover a row for hide, settings and remove.
 */
export const ChartLegend: React.FC<Props> = ({ items, allHidden, onToggleAll }) => {
  if (items.length === 0) return null;

  return (
    <div className="chart-legend">
      <button
        type="button"
        className="legend-collapse"
        onClick={onToggleAll}
        title={allHidden ? 'Show all indicators on the chart' : 'Hide all indicators from the chart (they stay selected)'}
      >
        {allHidden ? `▼ ${items.length} indicator${items.length > 1 ? 's' : ''} hidden. Show` : '▲ Hide indicators'}
      </button>
      {!allHidden && (
        <ul>
          {items.map((it) => (
            <li key={it.id} className={it.hidden ? 'hidden' : ''}>
              {it.color && <i className="legend-dot" style={{ background: it.color }} />}
              <span className="legend-name">{it.name}</span>
              {it.params && <span className="legend-params">{it.params}</span>}
              <span className="legend-actions">
                {it.onToggle && (
                  <button type="button" onClick={it.onToggle} title={it.hidden ? 'Show' : 'Hide'} aria-label={it.hidden ? 'Show' : 'Hide'}>
                    {it.hidden ? '🚫' : '👁'}
                  </button>
                )}
                {it.onSettings && <button type="button" onClick={it.onSettings} title="Settings" aria-label="Settings">⚙</button>}
                {it.onRemove && <button type="button" onClick={it.onRemove} title="Remove" aria-label="Remove">✕</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
