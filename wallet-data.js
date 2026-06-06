// netlify/functions/wallet-data.js
// Serves stored wallet trade data to the dashboard
// Drop this in your Dead Poet repo at: netlify/functions/wallet-data.js

const { getStore } = require("@netlify/blobs");

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
    const store = getStore("wallet-trades");
    const { type } = event.queryStringParameters || {};

    if (type === "convergence") {
      const data = await store.get("convergence", { type: "json" });
      return { statusCode: 200, headers, body: JSON.stringify(data || []) };
    }

    if (type === "meta") {
      const data = await store.get("meta", { type: "json" });
      return { statusCode: 200, headers, body: JSON.stringify(data || {}) };
    }

    // Default — return trades with optional filters
    const { wallet, limit, onlyBuys, minUsd } = event.queryStringParameters || {};
    let trades = await store.get("trades", { type: "json" }) || [];

    if (wallet) trades = trades.filter(t => t.walletName === wallet);
    if (onlyBuys === "true") trades = trades.filter(t => t.isBuy);
    if (minUsd) trades = trades.filter(t => t.usdValue >= parseFloat(minUsd));
    if (limit) trades = trades.slice(0, parseInt(limit));

    return { statusCode: 200, headers, body: JSON.stringify(trades) };

  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message, note: "Blobs may not be initialized yet — wait for first scheduled run" }),
    };
  }
};
