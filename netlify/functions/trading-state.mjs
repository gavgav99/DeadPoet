// netlify/functions/trading-state.mjs
// Serves the current trading state to bigcap.html
// bigcap.html reads from here instead of managing state itself

import { getStore } from "@netlify/blobs";

export default async (request, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") {
    return new Response("", { status:200, headers });
  }

  const store = getStore({ name:"trading-state", siteID: context.site.id, token: context.token });

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    // POST — manual trade from browser (buy or sell)
    if (request.method === "POST") {
      const body = await request.json();
      let state = await store.get("state", { type:"json" }) || { portfolio:{ cash:10000, positions:{}, totalValue:10000 }, journal:[], profiles:{}, priceHistory:{}, peaks:{} };

      if (body.action === "SELL" && body.coinId) {
        const pos = state.portfolio.positions[body.coinId];
        if (pos && body.price) {
          const pnlPct = ((body.price - pos.entryPrice) / pos.entryPrice) * 100;
          state.portfolio.cash += pos.qty * body.price;
          delete state.portfolio.positions[body.coinId];
          state.journal = state.journal.map(j => j.id===pos.journalId&&j.status==="OPEN"
            ? {...j, status:"CLOSED", exitPrice:body.price, pnlPct, won:pnlPct>0, exitReason:"MANUAL SELL", closeTime:new Date().toISOString()}
            : j);
          let pv=0;
          // Can't recalc full value without all prices, just update cash
          state.portfolio.totalValue = state.portfolio.cash;
          await store.setJSON("state", state);
        }
      }

      if (body.action === "BUY" && body.coinId && body.price && body.targets) {
        if (!state.portfolio.positions[body.coinId] && state.portfolio.cash >= 100) {
          const qty = 100 / body.price;
          const jid = `${body.coinId}-${Date.now()}`;
          state.portfolio.cash -= 100;
          state.portfolio.positions[body.coinId] = { qty, originalQty:qty, entryPrice:body.price, tp1Hit:false, journalId:jid, entryTime:Date.now(), targets:body.targets };
          state.journal.push({ id:jid, coinId:body.coinId, sym:body.sym, status:"OPEN", entryPrice:body.price, exitPrice:null, qty, amount:100, pnlPct:0, won:null, type:"MANUAL", signal:body.signal||"—", score:body.score||50, targets:body.targets, timestamp:new Date().toISOString(), closeTime:null, exitReason:null });
          await store.setJSON("state", state);
        }
      }

      return new Response(JSON.stringify({ ok:true }), { status:200, headers });
    }

    // GET — return current state
    const state = await store.get("state", { type:"json" });
    if (!state) {
      return new Response(JSON.stringify({ 
        portfolio:{ cash:10000, positions:{}, totalValue:10000 }, 
        journal:[], profiles:{}, lastRun:null,
        message:"No data yet — trading engine hasn't run. Check Netlify Functions logs."
      }), { status:200, headers });
    }

    return new Response(JSON.stringify(state), { status:200, headers });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers });
  }
};

export const config = { path: "/api/trading-state" };
