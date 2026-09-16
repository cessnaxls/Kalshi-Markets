# Kalshi Edge Terminal v6
Compact Render-hosted Kalshi trading terminal with interactive candlesticks, paper trading, protected live orders, and a persistent server-side auto-trading bot.

## Bot presets
VWAP Reversion, Momentum, EMA Cross, Breakout. Modes: Signals only, Paper auto, Live auto. The bot runs server-side every 10 seconds and persists its state/log to `DATA_DIR`.

## Deploy
1. Push this folder to GitHub.
2. Create a Render Blueprint from `render.yaml`.
3. Start with `KALSHI_ENV=demo` and demo credentials.
4. Put the entire PEM private key in `KALSHI_PRIVATE_KEY` (escaped newlines are accepted).
5. Leave `LIVE_TRADING_ENABLED=false` until paper/demo testing is complete.
6. For production, use production credentials, set `KALSHI_ENV=production`, then deliberately set `LIVE_TRADING_ENABLED=true`.

Live bot mode additionally requires the in-app `ARM LIVE BOT` phrase. The KILL button disables the bot and disarms live automation.

Strategy presets are examples, not guarantees of profitable edge. Backtest/paper-test them before live use.


## v7 chart fix
Market/chart data defaults to Kalshi production (`KALSHI_DATA_ENV=production`) even when order execution is configured for demo. This lets the terminal chart current production tickers while you keep real-money execution disabled. The chart uses the batch candlestick endpoint with a bounded six-day 1-minute window and falls back to recent trades if candlesticks fail. TA is now under the chart TA menu and TP/SL/entry guides are under Trade Tools.


## v8 changes
Adds 1s, 5s, 15s, and 30s chart intervals built from actual Kalshi trades. Fixes TA and Trade Tools dropdown clipping/touch behavior by allowing toolbar overflow and raising menu stacking order. Sub-minute history loads up to 5,000 recent trades from the prior 24 hours; no synthetic interpolation is used.

## v9 changes
- Light mode active/selected controls use a subtle light gray that is darker than unselected controls.
- Selecting **LIVE** now fetches authenticated Kalshi `/portfolio/balance` data and displays cash, current portfolio value, and total account value from the configured execution environment.
- Live positions in the right rail are read from the authenticated portfolio positions endpoint.
- To show your real-money account, set `KALSHI_ENV=production` and use production Kalshi API credentials. `KALSHI_ENV=demo` intentionally shows the demo portfolio instead.

## v11 changes
- Near-real-time chart streaming: the browser opens an SSE stream to the Node server; the server polls Kalshi's public trade feed once per second and pushes only new trades/quotes. Incoming trades mutate the currently forming candle immediately for 1s/5s/15s/30s and keep minute candles current.
- Expanded TA menu: VWAP, EMA 9/21/50, SMA 20/50, Bollinger Bands 20/2, Donchian 20, volume, RSI 14, MACD 12/26, and ATR 14. Trend/volatility studies draw on-chart; oscillator values appear in the compact status readout.
- Trade Tools supports Percentage, Risk/Reward, and absolute Price TP/SL modes. R:R mode takes risk % and reward:risk ratio and calculates TP automatically.
- TP/SL guides are labeled with their percentage distance from entry.

The streaming transport is server-sent events to the browser, backed by one-second server polling of Kalshi public market data. It is near-real-time rather than an exchange WebSocket implementation; this avoids exposing credentials and is compatible with the existing app architecture.
