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
