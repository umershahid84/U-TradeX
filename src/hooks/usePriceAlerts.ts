import { useCallback, useEffect, useRef, useState } from 'react';
import { PriceAlert, Toast } from '../types';

const STORAGE_KEY = 'priceAlerts';

const load = (): PriceAlert[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

// Short two-tone chime; silent if the browser blocks audio before any interaction
const chime = () => {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.32);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {
    /* no audio */
  }
};

/**
 * Price alerts, saved in the browser. `check(symbol, price)` is called with every price update;
 * an alert fires once when the price reaches its level, then stays in the list as history.
 */
export const usePriceAlerts = () => {
  const [alerts, setAlerts] = useState<PriceAlert[]>(load);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
    } catch {
      /* storage unavailable */
    }
  }, [alerts]);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const addAlert = useCallback((symbol: string, price: number, currentPrice: number) => {
    if (!Number.isFinite(price) || price <= 0) return false;
    const alert: PriceAlert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      symbol,
      price: Math.round(price * 100) / 100,
      direction: price >= currentPrice ? 'above' : 'below',
      createdAt: Date.now(),
    };
    setAlerts((prev) => [...prev, alert]);
    // Ask once, on the user's own action, so alerts can reach them when the tab is in the background
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    return true;
  }, []);

  const removeAlert = useCallback((id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)), []);
  const clearTriggered = useCallback(() => setAlerts((prev) => prev.filter((a) => !a.triggeredAt)), []);

  const check = useCallback((symbol: string, price: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    const hits = alertsRef.current.filter(
      (a) =>
        !a.triggeredAt &&
        a.symbol.toUpperCase() === symbol.toUpperCase() &&
        (a.direction === 'above' ? price >= a.price : price <= a.price)
    );
    if (!hits.length) return;

    const ids = new Set(hits.map((h) => h.id));
    // update the ref now so a second price tick can't fire the same alert again
    alertsRef.current = alertsRef.current.map((a) =>
      ids.has(a.id) ? { ...a, triggeredAt: Date.now(), triggeredPrice: price } : a
    );
    setAlerts(alertsRef.current);

    hits.forEach((h) => {
      const title = `${h.symbol} ${h.direction === 'above' ? 'rose to' : 'fell to'} $${h.price.toFixed(2)}`;
      const body = `Last price $${price.toFixed(2)}`;
      setToasts((t) => [...t, { id: `${h.id}-t`, title, body, symbol: h.symbol }]);
      setTimeout(() => dismissToast(`${h.id}-t`), 12000);
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`🔔 ${title}`, { body });
        } catch {
          /* some mobile browsers only allow service-worker notifications */
        }
      }
    });
    chime();
  }, [dismissToast]);

  return { alerts, toasts, addAlert, removeAlert, clearTriggered, check, dismissToast };
};
