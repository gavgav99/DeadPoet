// netlify/functions/trading-engine.mjs
// 24/7 trading engine for Dead Poet big cap scanner
// Uses modern Netlify Functions syntax with built-in scheduling
// Runs every 60 seconds automatically

import { getStore } from "@netlify/blobs";

// ─── COINS ────────────────────────────────────────────────────────────────────
const COINS = [
  { id:"dogecoin",            sym:"DOGE", tier:1 },
  { id:"shiba-inu",           sym:"SHIB", tier:1 },
  { id:"pepe",                sym:"PEPE", tier:2 },
  { id:"dogwifcoin",          sym:"WIF",  tier:3 },
  { id:"bonk",                sym:"BONK", tier:2 },
  { id:"floki",               sym:"FLOKI",tier:2 },
  { id:"brett-based",         sym:"BRETT",tier:3 },
  { id:"mog-coin",            sym:"MOG",  tier:4 },
  { id:"popcat",              sym:"POPCAT",tier:3 },
  { id:"cat-in-a-dogs-world", sym:"MEW",  tier:3 },
  { id:"book-of-meme",        sym:"BOME", tier:3 },
  { id:"turbo",               sym:"TURBO",tier:3 },
  { id:"neiro-on-eth",        sym:"NEIRO",tier:4 },
  { id:"giga",                sym:"GIGA", tier:4 },
  { id:"dogelon-mars",        sym:"ELON", tier:2 },
  { id:"samoyedcoin",         sym:"SAMO", tier:4 },
  { id:"coq-inu",             sym:"COQ",  tier:4 },
  { id:"sundog",              sym:"SUNDOG",tier:3 },
  { id:"landwolf",            sym:"WOLF", tier:4 },
  { id:"jesus-coin",          sym:"JESUS",tier:4 },
];

const TIER_DEFAULTS = {
  1: { tp1:4,  tp2:8,  stop:6  },
  2: { tp1:7,  tp2:14, stop:10 },
  3: { tp1:10, tp2:20, stop:12 },
  4: { tp1:12, tp2:22, stop:15 },
};

const STARTING = 10000;
const CG = "https://api.coingecko.com/api/v3";

// ─── INDICATOR MATH ───────────────────────────────────────────────────────────
function calcRSI(prices, n=14) {
  if (prices.length < n+1) return null;
  const ch = prices.slice(1).map((p,i)=>p-prices[i]);
  const rc = ch.slice(-n);
  const g = rc.filter(c=>c>0).reduce((a,b)=>a+b,0)/n;
  const l = Math.abs(rc.filter(c=>c<0).reduce((a,b)=>a+b,0))/n;
  return l===0?100:100-100/(1+g/l);
}

function calcEMA(prices, n) {
  if (prices.length < n) return null;
  const k = 2/(n+1);
  let e = prices.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for (let i=n;i<prices.length;i++) e=prices[i]*k+e*(1-k);
  return e;
}

function calcMACD(prices) {
  const e12=calcEMA(prices,12), e26=calcEMA(prices,26);
  if (!e12||!e26) return null;
  return { val:e12-e26, bullish:e12>e26 };
}

function calcBB(prices, n=20) {
  if (prices.length<n) return null;
  const sl=prices.slice(-n), sma=sl.reduce((a,b)=>a+b,0)/n;
  const std=Math.sqrt(sl.reduce((s,p)=>s+Math.pow(p-sma,2),0)/n);
  return { upper:sma+2*std, middle:sma, lower:sma-2*std };
}

function calcSignal(history, price) {
  if (!history || history.length < 20) return { signal:"NEUTRAL", score:50, reasons:[] };
  const rsi = calcRSI(history, 14);
  const macd = calcMACD(history);
  const bb = calcBB(history, 20);
  let bull=0, bear=0, reasons=[];

  if (rsi!=null) {
    if (rsi<30){bull+=3;reasons.push("RSI oversold");}
    else if (rsi<40){bull+=2;reasons.push("RSI cooling");}
    else if (rsi<50){bull+=1;}
    else if (rsi>75){bear+=3;reasons.push("RSI overbought");}
    else if (rsi>65){bear+=2;reasons.push("RSI elevated");}
    else if (rsi>55){bear+=1;}
  }
  if (macd) {
    if (macd.bullish){bull+=2;reasons.push("MACD bullish");}
    else{bear+=2;reasons.push("MACD bearish");}
  }
  if (bb && price) {
    if (price<bb.lower){bull+=3;reasons.push("Below lower BB");}
    else if (price>bb.upper){bear+=3;reasons.push("Above upper BB");}
    else if (price<bb.middle){bull+=1;}
    else{bear+=1;}
  }

  const total=bull+bear;
  const score=total>0?Math.round((bull/total)*100):50;
  let signal="NEUTRAL";
  if (score>=75) signal="STRONG BUY";
  else if (score>=62) signal="BUY";
  else if (score>=53) signal="WATCH";
  else if (score<=25) signal="STRONG SELL";
  else if (score<=38) signal="SELL";

  return { signal, score, reasons, rsi, macd, bb };
}

