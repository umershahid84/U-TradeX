import React, { useState } from 'react';
import { SidebarTab, TAB_META } from './SidebarTabs';
import type { ChartUiCommand, ChartUiState } from './TradingChart';
import './LeftNav.css';

interface Props {
  active: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
  /** Number shown on the Air Gaps item (today's alerts) */
  airGapAlerts: number;
  onOpenDashboard: () => void;
  /** Which chart tools are open (null until the chart reports) and a way to toggle one */
  chartUi: ChartUiState | null;
  onChartTool: (id: ChartUiCommand['id']) => void;
}

const CHART_TOOLS: { id: ChartUiCommand['id']; icon: string; label: string; hint: string }[] = [
  { id: 'indicators', icon: '📊', label: 'Indicators', hint: 'Indicators, clouds and your saved scripts' },
  { id: 'alerts', icon: '🔔', label: 'Alerts', hint: 'Price alerts' },
  { id: 'style', icon: '🎨', label: 'Style', hint: 'Candle style, theme and colours' },
  { id: 'plan', icon: '📐', label: 'Trade plan', hint: 'Drag entry, stop and target' },
  { id: 'autoplan', icon: '🧭', label: 'Auto plan', hint: 'Entry, stop and targets from the EMA clouds' },
  { id: 'politicians', icon: '🏛', label: 'Congress marks', hint: 'Congress trades marked on the chart' },
  { id: 'fibonacci', icon: '🔢', label: 'Fibonacci', hint: 'Retracement levels' },
];

const KEY = 'leftNavCollapsed';

/**
 * The menu down the left side: one item for each view of the sidebar panel (Watchlist, Scanner, Air Gaps, Bots, Trade,
 * Options, Sentiment, Congress) plus a shortcut to the Air Gap dashboard. It folds to icons only; the choice is remembered.
 */
export const LeftNav: React.FC<Props> = ({ active, onSelect, airGapAlerts, onOpenDashboard, chartUi, onChartTool }) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((v) => {
      try {
        localStorage.setItem(KEY, v ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !v;
    });

  const item = (id: string, icon: string, label: string, on: boolean, onClick: () => void, badge?: number, hint?: string) => (
    <button key={id} type="button" className={`ln-item ${on ? 'on' : ''}`} onClick={onClick} title={collapsed ? label : hint} aria-current={on ? 'page' : undefined}>
      <span className="ln-icon" aria-hidden>{icon}</span>
      {!collapsed && <span className="ln-label">{label}</span>}
      {!!badge && <span className="ln-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );

  return (
    <nav className={`left-nav ${collapsed ? 'collapsed' : ''}`} aria-label="Main menu">
      <button type="button" className="ln-collapse" onClick={toggle} title={collapsed ? 'Expand the menu' : 'Collapse the menu'} aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}>
        {collapsed ? '▶' : '◀'}
      </button>
      <div className="ln-head">{collapsed ? '' : 'Chart'}</div>
      <div className="ln-list">
        {CHART_TOOLS.map((t) => item(`tool-${t.id}`, t.icon, t.label, !!chartUi?.[t.id], () => onChartTool(t.id), t.id === 'alerts' ? chartUi?.alertCount : undefined, t.hint))}
      </div>
      <div className="ln-sep" />
      <div className="ln-head">{collapsed ? '' : 'Views'}</div>
      <div className="ln-list">
        {TAB_META.map((t) => item(t.id, t.icon, t.id === 'airgaps' ? 'Air Gaps' : t.id === 'politicians' ? 'Congress' : t.label, active === t.id, () => onSelect(t.id), t.id === 'airgaps' ? airGapAlerts : undefined))}
      </div>
      <div className="ln-sep" />
      <div className="ln-list">{item('dash', '⤢', 'Gap dashboard', false, onOpenDashboard)}</div>
    </nav>
  );
};
