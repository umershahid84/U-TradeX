import React from 'react';

interface LogoProps {
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ size = 40 }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#FFD700', stopOpacity: 1 }} />
          <stop offset="50%" style={{ stopColor: '#FFA500', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#FF8C00', stopOpacity: 1 }} />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      {/* T - Bottom layer (Letter T with horizontal bar at top and vertical stem) */}
      <g filter="url(#glow)">
        {/* Horizontal bar of T */}
        <rect
          x="20"
          y="50"
          width="60"
          height="10"
          fill="url(#goldGradient)"
          stroke="#DAA520"
          strokeWidth="2"
        />
        {/* Vertical stem of T */}
        <rect
          x="45"
          y="50"
          width="10"
          height="45"
          fill="url(#goldGradient)"
          stroke="#DAA520"
          strokeWidth="2"
        />
      </g>
      
      {/* U - Top layer (sitting on top of T) */}
      <g filter="url(#glow)">
        <path
          d="M 30 10 L 30 35 Q 30 45 40 45 L 60 45 Q 70 45 70 35 L 70 10 L 62 10 L 62 35 Q 62 40 57 40 L 43 40 Q 38 40 38 35 L 38 10 Z"
          fill="url(#goldGradient)"
          stroke="#DAA520"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
};
