// netlify/functions/dexscreener.js
// Drop this into your Dead Poet repo at: netlify/functions/dexscreener.js
// It proxies DEXScreener server-side so your scanner app has no CORS issues.

const DEXSCREENER_BASE = "https://api.dexscreener.com";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const { endpoint, q } = event.queryStringParameters || {};

    let url;
    if (endpoint === "search" && q) {
      url = `${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`;
    } else if (endpoint === "new") {
      // Latest new pairs on Solana — sorted by creation time
      url = `${DEXSCREENER_BASE}/token-profiles/latest/v1`;
    } else if (endpoint === "pairs" && q) {
      // Lookup specific pair address
      url = `${DEXSCREENER_BASE}/latest/dex/pairs/solana/${q}`;
    } else if (endpoint === "tokens" && q) {
      url = `${DEXSCREENER_BASE}/latest/dex/tokens/${q}`;
    } else {
      // Default — fetch latest SOL pairs
      url = `${DEXSCREENER_BASE}/latest/dex/search?q=pump.fun`;
    }

    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "DeadPoet/1.0",
      },
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({ error: `DEXScreener returned ${res.status}` }),
      };
    }

    const data = await res.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
