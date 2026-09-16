import express from 'express';
import crypto from 'crypto';
import 'dotenv/config';

const app=express(); app.use(express.json({limit:'1mb'})); app.use(express.static('public'));
const ENV=process.env.KALSHI_ENV==='production'?'production':'demo';
const BASE=ENV==='production'?'https://external-api.kalshi.com/trade-api/v2':'https://external-api.demo.kalshi.co/trade-api/v2';
const keyId=process.env.KALSHI_API_KEY_ID||'';
const privateKey=(process.env.KALSHI_PRIVATE_KEY||'').replace(/\\n/g,'\n');
const liveServerEnabled=process.env.LIVE_TRADING_ENABLED==='true';
function authHeaders(method,path){
 if(!keyId||!privateKey) throw new Error('Kalshi credentials are not configured on the server');
 const ts=Date.now().toString(); const fullPath='/trade-api/v2'+path.split('?')[0];
 const sig=crypto.sign('sha256',Buffer.from(ts+method.toUpperCase()+fullPath),{key:privateKey,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:crypto.constants.RSA_PSS_SALTLEN_DIGEST}).toString('base64');
 return {'KALSHI-ACCESS-KEY':keyId,'KALSHI-ACCESS-TIMESTAMP':ts,'KALSHI-ACCESS-SIGNATURE':sig,'Content-Type':'application/json'};
}
async function kalshi(path,{auth=false,method='GET',body}={}){
 const headers=auth?authHeaders(method,path):{'Content-Type':'application/json'};
 const r=await fetch(BASE+path,{method,headers,body:body?JSON.stringify(body):undefined});
 const text=await r.text(); let data; try{data=JSON.parse(text)}catch{data={raw:text}};
 if(!r.ok) throw Object.assign(new Error(data?.message||data?.error?.message||`Kalshi ${r.status}`),{status:r.status,data}); return data;
}
app.get('/api/config',(q,s)=>s.json({environment:ENV,credentialsConfigured:!!(keyId&&privateKey),liveServerEnabled}));
app.get('/api/markets',async(q,s)=>{try{const p=new URLSearchParams({limit:String(Math.min(+q.query.limit||100,1000)),status:q.query.status||'open'}); if(q.query.cursor)p.set('cursor',q.query.cursor); s.json(await kalshi('/markets?'+p))}catch(e){s.status(e.status||500).json({error:e.message})}});
app.get('/api/market/:ticker',async(q,s)=>{try{s.json(await kalshi('/markets/'+encodeURIComponent(q.params.ticker)))}catch(e){s.status(e.status||500).json({error:e.message})}});
app.get('/api/orderbook/:ticker',async(q,s)=>{try{s.json(await kalshi('/markets/'+encodeURIComponent(q.params.ticker)+'/orderbook?depth=20'))}catch(e){s.status(e.status||500).json({error:e.message})}});
app.get('/api/candles/:series/:ticker',async(q,s)=>{try{const now=Math.floor(Date.now()/1000), end=+q.query.end||now,start=+q.query.start||end-86400,period=[1,60,1440].includes(+q.query.period)?+q.query.period:1; s.json(await kalshi(`/series/${encodeURIComponent(q.params.series)}/markets/${encodeURIComponent(q.params.ticker)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${period}`))}catch(e){s.status(e.status||500).json({error:e.message})}});
app.get('/api/account',async(q,s)=>{try{const [balance,positions,orders]=await Promise.all([kalshi('/portfolio/balance',{auth:true}),kalshi('/portfolio/positions?limit=1000',{auth:true}),kalshi('/portfolio/orders?limit=1000',{auth:true})]);s.json({balance,positions,orders})}catch(e){s.status(e.status||500).json({error:e.message})}});
app.post('/api/live/order',async(q,s)=>{try{if(!liveServerEnabled)return s.status(403).json({error:'LIVE_TRADING_ENABLED is false on server'}); if(q.body.confirm!=='PLACE LIVE ORDER')return s.status(400).json({error:'Explicit confirmation missing'}); const {ticker,action,side,count,price}=q.body; if(!ticker||!['buy','sell'].includes(action)||!['yes','no'].includes(side)||!(+count>0)||!(+price>0&&+price<1))return s.status(400).json({error:'Invalid order'}); const payload={ticker,action,side,count:Math.floor(+count),type:'limit',client_order_id:crypto.randomUUID(),[side+'_price']:Math.round(+price*100)}; s.json(await kalshi('/portfolio/orders',{auth:true,method:'POST',body:payload}))}catch(e){s.status(e.status||500).json({error:e.message,detail:e.data})}});
app.get('/api/health',(q,s)=>s.json({ok:true,environment:ENV}));
app.listen(process.env.PORT||3000,()=>console.log('Kalshi Edge Terminal running'));
