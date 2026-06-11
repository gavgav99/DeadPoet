// netlify/functions/trading-engine.mjs
// Dead Poet Trading Engine v4
// Real-time data: DEXScreener (5m momentum) + GeckoTerminal (5m candles) + Fear & Greed
// Primary signal: momentum + volume spike + buy pressure
// Confirmation: RSI/MACD on 5m candles
// Filter: Fear & Greed macro layer

import { getStore } from "@netlify/blobs";

// ─── COINS ────────────────────────────────────────────────────────────────────
const COINS = [
  { sym:"DOGE",  tier:1, timeStop:12, gt_network:"eth",    gt_pool:"0xc2adda861f89bbb333c90c492cb837741916a225" },
  { sym:"SHIB",  tier:1, timeStop:12, gt_network:"eth",    gt_pool:"0x811beed0119b4afce20d2583eb608c6f7af1954f" },
  { sym:"PEPE",  tier:2, timeStop:8,  gt_network:"eth",    gt_pool:"0xa43fe16908251ee70ef74718545e4fe6c5ccec9f" },
  { sym:"BONK",  tier:2, timeStop:8,  gt_network:"solana", gt_pool:"8rjmd5rn4zhfaysvzv3km3akahfkqjy3adfbsrxkzm7" },
  { sym:"WIF",   tier:3, timeStop:6,  gt_network:"solana", gt_pool:"ep2ib6dyrjohsv7yeqgnrj6wm8rcwqnmrxnkpgsxw2" },
  { sym:"FLOKI", tier:2, timeStop:8,  gt_network:"eth",    gt_pool:"0xca7c2771d248dcbe09eabe0ce57a62e18da178c0" },
  { sym:"BRETT", tier:3, timeStop:6,  gt_network:"base",   gt_pool:"0x4f9f7d9af9c58044ebebfba5b88e3d08d7edb20e" },
  { sym:"MOG",   tier:4, timeStop:6,  gt_network:"eth",    gt_pool:"0xc2eab7d33d3cb97692ecb231a5d0e4a649cb539d" },
  { sym:"POPCAT",tier:3, timeStop:6,  gt_network:"solana", gt_pool:"frcx9p7afj6bk2gnrh2e85xyxgjjm7fxmufy1a67at" },
  { sym:"BOME",  tier:3, timeStop:6,  gt_network:"solana", gt_pool:"dsuvzpqekmrqnberzbmxzdrm6ushyxsx54ljqr9zu2k" },
  { sym:"TURBO", tier:3, timeStop:6,  gt_network:"eth",    gt_pool:"0x2967e7bb9daa5711ac332caf874bd47ef99b3820" },
  { sym:"NEIRO", tier:4, timeStop:6,  gt_network:"eth",    gt_pool:"0xa9ecf3fc25d7f91ec04b3cf73de2f7ee94e0b64f" },
  { sym:"ELON",  tier:2, timeStop:8,  gt_network:"eth",    gt_pool:"0x7b73644935b8e68019ac6356c40661e1bc315860" },
  { sym:"GIGA",  tier:4, timeStop:6,  gt_network:"solana", gt_pool:null },
  { sym:"MEW",   tier:3, timeStop:6,  gt_network:"solana", gt_pool:null },
];

const TIER_DEFAULTS = {
  1: { tp1:4,  tp2:8,  stop:5  },
  2: { tp1:7,  tp2:14, stop:8  },
  3: { tp1:10, tp2:20, stop:10 },
  4: { tp1:12, tp2:22, stop:12 },
};

const STARTING      = 10000;
const DEXSCREENER   = "https://api.dexscreener.com/latest/dex";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";
const FEAR_GREED    = "https://api.alternative.me/fng/?limit=1";
const COINLORE      = "https://api.coinlore.net/api/global/";
const ETHERSCAN     = "https://api.etherscan.io/api";
const MIN_LIQUIDITY = 500000;

// Known exchange hot wallet addresses (publicly labeled on Etherscan)
const EXCHANGE_WALLETS = new Set([
  "0x28c6c06298d514db089934071355e5743bf21d60", // Binance 14
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549", // Binance 15
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d", // Binance 16
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f", // Binance 17
  "0x9696f59e4d72e237be84ffd425dcad154bf96976", // Binance cold
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3", // Coinbase 1
  "0x503828976d22510aad0201ac7ec88293211d23da", // Coinbase 2
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740", // Coinbase 3
  "0x3cd751e6b0078be393132286c442345e5dc49699", // Coinbase 4
  "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511", // Coinbase 5
  "0xa090e606e30bd747d4e6245a1517ebe430f0057e", // Coinbase cold
  "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance 8
  "0x4976a4a02f38326660d17bf34b431dc6e2eb2327", // Binance 20
  "0xe2fc31f816a9b94326492132018c3aecc4a93ae1", // Binance withdrawals
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe", // Gate.io
  "0xd793281182a0e3e023116004778f45c29fc14f19", // Gate.io 2
  "0x2b5634c42055806a59e9107ed44d43c426e99a67", // KuCoin
  "0xa1d8d972560c2f8144af871db508f0b0b10a3fbf", // KuCoin 2
  "0x689c56aef474df92d44a1b70850f808488f9769c", // OKX
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b", // OKX 2
]);

// ETH-based coins we track with their contract addresses
const ETH_COINS = {
  PEPE:  "0x6982508145454ce325ddbe47a25d4ec3d2311933",
  SHIB:  "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
  FLOKI: "0xcf0c122c6b73ff809c693db761e7baebe62b6a2e",
  MOG:   "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a",
  TURBO: "0xa35923162c49cf95e6bf26623385eb431ad920d3",
  NEIRO: "0x812ba41e071c7b7fa095a0849acf5ba7e9e63d8b",
  ELON:  "0x761d38e5ddf6ccf6cf7c55759d5210750b5d60f3",
};

