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

// ── Bitbo API proxy ──
const BITBO_ENDPOINTS = {
  "mvrv-z":         "/api/v1/mvrv-z/?latest=true",
  "puell-multiple": "/api/v1/puell-multiple/?latest=true",
  "supply-in-profit": "/api/v1/supply-in-profit/?latest=true",
  "nupl":           "/api/v1/nupl/?latest=true",
};

// Cache to avoid hammering Bitbo (cache for 10 minutes)
const cache = {};
const CACHE_TTL = 10 * 60 * 1000;

function fetchBitbo(endpoint) {
  return new Promise((resolve, reject) => {
    const url = "https://charts.bitbo.io" + endpoint;
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DCAEngine/2.3)",
        "Accept": "application/json",
      },
      timeout: 10000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid JSON from Bitbo"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// Proxy endpoint: /proxy/bitbo/:metric
app.get("/proxy/bitbo/:metric", async (req, res) => {
  const metric = req.params.metric;
  const endpoint = BITBO_ENDPOINTS[metric];
  
  if (!endpoint) {
    return res.status(404).json({ error: "Unknown metric. Valid: " + Object.keys(BITBO_ENDPOINTS).join(", ") });
  }

  // Check cache
  const cached = cache[metric];
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    res.setHeader("X-Cache", "HIT");
    return res.json(cached.data);
  }

  try {
    const data = await fetchBitbo(endpoint);
    cache[metric] = { data, time: Date.now() };
    res.setHeader("X-Cache", "MISS");
    res.json(data);
  } catch (err) {
    console.error(`[Bitbo] ${metric} fetch failed:`, err.message);
    // Return stale cache if available
    if (cached) {
      res.setHeader("X-Cache", "STALE");
      return res.json(cached.data);
    }
    res.status(502).json({ error: "Bitbo API unreachable", detail: err.message });
  }
});

// Health check / all metrics at once
app.get("/proxy/bitbo", async (req, res) => {
  const results = {};
  for (const [metric, endpoint] of Object.entries(BITBO_ENDPOINTS)) {
    try {
      const cached = cache[metric];
      if (cached && Date.now() - cached.time < CACHE_TTL) {
        results[metric] = { value: cached.data?.data?.[0]?.[1] ? parseFloat(cached.data.data[0][1]) : null, cached: true };
      } else {
        const data = await fetchBitbo(endpoint);
        cache[metric] = { data, time: Date.now() };
        results[metric] = { value: data?.data?.[0]?.[1] ? parseFloat(data.data[0][1]) : null, cached: false };
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
  console.log("  On-chain proxy: /proxy/bitbo/{metric}");
  console.log("  Metrics: mvrv-z, puell-multiple, supply-in-profit, nupl");
  console.log("  Cache TTL: 10 minutes");
  console.log("");
  console.log("  Open the URL above on your tablet to use the app.");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
