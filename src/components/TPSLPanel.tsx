import React, { useState } from 'react';
import { TakeProfitStopLoss, Position } from '../types';
import './TPSLPanel.css';

interface TPSLPanelProps {
  positions: Position[];
  onSet: (tpsl: TakeProfitStopLoss) => void;
}

export const TPSLPanel: React.FC<TPSLPanelProps> = ({ positions, onSet }) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedSymbol) {
      alert('Please select a position');
      return;
    }

    const tp = takeProfit ? parseFloat(takeProfit) : undefined;
    const sl = stopLoss ? parseFloat(stopLoss) : undefined;

    if ((tp && isNaN(tp)) || (sl && isNaN(sl))) {
      alert('Please enter valid prices');
      return;
    }

    onSet({
      symbol: selectedSymbol,
      takeProfit: tp,
      stopLoss: sl,
    });

    setTakeProfit('');
    setStopLoss('');
  };

  const selectedPosition = positions.find(p => p.symbol === selectedSymbol);

  return (
    <div className="tpsl-panel">
      <h3>Take Profit / Stop Loss</h3>
      
      {positions.length === 0 ? (
        <div className="empty-state">
          No positions available. Place a trade first.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="tpsl-form">
          <div className="form-group">
            <label>Position</label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              required
            >
              <option value="">Select a position</option>
              {positions.map((pos) => (
                <option key={pos.symbol} value={pos.symbol}>
                  {pos.symbol} - {pos.quantity} shares @ ${pos.avgPrice.toFixed(2)}
                </option>
              ))}
            </select>
          </div>

          {selectedPosition && (
            <div className="position-info">
              <div className="info-row">
                <span>Current Price:</span>
                <span className="value">${selectedPosition.currentPrice.toFixed(2)}</span>
              </div>
              <div className="info-row">
                <span>P&L:</span>
                <span className={`value ${selectedPosition.pnl >= 0 ? 'positive' : 'negative'}`}>
                  ${selectedPosition.pnl.toFixed(2)} ({selectedPosition.pnlPercent.toFixed(2)}%)
                </span>
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Take Profit Price (Optional)</label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              placeholder="Enter price"
              step="0.01"
              min="0"
            />
            {selectedPosition && takeProfit && (
              <div className="hint">
                Profit if triggered: ${((parseFloat(takeProfit) - selectedPosition.avgPrice) * selectedPosition.quantity).toFixed(2)}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Stop Loss Price (Optional)</label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="Enter price"
              step="0.01"
              min="0"
            />
            {selectedPosition && stopLoss && (
              <div className="hint loss">
                Loss if triggered: ${((parseFloat(stopLoss) - selectedPosition.avgPrice) * selectedPosition.quantity).toFixed(2)}
              </div>
            )}
          </div>

          <button type="submit" className="submit-btn">
            Set TP/SL
          </button>
        </form>
      )}
    </div>
  );
};
