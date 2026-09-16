# Kalshi Edge Terminal

Render-ready Node web terminal with Kalshi market browser, candlesticks, volume/VWAP/EMA overlays, order book, paper trading, live-order gateway, programmable rule bot, scanner UI, risk controls, and dark/light modes.

## Deploy to Render
1. Push this folder to a GitHub repo.
2. Render -> New -> Blueprint -> select repo (`render.yaml` is included).
3. Start in **demo**. Create a Kalshi demo API key and set `KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY` in Render environment variables.
4. Keep `LIVE_TRADING_ENABLED=false` while testing. Public market/chart data works without account credentials.
5. For production, set `KALSHI_ENV=production`, install production credentials, and only then deliberately set `LIVE_TRADING_ENABLED=true`.

Live order submission also requires a browser confirmation phrase. Private keys stay server-side and are never returned to the browser.

## Bot expressions
Expressions can reference: `price`, `vwap`, `ema9`, `ema21`, `volumeRatio`, and `spread`.
Example: `price <= 0.25 && price > vwap && ema9 > ema21 && spread <= 0.05 && volumeRatio >= 1.25`

The scanner/bot is a strategy execution framework, not a guarantee of positive expected value. Paper-test strategies first.
