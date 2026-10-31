import React from 'react';
import './DrawingTools.css';

export type DrawingTool =
  | 'none'
  | 'trendline'
  | 'horizontal'
  | 'rectangle'
  | 'fibonacci';

interface DrawingToolsProps {
  onToolSelect: (tool: DrawingTool) => void;
  selectedTool: DrawingTool;
  onClearAll: () => void;
}

const TOOLS: { id: DrawingTool; label: string; icon: string }[] = [
  { id: 'none', label: 'Cursor', icon: '🖱️' },
  { id: 'trendline', label: 'Trend Line', icon: '📈' },
  { id: 'horizontal', label: 'Horizontal Line', icon: '➖' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'fibonacci', label: 'Fibonacci', icon: '🔢' },
];

/** Slim vertical tool rail along the left edge of the chart */
export const DrawingTools: React.FC<DrawingToolsProps> = ({ onToolSelect, selectedTool, onClearAll }) => (
  <div className="drawing-rail" role="toolbar" aria-label="Drawing tools">
    {TOOLS.map((tool) => (
      <button
        key={tool.id}
        className={`rail-btn ${selectedTool === tool.id ? 'active' : ''}`}
        onClick={() => onToolSelect(tool.id)}
        title={tool.label}
        aria-label={tool.label}
      >
        {tool.icon}
      </button>
    ))}
    <span className="rail-sep" />
    <button className="rail-btn danger" onClick={onClearAll} title="Clear all drawings" aria-label="Clear all drawings">
      🗑️
    </button>
  </div>
);
