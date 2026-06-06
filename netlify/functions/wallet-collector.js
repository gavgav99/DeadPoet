// netlify/functions/wallet-collector.js
// Runs every 60 seconds via Netlify scheduled functions
// Fetches real swap data from Tier S + A wallets and stores to Netlify Blobs
// Deploy this to your Dead Poet repo at: netlify/functions/wallet-collector.js

const { getStore } = require("@netlify/blobs");

const CIELO_BASE = "https://feed-api.cielo.finance/api/v1";
const MIN_USD = 50; // capture trades over $50

// Real wallet addresses from Orangie's discord
const TRACKED_WALLETS = [
  // TIER S
  { address: "H812jAz5Z5t8cvfXoxbE27Q2F89eovpib5kpXawLAFdS", name: "cooker", tier: "S" },
  { address: "ETcmHKVYg2TrU83cZbP6BNoitfztUdGVagWNSmGyzycG", name: "profit", tier: "S" },
  { address: "DuQabFqdC9eeBULVa7TTdZYxe8vK8ct5DZr4Xcf7docy", name: "ORANGIE", tier: "S" },
  { address: "2V54c75rjibgh6NsDWP88tbpu8KjQ3APRrK5zNQVqx1T", name: "orangie2", tier: "S" },
  { address: "7QZGS7MQ4S6hRmE8iXoFTXgQ2hXVUCho2ZhgeWvLNPZT", name: "murad", tier: "S" },
  { address: "9X5n5i1mugTjgGPhqf1KJDt8r4kD8TF3s62ttbxKzFHa", name: "dingaling", tier: "S" },
  { address: "BtMBMPkoNbnLF9Xn552guQq528KKXcsNBNNBre3oaQtr", name: "letterbomb", tier: "S" },
  { address: "JDd3hy3gQn2V982mi1zqhNqUw1GfV2UL6g76STojCJPN", name: "ratwizard", tier: "S" },
  { address: "76ZUBj1JLz7arTVHSRJok5oSTEqDuVBgySFMVHtzxzZc", name: "cabal guy", tier: "S" },
  { address: "HaZtFxgw99iM97LxmwFuDW6k4MP1XwsWTGoy7GUoSELj", name: "cobie", tier: "S" },
  // TIER A
  { address: "2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f", name: "cupsey", tier: "A" },
  { address: "FakHVp9d6JJDa5j4w4d1NetFjZafLkHx1LETWhDCyVxK", name: "nach", tier: "A" },
  { address: "BCnqsPEtA1TkgednYEebt6L3QVcZNdtXxqaUWGMbWopE", name: "kreo", tier: "A" },
  { address: "9yYya3F5EJoLnBNKW6z4YoWFrLnvqFJNpZumLGmBaGjx", name: "loop", tier: "A" },
  { address: "Gmh3Wt423pU6GsS3FQyZjknifnAFW7g3J8HhbF2TrbZL", name: "sukio", tier: "A" },
  { address: "9HCTuTPEiQvkUtLmTZvK6uch4E3pDynwJTbNw6jLhp9z", name: "corleone", tier: "A" },
  { address: "5rkPDK4JnVAumgzeV2Zu8vjggMTtHdDtrsd5o9dhGZHD", name: "PORTNOY", tier: "A" },
  { address: "AM84n1iLdxgVTAyENBcLf89p9MAmyoJGpXFdPMDL3Xkn", name: "AI16z DAO", tier: "A" },
  { address: "5sTQ5ih7xtctBhMXHr3f1aWdaXazWrWfoehqWdqWnTFP", name: "WinterMute", tier: "A" },
  { address: "3xzTSh7KSFsnhzVvuGWXMmA3xaA89gCCM1MSS1Ga6ka6", name: "TruthTerminal", tier: "A" },
];

