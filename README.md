# Kalshi Market Terminal

A public-market-data research dashboard built with FastAPI and TradingView Lightweight Charts.

## Run locally

```bash
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://localhost:8000 and paste a **market ticker** (not an event ticker).

## Deploy on Render free

1. Push this folder to a new GitHub repository.
2. In Render, choose **New > Blueprint**, connect the repository and apply `render.yaml`.
3. Open the deployed URL. No API key required for public endpoints.

## Important data caveats

- All chart candles are reconstructed from public executed trades. No artificial 1-second data is created.
- The public trades endpoint may impose limits, pagination or historical retention. A 100-page safety cap prevents unbounded Render free-tier requests. The interface warns if the cap is hit.
- Sparse markets have gaps, and prices are trade prices, not bid/ask quote history.
- Technical indicators are descriptive, not investment recommendations. No order placement is implemented.
- Large-history requests can be slow and Render free services can spin down when idle.
