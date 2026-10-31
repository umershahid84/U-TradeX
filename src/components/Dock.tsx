import React from 'react';
import './Dock.css';

export type DockPosition = 'top' | 'bottom';

interface DockProps {
  position: DockPosition;
  onPositionChange: (p: DockPosition) => void;
  onClose: () => void;
  children: React.ReactNode;
}

/** Strip holding the watchlist and options, shown above or below the chart */
export const Dock: React.FC<DockProps> = ({ position, onPositionChange, onClose, children }) => (
  <section className={`dock dock-${position}`}>
    <div className="dock-bar">
      <span className="dock-title">Watchlist &amp; Options</span>
      <div className="dock-controls">
        <button
          type="button"
          className={position === 'top' ? 'active' : ''}
          onClick={() => onPositionChange('top')}
          title="Show above the chart"
        >
          ▲ Above
        </button>
        <button
          type="button"
          className={position === 'bottom' ? 'active' : ''}
          onClick={() => onPositionChange('bottom')}
          title="Show below the chart"
        >
          ▼ Below
        </button>
        <button type="button" onClick={onClose} title="Hide this panel">✕</button>
      </div>
    </div>
    <div className="dock-body">{children}</div>
  </section>
);
