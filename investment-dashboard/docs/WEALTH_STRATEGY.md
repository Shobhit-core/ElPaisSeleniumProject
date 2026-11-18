# ₹100 crore expansion — design, maths, verification and limits

## What was added (integrated into the existing app; no working module rewritten)

| Requirement | Where | Notes |
|---|---|---|
| ₹100 Cr Wealth Journey | **🎯 ₹100 Cr Journey** page, `shared/wealth.ts`, `/api/wealth` | Net worth, investable assets, milestones ₹1 L → ₹100 Cr, 3 scenarios, inflation, tax, costs, honest verdict |
| Interactive calculator | Journey → Calculator (runs in the browser on the same tested maths) | Monthly SIP, yearly step-up, years, return, costs, inflation, target |
| Step-up SIP strategy | Journey → Step-up & SIP needed | 0/5/10/15/20% step-ups at 5–30 yrs; required SIP for 20/25/30 yrs × 3 return assumptions |
| Wealth acceleration | Journey → Net worth & income | Income model splitting active income, side/business income and capital appreciation; required savings rate; opportunity evaluation |
| Year-end 2026 review | Journey → Year-end 2026, `/api/year-end` | Deployment, cash reserve, 20% downside, checklist (auto + manual) |
| Investment philosophy | **Learn & Philosophy** page | 9 investors: principles, conditions, strengths, weaknesses, failure modes, application |
| Testing principles on Indian data | Learn → Evidence, `/api/learn/evidence` | 10 years of NSE strategy-index data (Value, Quality, Midcap, Smallcap, Momentum vs Nifty 50) |
| Knowledge centre | Learn → Knowledge centre | Crashes, failures, successes; statements, valuation, risk, tax, allocation, behaviour |
| Behaviour tracking & post-investment reviews | Learn → My behaviour & reviews, `shared/behaviour.ts` | Detects short-term trading, disposition effect, costly orders, overtrading, unresearched buys, selling in drawdowns, concentration creep; review log & scorecard |
| Risk engine (12 categories) | Risk Management page, `shared/riskEngine.ts` | Register, 8 stress scenarios, time-weighted drawdown monitor, beta-scaled stock shocks |
| Position sizing | `positionSize()` — Recommendations + Committee | Single-stock cap, loss budget, sector room, plan sleeve, correlation, liquidity, minimum ticket |
| Thesis monitoring | `thesisAlerts()` | Tripwires for shrinking profit/revenue, high debt, pledge, governance flags, falling ROE |
| Institutional valuation | `shared/valuation.ts`, Research → Fundamentals | DCF, earnings multiple, comparables, asset-based, DDM, Graham number — each with limitations; margin of safety |
| Investment committee | Research → Investment committee, `shared/committee.ts` | 6 independent rule-based reviewers incl. a skeptic; default is NO INVESTMENT RECOMMENDATION |
| Performance accountability | Performance & Tax page, `shared/performance.ts` | Same cash flows replayed into Nifty 50; returns after costs; XIRR only after 1 year |

## Calculation conventions (so anyone can check them)
- Monthly rate `i = (1 + net)^(1/12) − 1`, where net = gross return − cost drag (default 0.5%/yr).
- SIPs are invested at the **start** of each month; the monthly amount rises by the step-up % every 12 months.
- Real value = nominal ÷ (1 + inflation)^years (default inflation 5.5%).
- After-tax value = value − 12.5% × max(0, gain − ₹1.25 L) — a once-at-the-end simplification.
- Required SIP uses linearity: `SIP = (target − FV(initial)) ÷ FV(₹1 SIP)`.
- Drawdowns use a **time-weighted index** so new money is not mistaken for gains or losses.
- XIRR is shown only once the first cash flow is ≥ 365 days old; before that the simple absolute return is shown (annualising weeks of movement gave −90% in testing).
- Stress shocks are hypothetical approximations of past episodes (labelled as such); individual stocks are scaled by their measured beta vs the Nifty 50 (0.5–2).
- Position size: severe single-stock fall = 2 × annual volatility, bounded 50–80%; the loss budget is 2% of the portfolio per position.

