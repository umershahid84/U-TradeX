import React, { useState } from 'react';
import { Order } from '../types';
import './TradingPanel.css';

interface TradingPanelProps {
  symbol: string;
  currentPrice: number;
  balance: number;
  onPlaceOrder: (order: Omit<Order, 'id' | 'status' | 'timestamp'>) => void;
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
    });

    setQuantity('1');
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
              BUY
            </button>
            <button
              type="button"
              className={side === 'sell' ? 'sell active' : 'sell'}
              onClick={() => setSide('sell')}
            >
              SELL
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
          Place {side.toUpperCase()} Order
        </button>
      </form>
    </div>
  );
};
