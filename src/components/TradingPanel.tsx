import React, { useState } from 'react';
import { Order, TrailingStop } from '../types';
import './TradingPanel.css';

interface TradingPanelProps {
  symbol: string;
  currentPrice: number;
  balance: number;
  onPlaceOrder: (order: Omit<Order, 'id' | 'status' | 'timestamp'>, takeProfit?: number, stopLoss?: number, trailing?: TrailingStop) => void;
}

export const TradingPanel: React.FC<TradingPanelProps> = ({
  symbol,
  currentPrice,
  balance,
  onPlaceOrder,
}) => {
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState<string>('1');
  const [tp, setTp] = useState<string>('');
  const [sl, setSl] = useState<string>('');
  const [trail, setTrail] = useState<string>('');
  const [limitPrice, setLimitPrice] = useState<string>(currentPrice.toFixed(2));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      alert('Please enter a valid quantity');
      return;
    }

    const price = orderType === 'market' ? currentPrice : parseFloat(limitPrice);
    if (isNaN(price) || price <= 0) {
      alert('Please enter a valid price');
      return;
    }

    onPlaceOrder({
      symbol,
      type: orderType,
      side,
      quantity: qty,
      price,
    }, parseFloat(tp) > 0 ? parseFloat(tp) : undefined, parseFloat(sl) > 0 ? parseFloat(sl) : undefined,
      parseFloat(trail) > 0 ? { type: 'percent', value: parseFloat(trail) } : undefined);

    setQuantity('1');
    setTp('');
    setSl('');
    setTrail('');
  };

  const estimatedCost = parseFloat(quantity) * (orderType === 'market' ? currentPrice : parseFloat(limitPrice) || 0);

  return (
    <div className="trading-panel">
      <h3 className="panel-title">Place Order</h3>
      
      <div className="order-type-selector">
        <button
          className={orderType === 'market' ? 'active' : ''}
          onClick={() => setOrderType('market')}
        >
          Market
        </button>
        <button
          className={orderType === 'limit' ? 'active' : ''}
          onClick={() => setOrderType('limit')}
        >
          Limit
        </button>
      </div>

      <form onSubmit={handleSubmit} className="order-form">
        <div className="form-group">
          <label>Side</label>
          <div className="side-selector">
            <button
              type="button"
              className={side === 'buy' ? 'buy active' : 'buy'}
              onClick={() => setSide('buy')}
            >
              BUY / LONG
            </button>
            <button
              type="button"
              className={side === 'sell' ? 'sell active' : 'sell'}
              onClick={() => setSide('sell')}
            >
              SELL / SHORT
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Quantity</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min="1"
            step="1"
          />
        </div>

        {orderType === 'limit' && (
          <div className="form-group">
            <label>Limit Price</label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              min="0.01"
              step="0.01"
            />
          </div>
        )}

        <div className="form-group">
          <label>🎯 Take profit / 🛑 Stop loss / ⟲ Trailing % (optional, close the position automatically{orderType === 'limit' ? ' once the limit order fills' : ''})</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" min="0" step="0.01" placeholder="Take profit" value={tp} onChange={(e) => setTp(e.target.value)} />
            <input type="number" min="0" step="0.01" placeholder="Stop loss" value={sl} onChange={(e) => setSl(e.target.value)} />
            <input type="number" min="0" step="0.1" placeholder="Trail %" value={trail} onChange={(e) => setTrail(e.target.value)} />
          </div>
        </div>

        <div className="order-summary">
          <div className="summary-row">
            <span>Current Price:</span>
            <span className="price">${currentPrice.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span>Estimated Cost:</span>
            <span className="cost">${estimatedCost.toFixed(2)}</span>
          </div>
          <div className="summary-row">
            <span>Available Balance:</span>
            <span className="balance">${balance.toFixed(2)}</span>
          </div>
        </div>

        <button
          type="submit"
          className={`submit-btn ${side}`}
          disabled={side === 'buy' && estimatedCost > balance}
        >
          Place {side === 'buy' ? 'BUY / LONG' : 'SELL / SHORT'} Order
        </button>
      </form>
    </div>
  );
};
