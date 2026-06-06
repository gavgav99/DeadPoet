const CIELO_BASE = "https://feed-api.cielo.finance/api/v1";

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

  const CIELO_KEY = process.env.CIELO_API_KEY;
  if (!CIELO_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "No API key configured" }) };
  }

  try {
    const { endpoint, wallet, limit } = event.queryStringParameters || {};

    let url;
    if (endpoint === "pnl" && wallet) {
      url = `${CIELO_BASE}/${wallet}/pnl/tokens?limit=${limit || 20}`;
    } else if (endpoint === "stats" && wallet) {
      url = `${CIELO_BASE}/${wallet}/pnl/total-stats`;
    } else if (endpoint === "feed" && wallet) {
      url = `${CIELO_BASE}/${wallet}/txs?limit=${limit || 20}`;
    } else if (endpoint === "related" && wallet) {
      url = `${CIELO_BASE}/${wallet}/related-wallets`;
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid endpoint" }) };
    }

    const res = await fetch(url, {
      headers: {
        "x-api-key": CIELO_KEY,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: `Cielo returned ${res.status}` }) };
    }

    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
