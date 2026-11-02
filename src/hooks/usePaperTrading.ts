import { useState, useEffect, useCallback, useRef } from 'react';
import { PaperTradingAccount, Order, Position, OptionContract } from '../types';
import { bsPrice, yearsToExpiry } from '../utils/optionPricing';

const DEFAULT_BALANCE = 100000;
let fallbackOrderCounter = 0;

const createDefaultAccount = (): PaperTradingAccount => ({
  balance: DEFAULT_BALANCE,
  initialBalance: DEFAULT_BALANCE,
  positions: [],
  orders: [],
  options: [],
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

    let newPositions: Position[];
    if (newQty === 0) {
      newPositions = prev.positions.filter((p) => p.symbol !== order.symbol);
    } else if (!existing) {
      newPositions = [
        ...prev.positions,
        { symbol: order.symbol, quantity: newQty, avgPrice: order.price, currentPrice: order.price, pnl: 0, pnlPercent: 0 },
      ];
    } else {
      const sameDirection = Math.sign(held) === Math.sign(delta);
      const crossed = Math.sign(newQty) !== Math.sign(held);
      const avgPrice = sameDirection
        ? (existing.avgPrice * Math.abs(held) + order.price * order.quantity) / Math.abs(newQty)
        : crossed
          ? order.price
          : existing.avgPrice;
      newPositions = prev.positions.map((p) => (p.symbol === order.symbol ? { ...p, quantity: newQty, avgPrice } : p));
    }

    const next = {
      ...prev,
      balance: order.side === 'buy' ? prev.balance - value : prev.balance + value,
      positions: newPositions,
      orders: [...prev.orders, { ...order, status: 'filled' as const }],
    };
    return { nextAccount: recalculateAccountTotals(next) };
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
        // Re-estimate open option contracts on this underlying with Black-Scholes
        options: prev.options.map((o) =>
          o.symbol === symbol && (o.impliedVolatility ?? 0) >= 0.05
            ? {
                ...o,
                currentPremium: bsPrice(o.type, currentPrice, o.strike, o.impliedVolatility ?? 0, yearsToExpiry(o.expiry)),
              }
            : o
        ),
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
        options: [...prev.options, option],
      });
    });

    if (error) {
      alert(error);
    }
  }, []);

  return {
    account,
    placeOrder,
    cancelOrder,
    resetAccount,
    updatePositionPrices,
    buyOption,
  };
};
