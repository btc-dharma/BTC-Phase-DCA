# ₿ DCA Engine v2.3

## Quick Start (2 commands)

```bash
npm install
node server.js
```

Then open **http://localhost:8080** on your tablet.

## Why server.js?

Bitbo's on-chain API (MVRV Z-Score, Puell Multiple, etc.) doesn't support
browser CORS requests. The server proxies these calls server-side so your
browser gets the data without CORS issues.

## Network Access

The server prints your local IP on startup. Use that URL on your tablet
(both devices must be on the same Wi-Fi):

```
  ₿ DCA Engine v2.3
  ─────────────────────────────────────
  Local:   http://localhost:8080
  Network: http://192.168.1.42:8080
```

## Add to Home Screen

1. Open the network URL in Chrome on your tablet
2. Tap ⋮ menu → "Add to Home screen" or "Install app"
3. The app launches fullscreen like a native app

## Files

| File | Purpose |
|------|---------|
| server.js | Express server (serves PWA + proxies Bitbo API) |
| index.html | Full app (React + engine logic) |
| manifest.json | PWA metadata |
| sw.js | Service worker (offline cache) |
| icon-*.png | App icons |
