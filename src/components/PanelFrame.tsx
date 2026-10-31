import React from 'react';
import './PanelFrame.css';

export type PanelId = 'watchlist' | 'options';
export type Placement = 'left' | 'top' | 'bottom';

interface PanelFrameProps {
  id: PanelId;
  placement: Placement;
  onMove: (placement: Placement) => void;
  /** Phones always stack panels below the chart, so the move buttons are hidden there */
  movable?: boolean;
  children: React.ReactNode;
}

const OPTIONS: { value: Placement; label: string; title: string }[] = [
  { value: 'left', label: '◀ Left', title: 'Show in the left sidebar' },
  { value: 'top', label: '▲ Above', title: 'Show above the chart' },
  { value: 'bottom', label: '▼ Below', title: 'Show below the chart' },
];

/** Wraps a panel with a slim bar for choosing where it is shown */
export const PanelFrame: React.FC<PanelFrameProps> = ({ id, placement, onMove, movable = true, children }) => (
  <div className={`panel-frame ${id} in-${placement}`}>
    {movable && (
      <div className="panel-move-bar">
        <span>Move</span>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={placement === o.value ? 'active' : ''}
            title={o.title}
            onClick={() => onMove(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    )}
    <div className="panel-body">{children}</div>
  </div>
);
