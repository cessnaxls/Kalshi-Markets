(function(){
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => '$' + Number(n || 0).toFixed(2);
const cents = n => Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) + '¢' : '—';
const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
async function api(url, opts){
  const r = await fetch(url, opts);
  let j = {};
  try { j = await r.json(); } catch { j = { error: 'Invalid server response' }; }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

let current = null;
let raw = [];
let shown = [];
let tf = '1m';
let contract = 'YES';
let orderSide = 'YES';
let chartType = 'candles';
let quoteTimer = null;
let marketCache = [];
let chart, candle, line, vwapSeries, ema9Series, ema21Series;
let paper = loadPaper();

function loadPaper(){
  try {
    const p = JSON.parse(localStorage.getItem('kalshiPaperV5') || 'null');
    if (p && Number.isFinite(p.cash) && p.positions) return p;
  } catch {}
  return { cash: 10000, positions: {}, orders: [], realized: 0 };
}
function savePaper(){ localStorage.setItem('kalshiPaperV5', JSON.stringify(paper)); }
function flash(msg, bad){
  $('#toast').textContent = msg;
  $('#toast').style.color = bad ? 'var(--red)' : 'var(--muted)';
  clearTimeout(flash._t); flash._t = setTimeout(() => { $('#toast').textContent = ''; }, 3500);
}
function setChartMessage(msg){ $('#chartMessage').textContent = msg; $('#chartMessage').classList.toggle('hidden', !msg); }

function initChart(){
  if (!window.LightweightCharts) {
    setChartMessage('Chart library failed to load. Reload the page.');
    return false;
  }
  const dark = !document.body.classList.contains('light');
  chart = LightweightCharts.createChart($('#chart'), {
    width: $('#chart').clientWidth || 800,
    height: $('#chart').clientHeight || 500,
    layout: { background: { color: 'transparent' }, textColor: dark ? '#8391a3' : '#708095', fontSize: 10 },
    grid: { vertLines: { color: dark ? '#1c2530' : '#e4e9ef' }, horzLines: { color: dark ? '#1c2530' : '#e4e9ef' } },
    rightPriceScale: { borderColor: dark ? '#26303a' : '#cfd8e2', scaleMargins: { top: .06, bottom: .06 } },
    timeScale: { borderColor: dark ? '#26303a' : '#cfd8e2', timeVisible: true, secondsVisible: false, rightOffset: 3, barSpacing: 7, minBarSpacing: 1 },
    crosshair: { mode: 0 }
  });
  candle = chart.addCandlestickSeries({
    upColor: '#18b879', downColor: '#e45454', borderVisible: false,
    wickUpColor: '#18b879', wickDownColor: '#e45454',
    priceFormat: { type: 'custom', formatter: p => Math.round(p * 100) + '¢' }
  });
  line = chart.addLineSeries({ lineWidth: 2, visible: false, priceFormat: { type: 'custom', formatter: p => Math.round(p * 100) + '¢' } });
  vwapSeries = chart.addLineSeries({ lineWidth: 1, priceLineVisible: false });
  ema9Series = chart.addLineSeries({ lineWidth: 1, priceLineVisible: false });
  ema21Series = chart.addLineSeries({ lineWidth: 1, priceLineVisible: false });
  new ResizeObserver(() => {
    if (chart) chart.applyOptions({ width: $('#chart').clientWidth, height: $('#chart').clientHeight });
  }).observe($('#chart'));
  chart.subscribeCrosshairMove(p => {
    if (!p || !p.time) return;
    const d = p.seriesData.get(candle);
    if (d && d.open != null) showOHLC(d);
    else {
      const q = p.seriesData.get(line);
      if (q && q.value != null) $('#ohlc').textContent = 'PRICE ' + cents(q.value);
    }
  });
  return true;
}

function aggregate(src, seconds){
  if (seconds <= 60) return src.slice();
  const out = []; let b = null;
  for (const x of src) {
    const t = Math.floor(x.time / seconds) * seconds;
    if (!b || b.time !== t) {
      if (b) out.push(b);
      b = { ...x, time: t };
    } else {
      b.high = Math.max(b.high, x.high); b.low = Math.min(b.low, x.low); b.close = x.close; b.volume += x.volume || 0;
    }
  }
  if (b) out.push(b);
  return out;
}
function invert(src){ return src.map(x => ({ ...x, open:1-x.open, high:1-x.low, low:1-x.high, close:1-x.close })); }
function ema(vals,n){
  if (!vals.length) return [];
  const k = 2/(n+1); let e = vals[0].close;
  return vals.map(x => ({ time:x.time, value:(e = x.close*k + e*(1-k)) }));
}
function metrics(vals){
  let pv=0, v=0;
  const vwap = vals.map(x => { const vol=Number(x.volume)||0; pv += ((x.high+x.low+x.close)/3)*vol; v += vol; return {time:x.time,value:v?pv/v:x.close}; });
  return { vwap, e9:ema(vals,9), e21:ema(vals,21) };
}
function showOHLC(x){ $('#ohlc').textContent = `O ${cents(x.open)}   H ${cents(x.high)}   L ${cents(x.low)}   C ${cents(x.close)}`; }
function redraw(fit){
  if (!chart || !candle) return;
  const source = contract === 'NO' ? invert(raw) : raw.slice();
  const seconds = ({'1m':60,'5m':300,'10m':600,'15m':900,'1h':3600,'1d':86400})[tf] || 60;
  shown = aggregate(source, seconds);
  candle.setData(shown);
  line.setData(shown.map(x => ({time:x.time,value:x.close})));
  candle.applyOptions({ visible: chartType === 'candles' });
  line.applyOptions({ visible: chartType === 'line' });
  renderTA();
  if (fit && shown.length) chart.timeScale().fitContent();
  const z = shown[shown.length-1];
  if (z) { $('#lastPrice').textContent = cents(z.close); showOHLC(z); }
  setChartMessage(shown.length ? '' : 'No candlestick history returned for this market');
}
function renderTA(){
  if (!vwapSeries) return;
  const m = metrics(shown);
  vwapSeries.setData($('#vwap').checked ? m.vwap : []);
  ema9Series.setData($('#ema9').checked ? m.e9 : []);
  ema21Series.setData($('#ema21').checked ? m.e21 : []);
  const z = shown[shown.length-1];
  $('#indicators').innerHTML = z ? `Last <b>${cents(z.close)}</b><br>VWAP <b>${cents(m.vwap[m.vwap.length-1]?.value)}</b><br>EMA 9 <b>${cents(m.e9[m.e9.length-1]?.value)}</b><br>EMA 21 <b>${cents(m.e21[m.e21.length-1]?.value)}</b>` : 'No chart data.';
}
function renderEdge(){
  if (!shown.length || !current) { $('#edgeView').textContent = 'Load a market first.'; return; }
  const closes = shown.map(x=>x.close), last=closes[closes.length-1], lo=Math.min(...closes), hi=Math.max(...closes);
  const yb=Number(current.yes_bid_dollars), ya=Number(current.yes_ask_dollars), spread=Number.isFinite(ya-yb)?ya-yb:NaN;
  const m=metrics(shown), vw=m.vwap[m.vwap.length-1]?.value;
  $('#edgeView').innerHTML = `Spread <b>${cents(spread)}</b><br>Range <b>${cents(lo)}–${cents(hi)}</b><br>Last vs VWAP <b>${Number.isFinite(vw)?((last-vw)*100).toFixed(1)+'¢':'—'}</b><br>24h volume <b>${escapeHtml(current.volume_24h_fp || current.volume_fp || '—')}</b>`;
}

async function checkConfig(){
  try {
    const c = await api('/api/config');
    $('#connection').textContent = `● ${c.environment}${c.credentialsConfigured?' linked':''}`;
    $('#connection').className = 'connection ok';
  } catch(e) {
    $('#connection').textContent = '● server error'; $('#connection').className = 'connection bad'; flash(e.message,true);
  }
}

function chartRequestPeriod(){ return tf === '1d' ? 1440 : tf === '1h' ? 60 : 1; }
function daysForTf(){ return tf === '1d' ? 720 : tf === '1h' ? 180 : 45; }
async function loadMarket(ticker){
  const t = String(ticker || '').trim().toUpperCase();
  if (!t) return;
  $('#ticker').value = t;
  $('#liveLabel').textContent = '● LOADING'; $('#liveLabel').className = 'liveLabel';
  setChartMessage('Loading chart…');
  try {
    const end = Math.floor(Date.now()/1000), start = end - daysForTf()*86400;
    const d = await api(`/api/chart/${encodeURIComponent(t)}?start=${start}&end=${end}&period=${chartRequestPeriod()}`);
    current = d.market;
    $('#mticker').textContent = current.ticker;
    $('#title').textContent = current.title || current.subtitle || d.event?.title || '';
    raw = (d.candlesticks || []).map(x => ({
      time:Number(x.end_period_ts),
      open:Number(x.price?.open_dollars), high:Number(x.price?.high_dollars), low:Number(x.price?.low_dollars), close:Number(x.price?.close_dollars),
      volume:Number(x.volume_fp || x.volume || 0)
    })).filter(x => [x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);
    redraw(true);
    await refreshQuote();
    $('#historyText').textContent = `${raw.length} source candles · ${tf} · ${d.series_ticker || ''}`;
    $('#liveLabel').textContent = '● LIVE'; $('#liveLabel').className = 'liveLabel live';
    clearInterval(quoteTimer); quoteTimer = setInterval(refreshQuote, 5000);
  } catch(e) {
    raw=[]; shown=[]; redraw(false);
    $('#liveLabel').textContent = '● ERROR'; $('#liveLabel').className = 'liveLabel';
    $('#historyText').textContent = e.message; setChartMessage('Chart error: ' + e.message); flash(e.message,true);
  }
}
async function refreshQuote(){
  if (!current) return;
  try {
    const m = (await api('/api/market/' + encodeURIComponent(current.ticker))).market;
    current = m;
    const yb=Number(m.yes_bid_dollars), ya=Number(m.yes_ask_dollars), nb=Number(m.no_bid_dollars), na=Number(m.no_ask_dollars), lp=Number(m.last_price_dollars);
    $('#quoteLine').textContent = `YES ${cents(yb)} / ${cents(ya)} · NO ${cents(nb)} / ${cents(na)}`;
    if (Number.isFinite(lp)) $('#lastPrice').textContent = cents(contract==='YES'?lp:1-lp);
    updateOrderHint(); renderPaper();
  } catch(e) { flash('Quote refresh: '+e.message,true); }
}

async function listMarkets(){
  $('#markets').innerHTML = '<div class="market"><small>Loading…</small></div>';
  try {
    const d = await api('/api/markets?status=open&limit=200');
    marketCache = d.markets || [];
    drawMarketList();
  } catch(e) { $('#markets').innerHTML = `<div class="market"><small>${escapeHtml(e.message)}</small></div>`; }
}
function drawMarketList(){
  const q = $('#marketFilter').value.trim().toLowerCase();
  const items = marketCache.filter(m => !q || (m.title||'').toLowerCase().includes(q) || m.ticker.toLowerCase().includes(q));
  $('#markets').innerHTML = items.map(m => `<div class="market" data-t="${escapeHtml(m.ticker)}"><b>${escapeHtml(m.title || m.ticker)}</b><small>${escapeHtml(m.ticker)} · ${cents(Number(m.last_price_dollars))}</small></div>`).join('') || '<div class="market"><small>No matches</small></div>';
  $$('.market[data-t]').forEach(el => el.onclick = () => { $('#marketDrawer').classList.add('hidden'); loadMarket(el.dataset.t); });
}

function markPriceFor(side){
  if (!current) return NaN;
  const yes = Number(current.last_price_dollars);
  return side === 'YES' ? yes : 1 - yes;
}
function bidAskFor(side){
  if (!current) return {bid:NaN,ask:NaN};
  return side === 'YES'
    ? {bid:Number(current.yes_bid_dollars),ask:Number(current.yes_ask_dollars)}
    : {bid:Number(current.no_bid_dollars),ask:Number(current.no_ask_dollars)};
}
function paperEquity(){
  let eq = paper.cash;
  Object.values(paper.positions).forEach(p => { if (p.qty) eq += p.qty * (Number.isFinite(markPriceFor(p.side)) ? markPriceFor(p.side) : p.avg); });
  return eq;
}
function renderPaper(){
  const eq = paperEquity();
  $('#account').innerHTML = `<div class="stat"><b>${money(paper.cash)}</b><small>CASH</small></div><div class="stat"><b>${money(eq)}</b><small>EQUITY</small></div><div class="stat"><b>${paper.realized>=0?'+':''}${money(paper.realized)}</b><small>REALIZED</small></div>`;
  const entries = Object.values(paper.positions).filter(p=>p.qty!==0);
  $('#positions').innerHTML = entries.length ? entries.map(p => `<div class="pos"><span>${escapeHtml(p.ticker)} ${p.side}<br><small>${p.qty} @ ${cents(p.avg)}</small></span><strong>${money(p.qty*(Number.isFinite(markPriceFor(p.side))?markPriceFor(p.side):p.avg))}</strong></div>`).join('') : 'No open paper positions.';
}
function updateOrderHint(){
  const ba = bidAskFor(orderSide);
  $('#buyBtn').textContent = 'BUY ' + orderSide;
  $('#sellBtn').textContent = 'SELL ' + orderSide;
  $('#orderHint').textContent = current ? `${orderSide} · buy ${cents(ba.ask)} · sell ${cents(ba.bid)} · simulated only` : 'Load a market first';
}
function paperTrade(action){
  if (!current) return flash('Load a market first.', true);
  const n = Math.max(1, Math.floor(Number($('#count').value) || 1));
  const ba = bidAskFor(orderSide);
  const px = action === 'BUY' ? ba.ask : ba.bid;
  if (!Number.isFinite(px) || px <= 0 || px >= 1) return flash('No usable quote for this side.', true);
  const key = current.ticker + ':' + orderSide;
  const pos = paper.positions[key] || {ticker:current.ticker,side:orderSide,qty:0,avg:0};
  if (action === 'BUY') {
    const cost = px*n; if (cost > paper.cash) return flash('Insufficient paper cash.', true);
    const newQty = pos.qty+n; pos.avg = newQty ? ((pos.avg*pos.qty)+(px*n))/newQty : 0; pos.qty=newQty; paper.cash-=cost;
  } else {
    if (pos.qty < n) return flash('Paper sell is limited to contracts you already own.', true);
    paper.cash += px*n; paper.realized += (px-pos.avg)*n; pos.qty -= n; if (!pos.qty) pos.avg=0;
  }
  paper.positions[key]=pos; paper.orders.unshift({ticker:current.ticker,side:orderSide,action,count:n,price:px,time:Date.now()});
  savePaper(); renderPaper(); flash(`${action} ${n} ${orderSide} @ ${cents(px)}`, false);
}

function applyTheme(){
  const light = document.body.classList.contains('light');
  $('#theme').textContent = light ? '☀' : '☾';
  if (chart) chart.applyOptions({
    layout:{background:{color:'transparent'},textColor:light?'#708095':'#8391a3',fontSize:10},
    grid:{vertLines:{color:light?'#e4e9ef':'#1c2530'},horzLines:{color:light?'#e4e9ef':'#1c2530'}},
    rightPriceScale:{borderColor:light?'#cfd8e2':'#26303a'},timeScale:{borderColor:light?'#cfd8e2':'#26303a'}
  });
}
function bind(){
  $('#load').onclick = () => loadMarket($('#ticker').value);
  $('#ticker').addEventListener('keydown', e => { if (e.key === 'Enter') loadMarket($('#ticker').value); });
  $('#browse').onclick = () => { $('#marketDrawer').classList.remove('hidden'); listMarkets(); };
  $('#closeMarkets').onclick = () => $('#marketDrawer').classList.add('hidden');
  $('#marketFilter').oninput = drawMarketList;
  $('#fit').onclick = () => { if (chart && shown.length) chart.timeScale().fitContent(); };
  $$('.charttype').forEach(b => b.onclick = () => { $$('.charttype').forEach(x=>x.classList.remove('active')); b.classList.add('active'); chartType=b.dataset.type; redraw(false); });
  $$('.contract').forEach(b => b.onclick = () => { $$('.contract').forEach(x=>x.classList.remove('active')); b.classList.add('active'); contract=b.dataset.contract; redraw(false); refreshQuote(); });
  $$('#timeframes button').forEach(b => b.onclick = () => { $$('#timeframes button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); tf=b.dataset.tf; if (current) loadMarket(current.ticker); });
  ['vwap','ema9','ema21'].forEach(id => $('#'+id).onchange = renderTA);
  $('#ta').onclick = () => { $('#toolsTitle').textContent='Technical analysis'; $('#taControls').classList.remove('hidden'); $('#edgeView').classList.add('hidden'); $('#toolsPanel').classList.remove('hidden'); };
  $('#edge').onclick = () => { $('#toolsTitle').textContent='Market stats'; $('#taControls').classList.add('hidden'); $('#edgeView').classList.remove('hidden'); renderEdge(); $('#toolsPanel').classList.remove('hidden'); };
  $('#closeTools').onclick = () => $('#toolsPanel').classList.add('hidden');
  $$('.sideTab').forEach(b => b.onclick = () => { $$('.sideTab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); orderSide=b.dataset.side; updateOrderHint(); });
  $('#buyBtn').onclick = () => paperTrade('BUY'); $('#sellBtn').onclick = () => paperTrade('SELL');
  $('#resetPaper').onclick = () => { if (confirm('Reset paper account to $10,000?')) { paper={cash:10000,positions:{},orders:[],realized:0}; savePaper(); renderPaper(); flash('Paper account reset.'); } };
  $('#theme').onclick = () => { document.body.classList.toggle('light'); localStorage.setItem('kalshiThemeV5',document.body.classList.contains('light')?'light':'dark'); applyTheme(); };
}

if (localStorage.getItem('kalshiThemeV5') === 'light') document.body.classList.add('light');
bind();
initChart();
applyTheme();
renderPaper();
updateOrderHint();
checkConfig();
})();
