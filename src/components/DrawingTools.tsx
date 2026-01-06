import React, { useState } from 'react';
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

export const DrawingTools: React.FC<DrawingToolsProps> = ({
  onToolSelect,
  selectedTool,
  onClearAll,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const tools = [
    { id: 'none' as DrawingTool, label: 'Cursor', icon: '🖱️' },
    { id: 'trendline' as DrawingTool, label: 'Trend Line', icon: '📈' },
    { id: 'horizontal' as DrawingTool, label: 'H-Line', icon: '➖' },
    { id: 'rectangle' as DrawingTool, label: 'Rectangle', icon: '▭' },
    { id: 'fibonacci' as DrawingTool, label: 'Fibonacci', icon: '🔢' },
  ];

  return (
    <div className="drawing-tools">
      <button
        className="tools-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        🎨 Drawing Tools {isExpanded ? '▲' : '▼'}
      </button>
      
      {isExpanded && (
        <div className="tools-panel">
          <div className="tools-grid">
            {tools.map((tool) => (
              <button
                key={tool.id}
                className={`tool-btn ${selectedTool === tool.id ? 'active' : ''}`}
                onClick={() => onToolSelect(tool.id)}
                title={tool.label}
              >
                <span className="tool-icon">{tool.icon}</span>
                <span className="tool-label">{tool.label}</span>
              </button>
            ))}
          </div>
          
          <button className="clear-btn" onClick={onClearAll}>
            🗑️ Clear All
          </button>
        </div>
      )}
    </div>
  );
};
