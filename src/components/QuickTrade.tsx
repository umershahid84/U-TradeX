import React, { useState } from 'react';
import { Order } from '../types';
import './QuickTrade.css';

interface QuickTradeProps {
  symbol: string;
  currentPrice: number;
  onPlaceOrder: (order: Omit<Order, 'id' | 'status' | 'timestamp'>, takeProfit?: number, stopLoss?: number) => void;
}

/** Always-visible market buy/sell at the bottom of the sidebar. Limit orders live in the Trade tab. */
export const QuickTrade: React.FC<QuickTradeProps> = ({ symbol, currentPrice, onPlaceOrder }) => {
  const [quantity, setQuantity] = useState('1');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const qty = parseInt(quantity);
  const valid = Number.isFinite(qty) && qty > 0 && currentPrice > 0;

  const place = (side: 'buy' | 'sell') => {
    if (!valid) return;
    const tpv = parseFloat(tp);
    const slv = parseFloat(sl);
    onPlaceOrder(
      { symbol, type: 'market', side, quantity: qty, price: currentPrice },
      Number.isFinite(tpv) && tpv > 0 ? tpv : undefined,
      Number.isFinite(slv) && slv > 0 ? slv : undefined
    );
    setTp('');
    setSl('');
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
      <div className="qt-levels">
        <label>
          🎯 Take profit
          <input type="number" min="0" step="0.01" placeholder="optional" value={tp} onChange={(e) => setTp(e.target.value)} aria-label="Take profit price" />
        </label>
        <label>
          🛑 Stop loss
          <input type="number" min="0" step="0.01" placeholder="optional" value={sl} onChange={(e) => setSl(e.target.value)} aria-label="Stop loss price" />
        </label>
      </div>
      <div className="qt-buttons">
        <button type="button" className="qt-buy" disabled={!valid} onClick={() => place('buy')}>
          Buy / Long {valid ? `· $${(qty * currentPrice).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}
        </button>
        <button type="button" className="qt-sell" disabled={!valid} onClick={() => place('sell')}>
          Sell / Short
        </button>
      </div>
    </div>
  );
};
