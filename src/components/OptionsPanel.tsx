import React, { useState } from 'react';
import { OptionContract } from '../types';
import './OptionsPanel.css';

interface OptionsPanelProps {
  symbol: string;
  currentPrice: number;
  balance: number;
  onBuyOption: (option: Omit<OptionContract, 'quantity'> & { quantity: number }) => void;
}

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  symbol,
  currentPrice,
  balance,
  onBuyOption,
}) => {
  const [optionType, setOptionType] = useState<'call' | 'put'>('call');
  const [strike, setStrike] = useState<string>(currentPrice.toFixed(2));
  const [expiry, setExpiry] = useState<string>('');
  const [premium, setPremium] = useState<string>('1.00');
  const [quantity, setQuantity] = useState<string>('1');

  // Generate expiry dates (next 4 Fridays)
  const generateExpiryDates = () => {
    const dates = [];
    const today = new Date();
    
    for (let i = 0; i < 4; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + (i * 7) + (5 - today.getDay() + 7) % 7);
      dates.push(date.toISOString().split('T')[0]);
    }
    
    return dates;
  };

  const expiryDates = generateExpiryDates();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const strikePrice = parseFloat(strike);
    const premiumPrice = parseFloat(premium);
    const qty = parseInt(quantity);

    if (isNaN(strikePrice) || isNaN(premiumPrice) || isNaN(qty)) {
      alert('Please enter valid values');
      return;
    }

    if (!expiry) {
      alert('Please select an expiry date');
      return;
    }

    const cost = premiumPrice * qty * 100;
    if (cost > balance) {
      alert('Insufficient balance');
      return;
    }

    onBuyOption({
      symbol,
      type: optionType,
      strike: strikePrice,
      expiry,
      premium: premiumPrice,
      quantity: qty,
    });

    setQuantity('1');
  };

  const estimatedCost = parseFloat(premium) * parseInt(quantity) * 100 || 0;

  return (
    <div className="options-panel">
      <h3>Options Trading</h3>

      <form onSubmit={handleSubmit} className="options-form">
        <div className="form-group">
          <label>Option Type</label>
          <div className="option-type-selector">
            <button
              type="button"
              className={optionType === 'call' ? 'active call' : 'call'}
              onClick={() => setOptionType('call')}
            >
              CALL
            </button>
            <button
              type="button"
              className={optionType === 'put' ? 'active put' : 'put'}
              onClick={() => setOptionType('put')}
            >
              PUT
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Strike Price</label>
          <input
            type="number"
            value={strike}
            onChange={(e) => setStrike(e.target.value)}
            step="0.5"
            min="0"
            required
          />
          <div className="strike-presets">
            <button
              type="button"
              onClick={() => setStrike((currentPrice * 0.95).toFixed(2))}
            >
              -5%
            </button>
            <button
              type="button"
              onClick={() => setStrike(currentPrice.toFixed(2))}
            >
              ATM
            </button>
            <button
              type="button"
              onClick={() => setStrike((currentPrice * 1.05).toFixed(2))}
            >
              +5%
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Expiry Date</label>
          <select
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            required
          >
            <option value="">Select expiry date</option>
            {expiryDates.map((date) => (
              <option key={date} value={date}>
                {new Date(date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Premium per Contract</label>
          <input
            type="number"
            value={premium}
            onChange={(e) => setPremium(e.target.value)}
            step="0.01"
            min="0.01"
            required
          />
        </div>

        <div className="form-group">
          <label>Number of Contracts</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min="1"
            step="1"
            required
          />
        </div>

        <div className="option-summary">
          <div className="summary-row">
            <span>Current Price:</span>
            <span className="value">${currentPrice.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span>Total Cost:</span>
            <span className="value">${estimatedCost.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span>Available Balance:</span>
            <span className="value">${balance.toFixed(2)}</span>
          </div>
          <div className="summary-info">
            Each contract represents 100 shares
          </div>
        </div>

        <button
          type="submit"
          className={`submit-btn ${optionType}`}
          disabled={estimatedCost > balance}
        >
          Buy {optionType.toUpperCase()} Option
        </button>
      </form>
    </div>
  );
};
