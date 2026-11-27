import React, { useEffect, useRef, useState } from 'react';
import type { WsPreset } from '../App';
import './Workspace.css';

interface Props {
  preset: WsPreset;
  onPreset: (p: WsPreset) => void;
  locked: boolean;
  onLock: (v: boolean) => void;
  onReset: () => void;
}

const PRESETS: { id: WsPreset; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard', hint: 'Chart, positions below, sidebar on the right' },
  { id: 'chart', label: 'Chart focus', hint: 'A wide chart and a slim sidebar' },
  { id: 'wide', label: 'Wide sidebar', hint: 'More room for scanner and air gap lists' },
];

/** Top-bar menu for the draggable layout: pick an arrangement, lock it, or put it back to the default */
export const LayoutMenu: React.FC<Props> = ({ preset, onPreset, locked, onLock, onReset }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className="ws-menu-wrap" ref={ref}>
      <button type="button" className="ws-menu-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title="Arrange the screen">
        ▦ Layout {locked ? '🔒' : ''}
      </button>
      {open && (
        <div className="ws-menu" role="menu">
          <h5>Arrangement</h5>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="menuitem" className={preset === p.id ? 'on' : ''} onClick={() => { onPreset(p.id); setOpen(false); }}>
              {p.label}
              <small>{p.hint}</small>
            </button>
          ))}
          <h5>Panels</h5>
          <button type="button" role="menuitem" onClick={() => { onLock(!locked); setOpen(false); }}>
            {locked ? '🔓 Unlock to drag and resize' : '🔒 Lock the arrangement'}
            <small>{locked ? 'Panels show their grip bars again' : 'Hides the grip bars and stops accidental moves'}</small>
          </button>
          <button type="button" role="menuitem" onClick={() => { onReset(); setOpen(false); }}>
            ↺ Reset this arrangement
            <small>Back to its default positions and sizes</small>
          </button>
        </div>
      )}
    </div>
  );
};
