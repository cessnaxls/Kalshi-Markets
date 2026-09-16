import express from 'express';
import crypto from 'crypto';
import 'dotenv/config';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const ENV = process.env.KALSHI_ENV === 'production' ? 'production' : 'demo';
const BASE = ENV === 'production'
  ? 'https://external-api.kalshi.com/trade-api/v2'
  : 'https://external-api.demo.kalshi.co/trade-api/v2';
const keyId = process.env.KALSHI_API_KEY_ID || '';
const privateKey = (process.env.KALSHI_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const liveServerEnabled = process.env.LIVE_TRADING_ENABLED === 'true';

function authHeaders(method, path) {
  if (!keyId || !privateKey) throw new Error('Kalshi credentials are not configured on the server');
  const ts = Date.now().toString();
  const fullPath = '/trade-api/v2' + path.split('?')[0];
  const sig = crypto.sign(
    'sha256',
    Buffer.from(ts + method.toUpperCase() + fullPath),
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }
  ).toString('base64');
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': sig,
    'Content-Type': 'application/json'
  };
}

async function kalshi(path, { auth = false, method = 'GET', body } = {}) {
  const headers = auth ? authHeaders(method, path) : { 'Content-Type': 'application/json' };
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.message || data?.error?.message || data?.error || `Kalshi ${r.status}`;
    throw Object.assign(new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)), { status: r.status, data });
  }
  return data;
}

app.get('/api/config', (req, res) => res.json({
  environment: ENV,
  credentialsConfigured: !!(keyId && privateKey),
  liveServerEnabled
}));

app.get('/api/markets', async (req, res) => {
  try {
    const p = new URLSearchParams({
      limit: String(Math.min(Number(req.query.limit) || 100, 1000)),
      status: req.query.status || 'open'
    });
    if (req.query.cursor) p.set('cursor', req.query.cursor);
    if (req.query.event_ticker) p.set('event_ticker', req.query.event_ticker);
    res.json(await kalshi('/markets?' + p));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/market/:ticker', async (req, res) => {
  try { res.json(await kalshi('/markets/' + encodeURIComponent(req.params.ticker))); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/event/:eventTicker', async (req, res) => {
  try { res.json(await kalshi('/events/' + encodeURIComponent(req.params.eventTicker))); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Robust chart endpoint: resolves the market -> event -> series automatically.
app.get('/api/chart/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker;
    const marketData = await kalshi('/markets/' + encodeURIComponent(ticker));
    const market = marketData.market;
    if (!market?.event_ticker) throw new Error('Market did not return an event ticker');
    const eventData = await kalshi('/events/' + encodeURIComponent(market.event_ticker));
    const seriesTicker = eventData.event?.series_ticker;
    if (!seriesTicker) throw new Error('Event did not return a series ticker');

    const period = [1, 60, 1440].includes(Number(req.query.period)) ? Number(req.query.period) : 1;
    const now = Math.floor(Date.now() / 1000);
    const end = Number(req.query.end) || now;
    const start = Number(req.query.start) || (end - 30 * 86400);
    const path = `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${period}`;
    const candles = await kalshi(path);
    res.json({ ...candles, market, event: eventData.event, series_ticker: seriesTicker });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, detail: e.data }); }
});

app.get('/api/orderbook/:ticker', async (req, res) => {
  try { res.json(await kalshi('/markets/' + encodeURIComponent(req.params.ticker) + '/orderbook?depth=20')); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/account', async (req, res) => {
  try {
    const [balance, positions, orders] = await Promise.all([
      kalshi('/portfolio/balance', { auth: true }),
      kalshi('/portfolio/positions?limit=1000', { auth: true }),
      kalshi('/portfolio/orders?limit=1000', { auth: true })
    ]);
    res.json({ balance, positions, orders });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post('/api/live/order', async (req, res) => {
  try {
    if (!liveServerEnabled) return res.status(403).json({ error: 'LIVE_TRADING_ENABLED is false on server' });
    if (req.body.confirm !== 'PLACE LIVE ORDER') return res.status(400).json({ error: 'Explicit confirmation missing' });
    const { ticker, action, side, count, price } = req.body;
    if (!ticker || !['buy', 'sell'].includes(action) || !['yes', 'no'].includes(side) || !(Number(count) > 0) || !(Number(price) > 0 && Number(price) < 1)) {
      return res.status(400).json({ error: 'Invalid order' });
    }
    const payload = {
      ticker,
      action,
      side,
      count: Math.floor(Number(count)),
      type: 'limit',
      client_order_id: crypto.randomUUID(),
      [side + '_price']: Math.round(Number(price) * 100)
    };
    res.json(await kalshi('/portfolio/orders', { auth: true, method: 'POST', body: payload }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message, detail: e.data }); }
});

app.get('/api/health', (req, res) => res.json({ ok: true, environment: ENV }));
app.listen(process.env.PORT || 3000, () => console.log(`Kalshi Edge Terminal running (${ENV})`));
