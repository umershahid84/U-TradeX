import React, { useEffect, useRef, useState } from 'react';
import { PaperTradingAccount } from '../types';
import { Portfolio } from './Portfolio';
import './PortfolioBar.css';

interface PortfolioBarProps {
  account: PaperTradingAccount;
  onReset: () => void;
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** One-line portfolio summary (value and P&L) that opens the full portfolio as a dropdown */
export const PortfolioBar: React.FC<PortfolioBarProps> = ({ account, onReset }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const up = account.pnl >= 0;
  const holdings = account.positions.length + account.options.length;

  return (
    <div className="portfolio-bar" ref={ref}>
      <button
        type="button"
        className={`portfolio-summary ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="pb-label">Portfolio</span>
        <span className="pb-value">{money(account.totalValue)}</span>
        <span className={`pb-pnl ${up ? 'up' : 'down'}`}>
          {up ? '+' : '-'}{money(Math.abs(account.pnl))} ({account.pnlPercent >= 0 ? '+' : ''}{account.pnlPercent.toFixed(2)}%)
        </span>
        {holdings > 0 && <span className="pb-count" title="Open positions and options">{holdings}</span>}
        <span className="pb-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="portfolio-dropdown">
          <Portfolio account={account} onReset={onReset} />
        </div>
      )}
    </div>
  );
};
