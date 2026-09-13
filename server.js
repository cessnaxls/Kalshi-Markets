import express from 'express';
import crypto from 'crypto';
import WebSocket from 'ws';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({limit:'1mb'}));
app.use(express.static('public'));

const env = process.env.KALSHI_ENV === 'demo' ? 'demo' : 'production';
const BASE = process.env.KALSHI_BASE_URL || (env === 'demo'
  ? 'https://external-api.demo.kalshi.co/trade-api/v2'
  : 'https://external-api.kalshi.com/trade-api/v2');
const WS_URL = env === 'demo'
  ? 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2'
  : 'wss://external-api-ws.kalshi.com/trade-api/ws/v2';
const API_KEY = process.env.KALSHI_API_KEY_ID || '';
const PRIVATE_KEY = (process.env.KALSHI_PRIVATE_KEY || '').replace(/\\n/g,'\n');

function signHeaders(method, fullPath) {
  if (!API_KEY || !PRIVATE_KEY) return {};
  const ts = Date.now().toString();
  const path = fullPath.split('?')[0];
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

function authHeaders(method, apiPath) {
  return signHeaders(method, '/trade-api/v2' + apiPath.split('?')[0]);
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

app.get('/api/health', (req,res)=>res.json({ok:true, env, linked:Boolean(API_KEY && PRIVATE_KEY), realtime:Boolean(API_KEY && PRIVATE_KEY)}));


function marketYesPct(m){
  const vals=[m.yes_ask_dollars,m.yes_bid_dollars,m.last_price_dollars];
  for(const v of vals){const n=Number(v);if(Number.isFinite(n))return Math.max(0,Math.min(100,n*100));}
  for(const v of [m.yes_ask,m.yes_bid,m.last_price]){const n=Number(v);if(Number.isFinite(n))return Math.max(0,Math.min(100,n));}
  return null;
}
function marketVolume(m){
  const n=Number(m.volume_fp ?? m.volume ?? 0); return Number.isFinite(n)?n:0;
}
function truthyLive(v){
  if(v===true||v===1)return true;
  const s=String(v??'').trim().toLowerCase();
  return ['true','1','live','in_progress','in-progress','ongoing','started'].includes(s);
}
function marketIsLive(m,now=Date.now()){
  // Prefer an explicit live/in-progress flag if Kalshi includes one in product metadata.
  if(truthyLive(m.is_live)||truthyLive(m.live)||truthyLive(m.in_progress)||truthyLive(m.product_metadata?.is_live)||truthyLive(m.product_metadata?.live)) return true;
  // Public market objects expose occurrence_datetime. For scheduled events (especially sports),
  // treat the period from the occurrence/start time until market close as "Live now".
  const start=Date.parse(m.occurrence_datetime||'');
  const end=Date.parse(m.close_time||m.latest_expiration_time||'');
  return Number.isFinite(start)&&start<=now&&(!Number.isFinite(end)||now<end);
}
function eventExplicitLive(e){
  return truthyLive(e?.is_live)||truthyLive(e?.live)||truthyLive(e?.in_progress)||
    truthyLive(e?.product_metadata?.is_live)||truthyLive(e?.product_metadata?.live)||truthyLive(e?.product_metadata?.in_progress);
}
function browseEvent(e,now=Date.now(),includeAll=false){
  // Browse should represent actually active/tradable markets, not historical nested markets.
  const markets=(e.markets||[]).filter(m=>String(m.status||'').toLowerCase()==='open');
  const explicitEventLive=eventExplicitLive(e);
  const allOutcomes=markets.map(m=>({
    ticker:m.ticker,
    label:m.yes_sub_title || m.subtitle || m.title || m.ticker,
    no_label:m.no_sub_title || 'No',
    yes_pct:marketYesPct(m),
    volume:marketVolume(m),
    close_time:m.close_time || m.latest_expiration_time || null,
    occurrence_datetime:m.occurrence_datetime || null,
    is_live:explicitEventLive || marketIsLive(m,now)
  })).sort((a,b)=>(b.volume-a.volume)||((b.yes_pct??-1)-(a.yes_pct??-1)));
  const isLive=explicitEventLive || allOutcomes.some(o=>o.is_live);
  return {
    event_ticker:e.event_ticker,
    series_ticker:e.series_ticker,
    title:e.title || e.event_ticker,
    subtitle:e.sub_title || '',
    category:e.category || 'Other',
    strike_date:e.strike_date || null,
    markets_count:markets.length,
    live_markets_count:isLive?markets.length:allOutcomes.filter(o=>o.is_live).length,
    volume:markets.reduce((a,m)=>a+marketVolume(m),0),
    close_time:markets.map(m=>m.close_time||m.latest_expiration_time).filter(Boolean).sort()[0]||null,
    is_live:isLive,
    // Keep the browse payload small; the full event is lazy-loaded when the user expands it.
    outcomes:includeAll?allOutcomes:allOutcomes.slice(0,4)
  };
}
app.get('/api/browse/event/:eventTicker', async (req,res)=>{
  try{
    const d=await kget('/events/'+encodeURIComponent(req.params.eventTicker));
    const e=d.event||d;
    const card=browseEvent(e,Date.now(),true);
    res.json(card);
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/browse/page', async (req,res)=>{
  try{
    const cursor=String(req.query.cursor||'');
    const now=Date.now();
    // One Kalshi page per browser request. This keeps the UI responsive and avoids
    // a single long-running request timing out while walking the entire catalog.
    const d=await kget('/events',{limit:200,cursor,status:'open',with_nested_markets:true});
    const cards=(d.events||[]).map(e=>browseEvent(e,now,false)).filter(e=>e.markets_count>0);
    res.json({
      events:cards,
      cursor:d.cursor||'',
      event_count:cards.length,
      market_count:cards.reduce((n,e)=>n+e.markets_count,0),
      generated_at:new Date(now).toISOString()
    });
  }catch(e){res.status(500).json({error:e.message});}
});

// Backward-compatible quick Browse response: first page only. The v10 browser uses
// /api/browse/page and progressively walks the cursor itself.
app.get('/api/browse', async (req,res)=>{
  try{
    const now=Date.now();
    const d=await kget('/events',{limit:200,status:'open',with_nested_markets:true});
    const cards=(d.events||[]).map(e=>browseEvent(e,now,false)).filter(e=>e.markets_count>0);
    const categories=[...new Set(cards.map(e=>e.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    res.json({events:cards,categories,cursor:d.cursor||'',event_count:cards.length,market_count:cards.reduce((n,e)=>n+e.markets_count,0),partial:Boolean(d.cursor)});
  }catch(e){res.status(500).json({error:e.message});}
});

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

app.get('/api/orderbook/:ticker', async (req,res)=>{
  try { res.json(await kget('/markets/'+encodeURIComponent(req.params.ticker)+'/orderbook', {depth:100})); }
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
  // REST trades are generally newest-first. Sort oldest-first so OHLC is correct.
  const ordered=[...trades].sort((a,b)=>new Date(a.created_time)-new Date(b.created_time));
  for (const t of ordered){
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
  for(const c of [...candles].sort((a,b)=>a.time-b.time)){
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

// Server-sent events bridge. The browser never sees the Kalshi private key.
app.get('/api/live/:ticker', (req,res)=>{
  const ticker=String(req.params.ticker||'').toUpperCase();
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();
  const send=(event,data)=>{ if(!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  if(!API_KEY || !PRIVATE_KEY){ send('status',{status:'unavailable',message:'Add Kalshi API credentials to enable live WebSocket data.'}); return res.end(); }

  let closed=false, ws, reconnectTimer, attempts=0;
  const connect=()=>{
    if(closed) return;
    try{
      const headers=signHeaders('GET','/trade-api/ws/v2');
      ws=new WebSocket(WS_URL,{headers});
      ws.on('open',()=>{
        attempts=0; send('status',{status:'connected'});
        ws.send(JSON.stringify({id:1,cmd:'subscribe',params:{channels:['trade','ticker','orderbook_delta'],market_tickers:[ticker]}}));
      });
      ws.on('message',buf=>{
        let d; try{d=JSON.parse(buf.toString())}catch{return;}
        if(d.type==='trade') send('trade',d.msg||d);
        else if(d.type==='ticker') send('ticker',d.msg||d);
        else if(d.type==='orderbook_snapshot') send('orderbook_snapshot',d.msg||d);
        else if(d.type==='orderbook_delta') send('orderbook_delta',d.msg||d);
        else if(d.type==='error') send('status',{status:'error',message:d.msg?.msg||'Kalshi WebSocket error'});
      });
      ws.on('error',err=>send('status',{status:'error',message:err.message}));
      ws.on('close',()=>{
        if(closed)return;
        send('status',{status:'reconnecting'});
        const delay=Math.min(15000,1000*Math.pow(2,attempts++));
        reconnectTimer=setTimeout(connect,delay);
      });
    }catch(e){send('status',{status:'error',message:e.message});reconnectTimer=setTimeout(connect,3000);}
  };
  const keep=setInterval(()=>{if(!res.writableEnded)res.write(': keepalive\n\n')},15000);
  req.on('close',()=>{closed=true;clearInterval(keep);clearTimeout(reconnectTimer);try{ws?.close()}catch{}});
  connect();
});

app.get('/api/account', async(req,res)=>{
  try{
    if(!API_KEY||!PRIVATE_KEY) return res.json({linked:false});
    const [balance,positions] = await Promise.all([kget('/portfolio/balance'),kget('/portfolio/positions',{limit:200})]);
    res.json({linked:true,balance,positions});
  }catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log(`Ticker terminal on :${PORT}`));