// ─── INDICATOR MATH (on 5m candles) ──────────────────────────────────────────
function calcRSI(closes, n=14) {
  if (closes.length < n+1) return null;
  const ch = closes.slice(1).map((p,i)=>p-closes[i]);
  const rc = ch.slice(-n);
  const g = rc.filter(c=>c>0).reduce((a,b)=>a+b,0)/n;
  const l = Math.abs(rc.filter(c=>c<0).reduce((a,b)=>a+b,0))/n;
  return l===0?100:100-100/(1+g/l);
}

function calcEMA(closes, n) {
  if (closes.length < n) return null;
  const k=2/(n+1);
  let e=closes.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for (let i=n;i<closes.length;i++) e=closes[i]*k+e*(1-k);
  return e;
}

function calcMACD(closes) {
  const e12=calcEMA(closes,12), e26=calcEMA(closes,26);
  if (!e12||!e26) return null;
  return { val:e12-e26, bullish:e12>e26 };
}

// ─── SIGNAL ENGINE ────────────────────────────────────────────────────────────
function calcSignal({ dex, ohlcv, fearGreed, walletSignal, prevData }) {
  let score = 50;
  const reasons = [];

  // ── LAYER 1: MOMENTUM (primary) ──
  // This is the core signal — is something actually happening RIGHT NOW
  if (dex) {
    const p5m   = dex.priceChange5m || 0;
    const p1h   = dex.priceChange1h || 0;
    const buys  = dex.buys5m || 0;
    const sells = dex.sells5m || 0;
    const v5m   = dex.volume5m || 0;
    const v1h   = dex.volume1h || 0;
    const bsr   = sells > 0 ? buys/sells : buys > 0 ? 5 : 1;

    // Price momentum
    if (p5m >= 3)        { score += 20; reasons.push(`Strong 5m momentum +${p5m.toFixed(1)}%`); }
    else if (p5m >= 1.5) { score += 12; reasons.push(`5m momentum +${p5m.toFixed(1)}%`); }
    else if (p5m >= 0.5) { score += 5;  }
    else if (p5m <= -2)  { score -= 20; reasons.push(`5m dump ${p5m.toFixed(1)}%`); }
    else if (p5m <= -1)  { score -= 10; reasons.push(`5m weakness ${p5m.toFixed(1)}%`); }

    // Buy/sell pressure
    if (bsr >= 2.5)      { score += 18; reasons.push(`Heavy buy pressure ${bsr.toFixed(1)}x`); }
    else if (bsr >= 1.5) { score += 10; reasons.push(`Buy pressure ${bsr.toFixed(1)}x`); }
    else if (bsr >= 1.2) { score += 4;  }
    else if (bsr <= 0.5) { score -= 18; reasons.push(`Sell pressure ${bsr.toFixed(1)}x`); }
    else if (bsr <= 0.8) { score -= 8;  reasons.push(`Weak bid ${bsr.toFixed(1)}x`); }

    // Volume spike — is this unusual activity?
    if (v1h > 0) {
      const vSpike = v5m / (v1h / 12); // compare 5m to expected 5m portion of 1h
      if (vSpike >= 3)      { score += 15; reasons.push(`Volume spike ${vSpike.toFixed(1)}x normal`); }
      else if (vSpike >= 2) { score += 8;  reasons.push(`Volume up ${vSpike.toFixed(1)}x`); }
      else if (vSpike >= 1.5){ score += 3;  }
      else if (vSpike <= 0.3){ score -= 5;  reasons.push("Dead volume"); }
    }

    // 1h trend context
    if (p1h >= 5)        { score += 8;  reasons.push(`1h trend +${p1h.toFixed(1)}%`); }
    else if (p1h >= 2)   { score += 4;  }
    else if (p1h <= -10) { score -= 12; reasons.push(`1h downtrend ${p1h.toFixed(1)}%`); }
    else if (p1h <= -5)  { score -= 6;  }

    // Don't chase — if already up big, skip
    if (p1h >= 20)  { score -= 25; reasons.push(`Already up ${p1h.toFixed(0)}% 1h — too late`); }
    if (p1h >= 10)  { score -= 10; reasons.push(`Up ${p1h.toFixed(0)}% 1h — late entry risk`); }
  }

  // ── LAYER 2: 5M CANDLE CONFIRMATION ──
  if (ohlcv && ohlcv.closes && ohlcv.closes.length >= 26) {
    const rsi  = calcRSI(ohlcv.closes, 14);
    const macd = calcMACD(ohlcv.closes);

    if (rsi != null) {
      // On 5m candles we want RSI between 40-65 — has momentum but not overbought
      if (rsi < 30)       { score += 10; reasons.push(`5m RSI oversold ${rsi.toFixed(0)}`); }
      else if (rsi < 45)  { score += 6;  reasons.push(`5m RSI ${rsi.toFixed(0)} — room to run`); }
      else if (rsi < 65)  { score += 2;  } // neutral sweet spot
      else if (rsi > 80)  { score -= 15; reasons.push(`5m RSI overbought ${rsi.toFixed(0)}`); }
      else if (rsi > 70)  { score -= 8;  reasons.push(`5m RSI elevated ${rsi.toFixed(0)}`); }
    }

    if (macd) {
      if (macd.bullish)  { score += 8; reasons.push("5m MACD bullish"); }
      else               { score -= 8; reasons.push("5m MACD bearish"); }
    }
  }

  // ── LAYER 3: FEAR & GREED ──
  if (fearGreed != null) {
    if (fearGreed <= 15)      { score += 18; reasons.push(`Extreme Fear ${fearGreed} — prime entry`); }
    else if (fearGreed <= 30) { score += 10; reasons.push(`Fear ${fearGreed}`); }
    else if (fearGreed <= 45) { score += 4;  }
    else if (fearGreed <= 55) { }
    else if (fearGreed <= 70) { score -= 5;  }
    else if (fearGreed <= 85) { score -= 15; reasons.push(`Greed ${fearGreed}`); }
    else                      { score -= 30; reasons.push(`Extreme Greed ${fearGreed} — avoid`); }
  }

  // ── LAYER 4: WALLET CONVERGENCE ──
  if (walletSignal) {
    if (walletSignal.tierSCount >= 2)     { score += 35; reasons.push(`CONVERGENCE: ${walletSignal.buyerNames?.join(" + ")}`); }
    else if (walletSignal.tierSCount >= 1){ score += 20; reasons.push(`Tier S wallet buying`); }
    else if (walletSignal.tierACount >= 2){ score += 10; }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let signal = "NEUTRAL";
  if (score >= 78)      signal = "STRONG BUY";
  else if (score >= 63) signal = "BUY";
  else if (score >= 53) signal = "WATCH";
  else if (score <= 22) signal = "STRONG SELL";
  else if (score <= 37) signal = "SELL";

  return { score, signal, reasons, rsi: ohlcv ? calcRSI(ohlcv.closes||[], 14) : null };
}

// ─── MOMENTUM REVERSAL DETECTION ─────────────────────────────────────────────
function isMomentumDead(dex, prevDex) {
  if (!dex || !prevDex) return false;
  // Two consecutive negative 5m candles + sell pressure flipping
  const p5m     = dex.priceChange5m || 0;
  const prevP5m = prevDex.priceChange5m || 0;
  const bsr     = (dex.sells5m||0) > 0 ? (dex.buys5m||0)/(dex.sells5m||0) : 1;

  return p5m < -0.5 && prevP5m < -0.5 && bsr < 0.8;
}

// ─── MACRO FILTERS ────────────────────────────────────────────────────────────
// ─── EXCHANGE FLOW ANALYSIS ───────────────────────────────────────────────────
// Tracks PEPE/SHIB/FLOKI/MOG moving TO exchanges (sell pressure)
// vs FROM exchanges (accumulation signal)
// Only for ETH tokens — uses Etherscan free API
// Small confirmation signal only — tracked separately for accuracy testing

async function fetchExchangeFlow(contractAddress, symbol, apiKey) {
  if (!apiKey || !contractAddress) return null;
  try {
    const cutoff = Math.floor(Date.now()/1000) - 1800; // last 30 minutes
    const url = `${ETHERSCAN}?module=account&action=tokentx&contractaddress=${contractAddress}&sort=desc&apikey=${apiKey}&offset=100`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "1" || !data.result) return null;

    // Filter to last 30 minutes only
    const recent = data.result.filter(tx => parseInt(tx.timeStamp) >= cutoff);
    if (recent.length === 0) return { inflow:0, outflow:0, netFlow:0, txCount:0, signal:"NEUTRAL" };

    let inflow = 0;   // USD value flowing INTO exchanges (bearish — people sending to sell)
    let outflow = 0;  // USD value flowing OUT OF exchanges (bullish — people withdrawing to hold)
    let txCount = 0;

    recent.forEach(tx => {
      const toExchange   = EXCHANGE_WALLETS.has(tx.to.toLowerCase());
      const fromExchange = EXCHANGE_WALLETS.has(tx.from.toLowerCase());
      if (!toExchange && !fromExchange) return; // not exchange-related

      // Token amount — divide by decimals (18 for most ERC20)
      const decimals = parseInt(tx.tokenDecimal) || 18;
      const amount = parseFloat(tx.value) / Math.pow(10, decimals);
      // We don't have exact USD price here so use raw token amount
      // Will be normalized against 24h volume later

      if (toExchange)   { inflow  += amount; txCount++; }
      if (fromExchange) { outflow += amount; txCount++; }
    });

    const total = inflow + outflow;
    const netFlow = outflow - inflow; // positive = more leaving exchanges = bullish

    let signal = "NEUTRAL";
    let adjustment = 0;

    if (total > 0) {
      const outflowRatio = outflow / total;
      if (outflowRatio >= 0.7)      { signal = "ACCUMULATION"; adjustment = 6;  } // 70%+ leaving = bullish
      else if (outflowRatio >= 0.55){ signal = "MILD_ACCUM";   adjustment = 3;  }
      else if (outflowRatio <= 0.3) { signal = "DISTRIBUTION"; adjustment = -6; } // 70%+ entering = bearish
      else if (outflowRatio <= 0.45){ signal = "MILD_DIST";    adjustment = -3; }
    }

    return { inflow, outflow, netFlow, txCount, total, signal, adjustment };
  } catch(e) {
    return null;
  }
}

