import React, { useState } from 'react';
import './CustomIndicatorPanel.css';

export interface CustomIndicator {
  id: string;
  name: string;
  formula: string; // JavaScript formula string
  color: string;
  lineWidth: number;
  enabled: boolean;
}

interface CustomIndicatorPanelProps {
  onAddIndicator: (indicator: CustomIndicator) => void;
  onRemoveIndicator: (id: string) => void;
  indicators: CustomIndicator[];
}

export const CustomIndicatorPanel: React.FC<CustomIndicatorPanelProps> = ({
  onAddIndicator,
  onRemoveIndicator,
  indicators,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');
  const [color, setColor] = useState('#2196F3');
  const [lineWidth, setLineWidth] = useState(2);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !formula) return;

    const indicator: CustomIndicator = {
      id: Date.now().toString(),
      name,
      formula,
      color,
      lineWidth,
      enabled: true,
    };

    onAddIndicator(indicator);
    
    // Reset form
    setName('');
    setFormula('');
    setColor('#2196F3');
    setLineWidth(2);
    setShowForm(false);
  };

  return (
    <div className="custom-indicator-panel">
      <div className="panel-header">
        <h3>Custom Indicators</h3>
        <button onClick={() => setShowForm(!showForm)} className="add-btn">
          {showForm ? '✖' : '+'} {showForm ? 'Cancel' : 'Add Custom'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="indicator-form">
          <div className="form-group">
            <label>Indicator Name:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My Custom EMA"
              required
            />
          </div>

          <div className="form-group">
            <label>Formula (JavaScript):</label>
            <textarea
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="// Available variables: prices (array), close, open, high, low, volume&#10;// Example: prices.map((p, i) => i < 20 ? NaN : prices.slice(i-19, i+1).reduce((a,b) => a+b, 0) / 20)"
              rows={4}
              required
            />
            <small className="help-text">
              Return an array of numbers. Use NaN for initial values. Available: prices, close, open, high, low, volume
            </small>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Color:</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Line Width:</label>
              <input
                type="number"
                value={lineWidth}
                onChange={(e) => setLineWidth(Number(e.target.value))}
                min="1"
                max="5"
              />
            </div>
          </div>

          <button type="submit" className="submit-btn">
            Create Indicator
          </button>
        </form>
      )}

      {indicators.length > 0 && (
        <div className="indicators-list">
          <h4>Your Indicators:</h4>
          {indicators.map((indicator) => (
            <div key={indicator.id} className="indicator-item">
              <div className="indicator-info">
                <span
                  className="color-dot"
                  style={{ backgroundColor: indicator.color }}
                />
                <span className="indicator-name">{indicator.name}</span>
              </div>
              <button
                onClick={() => onRemoveIndicator(indicator.id)}
                className="remove-btn"
              >
                ✖
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="help-section">
        <h4>Quick Examples:</h4>
        <div className="example">
          <strong>Simple Moving Average (20):</strong>
          <code>
            prices.map((p, i) =&gt; i &lt; 19 ? NaN : prices.slice(i-19, i+1).reduce((a,b) =&gt; a+b, 0) / 20)
          </code>
        </div>
        <div className="example">
          <strong>Exponential Moving Average (12):</strong>
          <code>
            (() =&gt; &#123; let ema = prices.slice(0,12).reduce((a,b)=&gt;a+b,0)/12; const k=2/13; return prices.map((p,i)=&gt; i&lt;11 ? NaN : i===11 ? ema : ema=(p-ema)*k+ema); &#125;)()
          </code>
        </div>
      </div>
    </div>
  );
};
