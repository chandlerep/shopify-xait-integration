# Shopify <-> XaitCPQ Integration

## Prerequisites
- Node.js 18 or newer (Express 5 requires Node 18+)
- npm 9+ (bundled with modern Node installs)
- Network access to both the Shopify Admin API and your XaitCPQ instance

---

## Getting Started

1. **Install dependencies**
   ```powershell
   npm install
   ```

2. **Run the service**
   ```powershell
   node index.js
   ```
   Use `npx nodemon index.js` if you prefer automatic reloads during development.

---

## Manual Endpoints
| Route | Method | Description |
| --- | --- | --- |
| `/sync-now` | GET | Runs the full sync immediately and returns a simple message when done. |
| `/check-sku?sku=ABC123` | GET | Looks up a SKU in XaitCPQ without creating it; returns JSON `{ sku, found, part }`. |

These endpoints are unauthenticated by default. If you deploy outside a trusted network, add authentication or IP filtering first.

---

## Monitoring & Logs
Console output shows progress and highlights issues with emoji markers:
- `✅` success (login, part creation, completed sync)
- `ℹ️` informative events (skipped part, no part found)
- `⚠️` recoverable warnings (missing SKU, lookup error)
- `❌` hard failures (login or API request errors)

Capture logs wherever you host the service (e.g., systemd, PM2, Docker logs) so you can troubleshoot API failures quickly.

---