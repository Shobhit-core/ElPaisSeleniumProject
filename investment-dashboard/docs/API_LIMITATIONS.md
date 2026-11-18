# Data sources & API limitations

Verified on 18-Nov-2026 from the development environment unless stated otherwise.

| Source | Used for | Auth / cost | Verified live? | Limitations |
|---|---|---|---|---|
| Upstox historical candle API (`/v2/historical-candle/...`) | Daily history, 30-min intraday candles for stocks, ETFs, NSE/BSE indices | None required for these endpoints | **Yes** — Nifty 50, Sensex, 13 sector indices, HDFCBANK, NIFTYBEES returned real data | Without a broker login, "current price" = close of the latest 30-min candle (up to ~30 min delayed). Upstox does not publish an SLA for unauthenticated use. If Upstox starts requiring auth here, prices fall back to manual entry. |
| Upstox instruments master (`assets.upstox.com/.../NSE.json.gz`, `BSE.json.gz`) | Symbol search, instrument keys | Public | **Yes** — 3,098 NSE equities/ETFs + indices loaded | Weekly refresh; new listings appear after the next sync. |
| Upstox account APIs (holdings, positions, funds, orders, P&L report, LTP) | Broker view, real-time LTP | OAuth 2.0 per user; token valid until 03:30 IST next day | **No** — implemented to the official docs and tested with mocks only; needs your account | Tokens are not scope-limited — read-only is enforced by this code (GET allowlist, no order code). Funds API is unavailable 00:00–05:30 IST (documented). Rate limits apply (not raised on request). Data APIs are reported as free; Upstox's ₹10/order API fee applies only to API-placed orders, which this app never makes. |
| AMFI `NAVAll.txt` | Mutual-fund NAVs, scheme search | Public, free | **Yes** — 14,224 schemes | Published once daily after market (NAV is T-day evening); not intraday. |
| NSE corporate announcements RSS | Filings, results intimations, alerts | Public RSS | **Yes** — 200 latest items | Rolling window of the most recent filings across all companies — not a searchable archive. Upcoming results are inferred from "Board Meeting Intimation" filings; there is no free official results-calendar API. |
| RBI press-release RSS | Economy feed | Public RSS | **Yes** | Headlines and links only. |
| NSE Indices constituent CSV (`niftyindices.com`) | Nifty 50 breadth, gainers/losers | Public file | **Not reachable from the dev sandbox** (network policy) — fallback: upload the CSV in Market Intelligence | Breadth is computed over Nifty 50 constituents only, from 30-min candles (~100 requests per refresh, cached 15 min). |
| Anthropic Messages API + web search tool | AI analyst research mode | `ANTHROPIC_API_KEY`, paid per use | **No** — no key in this environment; parsing logic tested with a stub client | Answers depend on what web search finds; sources are listed for verification. |

## What is deliberately NOT available
- **Company fundamentals (ROE, ROCE, D/E, promoter holding, pledging, P/E…)**: there is no free, licensed official API. The dashboard does not scrape screener sites or NSE web pages (restricted / against terms). You enter figures from annual reports, results and exchange shareholding filings, each with a source and period. Paid options if you want automation: licensed data vendors (e.g. exchange data feeds, CMOTS/Accord-type providers) — would plug into `server/providers/`.
- **Live index P/E, FII/DII flows, market-wide gainers/losers beyond Nifty 50**: NSE publishes these on its website but not via a public API; not scraped. Use research mode (cites sources) or the NSE site.
- **Corporate-action adjustment**: candles appear adjusted, but this isn't documented; the research page flags any >25% one-day move as a possible unadjusted split/bonus.
- **Order placement**: intentionally absent.

## Graceful degradation (tested)
- Upstream 5xx/timeouts → one retry, then the last known price is kept with its original timestamp and the failure is reported in the UI.
- Missing price → holding valued at cost and flagged "unpriced"; never guessed.
- Feeds down → cached copy shown, marked stale.
- Broker token expired → broker features return a clear "reconnect" message; everything else keeps working.
