import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ISeriesApi, ISeriesMarkersPluginApi, Time, createSeriesMarkers } from 'lightweight-charts';
import { ChartData } from '../types';
import { PoliticianTrade, fetchPoliticianTrades } from '../services/politicians';
import { buildPolMarkers } from '../utils/polMarkers';

interface Props {
  seriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  symbol: string;
  bars: ChartData[];
  /** Reports "n trades" or why there are none, for the toolbar tooltip */
  onStatus?: (text: string) => void;
}

/** Draws members of Congress's disclosed buys and sells of the charted symbol as markers (renders nothing itself) */
export const PoliticianMarkers: React.FC<Props> = ({ seriesRef, symbol, bars, onStatus }) => {
  const [trades, setTrades] = useState<PoliticianTrade[]>([]);
  const plugin = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    let live = true;
    setTrades([]);
    onStatus?.('Loading…');
    fetchPoliticianTrades(symbol)
      .then((d) => {
        if (!live) return;
        setTrades(d.trades);
        onStatus?.(`${d.trades.length} disclosed trades · ${d.source}`);
      })
      .catch((e: unknown) => live && onStatus?.(e instanceof Error ? e.message : 'Unavailable'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const markers = useMemo(() => buildPolMarkers(trades, bars), [trades, bars]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!plugin.current) plugin.current = createSeriesMarkers(series, []);
    try {
      plugin.current.setMarkers(
        markers.map((m) => ({
          time: m.time as Time,
          position: m.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
          color: m.side === 'buy' ? '#26a69a' : '#ef5350',
          shape: m.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
          text: `🏛 ${m.side === 'buy' ? 'B' : 'S'}${m.count > 1 ? ` ×${m.count}` : ''}`,
        }))
      );
    } catch {
      /* series replaced */
    }
  }, [markers, seriesRef]);

  useEffect(
    () => () => {
      try {
        plugin.current?.setMarkers([]);
        plugin.current?.detach();
      } catch {
        /* series replaced */
      }
      plugin.current = null;
    },
    []
  );

  return null;
};
