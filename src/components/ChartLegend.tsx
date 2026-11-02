import React, { useState } from 'react';
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
}

/**
 * Indicators on the chart, listed top-left with their settings. The arrow only collapses this list
 * (the indicators stay drawn on the chart); hover a row for hide, settings and remove.
 */
export const ChartLegend: React.FC<Props> = ({ items }) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('legendCollapsed') === 'true';
    } catch {
      return false;
    }
  });

  if (items.length === 0) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('legendCollapsed', String(next));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="chart-legend">
      <button
        type="button"
        className="legend-collapse"
        onClick={toggle}
        title={collapsed ? 'Show the indicator list' : 'Hide the indicator list (the indicators stay on the chart)'}
      >
        {collapsed ? `▼ ${items.length} indicator${items.length > 1 ? 's' : ''}` : '▲'}
      </button>
      {!collapsed && (
        <ul>
          {items.map((it) => (
            <li key={it.id} className={it.hidden ? 'hidden' : ''}>
              {it.color && <i className="legend-dot" style={{ background: it.color }} />}
              <span className="legend-name">{it.name}</span>
              {it.params && <span className="legend-params">{it.params}</span>}
              <span className="legend-actions">
                {it.onToggle && (
                  <button type="button" onClick={it.onToggle} title={it.hidden ? 'Show on chart' : 'Hide from chart'} aria-label={it.hidden ? 'Show on chart' : 'Hide from chart'}>
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
