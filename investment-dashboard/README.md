# Investment Desk — personal investment intelligence dashboard (India)

A self-hosted decision-support tool for a long-term Indian retail investor: portfolio tracking from a trade journal, real market data from official sources, a suitability-gated ₹ allocation plan, transparent stock-research scoring, risk monitoring, an alert engine that explains *why*, a capital-gains tax estimator, read-only Upstox integration and an AI analyst.

> **It never places orders.** There is no order-placement code anywhere in the codebase. It is research and record-keeping, not regulated investment advice; the author is not a SEBI-registered investment adviser.

## Quick start

```bash
cd investment-dashboard
npm install
cp .env.example .env            # set APP_PASSWORD_HASH (see the comment in the file)
npm run dev                     # API on :8787, UI on http://localhost:5173
npm test                        # 118 automated tests
```

Production: `npm run build && npm start` → http://127.0.0.1:8787. See [docs/SETUP.md](docs/SETUP.md) for configuration, broker connection, deployment and backups.

## What's inside

| Area | Implementation |
|---|---|
| Stack | Node 22 + Express + TypeScript API; React + Vite + Recharts UI; SQLite via built-in `node:sqlite` (single-user app → no DB server, trivial backups) |
| Market data | Upstox official API: public daily/30-min candles for stocks, ETFs, Nifty/Sensex/sector indices (no login needed); LTP when your account is connected. AMFI NAV file for mutual funds. NSE announcements RSS, RBI press-release RSS |
| Portfolio | FIFO lot engine from the journal (single source of truth); invested, current value, unrealised/realised P&L, day P&L, XIRR, weights, cash ledger |
| Plan | Onboarding questionnaire → suitability gate (no equity without an emergency fund or if money is needed within 12 months) → conservative / moderate / growth scenarios with amounts, risk, liquidity, downside, 40% stress test, lump-sum vs staggered comparison, clearly-labelled hypothetical projections |
| Research | Price + 50/200-day averages + RSI, returns, volatility, drawdown; sourced fundamentals entry (every figure needs source + period); published scoring methodology; thesis / invalidation / entry strategy |
| Recommendations | Ranked research watchlist (fundamental + valuation, risk shown separately), suggested amount limited to the plan's stock sleeve |
| Risk | Single-stock & sector concentration, effective holdings, equity vs profile cap, liquidity, simulated volatility & drawdown of current holdings |
| Alerts | Volatility-relative price moves, concentration/profile breaches, drawdown, valuation entry levels, thesis review dates, results & negative filings for owned/watched companies — each with an explanation |
| Tax | STCG/LTCG per lot with the post-23-Jul-2024 rates, ₹1.25 lakh exemption, set-off, cess; debt-fund slab treatment; exemption headroom |
| Broker | Upstox OAuth (official flow), AES-256-GCM-encrypted token, read-only allowlist; holdings, positions, funds, orders, P&L report |
| AI analyst | Local mode (deterministic, from your data) and research mode (Claude with web search, cites sources) |
| ₹100 Cr Journey | Net worth, milestones ₹1 L → ₹100 Cr, conservative/base/optimistic projections with inflation, tax and costs, step-up SIP tables, required SIP/return, income & wealth-acceleration model, interactive calculator, year-end 2026 review — with an honest verdict |
| Learn & Philosophy | 9 investors' principles with strengths/weaknesses/failure modes, tested against 10 years of NSE strategy-index data; case studies; behaviour detection and post-investment reviews |
| Committee & valuation | DCF, multiples, comparables, book value, DDM, Graham number with limitations and margin of safety; six-member rule-based investment committee (default: no recommendation) |
| Family view | Plain-language home page with a bad/likely/good range for 6 months–5 years |
| Security | Mandatory sign-in (scrypt), HttpOnly SameSite=Strict session cookie, CSRF header, CSP & security headers, rate limits, input validation (zod), secrets server-side only, redacted logs |

Docs: [₹100 Cr strategy — maths, verification, limits](docs/WEALTH_STRATEGY.md) · [Setup & deployment](docs/SETUP.md) · [API limitations](docs/API_LIMITATIONS.md) · [Broker comparison](docs/BROKER_COMPARISON.md) · [Market briefing 18-Nov-2026](docs/MARKET_BRIEFING.md)
