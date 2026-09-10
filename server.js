import express from 'express';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({limit:'1mb'}));
app.use(express.static('public'));

const env = process.env.KALSHI_ENV === 'demo' ? 'demo' : 'production';
const BASE = env === 'demo'
  ? 'https://external-api.demo.kalshi.co/trade-api/v2'
  : 'https://external-api.kalshi.com/trade-api/v2';
const API_KEY = process.env.KALSHI_API_KEY_ID || '';
const PRIVATE_KEY = (process.env.KALSHI_PRIVATE_KEY || '').replace(/\\n/g,'\n');

function authHeaders(method, apiPath) {
  if (!API_KEY || !PRIVATE_KEY) return {};
  const ts = Date.now().toString();
  const path = '/trade-api/v2' + apiPath.split('?')[0];
  const data = Buffer.from(ts + method.toUpperCase() + path);
  const signature = crypto.sign('sha256', data, {
    key: PRIVATE_KEY,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }).toString('base64');
  return {
    'KALSHI-ACCESS-KEY': API_KEY,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': signature
  };
}

async function kget(path, query = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([,v]) => v !== undefined && v !== null && v !== '')).toString();
  const apiPath = path + (qs ? `?${qs}` : '');
  const r = await fetch(BASE + apiPath, {headers: authHeaders('GET', path)});
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = {message:text}; }
  if (!r.ok) throw new Error(body?.error?.message || body?.message || `Kalshi ${r.status}`);
  return body;
}

app.get('/api/health', (req,res)=>res.json({ok:true, env, linked:Boolean(API_KEY && PRIVATE_KEY)}));

app.get('/api/markets', async (req,res)=>{
  try {
    const q = req.query.q?.toString().toLowerCase() || '';
    const status = req.query.status || 'open';
    const data = await kget('/markets', {limit:1000, status});
    let markets = data.markets || [];
    if (q) markets = markets.filter(m => [m.ticker,m.title,m.subtitle,m.event_ticker,m.series_ticker].some(v => String(v||'').toLowerCase().includes(q)));
    res.json({markets:markets.slice(0,300)});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/market/:ticker', async (req,res)=>{
  try { res.json(await kget('/markets/'+encodeURIComponent(req.params.ticker))); }
  catch(e){res.status(500).json({error:e.message});}
});

function intervalSeconds(tf){
  const map={"1s":1,"5s":5,"15s":15,"30s":30,"1m":60,"2m":120,"5m":300,"10m":600,"15m":900};
  return map[tf] || 60;
}
function priceOf(t){
  const p = Number(t.yes_price_dollars ?? (t.yes_price!=null ? t.yes_price/100 : NaN));
  return Number.isFinite(p) ? p*100 : null;
}
function aggregateTrades(trades, step){
  const b = new Map();
  for (const t of trades){
    const ts = Math.floor(new Date(t.created_time).getTime()/1000);
    const p = priceOf(t); if (!Number.isFinite(ts) || p==null) continue;
    const k = Math.floor(ts/step)*step;
    let x=b.get(k); if(!x){x={time:k,open:p,high:p,low:p,close:p,volume:0};b.set(k,x);} else {x.high=Math.max(x.high,p);x.low=Math.min(x.low,p);x.close=p;}
    x.volume += Number(t.count_fp || t.count || 0);
  }
  return [...b.values()].sort((a,b)=>a.time-b.time);
}
function aggregateCandles(candles, step){
  const b = new Map();
  for(const c of candles){
    const ts=Number(c.time); const k=Math.floor(ts/step)*step;
    let x=b.get(k); if(!x){x={time:k,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume||0};b.set(k,x);} else {x.high=Math.max(x.high,c.high);x.low=Math.min(x.low,c.low);x.close=c.close;x.volume+=(c.volume||0);}
  }
  return [...b.values()].sort((a,b)=>a.time-b.time);
}

async function allTrades(ticker, minTs, maxTs, capPages=30){
  let cursor=''; const out=[];
  for(let i=0;i<capPages;i++){
    const d=await kget('/markets/trades',{ticker,limit:1000,min_ts:minTs,max_ts:maxTs,cursor});
    out.push(...(d.trades||[])); cursor=d.cursor||''; if(!cursor)break;
  }
  return out;
}

app.get('/api/chart/:ticker', async (req,res)=>{
  try{
    const ticker=req.params.ticker; const tf=req.query.tf||'1m'; const step=intervalSeconds(tf);
    const md=await kget('/markets/'+encodeURIComponent(ticker)); const m=md.market||md;
    const start=Math.max(0,Math.floor(new Date(m.open_time||m.created_time||m.expected_expiration_time||Date.now()-86400000).getTime()/1000));
    const end=Math.floor(Date.now()/1000);
    let candles=[]; let source='trades'; let truncated=false;

    if(step<60){
      const maxSpan=step<=5? 6*3600 : step<=15?24*3600:3*86400;
      const qstart=Math.max(start,end-maxSpan);
      const trades=await allTrades(ticker,qstart,end,40);
      candles=aggregateTrades(trades,step); truncated=qstart>start;
    } else {
      // Use 1-minute native candles, then aggregate locally to 2/5/10/15m.
      const series=m.series_ticker || String(ticker).split('-')[0];
      try {
        const d=await kget(`/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks`,{start_ts:start,end_ts:end,period_interval:1});
        const base=(d.candlesticks||[]).map(c=>({time:Number(c.end_period_ts)-60,open:Number(c.price?.open_dollars)*100,high:Number(c.price?.high_dollars)*100,low:Number(c.price?.low_dollars)*100,close:Number(c.price?.close_dollars)*100,volume:Number(c.volume_fp||0)})).filter(c=>[c.open,c.high,c.low,c.close].every(Number.isFinite));
        candles= step===60?base:aggregateCandles(base,step); source='kalshi-1m';
      } catch {
        const trades=await allTrades(ticker,start,end,50); candles=aggregateTrades(trades,step); source='trades-fallback';
      }
    }
    res.json({market:m,tf,step,start,end,source,truncated,candles});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/account', async(req,res)=>{
  try{
    if(!API_KEY||!PRIVATE_KEY) return res.json({linked:false});
    const [balance,positions] = await Promise.all([kget('/portfolio/balance'),kget('/portfolio/positions',{limit:200})]);
    res.json({linked:true,balance,positions});
  }catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log(`Ticker terminal on :${PORT}`));
