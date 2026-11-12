import { useState, useEffect, useCallback, useRef } from 'react';
import { PaperTradingAccount, Order, Position, OptionContract, ClosedTrade } from '../types';
import { bsPrice, yearsToExpiry } from '../utils/optionPricing';

const DEFAULT_BALANCE = 100000;
let fallbackOrderCounter = 0;

const createDefaultAccount = (): PaperTradingAccount => ({
  balance: DEFAULT_BALANCE,
  initialBalance: DEFAULT_BALANCE,
  positions: [],
  orders: [],
  options: [],
  closedTrades: [],
  totalValue: DEFAULT_BALANCE,
  pnl: 0,
  pnlPercent: 0,
});

const generateOrderId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackOrderCounter += 1;
  return `${Date.now()}-${fallbackOrderCounter}`;
};

const recalculateAccountTotals = (account: PaperTradingAccount): PaperTradingAccount => {
  const positionsValue = account.positions.reduce(
    (sum, position) => sum + position.currentPrice * position.quantity,
    0
  );
  const optionsValue = account.options.reduce(
    (sum, option) => sum + (option.currentPremium ?? option.premium) * option.quantity * 100,
    0
  );
  const totalValue = account.balance + positionsValue + optionsValue;
  const pnl = totalValue - account.initialBalance;
  const pnlPercent = account.initialBalance > 0 ? (pnl / account.initialBalance) * 100 : 0;

  return {
    ...account,
    totalValue,
    pnl,
    pnlPercent,
  };
};

const loadSavedAccount = (): PaperTradingAccount => {
  try {
    const saved = localStorage.getItem('paperTradingAccount');
    if (!saved) {
      return createDefaultAccount();
    }

    const parsed = JSON.parse(saved) as Partial<PaperTradingAccount>;
    const base = createDefaultAccount();
    const normalized: PaperTradingAccount = {
      ...base,
      ...parsed,
      balance: typeof parsed.balance === 'number' ? parsed.balance : base.balance,
      initialBalance: typeof parsed.initialBalance === 'number' ? parsed.initialBalance : base.initialBalance,
      positions: Array.isArray(parsed.positions) ? parsed.positions : base.positions,
      orders: Array.isArray(parsed.orders) ? parsed.orders : base.orders,
      options: Array.isArray(parsed.options) ? parsed.options : base.options,
      // accounts saved before the history existed: rebuild it from the closing fills they recorded
      closedTrades: Array.isArray(parsed.closedTrades)
        ? parsed.closedTrades
        : (Array.isArray(parsed.orders) ? parsed.orders : [])
            .filter((o) => o.status === 'filled' && o.realizedPnl !== undefined && o.entryPrice !== undefined)
            .map((o): ClosedTrade => {
              const long = o.option ? true : o.side === 'sell';
              return {
                id: o.id,
                symbol: o.symbol,
                kind: o.option ? 'option' : 'stock',
                side: long ? 'long' : 'short',
                quantity: o.quantity,
                entryPrice: o.entryPrice!,
                exitPrice: o.price,
                pnl: o.realizedPnl!,
                pnlPct: o.entryPrice! > 0 ? ((o.price - o.entryPrice!) / o.entryPrice!) * 100 * (long ? 1 : -1) : null,
                closedAt: o.timestamp,
                option: o.option,
              };
            }),
    };

    return recalculateAccountTotals(normalized);
  } catch (error) {
    console.warn('Failed to load saved paper trading account. Using defaults.', error);
    return createDefaultAccount();
  }
};

