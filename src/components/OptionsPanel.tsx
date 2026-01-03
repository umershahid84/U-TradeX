import React, { useState, useEffect } from 'react';
import { OptionContract } from '../types';
import { RealMarketDataService, OptionChainData } from '../services/realMarketData';
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
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [optionsChain, setOptionsChain] = useState<{ calls: OptionChainData[], puts: OptionChainData[] }>({ calls: [], puts: [] });
  const [selectedOption, setSelectedOption] = useState<OptionChainData | null>(null);
  const [quantity, setQuantity] = useState<string>('1');
  const [loading, setLoading] = useState(false);

  const marketData = RealMarketDataService.getInstance();

  // Load expiration dates
  useEffect(() => {
    const loadExpirations = async () => {
      setLoading(true);
      try {
        const dates = await marketData.getOptionExpirations(symbol);
        if (dates.length > 0) {
          setExpiryDates(dates);
          setSelectedExpiry(dates[0]);
        } else {
          // Fallback to generated dates if API returns empty
          console.log('No expiration dates from API, using fallback');
          const fallbackDates = generateExpiryDates();
          setExpiryDates(fallbackDates);
          if (fallbackDates.length > 0) {
            setSelectedExpiry(fallbackDates[0]);
          }
        }
      } catch (error) {
        console.error('Error loading expirations:', error);
        // Fallback to generated dates
        const fallbackDates = generateExpiryDates();
        setExpiryDates(fallbackDates);
        if (fallbackDates.length > 0) {
          setSelectedExpiry(fallbackDates[0]);
        }
      }
      setLoading(false);
    };

    loadExpirations();
  }, [symbol]);

  // Load options chain when expiry changes
  useEffect(() => {
    if (!selectedExpiry) return;

    const loadOptionsChain = async () => {
      setLoading(true);
      try {
        const chains = await marketData.fetchOptionsChain(symbol, selectedExpiry);
        if (chains.length > 0 && (chains[0].calls.length > 0 || chains[0].puts.length > 0)) {
          setOptionsChain({
            calls: chains[0].calls || [],
            puts: chains[0].puts || [],
          });
        } else {
          // Generate fallback options data
          console.log('No options data from API, generating fallback');
          const fallbackChain = generateFallbackOptionsChain(symbol, currentPrice, selectedExpiry);
          setOptionsChain(fallbackChain);
        }
      } catch (error) {
        console.error('Error loading options chain:', error);
        // Generate fallback options data
        const fallbackChain = generateFallbackOptionsChain(symbol, currentPrice, selectedExpiry);
        setOptionsChain(fallbackChain);
      }
      setLoading(false);
    };

    loadOptionsChain();
  }, [symbol, selectedExpiry, currentPrice]);

  // Generate expiry dates (fallback)
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

  // Generate fallback options chain when API fails
  const generateFallbackOptionsChain = (_symbol: string, currentPrice: number, _expiry: string) => {
    const strikes: number[] = [];
    const strikeCount = 10;
    const strikeStep = currentPrice * 0.05; // 5% increments
    
    // Generate strikes around current price
    for (let i = -strikeCount / 2; i < strikeCount / 2; i++) {
      const strike = currentPrice + (i * strikeStep);
      if (strike > 0) {
        strikes.push(Math.round(strike * 100) / 100);
      }
    }
    
    const calls: OptionChainData[] = strikes.map(strike => {
      const inTheMoney = currentPrice > strike;
      const intrinsicValue = Math.max(0, currentPrice - strike);
      const timeValue = strike * 0.05 * (1 + Math.random() * 0.5);
      const premium = intrinsicValue + timeValue;
      
      return {
        strike,
        lastPrice: Math.round(premium * 100) / 100,
        bid: Math.round((premium * 0.95) * 100) / 100,
        ask: Math.round((premium * 1.05) * 100) / 100,
        volume: Math.floor(100 + Math.random() * 1000),
        openInterest: Math.floor(500 + Math.random() * 5000),
        impliedVolatility: 0.2 + Math.random() * 0.3,
        inTheMoney,
      };
    });
    
    const puts: OptionChainData[] = strikes.map(strike => {
      const inTheMoney = currentPrice < strike;
      const intrinsicValue = Math.max(0, strike - currentPrice);
      const timeValue = strike * 0.05 * (1 + Math.random() * 0.5);
      const premium = intrinsicValue + timeValue;
      
      return {
        strike,
        lastPrice: Math.round(premium * 100) / 100,
        bid: Math.round((premium * 0.95) * 100) / 100,
        ask: Math.round((premium * 1.05) * 100) / 100,
        volume: Math.floor(100 + Math.random() * 1000),
        openInterest: Math.floor(500 + Math.random() * 5000),
        impliedVolatility: 0.2 + Math.random() * 0.3,
        inTheMoney,
      };
    });
    
    return { calls, puts };
  };

  const handleOptionSelect = (option: OptionChainData) => {
    setSelectedOption(option);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedOption) {
      alert('Please select an option from the chain');
      return;
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1) {
      alert('Please enter a valid quantity');
      return;
    }

    const cost = selectedOption.lastPrice * qty * 100;
    if (cost > balance) {
      alert('Insufficient balance');
      return;
    }

    onBuyOption({
      symbol,
      type: optionType,
      strike: selectedOption.strike,
      expiry: selectedExpiry,
      premium: selectedOption.lastPrice,
      quantity: qty,
    });

    setQuantity('1');
    setSelectedOption(null);
  };

  const estimatedCost = selectedOption ? selectedOption.lastPrice * parseInt(quantity || '1') * 100 : 0;

  const currentOptions = optionType === 'call' ? optionsChain.calls : optionsChain.puts;

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
          <label>Expiry Date</label>
          <select
            value={selectedExpiry}
            onChange={(e) => setSelectedExpiry(e.target.value)}
            required
            disabled={loading}
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

        {loading ? (
          <div className="loading">Loading options chain...</div>
        ) : currentOptions.length > 0 ? (
          <div className="options-chain">
            <div className="chain-header">
              <span>Strike</span>
              <span>Last</span>
              <span>Bid/Ask</span>
              <span>Vol</span>
            </div>
            <div className="chain-list">
              {currentOptions
                .filter(opt => Math.abs(opt.strike - currentPrice) / currentPrice < 0.2) // Show strikes within 20% of current price
                .slice(0, 10) // Limit to 10 options
                .map((option) => (
                  <div
                    key={option.strike}
                    className={`chain-row ${selectedOption?.strike === option.strike ? 'selected' : ''} ${option.inTheMoney ? 'itm' : 'otm'}`}
                    onClick={() => handleOptionSelect(option)}
                  >
                    <span className="strike">${option.strike.toFixed(2)}</span>
                    <span className="last">${option.lastPrice.toFixed(2)}</span>
                    <span className="bid-ask">
                      ${option.bid.toFixed(2)}/${option.ask.toFixed(2)}
                    </span>
                    <span className="volume">{option.volume.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <div className="no-data">No options data available</div>
        )}

        {selectedOption && (
          <>
            <div className="selected-option-info">
              <h4>Selected Option</h4>
              <div className="info-grid">
                <div>
                  <label>Strike:</label>
                  <span>${selectedOption.strike.toFixed(2)}</span>
                </div>
                <div>
                  <label>Premium:</label>
                  <span>${selectedOption.lastPrice.toFixed(2)}</span>
                </div>
                <div>
                  <label>IV:</label>
                  <span>{(selectedOption.impliedVolatility * 100).toFixed(1)}%</span>
                </div>
                <div>
                  <label>OI:</label>
                  <span>{selectedOption.openInterest.toLocaleString()}</span>
                </div>
              </div>
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
          </>
        )}
      </form>
    </div>
  );
};
