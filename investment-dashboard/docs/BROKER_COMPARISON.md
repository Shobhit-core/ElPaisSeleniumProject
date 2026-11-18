# Broker comparison — Upstox vs Zerodha vs Groww (researched 18-Nov-2026)

Figures marked † come from third-party summaries and were not confirmed on the broker's own page in this session; verify before relying on them. All three are SEBI-registered stock brokers / depository participants — confirm the current registration on SEBI's intermediary search before opening an account.

| | **Upstox** | **Zerodha** | **Groww** |
|---|---|---|---|
| Equity delivery brokerage | ₹20 per executed order (Upstox brokerage calculator) | ₹0 † | ₹20 or 0.1%, min ₹5 † |
| DP charge (per scrip, on sell days) | ₹20 + GST (Upstox help centre) | ~₹13.5 + GST † | ~₹20 + GST † |
| Demat AMC | ₹300 + GST/yr (non-BSDA); waived in year 1 for new users | ~₹300 + GST/yr † | ₹0 † |
| Direct mutual funds | Yes | Yes (Coin) | Yes |
| ETFs | Yes | Yes | Yes |
| Official API | Upstox API v2/v3, OAuth | Kite Connect | Groww Trade API |
| API cost for a personal read-only dashboard | Data APIs reported free †; ₹10/order fee only on API-placed orders (not used here) | Personal tier free (holdings/positions/funds, **no market data**); Connect ₹500/month for live + historical data | ~₹499 + GST/month † |
| Market data without login | **Yes** — historical/intraday candles (verified) | No | No |
| Read-only AI integration | **Official read-only Upstox MCP** for Claude (holdings, orders, positions, MFs, funds, profile) | — | — |
| Token lifetime | Until 03:30 IST next day | Daily | Daily † |
| Fit with this dashboard | Fully integrated (OAuth + read-only allowlist + public data) | CSV import works; API integration possible with Kite Connect | CSV import works |

## Recommendation
**Upstox**, because it is the only one of the three that gives this dashboard real market data without a paid subscription, has an official OAuth flow the dashboard implements, and has an official read-only MCP for Claude. That matches your stated preference for a secure, read-only integration.

**The honest trade-off:** Zerodha charges ₹0 on delivery purchases, while Upstox charges ₹20 per order. For a long-term investor placing a handful of stock/ETF orders a year, that difference is roughly ₹100–₹300 a year. It matters more for small orders: ₹20 on a ₹1,000 purchase is 2% before GST. Mitigations:
- buy index **mutual funds (direct plans)**, which carry no brokerage, rather than many small ETF or stock orders;
- batch purchases into fewer, larger orders.

If you prefer the lowest trading cost and are happy to import trades by CSV, Zerodha is a reasonable alternative. The dashboard works with any broker through the journal.
