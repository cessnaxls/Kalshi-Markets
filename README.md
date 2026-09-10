# Kalshi Ticker Terminal

A chart-first Kalshi market viewer designed to feel like a market terminal rather than Kalshi's card-based market UI.

## Features
- Searches open Kalshi markets and shows actual market tickers.
- Candlestick or line chart.
- Timeframes: 1s, 5s, 15s, 30s, 1m, 2m, 5m, 10m, 15m.
- Full market lookback for minute+ charts when available.
- Sub-minute OHLC is derived from individual Kalshi trades.
- Server-side RSA-PSS Kalshi API authentication so private keys never reach the browser.
- Read-only account connection endpoint for balance/positions groundwork.
- Responsive desktop/iPad layout.

## Deploy on Render
1. Create a GitHub repository and upload this project.
2. In Render, choose **New > Blueprint** and connect the repo. `render.yaml` configures the service.
3. Add secrets in Render:
   - `KALSHI_API_KEY_ID`: your Kalshi API key ID
   - `KALSHI_PRIVATE_KEY`: your complete RSA private key PEM. Render supports multiline secret values. If necessary, paste it with `\\n` line separators.
   - `KALSHI_ENV`: `production` (or `demo`)
4. Deploy.

Generate the API key from Kalshi Account & security > API Keys. Prefer a read-only key for this viewer.

## Local run
```bash
npm install
KALSHI_API_KEY_ID='...' KALSHI_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----...' npm start
```
Then open http://localhost:3000.

## Technical note on sub-minute history
Kalshi's dedicated candlestick endpoint documents native 1-minute, 1-hour and 1-day periods. Sub-minute charts therefore paginate raw trades and build OHLC buckets locally. The starter app caps very fine intervals to recent windows so a liquid market does not require downloading an unbounded number of trades on every request. A production upgrade should persist live trades in Postgres/Timescale or Redis and continuously build 1-second bars; that allows genuine start-of-market 1-second history without repeatedly replaying every trade from Kalshi.

## Security
Never commit a private key. `.gitignore` excludes `.env` and `*.key`. Credentials are read only by the Node server.
