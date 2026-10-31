import React from 'react';
import './SidebarTabs.css';

export type SidebarTab = 'watchlist' | 'trade' | 'options' | 'sentiment';

export const TAB_META: { id: SidebarTab; label: string; icon: string }[] = [
  { id: 'watchlist', label: 'Watchlist', icon: '⭐' },
  { id: 'trade', label: 'Trade', icon: '💱' },
  { id: 'options', label: 'Options', icon: '🎯' },
  { id: 'sentiment', label: 'Sentiment', icon: '🌡️' },
];

interface SidebarTabsProps {
  active: SidebarTab;
  onChange: (tab: SidebarTab) => void;
  /** Collapse button shown at the start of the bar (desktop) */
  onCollapse?: () => void;
}

export const SidebarTabs: React.FC<SidebarTabsProps> = ({ active, onChange, onCollapse }) => (
  <div className="sidebar-tabs" role="tablist">
    {onCollapse && (
      <button type="button" className="tabs-collapse" onClick={onCollapse} title="Hide sidebar" aria-label="Hide sidebar">
        ▶
      </button>
    )}
    {TAB_META.map((t) => (
      <button
        key={t.id}
        type="button"
        role="tab"
        aria-selected={active === t.id}
        className={active === t.id ? 'active' : ''}
        onClick={() => onChange(t.id)}
      >
        <span className="tab-icon">{t.icon}</span>
        {t.label}
      </button>
    ))}
  </div>
);
