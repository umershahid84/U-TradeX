import React, { useState } from 'react';
import { PaperTradingAccount, Order } from '../types';
import './PositionsStrip.css';

interface PositionsStripProps {
  account: PaperTradingAccount;
  open: boolean;
  onToggle: () => void;
  onSelectSymbol: (symbol: string) => void;
  onClosePosition: (symbol: string, quantity: number, price: number) => void;
  onCancelOrder: (id: string) => void;
}

type Tab = 'positions' | 'options' | 'orders';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const signedMoney = (n: number) => `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}`;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/** Collapsible table of open positions, option contracts and orders along the bottom of the chart */
export const PositionsStrip: React.FC<PositionsStripProps> = ({
  account, open, onToggle, onSelectSymbol, onClosePosition, onCancelOrder,
}) => {
  const [tab, setTab] = useState<Tab>('positions');

  const optionRows = account.options.map((o) => {
    const cost = o.premium * o.quantity * 100;
    const value = (o.currentPremium ?? o.premium) * o.quantity * 100;
    return { o, cost, value, pnl: value - cost };
  });
  const orders: Order[] = [...account.orders].sort((a, b) => b.timestamp - a.timestamp);
  const pending = orders.filter((o) => o.status === 'pending').length;
  const stockPnl = account.positions.reduce((s, p) => s + p.pnl, 0);
  const optionPnl = optionRows.reduce((s, r) => s + r.pnl, 0);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'positions', label: 'Positions', count: account.positions.length },
    { id: 'options', label: 'Options', count: account.options.length },
    { id: 'orders', label: 'Orders', count: orders.length },
  ];

  return (
    <section className={`positions-strip ${open ? 'open' : ''}`}>
      <div className="ps-bar">
        <button type="button" className="ps-toggle" onClick={onToggle} aria-expanded={open}>
          <span className="ps-caret">{open ? '▾' : '▸'}</span>
          {open ? (
            <span className="ps-tabs" onClick={(e) => e.stopPropagation()}>
              {tabs.map((t) => (
                <span
                  key={t.id}
                  role="tab"
                  className={tab === t.id ? 'active' : ''}
                  onClick={() => setTab(t.id)}
                >
                  {t.label} <b>{t.count}</b>
                </span>
              ))}
            </span>
          ) : (
            <span className="ps-summary">
              Positions <b>{account.positions.length}</b>
              {account.positions.length > 0 && <em className={stockPnl >= 0 ? 'up' : 'down'}> {signedMoney(stockPnl)}</em>}
              <i>·</i> Options <b>{account.options.length}</b>
              {account.options.length > 0 && <em className={optionPnl >= 0 ? 'up' : 'down'}> {signedMoney(optionPnl)}</em>}
              <i>·</i> Orders <b>{orders.length}</b>
              {pending > 0 && <em className="pending"> {pending} pending</em>}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="ps-body">
          {tab === 'positions' && (
            account.positions.length === 0 ? (
              <div className="ps-empty">No open positions. Place a trade to see it here.</div>
            ) : (
              <table className="ps-table">
                <thead>
                  <tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>Last</th><th>P&amp;L</th><th>%</th><th /></tr>
                </thead>
                <tbody>
                  {account.positions.map((p) => (
                    <tr key={p.symbol}>
                      <td><button type="button" className="ps-link" onClick={() => onSelectSymbol(p.symbol)}>{p.symbol}</button></td>
                      <td>{p.quantity}</td>
                      <td>{money(p.avgPrice)}</td>
                      <td>{money(p.currentPrice)}</td>
                      <td className={p.pnl >= 0 ? 'up' : 'down'}>{signedMoney(p.pnl)}</td>
                      <td className={p.pnl >= 0 ? 'up' : 'down'}>{pct(p.pnlPercent)}</td>
                      <td>
                        <button type="button" className="ps-action" onClick={() => onClosePosition(p.symbol, p.quantity, p.currentPrice)}>
                          Close
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'options' && (
            optionRows.length === 0 ? (
              <div className="ps-empty">No option contracts. Buy one from the Options tab.</div>
            ) : (
              <table className="ps-table">
                <thead>
                  <tr><th>Contract</th><th>Expiry</th><th>Qty</th><th>Paid</th><th>Est. value</th><th>P&amp;L</th></tr>
                </thead>
                <tbody>
                  {optionRows.map(({ o, cost, value, pnl }, i) => (
                    <tr key={i}>
                      <td>
                        <button type="button" className="ps-link" onClick={() => onSelectSymbol(o.symbol)}>{o.symbol}</button>{' '}
                        ${o.strike} <span className={`ps-type ${o.type}`}>{o.type.toUpperCase()}</span>
                      </td>
                      <td>{o.expiry}</td>
                      <td>{o.quantity}</td>
                      <td>{money(cost)}</td>
                      <td>{money(value)}</td>
                      <td className={pnl >= 0 ? 'up' : 'down'}>
                        {signedMoney(pnl)} <small>({pct(cost > 0 ? (pnl / cost) * 100 : 0)})</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'orders' && (
            orders.length === 0 ? (
              <div className="ps-empty">No orders yet.</div>
            ) : (
              <table className="ps-table">
                <thead>
                  <tr><th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>{new Date(o.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                      <td><button type="button" className="ps-link" onClick={() => onSelectSymbol(o.symbol)}>{o.symbol}</button></td>
                      <td className={o.side === 'buy' ? 'up' : 'down'}>{o.side.toUpperCase()}</td>
                      <td>{o.type}</td>
                      <td>{o.quantity}</td>
                      <td>{money(o.price)}</td>
                      <td><span className={`ps-status ${o.status}`}>{o.status}</span></td>
                      <td>
                        {o.status === 'pending' && (
                          <button type="button" className="ps-action" onClick={() => onCancelOrder(o.id)}>Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      )}
    </section>
  );
};
