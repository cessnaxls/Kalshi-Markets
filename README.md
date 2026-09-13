# Kalshi Ticker Terminal v7

An iPad-first, chart-first Kalshi market viewer with real-time candles and a local paper-trading simulator.

## What changed in v3
- Fixed-height iPad layout using the visual viewport, safe-area insets, and no page scrolling.
- Real-time market updates bridged from Kalshi WebSockets through the Node server to the browser with Server-Sent Events.
- Live candles update in-place as trades arrive.
- Explicit YES / NO chart selector. NO candles are mathematically derived from YES prices (`NO = 100¢ - YES`) and OHLC is inverted correctly (`NO high = 100 - YES low`, etc.), so green always means the displayed contract rose during that candle.
- Line or candlestick chart.
- Timeframes: 1s, 5s, 15s, 30s, 1m, 2m, 5m, 10m, 15m.
- Direct ticker entry.
- Paper trading with $10,000 fake starting cash, BUY/SELL for the selected YES or NO contract, positions, equity, unrealized P/L, and reset.
- Paper buys fill at the displayed ask and sells fill at the displayed bid. No real Kalshi orders are ever submitted.
- Server-side RSA-PSS authentication keeps the Kalshi private key off the browser/iPad.


## v7: Kalshi-style market browser + light mode

- **Browse Markets** opens inside the existing fixed iPad viewport; it does not make the app taller or wider.
- Browse cards are event-first, similar to Kalshi's public Browse experience: category, event title, leading outcomes, implied YES percentage, event volume, and market count.
- Filters: **Trending** (approximated from public API volume), **Closing soon**, **New**, dynamic category chips, and text search.
- Tap any outcome to close Browse and open its exact market ticker in the existing chart terminal.
- Added a persistent **Light / Dark** theme toggle. The selected mode is stored locally and also re-themes the Lightweight Charts canvas.
- Browsing uses Kalshi's `/events` endpoint with nested open markets; direct ticker search remains available.

## Deploy on Render
1. Create a GitHub repository and upload the contents of this folder.
2. In Render choose **New > Blueprint** and connect the repository. `render.yaml` configures the web service.
3. In the Render service Environment page add:
   - `KALSHI_API_KEY_ID` — your Kalshi API key ID.
   - `KALSHI_PRIVATE_KEY` — the complete RSA private-key PEM. You can use a multiline value or escaped `\\n` line breaks.
   - `KALSHI_ENV` — `production` or `demo`.
4. Deploy/redeploy.

The real-time Kalshi WebSocket session is opened by the server because Kalshi WebSocket connections require authenticated handshake headers. The browser receives only normalized live events from your server.

## Historical candles
Kalshi documents native candlesticks at 1-minute, 1-hour, and 1-day intervals. This app retrieves 1-minute history for minute-based views and aggregates it locally for 2m/5m/10m/15m. Sub-minute OHLC is built from individual historical trades, then live trade events continue the current candle in real time.

Very fine historical intervals are intentionally capped to a recent window so loading an active market does not replay an unbounded number of trades. For permanent full-market 1-second history, the next step is persisting live trades/1-second bars in Postgres/TimescaleDB or similar storage.

## Paper trading behavior
Paper trading is browser-local and uses `localStorage`.
- Starting balance: $10,000 fake cash.
- Buy: simulated at ask.
- Sell: simulated at bid.
- Selling more contracts than the paper account owns is blocked.
- Fees and slippage are not modeled in this version.
- No endpoint in this app places a real Kalshi order.

## Local run
```bash
npm install
KALSHI_API_KEY_ID='...' KALSHI_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----...' npm start
```
Then open `http://localhost:3000`.

## Security
Never commit your private key. `.gitignore` excludes `.env` and key files. Kalshi credentials are read only by the Node server.

## v6: Order-book edge tools

The EDGE overlay keeps the terminal dimensions unchanged and adds:

- Live top-5 order-book imbalance (OBI) for the currently displayed YES or NO contract.
- Live microprice, midprice, and microprice edge from Kalshi order-book snapshots/deltas.
- Strong pressure callout when `|OBI| >= 0.60`.
- Automatic local signal backtesting at 5s, 15s, 30s, 1m, and 5m horizons.
- Accuracy, sample count, and average directional move per horizon.
- Signal statistics are stored only in browser localStorage and can be reset from the EDGE drawer.

Kalshi order books expose YES and NO bid levels. The app derives the displayed contract's ask ladder from the complementary side, then calculates imbalance over the best five bid/ask levels.
