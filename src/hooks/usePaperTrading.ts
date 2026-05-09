import { useState, useEffect, useCallback } from 'react';
import { PaperTradingAccount, Order, Position, OptionContract } from '../types';

const DEFAULT_BALANCE = 100000;

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
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const recalculateAccountTotals = (account: PaperTradingAccount): PaperTradingAccount => {
  const positionsValue = account.positions.reduce(
    (sum, position) => sum + position.currentPrice * position.quantity,
    0
  );
  const optionsValue = account.options.reduce(
    (sum, option) => sum + option.premium * option.quantity * 100,
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

  useEffect(() => {
    try {
      localStorage.setItem('paperTradingAccount', JSON.stringify(account));
    } catch (error) {
      console.warn('Failed to persist paper trading account', error);
    }
  }, [account]);

  const executeMarketOrder = useCallback((prev: PaperTradingAccount, order: Order): { nextAccount: PaperTradingAccount; error?: string } => {
    const cost = order.quantity * order.price;

    if (order.side === 'buy') {
      if (cost > prev.balance) {
        return { nextAccount: prev, error: 'Insufficient balance' };
      }

      const existingPosition = prev.positions.find((p) => p.symbol === order.symbol);
      let newPositions: Position[];

      if (existingPosition) {
        const newQuantity = existingPosition.quantity + order.quantity;
        const newAvgPrice =
          (existingPosition.avgPrice * existingPosition.quantity + cost) / newQuantity;

        newPositions = prev.positions.map((p) =>
          p.symbol === order.symbol
            ? { ...p, quantity: newQuantity, avgPrice: newAvgPrice }
            : p
        );
      } else {
        newPositions = [
          ...prev.positions,
          {
            symbol: order.symbol,
            quantity: order.quantity,
            avgPrice: order.price,
            currentPrice: order.price,
            pnl: 0,
            pnlPercent: 0,
          },
        ];
      }

      const next = {
        ...prev,
        balance: prev.balance - cost,
        positions: newPositions,
        orders: [...prev.orders, { ...order, status: 'filled' as const }],
      };
      return { nextAccount: recalculateAccountTotals(next) };
    }

    const position = prev.positions.find((p) => p.symbol === order.symbol);
    if (!position || position.quantity < order.quantity) {
      return { nextAccount: prev, error: 'Insufficient shares' };
    }

    const newPositions = prev.positions
      .map((p) => {
        if (p.symbol === order.symbol) {
          const newQuantity = p.quantity - order.quantity;
          return newQuantity > 0 ? { ...p, quantity: newQuantity } : null;
        }
        return p;
      })
      .filter((p): p is Position => p !== null);

    const next = {
      ...prev,
      balance: prev.balance + cost,
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
      alert('Please enter a valid quantity');
      return;
    }
    if (!Number.isFinite(order.price) || order.price <= 0) {
      alert('Please enter a valid price');
      return;
    }

    const newOrder: Order = {
      ...order,
      id: generateOrderId(),
      status: 'pending',
      timestamp: Date.now(),
    };

    if (newOrder.type === 'market') {
      let error: string | undefined;
      setAccount((prev) => {
        const result = executeMarketOrder(prev, newOrder);
        error = result.error;
        return result.nextAccount;
      });
      if (error) {
        alert(error);
      }
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
            const pnlPercent = ((currentPrice - p.avgPrice) / p.avgPrice) * 100;
            return { ...p, currentPrice, pnl, pnlPercent };
          }
          return p;
        }),
      })
    );
  }, []);

  const buyOption = useCallback((option: Omit<OptionContract, 'quantity'> & { quantity: number }) => {
    const cost = option.premium * option.quantity * 100; // Options are typically 100 shares
    if (!Number.isFinite(option.quantity) || option.quantity < 1 || !Number.isFinite(option.premium) || option.premium <= 0) {
      alert('Please enter a valid option order');
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