async function fetchAllExchangeFlows(apiKey) {
  if (!apiKey) return {};
  const flows = {};
  // Fetch ETH coins with known contracts — stagger to respect rate limits
  for (const [sym, contract] of Object.entries(ETH_COINS)) {
    flows[sym] = await fetchExchangeFlow(contract, sym, apiKey);
    await new Promise(r => setTimeout(r, 250)); // 4 per second max on free tier
  }
  return flows;
}

// ─── RELATIVE STRENGTH RANKING ────────────────────────────────────────────────
// Ranks all coins by 1h performance relative to each other
// Top performers get bonus, bottom get penalty
// Simple, proven signal from equity quant trading

function calcRelativeStrength(dexData) {
  const entries = Object.entries(dexData)
    .filter(([,d]) => d?.priceChange1h != null)
    .map(([sym, d]) => ({ sym, change1h: d.priceChange1h }))
    .sort((a,b) => b.change1h - a.change1h);

  const rankings = {};
  const total = entries.length;
  entries.forEach((e, i) => {
    const rank = i + 1;
    const percentile = ((total - rank) / total) * 100;
    let adjustment = 0;
    let signal = "NEUTRAL";
    if (percentile >= 80)      { adjustment = 12; signal = "RS_STRONG"; }   // top 20%
    else if (percentile >= 60) { adjustment = 6;  signal = "RS_ABOVE"; }    // top 40%
    else if (percentile <= 20) { adjustment = -12; signal = "RS_WEAK"; }    // bottom 20%
    else if (percentile <= 40) { adjustment = -6;  signal = "RS_BELOW"; }   // bottom 40%
    rankings[e.sym] = { rank, percentile: Math.round(percentile), adjustment, signal, change1h: e.change1h };
  });
  return rankings;
}

