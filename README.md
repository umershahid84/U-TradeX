# U-TradeX

## Professional Trading Platform

U-TradeX is a comprehensive trading platform designed for charting and paper trading with advanced features similar to TradingView.

## Features

### 📊 Advanced Charting
- **Real-time Market Data**: Live price updates and candlestick charts
- **Multiple Timeframes**: 1m, 2m, 3m, 5m, 10m, 15m, 30m, 1h, 4h, 1d, 1w, 1M, 3M, 1y
- **Time Range Selection**: Today, 1D, 5D, 1W, 1Y, Max
- **Professional UI**: Dark theme with modern, clean design

### 📈 Technical Indicators
- **Ripster EMA Cloud**: 5, 8, 9, and 13 period EMAs
- **MTF Indicators**: 20 and 50 period moving averages
- **Customizable**: Toggle indicators on/off
- **PineScript Support Framework**: Extensible architecture for custom indicators

### 💰 Paper Trading
- **$100,000 Default Balance**: Start with virtual cash
- **Market & Limit Orders**: Full order type support
- **Real-time Position Tracking**: Monitor P&L automatically
- **Reset Functionality**: Start over anytime with fresh balance

### 🎯 Risk Management
- **Take Profit (TP)**: Set automatic profit targets
- **Stop Loss (SL)**: Protect against losses
- **On-Chart Controls**: Easy adjustment of TP/SL levels
- **Position-based**: Individual TP/SL per position

### 🎪 Options Trading
- **Call & Put Options**: Full options trading support
- **Multiple Expirations**: 4-week expiration cycle
- **Strike Selection**: -5%, ATM, +5% quick presets
- **Contract Tracking**: Monitor all option positions

### 🎨 Fear & Greed Indicator
- **Market Sentiment**: Real-time fear/greed index (0-100)
- **Trading Signals**: STRONG BUY, BUY, HOLD, SELL, STRONG SELL
- **Overbought/Oversold Detection**: RSI-based analysis
- **Auto-adjustment**: Updates automatically per ticker

### 💼 Portfolio Management
- **Account Summary**: Balance, total value, P&L tracking
- **Position Management**: View all open positions
- **Order History**: Track all executed orders
- **Options Portfolio**: Separate tracking for options contracts

## Getting Started

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Usage

1. **Search Ticker**: Enter any stock symbol (e.g., AAPL, TSLA, MSFT)
2. **Select Timeframe**: Choose from 1m to 1y intervals
3. **Analyze Charts**: View price action with technical indicators
4. **Place Orders**: Buy/sell using market or limit orders
5. **Set TP/SL**: Protect positions with take profit and stop loss
6. **Trade Options**: Buy call/put options for leveraged exposure
7. **Monitor Portfolio**: Track performance in real-time

## Technology Stack

- **React 18**: Modern UI framework
- **TypeScript**: Type-safe development
- **Vite**: Lightning-fast build tool
- **Lightweight Charts**: TradingView's charting library
- **CSS3**: Professional styling and animations

## Project Structure

```
src/
├── components/          # React components
│   ├── TradingChart.tsx    # Main charting component
│   ├── TradingPanel.tsx    # Order placement
│   ├── Portfolio.tsx       # Account management
│   ├── FearGreedIndicator.tsx
│   ├── TPSLPanel.tsx       # Take profit/stop loss
│   ├── OptionsPanel.tsx    # Options trading
│   └── Navbar.tsx          # Navigation and controls
├── hooks/              # Custom React hooks
│   └── usePaperTrading.ts  # Paper trading logic
├── services/           # Business logic
│   └── marketData.ts       # Market data service
├── utils/              # Utility functions
│   └── indicators.ts       # Technical indicators
├── types/              # TypeScript definitions
│   └── index.ts            # Type definitions
├── App.tsx             # Main application
└── main.tsx            # Entry point
```

## Features in Detail

### Paper Trading System
- Persistent storage using localStorage
- Realistic order execution simulation
- Position tracking with average price calculation
- Real-time P&L updates based on live prices

### Fear & Greed Algorithm
The indicator calculates market sentiment using:
- **RSI (Relative Strength Index)**: Measures momentum
- **Price vs Moving Averages**: Trend strength
- **Volume Analysis**: Market participation
- **Composite Score**: 0-100 scale with 5 levels

### Unlimited Indicators
The platform is designed to support unlimited custom indicators:
- Modular indicator system
- Easy addition of new indicators
- No performance degradation
- PineScript-style syntax support (framework ready)

## Roadmap

### Planned Features
- [ ] Real market data integration (Alpha Vantage, Polygon.io)
- [ ] Full PineScript compiler and interpreter
- [ ] User-created indicator library
- [ ] Advanced order types (trailing stop, OCO)
- [ ] Multi-chart layouts
- [ ] Drawing tools (trend lines, fibonacci, etc.)
- [ ] Backtesting engine
- [ ] Strategy automation
- [ ] Custom alerts and notifications
- [ ] Export trading history

## Contributing

This is a personal trading platform project. Contributions, issues, and feature requests are welcome!

## License

ISC

## Disclaimer

This is a paper trading platform for educational and simulation purposes only. No real money is involved. Always do your own research before making real investment decisions.