export const usePaperTrading = () => {
  const [account, setAccount] = useState<PaperTradingAccount>(() => {
    return loadSavedAccount();
  });

  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  useEffect(() => {
    try {
      localStorage.setItem('paperTradingAccount', JSON.stringify(account));
    } catch (error) {
      console.warn('Failed to persist paper trading account', error);
    }
  }, [account]);

  // Signed positions: quantity > 0 is long, < 0 is a short. Selling beyond what you own opens/extends a short.
  const executeMarketOrder = useCallback((prev: PaperTradingAccount, order: Order): { nextAccount: PaperTradingAccount; error?: string } => {
    const value = order.quantity * order.price;
    const delta = order.side === 'buy' ? order.quantity : -order.quantity;
    const existing = prev.positions.find((p) => p.symbol === order.symbol);
    const held = existing?.quantity ?? 0;
    const newQty = held + delta;

    if (order.side === 'buy' && value > prev.balance) {
      return { nextAccount: prev, error: 'Insufficient balance' };
    }
    if (order.side === 'sell' && newQty < 0) {
      // Opening or growing a short: keep the short exposure within available cash
      const shortExposure = prev.positions
        .filter((p) => p.quantity < 0 && p.symbol !== order.symbol)
        .reduce((sum, p) => sum + Math.abs(p.quantity) * p.currentPrice, 0) + Math.abs(newQty) * order.price;
      if (shortExposure > prev.balance + Math.max(held, 0) * order.price) {
        return { nextAccount: prev, error: 'Not enough buying power to short that many shares' };
      }
    }

    // closing against an existing position locks in profit; record it on the fill (for P&L cards)
    let entryPrice: number | undefined;
    let realizedPnl: number | undefined;
    if (existing && Math.sign(held) !== Math.sign(delta)) {
      const closed = Math.min(Math.abs(held), order.quantity);
      entryPrice = existing.avgPrice;
      realizedPnl = (order.price - existing.avgPrice) * closed * Math.sign(held);
    }

    let newPositions: Position[];
    if (newQty === 0) {
      newPositions = prev.positions.filter((p) => p.symbol !== order.symbol);
    } else if (!existing) {
      newPositions = [
        ...prev.positions,
        { symbol: order.symbol, quantity: newQty, avgPrice: order.price, currentPrice: order.price, pnl: 0, pnlPercent: 0, openedAt: order.timestamp },
      ];
    } else {
      const sameDirection = Math.sign(held) === Math.sign(delta);
      const crossed = Math.sign(newQty) !== Math.sign(held);
      const avgPrice = sameDirection
        ? (existing.avgPrice * Math.abs(held) + order.price * order.quantity) / Math.abs(newQty)
        : crossed
          ? order.price
          : existing.avgPrice;
      newPositions = prev.positions.map((p) =>
        p.symbol === order.symbol ? { ...p, quantity: newQty, avgPrice, openedAt: crossed ? order.timestamp : p.openedAt ?? order.timestamp } : p
      );
    }

    const next = {
      ...prev,
      balance: order.side === 'buy' ? prev.balance - value : prev.balance + value,
      positions: newPositions,
      orders: [...prev.orders, { ...order, status: 'filled' as const, entryPrice, realizedPnl }],
      closedTrades:
        realizedPnl !== undefined && entryPrice !== undefined && existing
          ? [
              ...prev.closedTrades,
              {
                id: order.id,
                symbol: order.symbol,
                kind: 'stock' as const,
                side: held > 0 ? ('long' as const) : ('short' as const),
                quantity: Math.min(Math.abs(held), order.quantity),
                entryPrice,
                exitPrice: order.price,
                pnl: realizedPnl,
                pnlPct: entryPrice > 0 ? ((order.price - entryPrice) / entryPrice) * 100 * Math.sign(held) : null,
                openedAt: existing.openedAt,
                closedAt: order.timestamp,
              },
            ]
          : prev.closedTrades,
    };
    return { nextAccount: recalculateAccountTotals(next) };
  }, []);

  const clearClosedTrades = useCallback(() => {
    setAccount((prev) => ({ ...prev, closedTrades: [] }));
  }, []);

  const resetAccount = useCallback(() => {
    setAccount(createDefaultAccount());
  }, []);

  const placeOrder = useCallback((order: Omit<Order, 'id' | 'status' | 'timestamp'>) => {
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
      alert('Quantity must be a positive number');
      return;
    }
    if (!Number.isFinite(order.price) || order.price <= 0) {
      alert('Price must be a positive number');
      return;
    }

    const newOrder: Order = {
      ...order,
      id: generateOrderId(),
      status: 'pending',
      timestamp: Date.now(),
    };

    if (newOrder.type === 'market') {
      const result = executeMarketOrder(accountRef.current, newOrder);
      if (result.error) {
        alert(result.error);
        return;
      }
      accountRef.current = result.nextAccount;
      setAccount(result.nextAccount);
    } else {
      setAccount((prev) =>
        recalculateAccountTotals({
          ...prev,
          orders: [...prev.orders, newOrder],
        })
      );
    }
  }, [executeMarketOrder]);

  const cancelOrder = useCallback((orderId: string) => {
    setAccount((prev) =>
      recalculateAccountTotals({
        ...prev,
        orders: prev.orders.map((o) =>
          o.id === orderId ? { ...o, status: 'cancelled' as const } : o
        ),
      })
    );
  }, []);

  const updatePositionPrices = useCallback((symbol: string, currentPrice: number) => {
    setAccount((prev) =>
      recalculateAccountTotals({
        ...prev,
        positions: prev.positions.map((p) => {
          if (p.symbol === symbol) {
            const pnl = (currentPrice - p.avgPrice) * p.quantity;
            const pnlPercent = ((currentPrice - p.avgPrice) / p.avgPrice) * 100 * Math.sign(p.quantity || 1);
            return { ...p, currentPrice, pnl, pnlPercent };
          }
          return p;
        }),
        // Re-estimate open option contracts on this underlying with Black-Scholes, unless a real quote is fresh
        options: prev.options.map((o) =>
          o.symbol === symbol && (o.impliedVolatility ?? 0) >= 0.05 && !(o.quotedAt && Date.now() - o.quotedAt < 30_000)
            ? {
                ...o,
                currentPremium: bsPrice(o.type, currentPrice, o.strike, o.impliedVolatility ?? 0, yearsToExpiry(o.expiry)),
              }
            : o
        ),
      })
    );
  }, []);

  // Real option marks (from the quote feed) replace the model estimate for the contracts they match
  const setOptionPremiums = useCallback((updates: { key: string; mark: number }[]) => {
    if (!updates.length) return;
    const by = new Map(updates.map((u) => [u.key, u.mark]));
    setAccount((prev) =>
      recalculateAccountTotals({
        ...prev,
        options: prev.options.map((o) => {
          const mark = by.get(`${o.symbol}|${o.expiry}|${o.strike}|${o.type}`);
          return mark != null && mark > 0 ? { ...o, currentPremium: mark, quotedAt: Date.now() } : o;
        }),
      })
    );
  }, []);

  const buyOption = useCallback((option: Omit<OptionContract, 'quantity'> & { quantity: number }) => {
    const cost = option.premium * option.quantity * 100; // Options are typically 100 shares
    if (!Number.isFinite(option.quantity) || option.quantity < 1) {
      alert('Option quantity must be a positive number');
      return;
    }
    if (!Number.isFinite(option.premium) || option.premium <= 0) {
      alert('Option premium must be a positive number');
      return;
    }

    let error: string | undefined;
    setAccount((prev) => {
      if (cost > prev.balance) {
        error = 'Insufficient balance';
        return prev;
      }
      return recalculateAccountTotals({
        ...prev,
        balance: prev.balance - cost,
        options: [...prev.options, { ...option, openedAt: option.openedAt ?? Date.now() }],
      });
    });

    if (error) {
      alert(error);
    }
  }, []);

  // Fill resting limit orders for a symbol once the price reaches them (buy at or below, sell at or above).
  // Returns the orders that filled so the caller can arm their take-profit / stop-loss.
  const fillPendingOrders = useCallback((symbol: string, price: number): Order[] => {
    const due = accountRef.current.orders.filter(
      (o) => o.status === 'pending' && o.type === 'limit' && o.symbol === symbol && (o.side === 'buy' ? price <= o.price : price >= o.price)
    );
    if (!due.length) return [];
    const filled: Order[] = [];
    let acc = accountRef.current;
    for (const order of due) {
      const without = { ...acc, orders: acc.orders.filter((o) => o.id !== order.id) };
      const result = executeMarketOrder(without, { ...order, status: 'filled' });
      if (result.error) {
        // can no longer be paid for / covered: cancel it rather than leave it hanging
        acc = { ...acc, orders: acc.orders.map((o) => (o.id === order.id ? { ...o, status: 'cancelled' as const } : o)) };
      } else {
        acc = result.nextAccount;
        filled.push(order);
      }
    }
    accountRef.current = acc;
    setAccount(acc);
    return filled;
  }, [executeMarketOrder]);

  // Sell (close) some or all contracts of a held option at its current estimated value
  const sellOption = useCallback((index: number, quantity: number) => {
    const held = accountRef.current.options[index];
    if (!held) {
      alert('That option position no longer exists');
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > held.quantity) {
      alert(`Enter a quantity between 1 and ${held.quantity}`);
      return;
    }
    const premium = held.currentPremium ?? held.premium;
    const proceeds = premium * quantity * 100;
    const remaining = held.quantity - quantity;
    const prev = accountRef.current;
    const next = recalculateAccountTotals({
      ...prev,
      balance: prev.balance + proceeds,
      orders: [
        ...prev.orders,
        {
          id: generateOrderId(),
          symbol: held.symbol,
          type: 'market' as const,
          side: 'sell' as const,
          quantity,
          price: premium,
          status: 'filled' as const,
          timestamp: Date.now(),
          entryPrice: held.premium,
          realizedPnl: (premium - held.premium) * quantity * 100,
          option: { type: held.type, strike: held.strike, expiry: held.expiry },
        },
      ],
      closedTrades: [
        ...(prev.closedTrades ?? []),
        {
          id: `opt-${Date.now()}-${index}`,
          symbol: held.symbol,
          kind: 'option' as const,
          side: 'long' as const,
          quantity,
          entryPrice: held.premium,
          exitPrice: premium,
          pnl: (premium - held.premium) * quantity * 100,
          pnlPct: held.premium > 0 ? ((premium - held.premium) / held.premium) * 100 : null,
          openedAt: held.openedAt,
          closedAt: Date.now(),
          option: { type: held.type, strike: held.strike, expiry: held.expiry },
        },
      ],
      options:
        remaining > 0
          ? prev.options.map((o, i) => (i === index ? { ...o, quantity: remaining } : o))
          : prev.options.filter((_, i) => i !== index),
    });
    accountRef.current = next;
    setAccount(next);
  }, []);

  return {
    account,
    placeOrder,
    cancelOrder,
    resetAccount,
    updatePositionPrices,
    buyOption,
    sellOption,
    setOptionPremiums,
    clearClosedTrades,
    fillPendingOrders,
  };
};
