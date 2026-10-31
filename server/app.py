"""Local market data server for U-TradeX, backed by yfinance.

Browsers cannot call Yahoo Finance directly (no CORS headers, cookie/crumb
handshake), so the frontend talks to this server instead. The Vite dev server
proxies /api to it.

Run:  python server/app.py   (listens on http://127.0.0.1:8000)
"""
import math
import time

import yfinance as yf
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

QUOTE_TTL_SECONDS = 1.0
_quote_cache: dict = {}


def _num(value, default=0.0):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(f) or math.isinf(f) else f


def _error(message, status=502):
    return jsonify({"error": message}), status


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "yfinance": yf.__version__})


@app.get("/api/chart")
def chart():
    symbol = request.args.get("symbol", "").strip()
    interval = request.args.get("interval", "5m")
    period = request.args.get("range", "1d")
    prepost = request.args.get("prepost", "false") == "true"
    if not symbol:
        return _error("symbol is required", 400)

    try:
        df = yf.Ticker(symbol).history(
            period=period, interval=interval, prepost=prepost, auto_adjust=False
        )
    except Exception as exc:  # yfinance raises many different types
        return _error(f"yfinance failed for {symbol}: {exc}")

    if df is None or df.empty:
        return _error(f"No data returned for {symbol}", 404)

    bars = []
    last_time = 0
    for ts, row in df.iterrows():
        close = _num(row["Close"], None)
        open_ = _num(row["Open"], None)
        high = _num(row["High"], None)
        low = _num(row["Low"], None)
        if None in (close, open_, high, low):
            continue
        ms = int(ts.timestamp() * 1000)
        if ms <= last_time:
            continue
        last_time = ms
        bars.append(
            {
                "time": ms,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": _num(row["Volume"]),
            }
        )
    return jsonify({"symbol": symbol, "bars": bars})


@app.get("/api/quote")
def quote():
    symbol = request.args.get("symbol", "").strip()
    prepost = request.args.get("prepost", "false") == "true"
    if not symbol:
        return _error("symbol is required", 400)

    key = (symbol, prepost)
    cached = _quote_cache.get(key)
    if cached and time.time() - cached[0] < QUOTE_TTL_SECONDS:
        return jsonify(cached[1])

    try:
        ticker = yf.Ticker(symbol)
        price = None
        if prepost:
            # Latest 1m bar includes pre/post market trades
            df = ticker.history(period="1d", interval="1m", prepost=True)
            if df is not None and not df.empty:
                price = _num(df["Close"].dropna().iloc[-1], None)
        if price is None:
            price = _num(ticker.fast_info["last_price"], None)
    except Exception as exc:
        return _error(f"yfinance failed for {symbol}: {exc}")

    if not price or price <= 0:
        return _error(f"No live price for {symbol}", 404)

    payload = {"symbol": symbol, "price": price, "timestamp": int(time.time() * 1000)}
    _quote_cache[key] = (time.time(), payload)
    return jsonify(payload)


@app.get("/api/options/expirations")
def option_expirations():
    symbol = request.args.get("symbol", "").strip()
    try:
        return jsonify({"expirations": list(yf.Ticker(symbol).options)})
    except Exception as exc:
        return _error(f"yfinance failed for {symbol}: {exc}")


def _contracts(df):
    return [
        {
            "strike": _num(r["strike"]),
            "lastPrice": _num(r["lastPrice"]),
            "bid": _num(r["bid"]),
            "ask": _num(r["ask"]),
            "volume": _num(r["volume"]),
            "openInterest": _num(r["openInterest"]),
            "impliedVolatility": _num(r["impliedVolatility"]),
            "inTheMoney": bool(r["inTheMoney"]),
        }
        for _, r in df.iterrows()
    ]


@app.get("/api/options")
def options():
    symbol = request.args.get("symbol", "").strip()
    date = request.args.get("date")
    try:
        ticker = yf.Ticker(symbol)
        expirations = list(ticker.options)
        if not expirations:
            return jsonify({"chains": []})
        date = date or expirations[0]
        chain = ticker.option_chain(date)
        return jsonify(
            {
                "chains": [
                    {
                        "expirationDate": date,
                        "calls": _contracts(chain.calls),
                        "puts": _contracts(chain.puts),
                    }
                ]
            }
        )
    except Exception as exc:
        return _error(f"yfinance failed for {symbol}: {exc}")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, threaded=True)