## Default assumptions (all editable in the app)
| | Conservative | Base | Optimistic |
|---|---|---|---|
| Gross annual return | 8% | 10% | 12% |

Costs 0.5%/yr, inflation 5.5%, LTCG 12.5% above ₹1.25 L. The base is deliberately below the Nifty 50's measured 12.1% price CAGR (Nov-2016 → Nov-2026, Upstox data; ~13–13.5% including dividends), so the plan does not depend on repeating one strong decade. **Optimistic is not an expectation.**

## The honest result for your profile (₹30,000 + ₹10,000/month)
- Base case, 10% yearly step-up: **≈ ₹5.67 crore in 30 years**; ₹100 crore would take **≈ 54½ years**.
- ₹100 crore in 30 years needs **≈ 27% a year** (unrealistic) or a **starting SIP ≈ ₹1.78 lakh/month** rising 10% a year.
- ₹100 crore in 30 years ≈ **₹20 crore** of today's purchasing power at 5.5% inflation.
- Therefore the dominant lever is **income growth** (career, skills, side income, business ownership) with most increments invested — not higher-risk investing.

## Evidence from Indian data (NSE indices, 18-Nov-2016 → 18-Nov-2026, price returns)
| Index (closest philosophy) | CAGR | Volatility | Worst fall |
|---|---|---|---|
| Nifty 50 (Bogle) | 12.1% | 16% | −38% |
| Nifty50 Value 20 (Graham) | 13.3% | 15% | −31% |
| NIFTY100 Quality 30 (Buffett/Fisher) | 10.7% | 15% | −34% |
| Nifty Midcap 150 (Lynch/Jhunjhunwala) | 16.8% | 18% | −44% |
| Nifty Smallcap 250 | 14.5% | 19% | −61% |
| Nifty200 Momentum 30 | 15.7% | 19% | −34% |

Back-tested index rules over one decade; no style wins in every period. These are price indices (dividends excluded), and buying them through funds adds costs and tracking error.

## Verification
- **118 automated tests** (vitest), including independent checks: Excel's documented XIRR example (37.34%), closed-form annuity-due and compound-growth formulas, hand-computed step-up sums, DCF reducing to a perpetuity, Gordon DDM, Graham number, correlation ±1 and beta 2 on constructed series, a time-weighted drawdown that ignores new money, stress-test losses checked by hand, tax set-off and exemption, and round-trips for required SIP, required return and required savings rate.
- **Live end-to-end run** against real Upstox / AMFI / NSE data: wealth journey, 10-year index evidence, risk register, stress tests, performance vs Nifty 50, committee.
- **Browser check**: 15 page/tab combinations at desktop and phone width — no console errors, no horizontal overflow.

## Security review of the new code
- Every new endpoint sits behind sign-in and the CSRF header; inputs are validated with zod (unknown keys are stripped).
- No new outbound URL is built from user input except journal dates, which are validated `yyyy-mm-dd`; index keys are fixed constants.
- No secrets in new responses; the summary and analyst exclusions are unchanged.
- Existing items to be aware of (unchanged, documented): rate limits are in memory (reset on restart); `APP_PASSWORD` in plain text is accepted for local convenience (prefer `APP_PASSWORD_HASH`); research mode sends a portfolio summary to the Anthropic API when used; the CSP allows inline styles (needed by the chart library).

## Known limitations
- Fundamentals, valuation inputs and governance data are entered by you from primary sources — there is no free licensed fundamentals feed, so the committee can only be as good as the research entered.
- Projections use constant returns (deterministic) for the roadmap and simple independent buckets for the family-view range; real markets have streaks, correlations and fat tails.
- The tax model is an estimate (no surcharge, rebate, carry-forward, or per-year exemption use during accumulation).
- Stress scenarios are approximations, not exact historical replays; NAV history of mutual funds is not used for beta (index funds are treated as market beta 1).
- The benchmark is the Nifty 50 price index (no dividends), slightly flattering active results; total-return index data was not available from the API.
- Behaviour detection needs history: most patterns become meaningful only after months of real transactions and daily snapshots.
- International investing is evaluated as a risk category but no international data feed or LRS tracking is implemented.
