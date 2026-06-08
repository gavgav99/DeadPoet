// netlify/functions/marketdata.js
// Unified real-time market data proxy for Dead Poet
// Sources: DEXScreener (5m price/volume/txns) + GeckoTerminal (5m OHLCV candles)
// No API keys needed. Free forever.

const DEXSCREENER = "https://api.dexscreener.com/latest/dex";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";

// Top liquid pool addresses for each coin
// DEXScreener pair addresses — most liquid pool for each
const COIN_POOLS = {
  // ETH chain — GeckoTerminal network: "eth"
  PEPE:  { chain:"eth",    dexPair:"0xa43fe16908251ee70ef74718545e4fe6c5ccec9f", gt_network:"eth",    gt_pool:"0xa43fe16908251ee70ef74718545e4fe6c5ccec9f" },
  SHIB:  { chain:"eth",    dexPair:"0x811beed0119b4afce20d2583eb608c6f7af1954f", gt_network:"eth",    gt_pool:"0x811beed0119b4afce20d2583eb608c6f7af1954f" },
  FLOKI: { chain:"eth",    dexPair:"0xca7c2771d248dcbe09eabe0ce57a62e18da178c0", gt_network:"eth",    gt_pool:"0xca7c2771d248dcbe09eabe0ce57a62e18da178c0" },
  MOG:   { chain:"eth",    dexPair:"0xc2eab7d33d3cb97692ecb231a5d0e4a649cb539d", gt_network:"eth",    gt_pool:"0xc2eab7d33d3cb97692ecb231a5d0e4a649cb539d" },
  ELON:  { chain:"eth",    dexPair:"0x7b73644935b8e68019ac6356c40661e1bc315860", gt_network:"eth",    gt_pool:"0x7b73644935b8e68019ac6356c40661e1bc315860" },
  // SOL chain — GeckoTerminal network: "solana"
  BONK:  { chain:"solana", dexPair:"8rjmd5rn4zhfaysvzv3km3akahfkqjy3adfbsrxkzm7", gt_network:"solana", gt_pool:"8rjmd5rn4zhfaysvzv3km3akahfkqjy3adfbsrxkzm7" },
  WIF:   { chain:"solana", dexPair:"ep2ib6dyrjohsv7yeqgnrj6wm8rcwqnmrxnkpgsxw2", gt_network:"solana", gt_pool:"ep2ib6dyrjohsv7yeqgnrj6wm8rcwqnmrxnkpgsxw2" },
  POPCAT:{ chain:"solana", dexPair:"frcx9p7afj6bk2gnrh2e85xyxgjjm7fxmufy1a67at", gt_network:"solana", gt_pool:"frcx9p7afj6bk2gnrh2e85xyxgjjm7fxmufy1a67at" },
  MEW:   { chain:"solana", dexPair:"879f697d-b8b1-4d3e-9d85-1b52bc08c6aa", gt_network:"solana", gt_pool:null },
  BOME:  { chain:"solana", dexPair:"dsuvzpqekmrqnberzbmxzdrm6ushyxsx54ljqr9zu2k", gt_network:"solana", gt_pool:"dsuvzpqekmrqnberzbmxzdrm6ushyxsx54ljqr9zu2k" },
  TURBO: { chain:"eth",    dexPair:"0x2967e7bb9daa5711ac332caf874bd47ef99b3820", gt_network:"eth",    gt_pool:"0x2967e7bb9daa5711ac332caf874bd47ef99b3820" },
  BRETT: { chain:"base",   dexPair:"0x4f9f7d9af9c58044ebebfba5b88e3d08d7edb20e", gt_network:"base",   gt_pool:"0x4f9f7d9af9c58044ebebfba5b88e3d08d7edb20e" },
  NEIRO: { chain:"eth",    dexPair:"0xa9ecf3fc25d7f91ec04b3cf73de2f7ee94e0b64f", gt_network:"eth",    gt_pool:"0xa9ecf3fc25d7f91ec04b3cf73de2f7ee94e0b64f" },
  GIGA:  { chain:"solana", dexPair:null, gt_network:"solana", gt_pool:null },
  SUNDOG:{ chain:"tron",   dexPair:null, gt_network:"tron",   gt_pool:null },
  SAMO:  { chain:"solana", dexPair:null, gt_network:"solana", gt_pool:null },
  COQ:   { chain:"avax",   dexPair:null, gt_network:"avax",   gt_pool:null },
  WOLF:  { chain:"eth",    dexPair:null, gt_network:"eth",    gt_pool:null },
  JESUS: { chain:"eth",    dexPair:null, gt_network:"eth",    gt_pool:null },
};

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers, body:"" };

  const { endpoint, sym, chain, pool } = event.queryStringParameters || {};

  try {
    // ── DEXScreener search by symbol ──
    if (endpoint === "search" && sym) {
      const res = await fetch(`${DEXSCREENER}/search?q=${sym}`, {
        headers: { "Accept":"application/json", "User-Agent":"DeadPoet/1.0" }
      });
      if (!res.ok) return { statusCode:res.status, headers, body:JSON.stringify({ error:`DS ${res.status}` }) };
      const data = await res.json();

      // Find best pair — highest liquidity matching the symbol
      const pairs = (data.pairs || [])
        .filter(p => p.baseToken?.symbol?.toUpperCase() === sym.toUpperCase())
        .sort((a,b) => (b.liquidity?.usd||0) - (a.liquidity?.usd||0));

      const best = pairs[0];
      if (!best) return { statusCode:404, headers, body:JSON.stringify({ error:"No pair found" }) };

      return { statusCode:200, headers, body:JSON.stringify({
        symbol: best.baseToken?.symbol,
        price: parseFloat(best.priceUsd||0),
        priceChange5m: best.priceChange?.m5||0,
        priceChange1h: best.priceChange?.h1||0,
        priceChange24h: best.priceChange?.h24||0,
        volume5m: best.volume?.m5||0,
        volume1h: best.volume?.h1||0,
        volume24h: best.volume?.h24||0,
        buys5m: best.txns?.m5?.buys||0,
        sells5m: best.txns?.m5?.sells||0,
        buys1h: best.txns?.h1?.buys||0,
        sells1h: best.txns?.h1?.sells||0,
        liquidity: best.liquidity?.usd||0,
        marketCap: best.marketCap||best.fdv||0,
        pairAddress: best.pairAddress,
        chain: best.chainId,
        dex: best.dexId,
      })};
    }

    // ── DEXScreener bulk — get all coins at once ──
    if (endpoint === "bulk") {
      const symbols = ["PEPE","BONK","WIF","DOGE","SHIB","FLOKI","BRETT","MOG","POPCAT","BOME","TURBO","NEIRO","ELON"];
      const results = {};

      // Fetch in batches to avoid rate limits
      await Promise.all(symbols.map(async (s) => {
        try {
          const res = await fetch(`${DEXSCREENER}/search?q=${s}`, {
            headers: { "Accept":"application/json" }
          });
          if (!res.ok) return;
          const data = await res.json();
          const pairs = (data.pairs||[])
            .filter(p => p.baseToken?.symbol?.toUpperCase()===s && (p.liquidity?.usd||0)>100000)
            .sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
          const best = pairs[0];
          if (!best) return;
          results[s] = {
            symbol: s,
            price: parseFloat(best.priceUsd||0),
            priceChange5m: best.priceChange?.m5||0,
            priceChange1h: best.priceChange?.h1||0,
            priceChange24h: best.priceChange?.h24||0,
            volume5m: best.volume?.m5||0,
            volume1h: best.volume?.h1||0,
            buys5m: best.txns?.m5?.buys||0,
            sells5m: best.txns?.m5?.sells||0,
            liquidity: best.liquidity?.usd||0,
            marketCap: best.marketCap||best.fdv||0,
            pairAddress: best.pairAddress,
            chain: best.chainId,
          };
        } catch(e) {}
      }));

      return { statusCode:200, headers, body:JSON.stringify(results) };
    }

    // ── GeckoTerminal OHLCV — 5m candles for RSI/MACD ──
    if (endpoint === "ohlcv" && chain && pool) {
      const res = await fetch(
        `${GECKOTERMINAL}/networks/${chain}/pools/${pool}/ohlcv/minute?aggregate=5&limit=100`,
        { headers: { "Accept":"application/json;version=20230302" } }
      );
      if (!res.ok) return { statusCode:res.status, headers, body:JSON.stringify({ error:`GT ${res.status}` }) };
      const data = await res.json();
      const candles = data?.data?.attributes?.ohlcv_list || [];
      // Format: [timestamp, open, high, low, close, volume]
      const closes = candles.map(c => parseFloat(c[4])).reverse(); // most recent last
      const volumes = candles.map(c => parseFloat(c[5])).reverse();
      return { statusCode:200, headers, body:JSON.stringify({ closes, volumes, count:closes.length }) };
    }

    // ── DEXScreener pair by address (for known pairs) ──
    if (endpoint === "pair" && chain && pool) {
      const res = await fetch(`${DEXSCREENER}/pairs/${chain}/${pool}`);
      if (!res.ok) return { statusCode:res.status, headers, body:JSON.stringify({ error:`DS pair ${res.status}` }) };
      const data = await res.json();
      const pair = data?.pairs?.[0];
      if (!pair) return { statusCode:404, headers, body:JSON.stringify({ error:"Pair not found" }) };
      return { statusCode:200, headers, body:JSON.stringify({
        price: parseFloat(pair.priceUsd||0),
        priceChange5m: pair.priceChange?.m5||0,
        priceChange1h: pair.priceChange?.h1||0,
        volume5m: pair.volume?.m5||0,
        volume1h: pair.volume?.h1||0,
        buys5m: pair.txns?.m5?.buys||0,
        sells5m: pair.txns?.m5?.sells||0,
        liquidity: pair.liquidity?.usd||0,
      })};
    }

    return { statusCode:400, headers, body:JSON.stringify({ error:"Invalid endpoint. Use: search, bulk, ohlcv, pair" }) };

  } catch(e) {
    return { statusCode:500, headers, body:JSON.stringify({ error:e.message }) };
  }
};
