#!/usr/bin/env node
/**
 * DCA Engine v2.3 — Local Server
 * 
 * Serves the PWA static files AND proxies on-chain API calls
 * to Bitbo server-side, bypassing browser CORS restrictions.
 * 
 * Usage:
 *   npm install        (one time)
 *   node server.js     (start)
 * 
 * Then open http://localhost:8080 on any device on your network.
 * The app will auto-detect the proxy and fetch on-chain data.
 */

const express = require("express");
const https = require("https");
const http = require("http");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 8080;

// ── Serve static PWA files ──
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    // Proper MIME types for PWA
    if (filePath.endsWith(".js")) res.setHeader("Content-Type", "application/javascript");
    if (filePath.endsWith(".json")) res.setHeader("Content-Type", "application/json");
    // Cache static assets for offline
    if (filePath.endsWith(".png")) res.setHeader("Cache-Control", "public, max-age=86400");
  }
}));

// ── CoinMetrics Community API proxy ──
const CM_BASE = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&frequency=1d&paging_from=end";
const METRIC_CONFIGS = {
  "mvrv-z":         { url: CM_BASE + "&page_size=1&metrics=CapMVRVCur", parse: (d) => { const v = parseFloat(d?.data?.[0]?.CapMVRVCur); return isNaN(v) ? null : Math.round(((v - 1.65) / 1.3) * 1000) / 1000; } },
  "puell-multiple": { url: CM_BASE + "&page_size=365&metrics=RevUSD", parse: (d) => { if (!d?.data || d.data.length < 300) return null; const vals = d.data.map(r => parseFloat(r.RevUSD)).filter(v => !isNaN(v)); const today = vals[0]; const avg = vals.reduce((s,v) => s+v, 0) / vals.length; return avg > 0 ? Math.round((today / avg) * 1000) / 1000 : null; } },
  "supply-in-profit": { url: CM_BASE + "&page_size=1&metrics=SplyActPct1yr", parse: (d) => { const v = parseFloat(d?.data?.[0]?.SplyActPct1yr); return isNaN(v) ? null : v; } },
  "nupl":           { url: CM_BASE + "&page_size=1&metrics=CapMrktCurUSD,CapRealUSD", parse: (d) => { const mc = parseFloat(d?.data?.[0]?.CapMrktCurUSD); const rc = parseFloat(d?.data?.[0]?.CapRealUSD); return (mc > 0) ? Math.round(((mc - rc) / mc) * 10000) / 10000 : null; } },
};

// Cache to avoid hammering Bitbo (cache for 10 minutes)
const cache = {};
const CACHE_TTL = 10 * 60 * 1000;

function fetchCoinMetrics(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "DCAEngine/2.3", "Accept": "application/json" },
      timeout: 15000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON from CoinMetrics")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// Proxy endpoint: /proxy/bitbo/:metric (kept same path for app compatibility)
app.get("/proxy/bitbo/:metric", async (req, res) => {
  const metric = req.params.metric;
  const config = METRIC_CONFIGS[metric];
  
  if (!config) {
    return res.status(404).json({ error: "Unknown metric. Valid: " + Object.keys(METRIC_CONFIGS).join(", ") });
  }

  // Check cache
  const cached = cache[metric];
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    res.setHeader("X-Cache", "HIT");
    return res.json(cached.data);
  }

  try {
    const raw = await fetchCoinMetrics(config.url);
    const value = config.parse(raw);
    const result = { metric, value, source: "CoinMetrics" };
    cache[metric] = { data: result, time: Date.now() };
    res.setHeader("X-Cache", "MISS");
    res.json(result);
  } catch (err) {
    console.error(`[CoinMetrics] ${metric} fetch failed:`, err.message);
    if (cached) {
      res.setHeader("X-Cache", "STALE");
      return res.json(cached.data);
    }
    res.status(502).json({ error: "CoinMetrics API unreachable", detail: err.message });
  }
});

// Health check / all metrics at once
app.get("/proxy/bitbo", async (req, res) => {
  const results = {};
  for (const [metric, config] of Object.entries(METRIC_CONFIGS)) {
    try {
      const cached = cache[metric];
      if (cached && Date.now() - cached.time < CACHE_TTL) {
        results[metric] = { value: cached.data?.value, cached: true };
      } else {
        const raw = await fetchCoinMetrics(config.url);
        const value = config.parse(raw);
        const result = { metric, value, source: "CoinMetrics" };
        cache[metric] = { data: result, time: Date.now() };
        results[metric] = { value, cached: false };
      }
    } catch (err) {
      results[metric] = { value: null, error: err.message };
    }
  }
  res.json(results);
});

// ── Start server ──
app.listen(PORT, "0.0.0.0", () => {
  const ifaces = os.networkInterfaces();
  let localIP = "localhost";
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }
  
  console.log("");
  console.log("  ₿ DCA Engine v2.3");
  console.log("  ─────────────────────────────────────");
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log("");
  console.log("  On-chain proxy: /proxy/bitbo/{metric} (via CoinMetrics)");
  console.log("  Metrics: mvrv-z, puell-multiple, supply-in-profit, nupl");
  console.log("  Cache TTL: 10 minutes");
  console.log("");
  console.log("  Open the URL above on your tablet to use the app.");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
