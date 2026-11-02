import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PnLCardData, renderPnLCard, CARD_W, CARD_H } from '../utils/pnlCard';
import './PnLCardDialog.css';

interface Props {
  data: PnLCardData;
  onClose: () => void;
}

const load = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

/** Preview of a P&L card with download, share and copy; amounts can be hidden to share only the percentage */
export const PnLCardDialog: React.FC<Props> = ({ data, onClose }) => {
  const [showAmounts, setShowAmounts] = useState(() => load('pnlCardAmounts', 'true') === 'true');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (load('pnlCardTheme', 'dark') === 'light' ? 'light' : 'dark'));
  const [note, setNote] = useState('');
  const host = useRef<HTMLDivElement>(null);

  const canvas = useMemo(() => renderPnLCard(data, { showAmounts, theme }), [data, showAmounts, theme]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    canvas.className = 'pnl-card-canvas';
    el.replaceChildren(canvas);
  }, [canvas]);

  useEffect(() => {
    try {
      localStorage.setItem('pnlCardAmounts', String(showAmounts));
      localStorage.setItem('pnlCardTheme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [showAmounts, theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fileName = `${data.kind === 'day' ? 'daily-pnl' : `${data.headline}-pnl`}-${new Date().toISOString().slice(0, 10)}.png`.replace(/\s+/g, '-');
  const toBlob = () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(''), 2500);
  };

  const download = async () => {
    const blob = await toBlob();
    if (!blob) return flash('Could not create the image');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  const share = async () => {
    const blob = await toBlob();
    if (!blob) return flash('Could not create the image');
    const file = new File([blob], fileName, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'U-TradeX P&L' });
      else await download();
    } catch {
      /* share sheet dismissed */
    }
  };

  const copy = async () => {
    const blob = await toBlob();
    if (!blob) return flash('Could not create the image');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash('Image copied to the clipboard');
    } catch {
      flash('Copy is not supported here, use Download');
    }
  };

  return (
    <div className="pnl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pnl-dialog" role="dialog" aria-label="P&L card">
        <div className="pnl-head">
          <strong>{data.kind === 'day' ? 'Daily P&L card' : `${data.headline} P&L card`}</strong>
          <button type="button" className="pnl-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div ref={host} className="pnl-preview" style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }} />
        <div className="pnl-options">
          <label><input type="checkbox" checked={showAmounts} onChange={(e) => setShowAmounts(e.target.checked)} /> Show dollar amounts</label>
          <label>
            Style{' '}
            <select value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
        <div className="pnl-actions">
          <button type="button" className="primary" onClick={download}>⬇ Download</button>
          {canShareFiles && <button type="button" onClick={share}>📤 Share</button>}
          <button type="button" onClick={copy}>📋 Copy image</button>
        </div>
        {note && <div className="pnl-note">{note}</div>}
      </div>
    </div>
  );
};
