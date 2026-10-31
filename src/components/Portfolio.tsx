import React from 'react';
import { PaperTradingAccount, Position } from '../types';
import './Portfolio.css';

interface PortfolioProps {
  account: PaperTradingAccount;
  onReset: () => void;
}

export const Portfolio: React.FC<PortfolioProps> = ({ account, onReset }) => {
  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset your paper trading account?')) {
      onReset();
    }
  };

  return (
    <div className="portfolio">
      <div className="portfolio-header">
        <h3>Portfolio</h3>
        <button onClick={handleReset} className="reset-btn">
          Reset Account
        </button>
      </div>

      <div className="account-summary">
        <div className="summary-card">
          <div className="card-label">Cash Balance</div>
          <div className="card-value">${account.balance.toFixed(2)}</div>
        </div>
        <div className="summary-card">
          <div className="card-label">Total Value</div>
          <div className="card-value">${account.totalValue.toFixed(2)}</div>
        </div>
        <div className="summary-card">
          <div className="card-label">P&L</div>
          <div className={`card-value ${account.pnl >= 0 ? 'positive' : 'negative'}`}>
            ${account.pnl.toFixed(2)} ({account.pnlPercent.toFixed(2)}%)
          </div>
        </div>
      </div>

      <div className="positions-section">
        <h4>Positions ({account.positions.length})</h4>
        {account.positions.length === 0 ? (
          <div className="empty-state">No open positions</div>
        ) : (
          <div className="positions-list">
            {account.positions.map((position) => (
              <PositionCard key={position.symbol} position={position} />
            ))}
          </div>
        )}
      </div>

      <div className="orders-section">
        <h4>Recent Orders ({account.orders.length})</h4>
        {account.orders.length === 0 ? (
          <div className="empty-state">No orders yet</div>
        ) : (
          <div className="orders-list">
            {account.orders.slice(-5).reverse().map((order) => (
              <div key={order.id} className="order-item">
                <div className="order-info">
                  <span className={`order-side ${order.side}`}>
                    {order.side.toUpperCase()}
                  </span>
                  <span className="order-symbol">{order.symbol}</span>
                  <span className="order-qty">{order.quantity} @ ${order.price.toFixed(2)}</span>
                </div>
                <span className={`order-status ${order.status}`}>
                  {order.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {account.options.length > 0 && (
        <div className="options-section">
          <h4>Options ({account.options.length})</h4>
          <div className="options-list">
            {account.options.map((option, index) => {
              const cost = option.premium * option.quantity * 100;
              const value = (option.currentPremium ?? option.premium) * option.quantity * 100;
              const pnl = value - cost;
              const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
              const expired = Date.parse(`${option.expiry}T20:00:00Z`) < Date.now();
              return (
                <div key={index} className="option-item">
                  <div className="option-info">
                    <span className={`option-type ${option.type}`}>
                      {option.type.toUpperCase()}
                    </span>
                    <span>{option.symbol}</span>
                    <span>${option.strike}</span>
                    <span>{option.expiry}{expired ? ' (expired)' : ''}</span>
                  </div>
                  <div className="option-value">
                    <div>{option.quantity} contracts @ ${option.premium.toFixed(2)}</div>
                    <div className="option-pnl">
                      Est. value ${value.toFixed(0)}{' '}
                      <span className={pnl >= 0 ? 'gain' : 'loss'}>
                        {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(0)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const PositionCard: React.FC<{ position: Position }> = ({ position }) => {
  return (
    <div className="position-card">
      <div className="position-header">
        <span className="position-symbol">{position.symbol}</span>
        <span className="position-qty">{position.quantity} shares</span>
      </div>
      <div className="position-details">
        <div className="detail-row">
          <span>Avg Price:</span>
          <span>${position.avgPrice.toFixed(2)}</span>
        </div>
        <div className="detail-row">
          <span>Current:</span>
          <span>${position.currentPrice.toFixed(2)}</span>
        </div>
        <div className="detail-row">
          <span>P&L:</span>
          <span className={position.pnl >= 0 ? 'positive' : 'negative'}>
            ${position.pnl.toFixed(2)} ({position.pnlPercent.toFixed(2)}%)
          </span>
        </div>
      </div>
    </div>
  );
};
