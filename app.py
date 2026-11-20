import os, time, math
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
import httpx

app=FastAPI(title='Kalshi Market Terminal')
BASE='https://api.elections.kalshi.com/trade-api/v2'
ROOT=Path(__file__).parent

@app.get('/')
def home(): return FileResponse(ROOT/'index.html')
@app.get('/health')
def health(): return {'ok':True}

async def get(path, params=None):
    async with httpx.AsyncClient(timeout=35,headers={'User-Agent':'KalshiMarketTerminal/1.0'}) as client:
        r=await client.get(BASE+path,params=params)
    if r.status_code>=400: raise HTTPException(r.status_code,detail=r.text[:400])
    return r.json()

@app.get('/api/market/{ticker}')
async def market(ticker:str):
    data=await get('/markets/'+ticker.upper())
    return data

@app.get('/api/orderbook/{ticker}')
async def book(ticker:str): return await get('/markets/'+ticker.upper()+'/orderbook',{'depth':20})

@app.get('/api/history/{ticker}')
async def history(ticker:str):
    ticker=ticker.upper()
    market=(await get('/markets/'+ticker))['market']
    start=market.get('open_time') or market.get('created_time')
    try: begin=int(datetime.fromisoformat(start.replace('Z','+00:00')).timestamp()) if start else 0
    except (ValueError,AttributeError): begin=0
    end=int(time.time())
    trades=[]; cursor=None; pages=0; capped=False
    while pages<100:
        params={'ticker':ticker,'limit':1000,'min_ts':begin,'max_ts':end}
        if cursor: params['cursor']=cursor
        result=await get('/markets/trades',params)
        batch=result.get('trades',[])
        trades.extend(batch)
        pages+=1
        cursor=result.get('cursor')
        if not cursor or not batch: break
    if cursor and pages>=100: capped=True
    return {'ticker':ticker,'trades':trades,'capped':capped,'pages':pages,'market':market,'start_ts':begin,'end_ts':end}

@app.get('/api/live/{ticker}')
async def live(ticker: str, since: int = 0):
    """Incremental executed-trade polling; overlap timestamps for safe client deduplication."""
    ticker=ticker.upper()
    now=int(time.time())
    result=await get('/markets/trades', {'ticker':ticker,'limit':1000,'min_ts':max(0,since-3) if since else now-20,'max_ts':now+2})
    return {'trades':result.get('trades',[]),'has_more':bool(result.get('cursor')),'server_ts':now}
