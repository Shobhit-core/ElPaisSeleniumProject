# Setup, configuration & deployment

## Requirements
- Node.js **22.13+** (uses the built-in `node:sqlite`; Node prints an "experimental" warning — harmless). No database server needed.
- Outbound HTTPS to: `api.upstox.com`, `assets.upstox.com`, `www.amfiindia.com` (redirects to `portal.amfiindia.com`), `nsearchives.nseindia.com`, `www.rbi.org.in`, `www.niftyindices.com`, and `api.anthropic.com` if using research mode.

## 1. Install & configure
```bash
cd investment-dashboard
npm install
cp .env.example .env
npx tsx server/scripts/backup.ts hash-password "a long passphrase"   # paste output into APP_PASSWORD_HASH
```
The server refuses to start without a password. This is the **dashboard** password — never your broker credentials.

| Variable | Required | Purpose |
|---|---|---|
| `APP_PASSWORD_HASH` (or `APP_PASSWORD`) | yes | Sign-in |
| `HOST`, `PORT` | no | Defaults `127.0.0.1:8787` (local only) |
| `COOKIE_SECURE=true` | when on HTTPS | Secure cookie flag |
| `UPSTOX_CLIENT_ID`, `UPSTOX_CLIENT_SECRET`, `UPSTOX_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` | for broker link | Read-only Upstox account data |
| `ANTHROPIC_API_KEY` | for research mode | AI analyst web research (paid usage) |
| `NODE_USE_ENV_PROXY=1` | behind a proxy | Makes Node's fetch use `HTTPS_PROXY` |

## 2. Run
- Development: `npm run dev` → UI http://localhost:5173 (proxies `/api` to :8787).
- Production: `npm run build && npm start` → http://127.0.0.1:8787 serves UI + API.

On first start the server downloads the NSE instrument list (~3,100 equities/ETFs/indices) and the AMFI NAV file (~14,000 schemes); both refresh automatically (weekly / twice daily). Alerts are evaluated every 30 minutes while the server runs.

## 3. First use
1. **Profile & ₹ Plan** → answer the 7 onboarding questions. Recommendations stay locked until then.
2. **Journal → Cash** → record your ₹30,000 deposit.
3. Record each purchase in **Journal → Add transaction** (rationale is mandatory), or import a CSV. The charge estimator fills brokerage/STT/charges for your broker.
4. **Stock Research** → research companies with sourced figures; set entry levels and review dates for alerts.

### CSV format
```
date,type,symbol,name,asset_class,sector,quantity,price,brokerage,stt,other_charges,rationale
2026-11-20,BUY,MF:149373,Axis Nifty 50 Index Fund - Direct - Growth,EQUITY_MF,,600,15.46,0,0,0.46,Core index holding
2026-11-20,BUY,NIFTYBEES,Nippon Nifty 50 ETF,EQUITY_ETF,,10,288,20,3,5,Core via ETF
```
`asset_class`: EQUITY, EQUITY_ETF, EQUITY_MF, DEBT_MF, GOLD_ETF, GSEC, CASH. Mutual funds use `MF:<AMFI scheme code>` (search in the app to find it). The import is all-or-nothing and validated line by line.

## 4. Connect Upstox (optional, read-only)
1. Create an app at Upstox Developer Apps; set redirect URL = `<your origin>/api/broker/callback` exactly.
2. Put the API key/secret and a 64-hex `TOKEN_ENCRYPTION_KEY` in `.env`; restart.
3. **Settings & Broker → Connect Upstox.** You log in on Upstox's own page; the dashboard receives only an access token, encrypts it, and uses it for GET requests on a fixed allowlist.
4. The token expires at **03:30 IST daily** (Upstox rule) — reconnect each day you want live broker data. Without it, the dashboard still works using public candle data and your journal.

Separately, for asking Claude about your account in a chat, Upstox publishes an official read-only MCP: add the marketplace `upstox/upstox-plugin-marketplace` in Claude and install `upstox-mcp` (holdings, orders, positions, mutual funds, funds, profile; re-authorise daily). That is independent of this dashboard.

## 5. Deployment options
- **Recommended: run on your own machine** (`HOST=127.0.0.1`). Nothing is exposed to the internet.
- **Small VPS:** keep `HOST=127.0.0.1`, put Caddy/nginx in front with HTTPS, set `COOKIE_SECURE=true`, and add the HTTPS callback URL in your Upstox app. Run with a process manager (systemd/pm2). Example Caddyfile: `invest.example.com { reverse_proxy 127.0.0.1:8787 }`.
- Do not expose the app on a public IP without HTTPS.

## 6. Backups & data
- Database: `data/portfolio.db` (gitignored). `npm run backup` or Settings → "Back up database" writes a consistent copy (SQLite `VACUUM INTO`) to `backups/`. Schedule it (cron) and copy backups off the machine.
- Journal export: Journal → CSV import/export → "Export journal as CSV".
- Restore: stop the server, replace `data/portfolio.db` with a backup file, start.

## 7. Tests
```bash
npm test          # unit + API integration tests (vitest)
npm run typecheck
```
Integration tests start the real Express app on a temporary database and simulate upstream APIs (including outages) with fixtures captured from the real AMFI, Upstox and NSE responses on 18-Nov-2026. The Upstox **account** flow is tested only against mocks — see API_LIMITATIONS.md.
