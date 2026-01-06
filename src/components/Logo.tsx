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
      
      {/* X - Bottom layer */}
      <g filter="url(#glow)">
        <path
          d="M 25 55 L 45 75 L 35 85 L 15 65 Z"
          fill="url(#goldGradient)"
          stroke="#DAA520"
          strokeWidth="2"
        />
        <path
          d="M 55 75 L 75 55 L 85 65 L 65 85 Z"
          fill="url(#goldGradient)"
          stroke="#DAA520"
          strokeWidth="2"
        />
        <path
          d="M 75 55 L 55 35 L 65 25 L 85 45 Z"
          fill="url(#goldGradient)"
          stroke="#DAA520"
          strokeWidth="2"
        />
        <path
          d="M 45 35 L 25 55 L 15 45 L 35 25 Z"
          fill="url(#goldGradient)"
          stroke="#DAA520"
          strokeWidth="2"
        />
      </g>
      
      {/* U - Top layer */}
      <g filter="url(#glow)">
        <path
          d="M 30 15 L 30 40 Q 30 50 40 50 L 60 50 Q 70 50 70 40 L 70 15 L 60 15 L 60 40 Q 60 45 55 45 L 45 45 Q 40 45 40 40 L 40 15 Z"
          fill="url(#goldGradient)"
          stroke="#DAA520"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
};