// Direct token contract addresses — avoids symbol search ambiguity
// These are the canonical liquid pairs on DEXScreener
const COIN_PAIRS = {
  // ETH chain
  PEPE:  { chain:"ethereum", token:"0x6982508145454ce325ddbe47a25d4ec3d2311933" },
  SHIB:  { chain:"ethereum", token:"0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce" },
  MOG:   { chain:"ethereum", token:"0xaaee1a9723aadb7afa2810263653a34ba2c21c7a" },
  FLOKI: { chain:"ethereum", token:"0xcf0c122c6b73ff809c693db761e7baebe62b6a2e" },
  TURBO: { chain:"ethereum", token:"0xa35923162c49cf95e6bf26623385eb431ad920d3" },
  NEIRO: { chain:"ethereum", token:"0x812ba41e071c7b7fa095a0849acf5ba7e9e63d8b" },
  ELON:  { chain:"ethereum", token:"0x761d38e5ddf6ccf6cf7c55759d5210750b5d60f3" },
  DOGE:  { chain:"ethereum", token:"0x4206931337dc273a630d328da6441786bfad668f" },
  // SOL chain
  BONK:  { chain:"solana",   token:"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  WIF:   { chain:"solana",   token:"EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  POPCAT:{ chain:"solana",   token:"7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  BOME:  { chain:"solana",   token:"ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82" },
  GIGA:  { chain:"solana",   token:"63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9" },
  MEW:   { chain:"solana",   token:"MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  // BASE chain
  BRETT: { chain:"base",     token:"0x532f27101965dd16442e59d40670faf5ebb142e4" },
};

async function fetchDexBulk() {
  const results = {};

  // Fetch by token address — definitive, no ambiguity
  await Promise.all(Object.entries(COIN_PAIRS).map(async ([sym, info]) => {
    try {
      const res = await fetch(
        `${DEXSCREENER}/tokens/${info.chain}/${info.token}`,
        { headers: { "Accept":"application/json", "User-Agent":"DeadPoet/1.0" } }
      );
      if (!res.ok) return;
      const data = await res.json();

      // Get the most liquid pair for this token
      const pairs = (data.pairs||[])
        .filter(p => (p.liquidity?.usd||0) > 10000)
        .sort((a,b) => (b.volume?.h24||0) - (a.volume?.h24||0)); // sort by 24h volume

      const best = pairs[0];
      if (!best) return;

      results[sym] = {
        symbol: sym,
        price: parseFloat(best.priceUsd||0),
        priceChange5m:  best.priceChange?.m5  || 0,
        priceChange1h:  best.priceChange?.h1  || 0,
        priceChange24h: best.priceChange?.h24 || 0,
        volume5m:  best.volume?.m5  || 0,
        volume1h:  best.volume?.h1  || 0,
        volume24h: best.volume?.h24 || 0,
        buys5m:  best.txns?.m5?.buys  || 0,
        sells5m: best.txns?.m5?.sells || 0,
        buys1h:  best.txns?.h1?.buys  || 0,
        sells1h: best.txns?.h1?.sells || 0,
        liquidity:  best.liquidity?.usd || 0,
        marketCap:  best.marketCap || best.fdv || 0,
        pairAddress: best.pairAddress,
        chain: best.chainId,
      };
      console.log(`${sym}: $${results[sym].price} 5m:${results[sym].priceChange5m}% B/S:${results[sym].buys5m}/${results[sym].sells5m} vol5m:$${results[sym].volume5m}`);
    } catch(e) {
      console.error(`DEX token fetch error ${sym}:`, e.message);
    }
  }));

  return results;
}

async function fetchMacroData(coinloreRes) {
  const results = { btc:null, market:null };

  // CoinLore global market — already fetched in parallel
  try {
    if (coinloreRes?.ok) {
      const d = await coinloreRes.json();
      const m = d[0];
      results.market = {
        totalMcap: m.total_mcap,
        mcapChange: parseFloat(m.mcap_change),
        btcDominance: parseFloat(m.btc_d),
        volumeChange: parseFloat(m.volume_change),
      };
    }
  } catch(e) {}

  // BTC directly from DEXScreener — no proxy
  try {
    const res = await fetch(`${DEXSCREENER}/search?q=BTC`, {
      headers: { "Accept":"application/json", "User-Agent":"DeadPoet/1.0" }
    });
    if (res.ok) {
      const d = await res.json();
      const btcPair = (d.pairs||[])
        .filter(p => p.baseToken?.symbol==="WBTC" || p.baseToken?.symbol==="BTC")
        .sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
      if (btcPair) {
        results.btc = {
          price: parseFloat(btcPair.priceUsd||0),
          change5m: btcPair.priceChange?.m5||0,
          change1h: btcPair.priceChange?.h1||0,
          change24h: btcPair.priceChange?.h24||0,
        };
      }
    }
  } catch(e) {}

  return results;
}

function getMacroScore(btc, market) {
  let adjustment = 0;
  const reasons = [];
  let blockBuys = false;

  if (btc) {
    // BTC 1h is the most important macro filter
    if (btc.change1h <= -3) {
      blockBuys = true;
      reasons.push(`BTC dumping ${btc.change1h.toFixed(1)}% 1h — no buys`);
    } else if (btc.change1h <= -2) {
      adjustment -= 20;
      reasons.push(`BTC weak ${btc.change1h.toFixed(1)}% 1h`);
    } else if (btc.change1h <= -1) {
      adjustment -= 10;
    } else if (btc.change1h >= 2) {
      adjustment += 12;
      reasons.push(`BTC strong +${btc.change1h.toFixed(1)}% 1h`);
    } else if (btc.change1h >= 1) {
      adjustment += 6;
      reasons.push(`BTC positive +${btc.change1h.toFixed(1)}% 1h`);
    }

    // BTC 5m for very immediate context
    if (btc.change5m <= -1.5) {
      adjustment -= 10;
      reasons.push(`BTC dropping ${btc.change5m.toFixed(1)}% right now`);
    } else if (btc.change5m >= 1) {
      adjustment += 5;
    }
  }

  if (market) {
    // Total market cap direction
    if (market.mcapChange <= -5) {
      blockBuys = true;
      reasons.push(`Market cap down ${market.mcapChange.toFixed(1)}% — no buys`);
    } else if (market.mcapChange <= -3) {
      adjustment -= 15;
      reasons.push(`Market down ${market.mcapChange.toFixed(1)}%`);
    } else if (market.mcapChange >= 3) {
      adjustment += 10;
      reasons.push(`Market up ${market.mcapChange.toFixed(1)}%`);
    }

    // BTC dominance rising = alt bleed
    if (market.btcDominance >= 60) {
      adjustment -= 8;
      reasons.push(`BTC dominance ${market.btcDominance.toFixed(0)}% — alt bleed risk`);
    } else if (market.btcDominance <= 50) {
      adjustment += 5;
      reasons.push(`Low BTC dom ${market.btcDominance.toFixed(0)}% — alt season`);
    }
  }

  return { adjustment, blockBuys, reasons };
}

// ─── POSITION SIZING ──────────────────────────────────────────────────────────
function getSize(score) {
  if (score >= 97) return 300;
  if (score >= 90) return 200;
  if (score >= 82) return 100;
  return 50;
}

// ─── TARGETS ──────────────────────────────────────────────────────────────────
function getTargets(sym, tier, profiles) {
  const p = profiles[sym];
  if (p && p.trades && p.trades.length >= 5) {
    return { tp1:p.tp1, tp2:p.tp2, stop:p.stop, source:"ADAPTIVE", n:p.trades.length };
  }
  return { ...TIER_DEFAULTS[tier]||TIER_DEFAULTS[4], source:"DEFAULT", n:p?.trades?.length||0 };
}

function recordTrade(sym, tier, data, profiles) {
  if (!profiles[sym]) profiles[sym] = { trades:[], tp1:0, tp2:0, stop:0, winRate:0, flowAccuracy:{} };
  const p = profiles[sym];
  p.trades.push(data);

  // Track exchange flow signal accuracy separately
  // This tells us over time whether the flow signal is actually predictive
  if (data.flowSignal && data.flowSignal !== "NEUTRAL") {
    if (!p.flowAccuracy) p.flowAccuracy = {};
    const fs = data.flowSignal;
    if (!p.flowAccuracy[fs]) p.flowAccuracy[fs] = { wins:0, total:0 };
    p.flowAccuracy[fs].total++;
    // Accumulation signal should correlate with winning trades
    // Distribution signal should correlate with losing trades
    const flowWasRight = (fs === "ACCUMULATION" || fs === "MILD_ACCUM") ? data.won : !data.won;
    if (flowWasRight) p.flowAccuracy[fs].wins++;
  }

  // Track RS accuracy separately
  if (data.rsSignal && data.rsSignal !== "NEUTRAL") {
    if (!p.rsAccuracy) p.rsAccuracy = {};
    const rs = data.rsSignal;
    if (!p.rsAccuracy[rs]) p.rsAccuracy[rs] = { wins:0, total:0 };
    p.rsAccuracy[rs].total++;
    if (data.won) p.rsAccuracy[rs].wins++;
  }
  if (p.trades.length > 50) p.trades.shift();

  const wins   = p.trades.filter(t=>t.won);
  const losses = p.trades.filter(t=>!t.won);
  const def    = TIER_DEFAULTS[tier]||TIER_DEFAULTS[4];

  p.tp2      = Math.max((wins.length>0?wins.reduce((s,t)=>s+(t.peakPnl||t.pnlPct||0),0)/wins.length:def.tp2)*0.82, def.tp2*0.5);
  p.tp1      = p.tp2 * 0.5;
  p.stop     = Math.min((losses.length>0?Math.abs(losses.reduce((s,t)=>s+(t.pnlPct||0),0)/losses.length):def.stop)*1.15, 20);
  p.winRate  = (wins.length/p.trades.length)*100;
  p.avgPeak  = wins.length>0?wins.reduce((s,t)=>s+(t.peakPnl||0),0)/wins.length:0;
  p.confidence = p.trades.length>=10?"HIGH":p.trades.length>=5?"MEDIUM":"LOW";
  p.avgHoldH = p.trades.reduce((s,t)=>s+(parseFloat(t.hoursHeld)||0),0)/p.trades.length;
  return profiles;
}

// ─── ANALYTICS POSTING ────────────────────────────────────────────────────────
// Posts complete trade snapshots to analytics endpoint
// Runs fire-and-forget — doesn't block main engine

const ANALYTICS_URL = "https://deadpoet.xyz/api/analytics";

async function postToAnalytics(event, data) {
  try {
    await fetch(ANALYTICS_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ event, ...data }),
    });
  } catch(e) {
    console.log("Analytics post failed (non-critical):", e.message);
  }
}

