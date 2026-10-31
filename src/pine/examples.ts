export interface PineExample {
  name: string;
  source: string;
}

export const PINE_EXAMPLES: PineExample[] = [
  {
    name: 'EMA Cloud (8/21)',
    source: `//@version=5
indicator("EMA Cloud", overlay=true)
fastLen = input.int(8, "Fast EMA")
slowLen = input.int(21, "Slow EMA")

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)

p1 = plot(fast, "Fast", color=color.green, linewidth=1)
p2 = plot(slow, "Slow", color=color.red, linewidth=1)
fill(p1, p2, color = fast > slow ? color.new(color.green, 80) : color.new(color.red, 80))
`,
  },
  {
    name: 'RSI with levels',
    source: `//@version=5
indicator("RSI", overlay=false)
len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")

value = ta.rsi(src, len)
plot(value, "RSI", color=color.purple, linewidth=2)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)
hline(50, "Mid", color=color.gray)
`,
  },
  {
    name: 'MACD',
    source: `//@version=5
indicator("MACD", overlay=false)
fastLen = input.int(12, "Fast")
slowLen = input.int(26, "Slow")
sigLen = input.int(9, "Signal")

[macdLine, signalLine, hist] = ta.macd(close, fastLen, slowLen, sigLen)

plot(hist, "Histogram", style=plot.style_histogram, color = hist >= 0 ? color.teal : color.red)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
`,
  },
  {
    name: 'Bollinger Bands (filled)',
    source: `//@version=5
indicator("Bollinger Bands", overlay=true)
len = input.int(20, "Length")
mult = input.float(2.0, "StdDev", step=0.5)

[basis, upper, lower] = ta.bb(close, len, mult)

plot(basis, "Basis", color=color.orange)
u = plot(upper, "Upper", color=color.blue)
l = plot(lower, "Lower", color=color.blue)
fill(u, l, color=color.new(color.blue, 90))
`,
  },
  {
    name: 'Supertrend',
    source: `//@version=5
indicator("Supertrend", overlay=true)
factor = input.float(3.0, "Factor", step=0.5)
atrLen = input.int(10, "ATR Length")

[st, dir] = ta.supertrend(factor, atrLen)

plot(st, "Supertrend", color = dir < 0 ? color.green : color.red, linewidth=2)
`,
  },
  {
    name: 'EMA cross signals',
    source: `//@version=5
indicator("EMA Cross Signals", overlay=true)
fastLen = input.int(9, "Fast")
slowLen = input.int(21, "Slow")

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)

plot(fast, "Fast", color=color.aqua)
plot(slow, "Slow", color=color.orange)

buy = ta.crossover(fast, slow)
sell = ta.crossunder(fast, slow)
plotshape(buy, "Buy", style=shape.triangleup, location=location.belowbar, color=color.green, text="Buy")
plotshape(sell, "Sell", style=shape.triangledown, location=location.abovebar, color=color.red, text="Sell")
`,
  },
];
