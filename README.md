# U-TradeX

## Professional Trading Platform

U-TradeX is a comprehensive trading platform designed for charting and paper trading with advanced features similar to TradingView.

## Important Note on Real-Time Data

This platform attempts to fetch **real-time market data** from Yahoo Finance API. Due to browser CORS (Cross-Origin Resource Sharing) restrictions, the API calls may be blocked in certain environments. 

**How it works:**
1. First attempts direct API call to Yahoo Finance
2. If blocked by CORS, attempts to use a CORS proxy (https://corsproxy.io)
3. If both fail, falls back to realistic simulated data

**For production use:**
- Deploy the application on a web server with a backend proxy
- Use environment without strict CORS policies
- Consider using a paid API service with proper CORS support
- The application will automatically display real prices when API access is available

## Features

### 📊 Advanced Charting
- **Real-time Market Data**: Live price updates and candlestick charts
- **Multiple Timeframes**: 1m, 2m, 5m, 10m, 15m, 30m, 1h, 4h, D, W, M, 1Q, 1Y
- **Time Range Selection**: 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX
- **After-Hours Trading**: Toggle extended hours data (pre-market & post-market)
- **BID/ASK Display**: Real-time bid and ask prices with spread calculation
- **Professional UI**: Dark theme with modern, clean design

### 📈 Technical Indicators
- **Ripster EMA Cloud**: 5, 8, 9, and 13 period EMAs
- **Moving Averages**: SMA 20 and SMA 50
- **VWAP**: Volume Weighted Average Price
- **Bollinger Bands**: Upper, middle, and lower bands with 2σ deviation
- **Customizable**: Individual toggle for each indicator
- **No Label Stacking**: Fixed indicator management system
- **PineScript Support Framework**: Extensible architecture for custom indicators

### 🎨 Drawing & Analysis Tools
- **Drawing Tools Panel**: Interactive drawing tools interface
- **Fibonacci Retracement**: Automatic calculation with standard levels (23.6%, 38.2%, 50%, 61.8%, 78.6%)
- **Color-Coded Levels**: Easy visual identification
- **Clear All Function**: Remove all drawings at once
- **Framework Ready**: Extensible for trend lines, horizontal lines, and rectangles

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
- **Realistic Strike Intervals**: Smart strike generation based on stock price
- **Multiple Expirations**: 4-week expiration cycle
- **Options Chain Display**: Strike, premium, bid/ask, volume, and open interest
- **Improved Pricing**: Realistic premium calculation with intrinsic and time value
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

## Prerequisites

Before you begin, ensure you have the following installed on your computer:

### Required Software

1. **Node.js** (version 18.0.0 or higher)
   - Download from: https://nodejs.org/
   - Verify installation: `node --version`
   - Includes npm (Node Package Manager)

2. **Git** (for cloning the repository)
   - Download from: https://git-scm.com/
   - Verify installation: `git --version`

3. **A Modern Web Browser**
   - Chrome (recommended)
   - Firefox
   - Safari
   - Edge

### System Requirements

- **Operating System**: Windows 10/11, macOS 10.15+, or Linux
- **RAM**: Minimum 4GB (8GB recommended)
- **Disk Space**: 500MB free space
- **Internet Connection**: Required for initial setup

## Getting Started

### Step 1: Clone the Repository

```bash
# Using HTTPS
git clone https://github.com/umershahid84/U-TradeX.git

# Or using SSH
git clone git@github.com:umershahid84/U-TradeX.git

# Navigate to the project directory
cd U-TradeX
```

### Step 2: Install Dependencies

```bash
# Install all required npm packages
npm install
```

This will install:
- React 18
- TypeScript
- Vite
- Lightweight Charts
- All other dependencies listed in package.json

**Note**: Installation may take 2-5 minutes depending on your internet speed.

### Step 3: Run the Application

#### Development Mode (Recommended for local use)

```bash
# Start the development server
npm run dev
```

The application will open automatically at `http://localhost:3000`

If it doesn't open automatically, manually navigate to:
- Local: http://localhost:3000/
- Network: Use the network address shown in the terminal to access from other devices on your network

**Development mode features**:
- Hot Module Replacement (instant updates when you save files)
- Detailed error messages
- React DevTools support

#### Production Build

```bash
# Build for production
npm run build

# Preview the production build
npm run preview
```

The production build will be created in the `dist/` folder.

### Step 4: Start Trading!

Once the application is running:
1. The default ticker is **AAPL** (Apple Inc.)
2. You start with **$100,000** in paper trading money
3. All data is saved in your browser's localStorage

### Usage

#### Quick Start Guide

1. **Search for a Stock**
   - Type a stock symbol in the search bar (e.g., AAPL, TSLA, MSFT, GOOGL)
   - Press Enter or click the search button 🔍
   - The chart will update with the new ticker

2. **Select Timeframe and Range**
   - Click any timeframe button: 1m, 2m, 5m, 10m, 15m, 30m, 1h, 4h, D, W, M, 1Q, 1Y
   - Choose a time range: 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX
   - Toggle "After Hours" to include pre-market and post-market data
   - Indicators will automatically recalculate

3. **View Technical Indicators**
   - Click "📊 Show Indicators" button to open indicator panel
   - Individual toggles for each indicator:
     - **EMAs**: 5, 8, 9, 13 period exponential moving averages
     - **SMAs**: 20, 50 period simple moving averages
     - **VWAP**: Volume Weighted Average Price
     - **Bollinger Bands**: Upper, middle, and lower bands
   - Indicators properly remove when unchecked (no more label stacking!)

4. **Use Drawing Tools**
   - Click "🎨 Drawing Tools" to open the drawing panel
   - Select from available tools:
     - Cursor (default selection mode)
     - Trend Line (framework ready)
     - Horizontal Line (framework ready)
     - Rectangle (framework ready)
     - Fibonacci Retracement
   - Click "🔢 Add Fibonacci" to add automatic Fibonacci levels
   - Click "🗑️ Clear All" to remove all drawings

5. **View BID/ASK Prices**
   - Located at the top of the chart
   - Shows real-time BID price (red)
   - Shows real-time ASK price (green)
   - Spread calculated as 0.05% of current price

6. **Place Orders**
   - **Market Order**: Executes immediately at current price
     - Select BUY or SELL
     - Enter quantity (number of shares)
     - Click "Place BUY Order" or "Place SELL Order"
   - **Limit Order**: Executes when price reaches your target
     - Click "Limit" button
     - Enter quantity and limit price
     - Click "Place BUY Order" or "Place SELL Order"

7. **Set Take Profit / Stop Loss**
   - Select a position from the dropdown
   - Enter Take Profit price (sells automatically when price goes up)
   - Enter Stop Loss price (sells automatically when price goes down)
   - Click "Set TP/SL"

8. **Trade Options**
   - Choose CALL (bullish) or PUT (bearish)
   - Select expiration date from available dates
   - Browse the options chain showing strikes, premiums, and volume
   - Click on an option to select it
   - Enter number of contracts
   - Click "Buy CALL Option" or "Buy PUT Option"
   - **Note**: Strike prices are now generated with realistic intervals based on stock price

9. **Monitor Your Portfolio**
   - **Left Panel**: View your portfolio
     - Cash balance
     - Total value
     - Profit/Loss (P&L)
     - All positions
     - Order history
   - **Reset Account**: Click "Reset Account" to start over with $100,000

#### Understanding the Interface

**Top Navigation Bar**:
- **Left**: U-TradeX logo and tagline
- **Center**: Search box for stock symbols
- **Right**: Timeframe and range selectors

**Main Chart Area**:
- **Header**: Shows ticker symbol and current price
- **Chart**: Candlestick chart with indicators
- **Controls**: Toggle indicators on/off

**Right Panel**:
- **Fear & Greed Indicator**: Market sentiment and trading signals
- **Place Order**: Buy/sell stocks
- **Take Profit/Stop Loss**: Risk management
- **Options Trading**: Call and put options

#### Fear & Greed Indicator Explained

The indicator shows market sentiment from 0 (Extreme Fear) to 100 (Extreme Greed):

- **0-20 (Extreme Fear)**: 📉 OVERSOLD - Signal: STRONG BUY
- **21-40 (Fear)**: Signal: BUY
- **41-60 (Neutral)**: ➡️ NORMAL - Signal: HOLD
- **61-80 (Greed)**: Signal: SELL
- **81-100 (Extreme Greed)**: 📈 OVERBOUGHT - Signal: STRONG SELL

The indicator combines:
- RSI (Relative Strength Index)
- Price vs Moving Averages
- Trend strength
- Volume analysis

## Troubleshooting

### Common Issues and Solutions

#### Issue: "npm: command not found"
**Solution**: Node.js is not installed or not in your PATH
1. Download and install Node.js from https://nodejs.org/
2. Restart your terminal/command prompt
3. Verify installation: `node --version` and `npm --version`

#### Issue: "Module not found" errors
**Solution**: Dependencies not installed
```bash
# Delete node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Reinstall dependencies
npm install
```

#### Issue: Port 3000 is already in use
**Solution**: Another application is using port 3000
```bash
# Option 1: Stop the other application using port 3000

# Option 2: Use a different port
# Edit vite.config.ts and change the port number
```

#### Issue: Application loads but shows blank screen
**Solution**: Clear browser cache and refresh
1. Open browser DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"
4. Or use Incognito/Private mode

#### Issue: Chart not displaying
**Solution**: 
1. Check browser console for errors (F12)
2. Ensure you have a stable internet connection
3. Try a different browser
4. Clear localStorage: `localStorage.clear()` in browser console

#### Issue: "EACCES" permission errors during npm install
**Solution**: 
```bash
# On macOS/Linux, use sudo (not recommended for production)
sudo npm install

# Better solution: Fix npm permissions
# Follow guide: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally
```

#### Issue: TypeScript errors during build
**Solution**: Ensure you have the correct Node.js version
```bash
# Check Node version (should be 18.0.0 or higher)
node --version

# Update Node.js if needed
```

### Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 90+ | ✅ Fully Supported |
| Firefox | 88+ | ✅ Fully Supported |
| Safari | 14+ | ✅ Fully Supported |
| Edge | 90+ | ✅ Fully Supported |

### Getting Help

If you encounter issues not listed here:
1. Check the browser console for error messages (F12)
2. Review the terminal output for error details
3. Create an issue on GitHub with:
   - Your operating system
   - Node.js version (`node --version`)
   - Error message or screenshot
   - Steps to reproduce the issue

## Performance Tips

1. **Close unused browser tabs** to free up memory
2. **Use Chrome** for best performance
3. **Disable browser extensions** if experiencing slowdowns
4. **Use production build** for better performance:
   ```bash
   npm run build
   npm run preview
   ```

## Data Storage

All your paper trading data is stored locally in your browser:
- **Account balance**: Saved automatically
- **Positions**: Persist across sessions
- **Orders**: Stored in order history
- **Settings**: Remember your preferences

**To reset everything**:
1. Click "Reset Account" button in the portfolio
2. Or clear browser localStorage manually

**Important**: Data is stored per browser. If you switch browsers or clear browser data, your paper trading history will be lost.

## Technology Stack

- **React 18**: Modern UI framework
- **TypeScript**: Type-safe development
- **Vite**: Lightning-fast build tool
- **Lightweight Charts**: TradingView's charting library
- **CSS3**: Professional styling and animations

## Deployment

### Deploy to Production

#### Option 1: Vercel (Recommended)
1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```
2. Deploy:
   ```bash
   npm run build
   vercel --prod
   ```

#### Option 2: Netlify
1. Install Netlify CLI:
   ```bash
   npm install -g netlify-cli
   ```
2. Deploy:
   ```bash
   npm run build
   netlify deploy --prod --dir=dist
   ```

#### Option 3: GitHub Pages
1. Install gh-pages:
   ```bash
   npm install --save-dev gh-pages
   ```
2. Add to package.json:
   ```json
   "homepage": "https://yourusername.github.io/U-TradeX",
   "scripts": {
     "predeploy": "npm run build",
     "deploy": "gh-pages -d dist"
   }
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```

#### Option 4: Self-Hosting
1. Build the application:
   ```bash
   npm run build
   ```
2. Copy the `dist/` folder to your web server
3. Configure your web server to serve the files
4. Point your domain to the server

### Environment Variables (Optional)

Create a `.env` file in the root directory for configuration:
```env
VITE_APP_NAME=U-TradeX
VITE_DEFAULT_BALANCE=100000
# Add API keys for future real market data integration
# VITE_ALPHA_VANTAGE_KEY=your_api_key_here
```

## Advanced Configuration

### Customizing Default Settings

Edit the following files to customize behavior:

**Default Paper Trading Balance** (`src/hooks/usePaperTrading.ts`):
```typescript
const DEFAULT_BALANCE = 100000; // Change this value
```

**Update Frequency** (`src/services/marketData.ts`):
```typescript
const interval = setInterval(() => {
  // Updates every 1000ms (1 second)
  // Change to 500 for faster updates or 2000 for slower
}, 1000);
```

**Chart Colors** (`src/components/TradingChart.tsx`):
```typescript
upColor: '#26a69a',    // Green for up candles
downColor: '#ef5350',  // Red for down candles
```

**Fear & Greed Thresholds** (`src/utils/indicators.ts`):
```typescript
// Adjust the score ranges
if (score <= 20) level = 'extreme fear';      // Change threshold
else if (score <= 40) level = 'fear';
// ... etc
```

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

### Development Guidelines

#### Setting Up for Development

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/U-TradeX.git
   cd U-TradeX
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
5. Make your changes and test thoroughly
6. Commit your changes:
   ```bash
   git add .
   git commit -m "Add: your feature description"
   ```
7. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
8. Open a Pull Request

#### Code Style

- **TypeScript**: Use strict typing, avoid `any` when possible
- **Components**: Functional components with hooks
- **Naming**: 
  - Components: PascalCase (e.g., `TradingChart.tsx`)
  - Files: camelCase or PascalCase
  - Variables: camelCase
- **CSS**: Use component-specific CSS files (e.g., `TradingChart.css`)

#### Testing Your Changes

```bash
# Start dev server
npm run dev

# Build to check for errors
npm run build

# Test the production build
npm run preview
```

#### Project Scripts

```bash
npm run dev        # Start development server (with hot reload)
npm run build      # Build for production (creates dist/ folder)
npm run preview    # Preview production build locally
```

### Adding New Features

#### Adding a New Indicator

1. Add indicator calculation to `src/utils/indicators.ts`:
   ```typescript
   export const calculateYourIndicator = (data: number[]) => {
     // Your calculation logic
     return result;
   };
   ```

2. Update `src/components/TradingChart.tsx`:
   ```typescript
   // Calculate indicator
   const yourIndicator = calculateYourIndicator(closes);
   
   // Add series to chart
   const series = chartRef.current.addSeries(LineSeries, {
     color: '#yourcolor',
     lineWidth: 2,
     title: 'Your Indicator',
   });
   
   // Set data
   series.setData(yourIndicator.map((value, i) => ({
     time: (data[i].time / 1000) as Time,
     value: value,
   })));
   ```

#### Adding a New Order Type

1. Update types in `src/types/index.ts`:
   ```typescript
   export interface Order {
     // ... existing fields
     type: 'market' | 'limit' | 'your_new_type';
   }
   ```

2. Update order execution logic in `src/hooks/usePaperTrading.ts`

3. Update UI in `src/components/TradingPanel.tsx`

### Understanding the Codebase

**Key Files**:
- `src/App.tsx`: Main application logic, state management
- `src/components/TradingChart.tsx`: Chart rendering, indicators
- `src/hooks/usePaperTrading.ts`: Paper trading logic, order execution
- `src/services/marketData.ts`: Market data simulation
- `src/utils/indicators.ts`: Technical indicator calculations

**Data Flow**:
1. User interacts with UI (Navbar, TradingPanel)
2. State updates in App.tsx
3. MarketDataService generates/updates prices
4. TradingChart displays data with indicators
5. usePaperTrading manages account state
6. Portfolio shows updated positions/P&L

### Reporting Issues

When reporting bugs, please include:
1. **Environment**:
   - OS (Windows/Mac/Linux)
   - Browser and version
   - Node.js version (`node --version`)
2. **Steps to reproduce**
3. **Expected behavior**
4. **Actual behavior**
5. **Screenshots** (if applicable)
6. **Console errors** (F12 → Console tab)

## License

ISC

## Disclaimer

This is a paper trading platform for educational and simulation purposes only. No real money is involved. Always do your own research before making real investment decisions.

## Quick Reference

### Command Cheat Sheet

```bash
# Setup
git clone https://github.com/umershahid84/U-TradeX.git
cd U-TradeX
npm install

# Development
npm run dev              # Start dev server (http://localhost:3000)
npm run build           # Build for production
npm run preview         # Preview production build

# Troubleshooting
rm -rf node_modules package-lock.json
npm install             # Clean install
```

### Keyboard Shortcuts (Browser)

- **F12**: Open Developer Tools
- **Ctrl/Cmd + Shift + R**: Hard refresh (clear cache)
- **Ctrl/Cmd + Plus/Minus**: Zoom in/out
- **F5**: Refresh page

### Default Settings

| Setting | Value |
|---------|-------|
| Starting Balance | $100,000 |
| Default Ticker | AAPL |
| Default Timeframe | 5m |
| Default Range | 1d |
| Price Update Frequency | 1 second |
| Indicators | Enabled by default |

### File Locations

| What | Where |
|------|-------|
| Source Code | `src/` |
| Components | `src/components/` |
| Trading Logic | `src/hooks/usePaperTrading.ts` |
| Indicators | `src/utils/indicators.ts` |
| Market Data | `src/services/marketData.ts` |
| Configuration | `vite.config.ts`, `tsconfig.json` |
| Build Output | `dist/` (after `npm run build`) |

### Resources

- **Node.js**: https://nodejs.org/
- **React Documentation**: https://react.dev/
- **TypeScript**: https://www.typescriptlang.org/
- **Vite Guide**: https://vitejs.dev/guide/
- **Lightweight Charts**: https://tradingview.github.io/lightweight-charts/
- **GitHub Repository**: https://github.com/umershahid84/U-TradeX

## FAQ

**Q: Is this connected to real market data?**
A: No, currently it uses simulated data. Real market data integration is planned for future releases.

**Q: Can I lose real money?**
A: No, this is a paper trading platform. All money is virtual.

**Q: How do I save my progress?**
A: Everything is automatically saved in your browser's localStorage.

**Q: Can I use this on mobile?**
A: Yes, the interface is responsive and works on mobile browsers.

**Q: How do I add real market data?**
A: You can integrate APIs like Alpha Vantage or Polygon.io by modifying `src/services/marketData.ts`.

**Q: Can I customize the indicators?**
A: Yes, you can modify indicator calculations in `src/utils/indicators.ts`.

**Q: How do I reset my account?**
A: Click the "Reset Account" button in the Portfolio panel.

**Q: Does it support cryptocurrency?**
A: Currently no, but you can extend it to support crypto by modifying the market data service.

**Q: Can I export my trading history?**
A: Not currently, but this is on the roadmap for future releases.

**Q: Why is my balance not $100,000?**
A: If you've placed trades, your balance will reflect those transactions. Click "Reset Account" to start fresh.

---

## Support

For questions, issues, or feature requests:
- **GitHub Issues**: https://github.com/umershahid84/U-TradeX/issues
- **Discussions**: https://github.com/umershahid84/U-TradeX/discussions

## Changelog

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for detailed implementation notes.

---

Made with ❤️ for traders who want to practice without risk.

**Happy Paper Trading! 📈💰**


## Live market data (yfinance server)

Browsers cannot call Yahoo Finance directly, so prices come from a small local
Python server (`server/app.py`) built on [yfinance](https://github.com/ranaroussi/yfinance).
Vite proxies `/api` to it.

```bash
pip install -r server/requirements.txt   # once (a virtualenv is recommended)
npm install                              # once
npm run dev:all                          # starts the API (port 8000) and the web app (port 3000)
```

Or run them separately with `npm run server` and `npm run dev`. If the header
shows "Disconnected", the API server is not running.
