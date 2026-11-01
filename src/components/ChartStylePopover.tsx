import React, { useEffect, useRef } from 'react';
import { CHART_TYPES, ChartStyleSettings, ChartTheme, ChartType } from '../utils/chartStyle';
import './ChartStylePopover.css';

interface Props {
  settings: ChartStyleSettings;
  onChange: (next: ChartStyleSettings) => void;
  onClose: () => void;
}

const G = '#26a69a';
const R = '#ef5350';
const B = '#5C8DFF';

/** Tiny preview of each chart type */
const TypeIcon: React.FC<{ type: ChartType }> = ({ type }) => {
  const common = { width: 34, height: 26, viewBox: '0 0 34 26', fill: 'none' } as const;
  switch (type) {
    case 'candles':
      return (
        <svg {...common}>
          <line x1="8" y1="3" x2="8" y2="22" stroke={G} strokeWidth="1.5" /><rect x="5" y="8" width="6" height="9" fill={G} />
          <line x1="19" y1="5" x2="19" y2="24" stroke={R} strokeWidth="1.5" /><rect x="16" y="9" width="6" height="10" fill={R} />
          <line x1="29" y1="2" x2="29" y2="18" stroke={G} strokeWidth="1.5" /><rect x="26" y="5" width="6" height="9" fill={G} />
        </svg>
      );
    case 'hollow':
      return (
        <svg {...common}>
          <line x1="8" y1="3" x2="8" y2="22" stroke={G} strokeWidth="1.5" /><rect x="5" y="8" width="6" height="9" stroke={G} strokeWidth="1.5" />
          <line x1="19" y1="5" x2="19" y2="24" stroke={R} strokeWidth="1.5" /><rect x="16" y="9" width="6" height="10" fill={R} />
          <line x1="29" y1="2" x2="29" y2="18" stroke={G} strokeWidth="1.5" /><rect x="26" y="5" width="6" height="9" stroke={G} strokeWidth="1.5" />
        </svg>
      );
    case 'bars':
      return (
        <svg {...common}>
          <path d="M8 3V22M4 9H8M8 17H12" stroke={G} strokeWidth="1.6" />
          <path d="M19 5V24M15 11H19M19 19H23" stroke={R} strokeWidth="1.6" />
          <path d="M29 2V18M25 6H29M29 14H33" stroke={G} strokeWidth="1.6" />
        </svg>
      );
    case 'heikin':
      return (
        <svg {...common}>
          <line x1="6" y1="12" x2="6" y2="23" stroke={R} strokeWidth="1.5" /><rect x="3" y="14" width="6" height="7" fill={R} />
          <line x1="14" y1="6" x2="14" y2="19" stroke={G} strokeWidth="1.5" /><rect x="11" y="8" width="6" height="9" fill={G} />
          <line x1="22" y1="3" x2="22" y2="15" stroke={G} strokeWidth="1.5" /><rect x="19" y="4" width="6" height="9" fill={G} />
          <line x1="30" y1="1" x2="30" y2="11" stroke={G} strokeWidth="1.5" /><rect x="27" y="2" width="6" height="7" fill={G} />
        </svg>
      );
    case 'line':
      return (
        <svg {...common}>
          <polyline points="2,20 10,12 17,16 25,6 32,9" stroke={B} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <polygon points="2,20 10,12 17,16 25,6 32,9 32,25 2,25" fill={B} opacity="0.3" />
          <polyline points="2,20 10,12 17,16 25,6 32,9" stroke={B} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      );
  }
};

/** Chart type and background picker, opened from the Style button */
export const ChartStylePopover: React.FC<Props> = ({ settings, onChange, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Element | null;
      if (target && !target.closest('.style-popover, .style-toggle')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="style-popover" ref={ref} role="dialog" aria-label="Chart style">
      <h4>Chart type</h4>
      <div className="style-types">
        {CHART_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={settings.type === t.value ? 'active' : ''}
            onClick={() => onChange({ ...settings, type: t.value })}
          >
            <TypeIcon type={t.value} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <h4>Background</h4>
      <div className="style-themes">
        {(['dark', 'light'] as ChartTheme[]).map((th) => (
          <button
            key={th}
            type="button"
            className={`${th} ${settings.theme === th ? 'active' : ''}`}
            onClick={() => onChange({ ...settings, theme: th })}
          >
            {th === 'dark' ? '🌙 Dark' : '☀️ Light'}
          </button>
        ))}
      </div>
    </div>
  );
};
