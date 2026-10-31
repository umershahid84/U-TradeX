import React from 'react';
import { Toast } from '../types';
import './Toasts.css';

interface ToastsProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onSelectSymbol: (symbol: string) => void;
}

export const Toasts: React.FC<ToastsProps> = ({ toasts, onDismiss, onSelectSymbol }) => {
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-icon">🔔</span>
          <button
            type="button"
            className="toast-main"
            onClick={() => { if (t.symbol) onSelectSymbol(t.symbol); onDismiss(t.id); }}
          >
            <strong>{t.title}</strong>
            <span>{t.body}</span>
          </button>
          <button type="button" className="toast-x" onClick={() => onDismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
};
