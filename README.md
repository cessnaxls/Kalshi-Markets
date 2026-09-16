# Kalshi Edge Terminal v5

Compact Render-hosted Kalshi chart + paper trading terminal.

## What changed in v5
- Much smaller controls and typography, matching the dense organization of the reference app.
- Fixed chart loading by resolving `market -> event -> series_ticker` server-side before calling Kalshi candlesticks.
- Current Kalshi candlestick API only supports 1-minute, 1-hour, and 1-day source candles; 5m/10m/15m are aggregated locally from real 1m candles.
- Browse, ticker load, Candles/Line, YES/NO inversion, timeframes, Fit, TA, Edge panel, theme, paper BUY/SELL, side switcher, reset and market filtering are all wired.
- Paper state persists in localStorage.
- Chart CDN has a fallback source.

## Render
Use the included `render.yaml`, or deploy as a Node web service:

```bash
npm install
npm start
```

Environment variables:
- `KALSHI_ENV=demo` or `production`
- `KALSHI_API_KEY_ID` (needed for authenticated account/live routes)
- `KALSHI_PRIVATE_KEY`
- `LIVE_TRADING_ENABLED=false` by default

Public chart/market data does not require Kalshi credentials.