async function fetchWalletSwaps(wallet, apiKey) {
  const url = `${CIELO_BASE}/feed?wallet=${wallet.address}&limit=20&chain=solana`;
  const res = await fetch(url, {
    headers: { "x-api-key": apiKey, "Accept": "application/json" },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const items = data?.data?.items || [];

  return items
    .filter(tx => tx.tx_type === "swap")
    .map(tx => {
      const usd = tx.token0_amount_usd || tx.amount_usd || 0;
      const isSell = tx.is_sell;
      const token = isSell
        ? { name: tx.token0_name, symbol: tx.token0_symbol, address: tx.token0_address, usd: tx.token0_amount_usd }
        : { name: tx.token1_name, symbol: tx.token1_symbol, address: tx.token1_address, usd: tx.token1_amount_usd };

      return {
        id: tx.tx_hash,
        walletName: wallet.name,
        walletAddress: wallet.address,
        walletTier: wallet.tier,
        isBuy: !isSell,
        token,
        usdValue: Math.max(usd, token?.usd || 0),
        dex: tx.dex || "unknown",
        timestamp: tx.timestamp,
        time: new Date(tx.timestamp * 1000).toISOString(),
        txHash: tx.tx_hash,
        chain: tx.chain,
      };
    })
    .filter(tx => tx.usdValue >= MIN_USD);
}

function detectConvergence(allTrades) {
  // Group buys by token address in last 4 hours
  const cutoff = Date.now() / 1000 - (4 * 60 * 60);
  const tokenBuys = {};

  allTrades
    .filter(t => t.isBuy && t.timestamp >= cutoff)
    .forEach(t => {
      const key = t.token?.address;
      if (!key || key === "native" || key === "So11111111111111111111111111111111111111112") return;
      if (!tokenBuys[key]) tokenBuys[key] = [];
      // Avoid duplicate wallets
      if (!tokenBuys[key].find(b => b.walletName === t.walletName)) {
        tokenBuys[key].push(t);
      }
    });

  return Object.entries(tokenBuys)
    .filter(([, buys]) => buys.length >= 2)
    .map(([addr, buys]) => ({
      tokenAddress: addr,
      tokenName: buys[0].token?.name,
      tokenSymbol: buys[0].token?.symbol,
      buyers: buys.map(b => ({ name: b.walletName, tier: b.walletTier, usd: b.usdValue })),
      buyerNames: buys.map(b => b.walletName),
      tierSCount: buys.filter(b => b.walletTier === "S").length,
      totalUsd: buys.reduce((s, b) => s + b.usdValue, 0),
      firstBuy: Math.min(...buys.map(b => b.timestamp)),
      lastBuy: Math.max(...buys.map(b => b.timestamp)),
      time: new Date(Math.max(...buys.map(b => b.timestamp)) * 1000).toISOString(),
      conviction: buys.filter(b => b.walletTier === "S").length >= 2 ? "EXTREME" :
                  buys.filter(b => b.walletTier === "S").length >= 1 ? "HIGH" : "MEDIUM",
    }))
    .sort((a, b) => b.tierSCount - a.tierSCount || b.totalUsd - a.totalUsd);
}

exports.handler = async (event) => {
  const CIELO_KEY = process.env.CIELO_API_KEY;
  if (!CIELO_KEY) {
    console.error("No CIELO_API_KEY set");
    return { statusCode: 500, body: "No API key" };
  }

  console.log(`[${new Date().toISOString()}] Wallet collector running...`);

  try {
    // Initialize Netlify Blobs store
    const store = getStore("wallet-trades");

    // Load existing trades
    let existingTrades = [];
    try {
      const existing = await store.get("trades", { type: "json" });
      existingTrades = existing || [];
    } catch (e) {
      existingTrades = [];
    }

    // Fetch fresh swaps from all wallets
    // Stagger requests to respect rate limits (10 credits/sec on free plan)
    const allNewTrades = [];
    const existingIds = new Set(existingTrades.map(t => t.id));

    for (const wallet of TRACKED_WALLETS) {
      try {
        const swaps = await fetchWalletSwaps(wallet, CIELO_KEY);
        const fresh = swaps.filter(s => !existingIds.has(s.id));
        allNewTrades.push(...fresh);
        if (fresh.length > 0) {
          console.log(`${wallet.name}: ${fresh.length} new swaps`);
        }
      } catch (e) {
        console.error(`Error fetching ${wallet.name}:`, e.message);
      }
      // Rate limit protection — 200ms between requests
      await new Promise(r => setTimeout(r, 200));
    }

    // Merge and keep last 7 days of trades
    const cutoff7d = Date.now() / 1000 - (7 * 24 * 60 * 60);
    const merged = [...allNewTrades, ...existingTrades]
      .filter(t => t.timestamp >= cutoff7d)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 2000); // max 2000 trades stored

    // Detect convergence
    const convergence = detectConvergence(merged);

    // Store everything
    await store.setJSON("trades", merged);
    await store.setJSON("convergence", convergence);
    await store.setJSON("meta", {
      lastRun: new Date().toISOString(),
      totalTrades: merged.length,
      newThisRun: allNewTrades.length,
      convergenceAlerts: convergence.length,
      walletsTracked: TRACKED_WALLETS.length,
    });

    console.log(`Done. ${allNewTrades.length} new trades. ${convergence.length} convergence alerts.`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        newTrades: allNewTrades.length,
        totalStored: merged.length,
        convergenceAlerts: convergence.length,
      }),
    };

  } catch (e) {
    console.error("Collector error:", e);
    return { statusCode: 500, body: e.message };
  }
};
