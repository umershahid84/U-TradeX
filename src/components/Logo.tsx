import React, { useId } from 'react';

interface LogoProps {
  size?: number;
}

/** Rising Bars: three climbing candles, the last in gold */
export const Logo: React.FC<LogoProps> = ({ size = 40 }) => {
  const id = useId().replace(/:/g, '');
  const teal = `teal-${id}`;
  const gold = `gold-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="U-TradeX"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={teal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4DD0C4" />
          <stop offset="1" stopColor="#1B8A80" />
        </linearGradient>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD54F" />
          <stop offset="1" stopColor="#FF9800" />
        </linearGradient>
      </defs>

      <line x1="22" y1="44" x2="22" y2="88" stroke="#26a69a" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="14" y="54" width="16" height="24" rx="3" fill="#26a69a" />

      <line x1="50" y1="26" x2="50" y2="82" stroke="#26a69a" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="42" y="38" width="16" height="32" rx="3" fill={`url(#${teal})`} />

      <line x1="78" y1="8" x2="78" y2="72" stroke="#FFB300" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="70" y="20" width="16" height="40" rx="3" fill={`url(#${gold})`} />
    </svg>
  );
};