// ─── ADAPTIVE TARGETS ─────────────────────────────────────────────────────────
function getTargets(sym, tier, profiles) {
  const profile = profiles[sym];
  if (profile && profile.trades && profile.trades.length >= 5) {
    return { tp1:profile.tp1, tp2:profile.tp2, stop:profile.stop, source:"ADAPTIVE", n:profile.trades.length };
  }
  const def = TIER_DEFAULTS[tier] || TIER_DEFAULTS[4];
  return { ...def, source:"DEFAULT", n:profile?.trades?.length||0 };
}

function recordTrade(sym, tier, tradeData, profiles) {
  if (!profiles[sym]) profiles[sym] = { trades:[], tp1:0, tp2:0, stop:0, winRate:0 };
  const p = profiles[sym];
  p.trades.push(tradeData);
  if (p.trades.length > 30) p.trades.shift();

  const wins = p.trades.filter(t=>t.won);
  const losses = p.trades.filter(t=>!t.won);
  const avgWin = wins.length > 0 ? wins.reduce((s,t)=>s+t.pnlPct,0)/wins.length : TIER_DEFAULTS[tier].tp2;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s,t)=>s+t.pnlPct,0)/losses.length) : TIER_DEFAULTS[tier].stop;

  p.tp2 = Math.max(avgWin * 0.85, TIER_DEFAULTS[tier].tp2 * 0.5);
  p.tp1 = p.tp2 * 0.5;
  p.stop = Math.min(avgLoss * 1.1, 25);
  p.winRate = (wins.length/p.trades.length)*100;
  p.avgPeak = avgWin;
  p.confidence = p.trades.length>=10?"HIGH":p.trades.length>=5?"MEDIUM":"LOW";
  return profiles;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async (request, context) => {
  console.log(`[${new Date().toISOString()}] Trading engine running...`);

  const store = getStore({ name:"trading-state", siteID: context.site.id, token: context.token });

  try {
    // Load current state
    let state = { portfolio:{ cash:STARTING, positions:{}, totalValue:STARTING }, journal:[], profiles:{}, priceHistory:{}, peaks:{}, lastRun:null };
    try {
      const saved = await store.get("state", { type:"json" });
      if (saved) state = { ...state, ...saved };
    } catch(e) { console.log("No saved state, starting fresh"); }

    // ── Fetch prices ──
    const ids = COINS.map(c=>c.id).join(",");
    let prices = {};
    try {
      const res = await fetch(`${CG}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_24hr_vol=true&include_market_cap=true`);
      if (res.ok) prices = await res.json();
    } catch(e) { console.error("Price fetch failed:", e.message); }

    if (Object.keys(prices).length === 0) {
      console.log("No price data — skipping this run");
      return new Response("no data", { status: 200 });
    }

    // Update price history
    COINS.forEach(c => {
      if (prices[c.id]) {
        if (!state.priceHistory[c.id]) state.priceHistory[c.id] = [];
        state.priceHistory[c.id] = [...state.priceHistory[c.id].slice(-199), prices[c.id].usd];
      }
    });

    // ── Calculate indicators and make decisions ──
    const now = Date.now();
    const log = [];

    // Check exits first
    Object.entries({ ...state.portfolio.positions }).forEach(([id, pos]) => {
      const coin = COINS.find(c=>c.id===id);
      const price = prices[id]?.usd;
      if (!price || !coin) return;

      const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
      const ageH = (now - pos.entryTime) / 3600000;
      const t = pos.targets;

      // Update peak
      state.peaks[id] = Math.max(state.peaks[id]||0, price);

      // Stop loss
      if (pnlPct <= -t.stop) {
        state.portfolio.cash += pos.qty * price;
        delete state.portfolio.positions[id];
        state.journal = state.journal.map(j => j.id===pos.journalId&&j.status==="OPEN"
          ? {...j, status:"CLOSED", exitPrice:price, pnlPct, won:false, exitReason:`STOP LOSS -${t.stop}%`, closeTime:new Date().toISOString()}
          : j);
        state.profiles = recordTrade(coin.sym, coin.tier, { entryPrice:pos.entryPrice, exitPrice:price, pnlPct, won:false, exitReason:`STOP LOSS` }, state.profiles);
        log.push(`STOP LOSS: ${coin.sym} at ${pnlPct.toFixed(1)}%`);
        delete state.peaks[id];
        return;
      }

      // Time stop
      if (ageH >= 48) {
        state.portfolio.cash += pos.qty * price;
        delete state.portfolio.positions[id];
        state.journal = state.journal.map(j => j.id===pos.journalId&&j.status==="OPEN"
          ? {...j, status:"CLOSED", exitPrice:price, pnlPct, won:pnlPct>0, exitReason:"TIME STOP 48H", closeTime:new Date().toISOString()}
          : j);
        state.profiles = recordTrade(coin.sym, coin.tier, { entryPrice:pos.entryPrice, exitPrice:price, pnlPct, won:pnlPct>0, exitReason:"TIME STOP" }, state.profiles);
        log.push(`TIME STOP: ${coin.sym} at ${pnlPct.toFixed(1)}%`);
        delete state.peaks[id];
        return;
      }

      // Trailing stop after TP1
      if (pos.tp1Hit) {
        const peak = state.peaks[id] || price;
        const peakPnl = ((peak - pos.entryPrice) / pos.entryPrice) * 100;
        if (pnlPct <= peakPnl * 0.5 && pnlPct > 0) {
          state.portfolio.cash += pos.qty * price;
          delete state.portfolio.positions[id];
          state.journal = state.journal.map(j => j.id===pos.journalId&&j.status==="OPEN"
            ? {...j, status:"CLOSED", exitPrice:price, pnlPct, won:true, exitReason:"TRAILING STOP", closeTime:new Date().toISOString()}
            : j);
          state.profiles = recordTrade(coin.sym, coin.tier, { entryPrice:pos.entryPrice, exitPrice:price, pnlPct, won:true, exitReason:"TRAILING STOP" }, state.profiles);
          log.push(`TRAILING STOP: ${coin.sym} at ${pnlPct.toFixed(1)}%`);
          delete state.peaks[id];
          return;
        }
      }

      // TP1 — sell half
      if (pnlPct >= t.tp1 && !pos.tp1Hit) {
        const sellQty = pos.qty / 2;
        state.portfolio.cash += sellQty * price;
        state.portfolio.positions[id] = { ...pos, qty: pos.qty - sellQty, tp1Hit: true };
        log.push(`TP1: ${coin.sym} sold 50% at ${pnlPct.toFixed(1)}%`);
      }

      // TP2 — close rest
      if (pnlPct >= t.tp2) {
        state.portfolio.cash += pos.qty * price;
        delete state.portfolio.positions[id];
        state.journal = state.journal.map(j => j.id===pos.journalId&&j.status==="OPEN"
          ? {...j, status:"CLOSED", exitPrice:price, pnlPct, won:true, exitReason:`TP2 +${t.tp2}%`, closeTime:new Date().toISOString()}
          : j);
        state.profiles = recordTrade(coin.sym, coin.tier, { entryPrice:pos.entryPrice, exitPrice:price, pnlPct, won:true, exitReason:"TP2" }, state.profiles);
        log.push(`TP2: ${coin.sym} closed at ${pnlPct.toFixed(1)}%`);
        delete state.peaks[id];
      }
    });

    // Auto buy — check signals
    COINS.forEach(coin => {
      if (state.portfolio.positions[coin.id]) return; // already in
      if (state.portfolio.cash < 100) return; // not enough cash
      const price = prices[coin.id]?.usd;
      const history = state.priceHistory[coin.id] || [];
      if (!price || history.length < 20) return;

      const ind = calcSignal(history, price);
      if (ind.signal !== "STRONG BUY") return;

      // Open trade
      const targets = getTargets(coin.sym, coin.tier, state.profiles);
      const qty = 100 / price;
      const jid = `${coin.id}-${now}`;
      state.portfolio.cash -= 100;
      state.portfolio.positions[coin.id] = { qty, originalQty:qty, entryPrice:price, tp1Hit:false, journalId:jid, entryTime:now, targets };
      state.peaks[coin.id] = price;
      state.journal.push({
        id:jid, coinId:coin.id, sym:coin.sym, status:"OPEN",
        entryPrice:price, exitPrice:null, qty, amount:100,
        pnlPct:0, won:null, type:"AUTO", signal:ind.signal, score:ind.score,
        targets, timestamp:new Date().toISOString(), closeTime:null, exitReason:null,
        reasons:ind.reasons,
      });
      log.push(`AUTO BUY: ${coin.sym} at $${price} — ${ind.reasons.join(", ")}`);
    });

    // Update open journal P&L
    state.journal = state.journal.map(j => {
      if (j.status !== "OPEN") return j;
      const price = prices[j.coinId]?.usd;
      if (!price) return j;
      return { ...j, pnlPct: ((price - j.entryPrice) / j.entryPrice) * 100, currentPrice: price };
    });

    // Recalc portfolio value
    let pv = 0;
    Object.entries(state.portfolio.positions).forEach(([id,pos]) => {
      pv += (prices[id]?.usd || pos.entryPrice) * pos.qty;
    });
    state.portfolio.totalValue = state.portfolio.cash + pv;
    state.lastRun = new Date().toISOString();
    state.lastPrices = {};
    COINS.forEach(c => { if (prices[c.id]) state.lastPrices[c.id] = prices[c.id]; });

    // Save state
    await store.setJSON("state", state);

    console.log(`Done. Actions: ${log.length > 0 ? log.join(" | ") : "none"}. Portfolio: $${state.portfolio.totalValue.toFixed(2)}`);
    return new Response(JSON.stringify({ ok:true, log, portfolio:state.portfolio.totalValue }), { status:200 });

  } catch(e) {
    console.error("Trading engine error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status:500 });
  }
};

// Schedule: every minute
export const config = {
  schedule: "* * * * *",
};
