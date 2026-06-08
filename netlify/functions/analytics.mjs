// netlify/functions/analytics.mjs
// Dead Poet Analytics Engine
// Stores complete trade snapshots and serves analytical data
// Endpoint: /api/analytics

import { getStore } from "@netlify/blobs";

export default async (request, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") return new Response("", { status:200, headers });

  const store = getStore({ name:"trading-analytics", siteID:context.site.id, token:context.token });
  const url   = new URL(request.url);
  const type  = url.searchParams.get("type") || "summary";

  try {

    // ── POST — store a new trade snapshot ──
    if (request.method === "POST") {
      const body = await request.json();

      if (body.event === "TRADE_OPEN") {
        // Store full entry snapshot
        const key = `trades:open:${body.id}`;
        await store.setJSON(key, { ...body, storedAt: new Date().toISOString() });
        return new Response(JSON.stringify({ ok:true }), { status:200, headers });
      }

      if (body.event === "TRADE_CLOSE") {
        // Move from open to closed with full snapshot
        const openKey   = `trades:open:${body.id}`;
        const closeKey  = `trades:closed:${body.closeTime?.slice(0,7)||new Date().toISOString().slice(0,7)}:${body.id}`;

        await store.setJSON(closeKey, { ...body, storedAt: new Date().toISOString() });

        // Update running accuracy stats
        await updateAccuracyStats(store, body);

        // Try to delete open record
        try { await store.delete(openKey); } catch(e) {}

        return new Response(JSON.stringify({ ok:true }), { status:200, headers });
      }

      if (body.event === "SIGNAL_LOG") {
        // Log every signal fire — win or loss — for analysis
        const date = new Date().toISOString().slice(0,10);
        const key  = `signals:${date}:${body.sym}:${Date.now()}`;
        await store.setJSON(key, { ...body, storedAt: new Date().toISOString() });
        return new Response(JSON.stringify({ ok:true }), { status:200, headers });
      }

      return new Response(JSON.stringify({ error:"Unknown event" }), { status:400, headers });
    }

    // ── GET ──
    if (type === "summary") {
      // Pull accuracy stats + recent closed trades for summary
      let accuracy = {};
      try { accuracy = await store.get("accuracy:running", { type:"json" }) || {}; } catch(e) {}

      // Get recent closed trades — last 90 days
      const months = getRecentMonths(3);
      const closedTrades = [];
      for (const month of months) {
        try {
          const keys = await store.list({ prefix:`trades:closed:${month}:` });
          for (const key of (keys.blobs || [])) {
            try {
              const t = await store.get(key.key, { type:"json" });
              if (t) closedTrades.push(t);
            } catch(e) {}
          }
        } catch(e) {}
      }

      closedTrades.sort((a,b) => new Date(b.closeTime) - new Date(a.closeTime));

      return new Response(JSON.stringify({
        accuracy,
        recentTrades: closedTrades.slice(0, 200),
        totalClosed: closedTrades.length,
        generatedAt: new Date().toISOString(),
      }), { status:200, headers });
    }

    if (type === "breakdown") {
      // Full analytical breakdown
      const months = getRecentMonths(6);
      const trades = [];
      for (const month of months) {
        try {
          const keys = await store.list({ prefix:`trades:closed:${month}:` });
          for (const key of (keys.blobs || [])) {
            try {
              const t = await store.get(key.key, { type:"json" });
              if (t) trades.push(t);
            } catch(e) {}
          }
        } catch(e) {}
      }

      return new Response(JSON.stringify({
        breakdown: buildBreakdown(trades),
        totalTrades: trades.length,
        generatedAt: new Date().toISOString(),
      }), { status:200, headers });
    }

    if (type === "accuracy") {
      let accuracy = {};
      try { accuracy = await store.get("accuracy:running", { type:"json" }) || {}; } catch(e) {}
      return new Response(JSON.stringify(accuracy), { status:200, headers });
    }

    return new Response(JSON.stringify({ error:"Unknown type" }), { status:400, headers });

  } catch(e) {
    console.error("Analytics error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers });
  }
};

// ─── ACCURACY STATS ───────────────────────────────────────────────────────────
async function updateAccuracyStats(store, trade) {
  let acc = {};
  try { acc = await store.get("accuracy:running", { type:"json" }) || {}; } catch(e) {}

  const won = trade.won;

  // Helper to update a stat bucket
  const update = (path, won) => {
    if (!acc[path]) acc[path] = { wins:0, total:0, totalPnl:0, avgHold:0 };
    acc[path].total++;
    acc[path].totalPnl += trade.pnlPct || 0;
    acc[path].avgHold = ((acc[path].avgHold * (acc[path].total-1)) + (parseFloat(trade.hoursHeld)||0)) / acc[path].total;
    if (won) acc[path].wins++;
    acc[path].winRate = (acc[path].wins / acc[path].total) * 100;
    acc[path].avgPnl  = acc[path].totalPnl / acc[path].total;
  };

  // Overall
  update("overall", won);

  // Per coin
  update(`coin:${trade.sym}`, won);

  // By Fear & Greed zone
  if (trade.snapshot?.fearGreed != null) {
    const fg = trade.snapshot.fearGreed;
    const zone = fg<=15?"EXTREME_FEAR":fg<=30?"FEAR":fg<=45?"MILD_FEAR":fg<=55?"NEUTRAL":fg<=70?"MILD_GREED":fg<=85?"GREED":"EXTREME_GREED";
    update(`fg:${zone}`, won);
  }

  // By BTC direction at entry
  if (trade.snapshot?.btcChange1h != null) {
    const btc = trade.snapshot.btcChange1h;
    const dir = btc >= 2?"BTC_STRONG_UP":btc >= 0.5?"BTC_UP":btc >= -0.5?"BTC_FLAT":btc >= -2?"BTC_DOWN":"BTC_STRONG_DOWN";
    update(`btc:${dir}`, won);
  }

  // By hour of day
  if (trade.snapshot?.hourUTC != null) {
    update(`hour:${trade.snapshot.hourUTC}`, won);
  }

  // By day of week
  if (trade.snapshot?.dayOfWeek != null) {
    update(`dow:${trade.snapshot.dayOfWeek}`, won);
  }

  // By score range
  if (trade.snapshot?.score != null) {
    const s = trade.snapshot.score;
    const bucket = s>=95?"95-100":s>=90?"90-94":s>=85?"85-89":s>=80?"80-84":"78-79";
    update(`score:${bucket}`, won);
  }

  // By RS rank
  if (trade.snapshot?.rsPercentile != null) {
    const rsp = trade.snapshot.rsPercentile;
    const bucket = rsp>=80?"TOP_20":rsp>=60?"TOP_40":rsp>=40?"MID":rsp>=20?"BOT_40":"BOT_20";
    update(`rs:${bucket}`, won);
  }

  // By exchange flow signal
  if (trade.snapshot?.flowSignal && trade.snapshot.flowSignal !== "NEUTRAL") {
    const flowWasRight = (trade.snapshot.flowSignal.includes("ACCUM")) ? won : !won;
    update(`flow:${trade.snapshot.flowSignal}`, flowWasRight);
  }

  // By exit reason
  if (trade.exitReason) {
    const reason = trade.exitReason.split(" ")[0]; // first word
    update(`exit:${reason}`, won);
  }

  // By volume spike at entry
  if (trade.snapshot?.volumeSpike != null) {
    const vs = trade.snapshot.volumeSpike;
    const bucket = vs>=3?"SPIKE_3X":vs>=2?"SPIKE_2X":vs>=1.5?"SPIKE_1.5X":"NORMAL";
    update(`volspike:${bucket}`, won);
  }

  // By buy/sell ratio at entry
  if (trade.snapshot?.buySellRatio != null) {
    const bsr = trade.snapshot.buySellRatio;
    const bucket = bsr>=2.5?"BSR_2.5X":bsr>=1.5?"BSR_1.5X":bsr>=1.2?"BSR_1.2X":"BSR_WEAK";
    update(`bsr:${bucket}`, won);
  }

  acc.lastUpdated = new Date().toISOString();
  acc.totalTrades = acc.overall?.total || 0;

  await store.setJSON("accuracy:running", acc);
}

// ─── BREAKDOWN ANALYSIS ───────────────────────────────────────────────────────
function buildBreakdown(trades) {
  if (trades.length === 0) return {};

  const wins = trades.filter(t=>t.won);
  const losses = trades.filter(t=>!t.won);

  // Group by various dimensions
  const byHour = groupBy(trades, t => t.snapshot?.hourUTC, "hour");
  const byDow  = groupBy(trades, t => t.snapshot?.dayOfWeek, "day");
  const byFG   = groupBy(trades, t => {
    const fg = t.snapshot?.fearGreed;
    if (fg == null) return null;
    return fg<=15?"0-15 Extreme Fear":fg<=30?"16-30 Fear":fg<=45?"31-45 Mild Fear":fg<=55?"46-55 Neutral":fg<=70?"56-70 Mild Greed":fg<=85?"71-85 Greed":"86-100 Extreme Greed";
  }, "fg");
  const byBTC = groupBy(trades, t => {
    const b = t.snapshot?.btcChange1h;
    if (b == null) return null;
    return b>=2?"BTC +2%+":b>=0.5?"BTC +0.5-2%":b>=-0.5?"BTC flat":b>=-2?"BTC -0.5-2%":"BTC -2%+";
  }, "btc");
  const byCoin = groupBy(trades, t => t.sym, "coin");
  const byExit = groupBy(trades, t => t.exitReason?.split(" ")[0], "exit");
  const byScore = groupBy(trades, t => {
    const s = t.snapshot?.score;
    if (s == null) return null;
    return s>=95?"95-100":s>=90?"90-94":s>=85?"85-89":s>=80?"80-84":"78-79";
  }, "score");

  return {
    overall: {
      total: trades.length,
      wins: wins.length,
      winRate: (wins.length/trades.length)*100,
      avgPnl: trades.reduce((s,t)=>s+(t.pnlPct||0),0)/trades.length,
      avgWin: wins.length>0?wins.reduce((s,t)=>s+(t.pnlPct||0),0)/wins.length:0,
      avgLoss: losses.length>0?Math.abs(losses.reduce((s,t)=>s+(t.pnlPct||0),0)/losses.length):0,
      profitFactor: losses.length>0&&wins.length>0?(wins.reduce((s,t)=>s+(t.pnlPct||0),0)/losses.length)/(Math.abs(losses.reduce((s,t)=>s+(t.pnlPct||0),0)/losses.length)):0,
      avgHold: trades.reduce((s,t)=>s+(parseFloat(t.hoursHeld)||0),0)/trades.length,
    },
    byHour, byDow, byFG, byBTC, byCoin, byExit, byScore,
  };
}

function groupBy(trades, keyFn, label) {
  const groups = {};
  trades.forEach(t => {
    const key = keyFn(t);
    if (key == null) return;
    if (!groups[key]) groups[key] = { trades:[], wins:0, total:0, totalPnl:0 };
    groups[key].total++;
    groups[key].totalPnl += t.pnlPct || 0;
    if (t.won) groups[key].wins++;
  });
  return Object.entries(groups).map(([k,g]) => ({
    label: k,
    total: g.total,
    wins: g.wins,
    winRate: (g.wins/g.total)*100,
    avgPnl: g.totalPnl/g.total,
  })).sort((a,b) => b.winRate - a.winRate);
}

function getRecentMonths(n) {
  const months = [];
  const d = new Date();
  for (let i=0; i<n; i++) {
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
    d.setMonth(d.getMonth()-1);
  }
  return months;
}

export const config = { path: "/api/analytics" };
