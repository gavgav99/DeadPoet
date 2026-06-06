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
    return { statusCode: 500, headers, body: JSON.stringify({ error: "No API key" }) };
  }

  try {
    const { wallet, limit, chain } = event.queryStringParameters || {};

    // Build feed URL — only free endpoint
    let url = `${CIELO_BASE}/feed?limit=${limit || 10}`;
    if (wallet) url += `&wallet=${wallet}`;
    if (chain) url += `&chainId=${chain}`;

    const res = await fetch(url, {
      headers: {
        "x-api-key": CIELO_KEY,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return { 
        statusCode: res.status, 
        headers, 
        body: JSON.stringify({ error: `Cielo ${res.status}`, detail: text }) 
      };
    }

    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: err.message }) 
    };
  }
};
