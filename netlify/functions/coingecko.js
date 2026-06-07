// netlify/functions/coingecko.js
// Proxies CoinGecko API server-side — no CORS, no browser rate limits
// Add to your Dead Poet repo at: netlify/functions/coingecko.js

const CG_BASE = "https://api.coingecko.com/api/v3";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const { endpoint, ids, days, interval } = event.queryStringParameters || {};

    let url;

    if (endpoint === "price" && ids) {
      // Simple price with all fields
      url = `${CG_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_24hr_vol=true&include_market_cap=true`;
    } else if (endpoint === "history" && ids) {
      // Market chart for a single coin
      url = `${CG_BASE}/coins/${ids}/market_chart?vs_currency=usd&days=${days||14}&interval=${interval||"hourly"}`;
    } else if (endpoint === "coins" && ids) {
      // Coin list with market data
      url = `${CG_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h,7d`;
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid endpoint. Use: price, history, coins" }),
      };
    }

    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "DeadPoet/1.0",
      },
    });

    if (res.status === 429) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: "CoinGecko rate limited — retry in 60s" }),
      };
    }

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({ error: `CoinGecko returned ${res.status}` }),
      };
    }

    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