function buildEntrySnapshot(coin, price, ind, fearGreed, macro, dex, size) {
  const now = new Date();
  return {
    // Identity
    sym: coin.sym,
    tier: coin.tier,
    price,
    size,

    // Signal breakdown — every component recorded
    score: ind.score,
    signal: ind.signal,
    baseScore: ind.score - (ind.macroAdj||0) - (ind.rsAdj||0) - (ind.flowAdj||0),
    macroAdj: ind.macroAdj || 0,
    rsAdj: ind.rsAdj || 0,
    flowAdj: ind.flowAdj || 0,
    reasons: ind.reasons,

    // 5m momentum at entry
    priceChange5m: dex.priceChange5m,
    priceChange1h: dex.priceChange1h,
    priceChange24h: dex.priceChange24h,
    buys5m: dex.buys5m,
    sells5m: dex.sells5m,
    buySellRatio: dex.sells5m > 0 ? dex.buys5m/dex.sells5m : dex.buys5m > 0 ? 5 : 1,
    volume5m: dex.volume5m,
    volume1h: dex.volume1h,
    volumeSpike: dex.volume1h > 0 ? (dex.volume5m / (dex.volume1h/12)) : null,
    liquidity: dex.liquidity,

    // Macro conditions
    fearGreed,
    btcChange1h: macro.btc?.change1h || null,
    btcChange5m: macro.btc?.change5m || null,
    marketMcapChange: macro.market?.mcapChange || null,
    btcDominance: macro.market?.btcDominance || null,

    // Relative strength
    rsRank: ind.rs?.rank || null,
    rsPercentile: ind.rs?.percentile || null,
    rsSignal: ind.rs?.signal || null,

    // Exchange flow
    flowSignal: ind.flow?.signal || null,
    flowInflow: ind.flow?.inflow || null,
    flowOutflow: ind.flow?.outflow || null,
    flowTxCount: ind.flow?.txCount || null,

    // Time context — critical for time-of-day analysis
    hourUTC: now.getUTCHours(),
    dayOfWeek: now.getUTCDay(), // 0=Sun, 6=Sat
    timestamp: now.toISOString(),
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default async (request, context) => {
  console.log(`[${new Date().toISOString()}] Dead Poet Engine v4 — Real-time momentum`);
  const store = getStore({ name:"trading-state", siteID:context.site.id, token:context.token });

  try {
    // Load state
    let state = {
      portfolio:{ cash:STARTING, positions:{}, totalValue:STARTING },
      journal:[], profiles:{}, peaks:{}, prevDexData:{},
      fearGreed:null, indicators:{}, lastRun:null, version:"v5",
    };
    try {
      const saved = await store.get("state", { type:"json" });
      if (saved) state = { ...state, ...saved };
    } catch(e) { console.log("Fresh state"); }

    // ── ONE-TIME MIGRATION TO v5 — wipe legacy corrupted state ──
    // Old engine used lowercase CoinGecko ids with stale prices.
    // Those positions can never exit (sym lookup fails) and their
    // P&L is fake. Full clean reset, then never again.
    if (state.version !== "v5") {
      console.log("⚠ Migrating to v5 — wiping legacy state, fresh $10,000 start");
      state = {
        portfolio:{ cash:STARTING, positions:{}, totalValue:STARTING },
        journal:[], profiles:{}, peaks:{}, prevDexData:{},
        fearGreed:null, indicators:{}, lastRun:null, version:"v5",
      };
    }

    // Safety: purge any position whose key isn't a tracked sym
    const validSyms = new Set(COINS.map(c=>c.sym));
    Object.keys(state.portfolio.positions).forEach(key => {
      if (!validSyms.has(key)) {
        console.log(`Purging untracked position: ${key} — returning cost basis to cash`);
        const pos = state.portfolio.positions[key];
        state.portfolio.cash += (pos.size || pos.qty * pos.entryPrice || 0);
        delete state.portfolio.positions[key];
        delete state.peaks[key];
      }
    });

    // ── Fetch real-time data ──
    const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || null;

    const [fearGreedRes, coinloreRes] = await Promise.all([
      fetch(FEAR_GREED).catch(()=>null),
      fetch(COINLORE).catch(()=>null),
    ]);

    const fearGreed = fearGreedRes?.ok
      ? parseInt((await fearGreedRes.json())?.data?.[0]?.value) : state.fearGreed;

    // Fetch DEX data directly — no proxy needed server-side
    const dexData = await fetchDexBulk();

    // Fetch macro data
    const macro = await fetchMacroData(coinloreRes);

    // Relative strength ranking — free, uses dexData we already have
    const rsRankings = calcRelativeStrength(dexData);

    // Exchange flow — ETH tokens only, small confirmation signal
    // Runs every 5 minutes to avoid Etherscan rate limits
    const now_ts = Date.now();
    let exchangeFlows = state.exchangeFlows || {};
    const shouldFetchFlows = !state.lastFlowFetch || (now_ts - state.lastFlowFetch) > 300000; // every 5 min
    if (shouldFetchFlows && ETHERSCAN_KEY) {
      console.log("Fetching exchange flows...");
      exchangeFlows = await fetchAllExchangeFlows(ETHERSCAN_KEY);
      state.lastFlowFetch = now_ts;
      state.exchangeFlows = exchangeFlows;
    }
    const macroFilter = getMacroScore(macro.btc, macro.market);

    state.fearGreed = fearGreed;
    state.btcData   = macro.btc;
    state.marketData = macro.market;

    console.log(`F&G: ${fearGreed} | DEX: ${Object.keys(dexData).length} coins | BTC 1h: ${macro.btc?.change1h?.toFixed(1)||"—"}% | Mkt: ${macro.market?.mcapChange?.toFixed(1)||"—"}% | MacroBlock: ${macroFilter.blockBuys}`);

    // Fetch 5m OHLCV directly from GeckoTerminal — no proxy, no credits
    const ohlcvData = {};
    for (const coin of COINS) {
      if (!coin.gt_pool) continue;
      try {
        const res = await fetch(
          `${GECKOTERMINAL}/networks/${coin.gt_network}/pools/${coin.gt_pool}/ohlcv/minute?aggregate=5&limit=100`,
          { headers: { "Accept":"application/json;version=20230302" } }
        );
        if (res.ok) {
          const data = await res.json();
          const candles = data?.data?.attributes?.ohlcv_list || [];
          const closes = candles.map(c => parseFloat(c[4])).reverse();
          const volumes = candles.map(c => parseFloat(c[5])).reverse();
          ohlcvData[coin.sym] = { closes, volumes, count:closes.length };
        }
      } catch(e) {}
      await new Promise(r=>setTimeout(r,250)); // GeckoTerminal rate limit: 30 req/min
    }

    const blockBuys = (fearGreed != null && fearGreed > 85) || macroFilter.blockBuys;
    const now = Date.now();
    const log = [];

    // ── EXITS ──
    Object.entries({...state.portfolio.positions}).forEach(([sym, pos]) => {
      const coin  = COINS.find(c=>c.sym===sym);
      const dex   = dexData[sym];
      if (!coin || !dex?.price) return;

      const price  = dex.price;
      const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
      const ageH   = (now - pos.entryTime) / 3600000;
      const t      = pos.targets;

      state.peaks[sym] = Math.max(state.peaks[sym]||0, price);
      const peakPnl = ((state.peaks[sym] - pos.entryPrice) / pos.entryPrice) * 100;

      const close = (reason, won) => {
        state.portfolio.cash += pos.qty * price;
        delete state.portfolio.positions[sym];
        state.journal = state.journal.map(j => j.id===pos.journalId&&j.status==="OPEN"
          ? {...j, status:"CLOSED", exitPrice:price, pnlPct, won, exitReason:reason, closeTime:new Date().toISOString()}
          : j);
        const jEntry = state.journal.find(j => j.id === pos.journalId);
        state.profiles = recordTrade(sym, coin.tier, {
          entryPrice:pos.entryPrice, exitPrice:price, pnlPct, peakPnl,
          won, exitReason:reason, hoursHeld:ageH.toFixed(1),
          flowSignal: jEntry?.flowSignalAtEntry || null,
          rsSignal: jEntry?.rsSignalAtEntry || null,
          score: pos.entryScore,
        }, state.profiles);

        // Post complete close snapshot to analytics
        postToAnalytics("TRADE_CLOSE", {
          id: pos.journalId,
          sym, won, pnlPct, peakPnl,
          exitReason: reason,
          exitPrice: price,
          hoursHeld: ageH.toFixed(1),
          closeTime: new Date().toISOString(),
          snapshot: jEntry?.snapshot || null, // original entry snapshot
          // Current conditions at exit for comparison
          exitConditions: {
            fearGreed: state.fearGreed,
            btcChange1h: state.btcData?.change1h || null,
            priceChange5m: dexData[sym]?.priceChange5m || null,
          },
        });

        delete state.peaks[sym];
        log.push(`${reason}: ${sym} ${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%`);
      };

      // Stop loss
      if (pnlPct <= -t.stop) return close(`STOP -${t.stop}%`, false);

      // Time stop — per coin tier
      if (ageH >= coin.timeStop) return close(`TIME STOP ${coin.timeStop}H`, pnlPct>0);

      // Momentum death — exit if 5m momentum reversed for two consecutive checks
      if (isMomentumDead(dex, state.prevDexData[sym]) && !pos.tp1Hit) {
        return close(`MOMENTUM REVERSAL`, pnlPct>0);
      }

      // Trailing stop after TP1
      if (pos.tp1Hit && pnlPct <= peakPnl*0.5 && pnlPct > 0) {
        return close("TRAILING STOP", true);
      }

      // TP1
      if (pnlPct >= t.tp1 && !pos.tp1Hit) {
        state.portfolio.cash += (pos.qty/2) * price;
        state.portfolio.positions[sym] = {...pos, qty:pos.qty/2, tp1Hit:true};
        log.push(`TP1 +${t.tp1}%: ${sym} sold 50%`);
      }

      // TP2
      if (pnlPct >= t.tp2) return close(`TP2 +${t.tp2}%`, true);
    });

    // ── ENTRIES ──
    const candidates = [];
    COINS.forEach(coin => {
      const dex   = dexData[coin.sym];
      const ohlcv = ohlcvData[coin.sym];
      if (!dex?.price) return;

      // Liquidity filter — skip illiquid coins entirely
      if ((dex.liquidity||0) < MIN_LIQUIDITY) {
        console.log(`${coin.sym} skipped — liquidity $${(dex.liquidity||0).toFixed(0)} below minimum`);
        return;
      }

      const ind = calcSignal({
        dex, ohlcv, fearGreed,
        walletSignal: state.walletConvergence?.[coin.sym]||null,
        prevData: state.prevDexData[coin.sym],
      });

      // Get relative strength for this coin
      const rs = rsRankings[coin.sym];
      const rsAdj = rs?.adjustment || 0;
      const rsReason = rs?.signal !== "NEUTRAL" ? `RS rank ${rs?.rank}/${Object.keys(dexData).length} (${rs?.signal})` : null;

      // Get exchange flow for ETH coins
      const flow = exchangeFlows[coin.sym];
      const flowAdj = flow?.adjustment || 0;
      const flowReason = flow && flow.signal !== "NEUTRAL"
        ? `Exchange flow: ${flow.signal} (${flow.txCount} txns)` : null;

      // Combine all adjustments
      const totalAdj = macroFilter.adjustment + rsAdj + flowAdj;
      const adjustedScore = Math.max(0, Math.min(100, ind.score + totalAdj));
      const adjustedReasons = [
        ...ind.reasons,
        ...macroFilter.reasons,
        ...(rsReason ? [rsReason] : []),
        ...(flowReason ? [flowReason] : []),
      ];

      let adjustedSignal = "NEUTRAL";
      if (adjustedScore >= 78)      adjustedSignal = "STRONG BUY";
      else if (adjustedScore >= 63) adjustedSignal = "BUY";
      else if (adjustedScore >= 53) adjustedSignal = "WATCH";
      else if (adjustedScore <= 22) adjustedSignal = "STRONG SELL";
      else if (adjustedScore <= 37) adjustedSignal = "SELL";

      const finalInd = {
        ...ind, score:adjustedScore, signal:adjustedSignal, reasons:adjustedReasons,
        rs, flow, macroAdj:macroFilter.adjustment, rsAdj, flowAdj,
      };
      state.indicators[coin.sym] = {
        ...finalInd, price:dex.price, dex,
        liquidity:dex.liquidity, btc:macro.btc,
      };

      if (finalInd.signal === "STRONG BUY" && !state.portfolio.positions[coin.sym]) {
        candidates.push({ coin, dex, ind:finalInd });
      }
    });

    // Sort by score, buy all STRONG BUY with dynamic sizing
    candidates.sort((a,b) => b.ind.score - a.ind.score);

    for (const { coin, dex, ind } of candidates) {
      if (blockBuys) break;
      const size = getSize(ind.score);
      if (state.portfolio.cash < size) continue;

      const targets = getTargets(coin.sym, coin.tier, state.profiles);
      const qty = size / dex.price;
      const jid = `${coin.sym}-${now}-${Math.random().toString(36).slice(2,5)}`;

      state.portfolio.cash -= size;
      state.portfolio.positions[coin.sym] = {
        qty, originalQty:qty, entryPrice:dex.price,
        tp1Hit:false, journalId:jid, entryTime:now,
        targets, entryScore:ind.score, entryFearGreed:fearGreed, size,
        entry5mChange:dex.priceChange5m, entryBSR:dex.buys5m/(dex.sells5m||1),
      };
      state.peaks[coin.sym] = dex.price;

      // Build complete entry snapshot for analytics
      const entrySnapshot = buildEntrySnapshot(coin, dex.price, ind, fearGreed, macro, dex, size);

      state.journal.push({
        id:jid, coinId:coin.sym, sym:coin.sym, status:"OPEN",
        entryPrice:dex.price, exitPrice:null, qty, amount:size,
        pnlPct:0, won:null, type:"AUTO", signal:ind.signal, score:ind.score,
        fearGreedAtEntry:fearGreed, targets,
        timestamp:new Date().toISOString(), closeTime:null, exitReason:null,
        reasons:ind.reasons, priceChange5m:dex.priceChange5m,
        buySellRatio:(dex.buys5m/(dex.sells5m||1)).toFixed(2),
      });

      // Post to analytics
      postToAnalytics("TRADE_OPEN", {
        id: jid, sym: coin.sym,
        snapshot: buildEntrySnapshot(coin, dex.price, ind, fearGreed, macro, dex, size),
      });

      log.push(`BUY $${size}: ${coin.sym} score=${ind.score} 5m=${dex.priceChange5m?.toFixed(1)}% BSR=${(dex.buys5m/(dex.sells5m||1)).toFixed(1)}x F&G=${fearGreed}`);
    }

    // Store current DEX data as previous for next run (momentum reversal detection)
    state.prevDexData = dexData;

    // Update open P&L
    state.journal = state.journal.map(j => {
      if (j.status !== "OPEN") return j;
      const price = dexData[j.sym]?.price;
      return price ? {...j, pnlPct:((price-j.entryPrice)/j.entryPrice)*100, currentPrice:price} : j;
    });

    // Recalc portfolio value
    let pv = 0;
    Object.entries(state.portfolio.positions).forEach(([sym,pos]) => {
      pv += (dexData[sym]?.price || pos.entryPrice) * pos.qty;
    });
    state.portfolio.totalValue = state.portfolio.cash + pv;
    state.lastRun  = new Date().toISOString();
    state.lastDex  = dexData;

    await store.setJSON("state", state);

    const pnl = state.portfolio.totalValue - STARTING;
    console.log(`Portfolio: $${state.portfolio.totalValue.toFixed(2)} (${pnl>=0?"+":""}${pnl.toFixed(2)}) | Open: ${Object.keys(state.portfolio.positions).length} | Actions: ${log.length}`);
    if (log.length>0) log.forEach(l=>console.log(" →",l));

    return new Response(JSON.stringify({ ok:true, log, fearGreed, portfolio:state.portfolio.totalValue }), { status:200 });

  } catch(e) {
    console.error("Engine error:", e);
    return new Response(JSON.stringify({ error:e.message }), { status:500 });
  }
};

export const config = { schedule:"* * * * *" };
