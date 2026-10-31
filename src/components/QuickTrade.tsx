import React, { useState } from 'react';
import { Order } from '../types';
import './QuickTrade.css';

interface QuickTradeProps {
  symbol: string;
  currentPrice: number;
  onPlaceOrder: (order: Omit<Order, 'id' | 'status' | 'timestamp'>) => void;
}

/** Always-visible market buy/sell at the bottom of the sidebar. Limit orders live in the Trade tab. */
export const QuickTrade: React.FC<QuickTradeProps> = ({ symbol, currentPrice, onPlaceOrder }) => {
  const [quantity, setQuantity] = useState('1');
  const qty = parseInt(quantity);
  const valid = Number.isFinite(qty) && qty > 0 && currentPrice > 0;

  const place = (side: 'buy' | 'sell') => {
    if (!valid) return;
    onPlaceOrder({ symbol, type: 'market', side, quantity: qty, price: currentPrice });
  };

  return (
    <div className="quick-trade">
      <div className="qt-top">
        <span className="qt-symbol">{symbol}</span>
        <span className="qt-price">${currentPrice.toFixed(2)}</span>
        <label className="qt-qty">
          Qty
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            aria-label="Quantity"
          />
        </label>
      </div>
      <div className="qt-buttons">
        <button type="button" className="qt-buy" disabled={!valid} onClick={() => place('buy')}>
          Buy {valid ? `· $${(qty * currentPrice).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}
        </button>
        <button type="button" className="qt-sell" disabled={!valid} onClick={() => place('sell')}>
          Sell
        </button>
      </div>
    </div>
  );
};
