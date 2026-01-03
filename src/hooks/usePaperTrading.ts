import { useState, useEffect } from 'react';
import { PaperTradingAccount, Order, Position, OptionContract } from '../types';

const DEFAULT_BALANCE = 100000;

export const usePaperTrading = () => {
  const [account, setAccount] = useState<PaperTradingAccount>(() => {
    const saved = localStorage.getItem('paperTradingAccount');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      balance: DEFAULT_BALANCE,
      initialBalance: DEFAULT_BALANCE,
      positions: [],
      orders: [],
      options: [],
      totalValue: DEFAULT_BALANCE,
      pnl: 0,
      pnlPercent: 0,
    };
  });

  useEffect(() => {
    localStorage.setItem('paperTradingAccount', JSON.stringify(account));
  }, [account]);

  const resetAccount = () => {
    const newAccount: PaperTradingAccount = {
      balance: DEFAULT_BALANCE,
      initialBalance: DEFAULT_BALANCE,
      positions: [],
      orders: [],
      options: [],
      totalValue: DEFAULT_BALANCE,
      pnl: 0,
      pnlPercent: 0,
    };
    setAccount(newAccount);
  };

  const placeOrder = (order: Omit<Order, 'id' | 'status' | 'timestamp'>) => {
    const newOrder: Order = {
      ...order,
      id: Date.now().toString(),
      status: 'pending',
      timestamp: Date.now(),
    };

    // For market orders, execute immediately
    if (newOrder.type === 'market') {
      executeOrder(newOrder);
    } else {
      setAccount(prev => ({
        ...prev,
        orders: [...prev.orders, newOrder],
      }));
    }
  };

  const executeOrder = (order: Order) => {
    const cost = order.quantity * order.price;
    
    if (order.side === 'buy') {
      if (cost > account.balance) {
        alert('Insufficient balance');
        return;
      }

      setAccount(prev => {
        const existingPosition = prev.positions.find(p => p.symbol === order.symbol);
        let newPositions: Position[];

        if (existingPosition) {
          const newQuantity = existingPosition.quantity + order.quantity;
          const newAvgPrice = 
            (existingPosition.avgPrice * existingPosition.quantity + cost) / newQuantity;
          
          newPositions = prev.positions.map(p =>
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

        return {
          ...prev,
          balance: prev.balance - cost,
          positions: newPositions,
          orders: prev.orders.map(o => 
            o.id === order.id ? { ...o, status: 'filled' as const } : o
          ),
        };
      });
    } else {
      // Sell
      const position = account.positions.find(p => p.symbol === order.symbol);
      if (!position || position.quantity < order.quantity) {
        alert('Insufficient shares');
        return;
      }

      setAccount(prev => {
        const newPositions = prev.positions
          .map(p => {
            if (p.symbol === order.symbol) {
              const newQuantity = p.quantity - order.quantity;
              return newQuantity > 0 ? { ...p, quantity: newQuantity } : null;
            }
            return p;
          })
          .filter((p): p is Position => p !== null);

        return {
          ...prev,
          balance: prev.balance + cost,
          positions: newPositions,
          orders: prev.orders.map(o => 
            o.id === order.id ? { ...o, status: 'filled' as const } : o
          ),
        };
      });
    }
  };

  const cancelOrder = (orderId: string) => {
    setAccount(prev => ({
      ...prev,
      orders: prev.orders.map(o =>
        o.id === orderId ? { ...o, status: 'cancelled' as const } : o
      ),
    }));
  };

  const updatePositionPrices = (symbol: string, currentPrice: number) => {
    setAccount(prev => ({
      ...prev,
      positions: prev.positions.map(p => {
        if (p.symbol === symbol) {
          const pnl = (currentPrice - p.avgPrice) * p.quantity;
          const pnlPercent = ((currentPrice - p.avgPrice) / p.avgPrice) * 100;
          return { ...p, currentPrice, pnl, pnlPercent };
        }
        return p;
      }),
    }));
  };

  const buyOption = (option: Omit<OptionContract, 'quantity'> & { quantity: number }) => {
    const cost = option.premium * option.quantity * 100; // Options are typically 100 shares
    
    if (cost > account.balance) {
      alert('Insufficient balance');
      return;
    }

    setAccount(prev => ({
      ...prev,
      balance: prev.balance - cost,
      options: [...prev.options, option],
    }));
  };

  return {
    account,
    placeOrder,
    cancelOrder,
    resetAccount,
    updatePositionPrices,
    buyOption,
  };
};
