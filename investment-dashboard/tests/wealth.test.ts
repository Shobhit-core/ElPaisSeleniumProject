// Independent checks: every expected value below is derived by hand or from a closed-form formula,
// not from the implementation under test.
import { describe, expect, it } from "vitest";
import { afterTax, incomeModel, milestoneTable, monthsToTarget, netWorth, projectPlan, realValue, requiredMonthly, requiredReturn, requiredSavingsRate, DEFAULT_WEALTH_ASSUMPTIONS, finalValue, CRORE, LAKH, MILESTONES } from "../shared/wealth.ts";
import { dcfValue, intrinsicSummary, valueMethods, scenarioValues } from "../shared/valuation.ts";
import { beta, correlation, drawdownStats, positionSize, recoveryNeeded, runStressTests, riskRegister, segmentOf } from "../shared/riskEngine.ts";
import { benchmarkReplica, cagr, closeOn, indexEvidence, returnStats, rollingReturns } from "../shared/performance.ts";
import { analyseBehaviour } from "../shared/behaviour.ts";
import { runCommittee } from "../shared/committee.ts";
import { fundamentalScore, valuation } from "../shared/scoring.ts";
import { xirr } from "../shared/portfolio.ts";

describe("Wealth projection maths", () => {
  it("zero return, step-up: contributions add exactly (100/month, +10% in year 2)", () => {
    const p = projectPlan({ initial: 0, monthly: 100, stepUpPct: 10, years: 2, grossReturnPct: 0, costDragPct: 0 });
    expect(p[1].contributed).toBeCloseTo(1200, 6);
    expect(p[2].contributed).toBeCloseTo(1200 + 1320, 6);
    expect(p[2].value).toBeCloseTo(2520, 6);
    expect(p[2].monthlyContribution).toBeCloseTo(110, 6);
  });
  it("lump sum compounds annually exactly: 30,000 at 10% for 30 years", () => {
    expect(finalValue({ initial: 30000, monthly: 0, stepUpPct: 0, years: 30, grossReturnPct: 10, costDragPct: 0 })).toBeCloseTo(30000 * Math.pow(1.1, 30), 2);
  });
  it("level SIP matches the annuity-due closed form", () => {
    const i = Math.pow(1.12, 1 / 12) - 1;
    const n = 240;
    const closed = 10000 * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
    expect(finalValue({ initial: 0, monthly: 10000, stepUpPct: 0, years: 20, grossReturnPct: 12, costDragPct: 0 })).toBeCloseTo(closed, 2);
  });
  it("cost drag reduces the effective rate (12% gross, 0.5% cost = 11.5% net)", () => {
    expect(finalValue({ initial: 1, monthly: 0, stepUpPct: 0, years: 10, grossReturnPct: 12, costDragPct: 0.5 })).toBeCloseTo(Math.pow(1.115, 10), 8);
  });
  it("required monthly SIP round-trips to the target", () => {
    const base = { initial: 30000, stepUpPct: 10, years: 30, grossReturnPct: 10, costDragPct: 0.5 };
    const m = requiredMonthly(100 * CRORE, base);
    expect(finalValue({ ...base, monthly: m })).toBeCloseTo(100 * CRORE, -2);
    expect(requiredMonthly(1000, { ...base, initial: 5000 })).toBe(0);
  });
  it("months-to-target is the first month crossing the target", () => {
    const p = { initial: 30000, monthly: 10000, stepUpPct: 0, grossReturnPct: 0, costDragPct: 0 };
    // zero return: 30,000 + 10,000×m ≥ 1,00,000 → m = 7
    expect(monthsToTarget(1 * LAKH, p)).toBe(7);
    expect(monthsToTarget(10, p)).toBe(0);
    expect(monthsToTarget(100 * CRORE, p, 10)).toBeNull();
  });
  it("required return round-trips; inflation and tax are applied correctly", () => {
    const p = { initial: 30000, monthly: 10000, stepUpPct: 10, years: 30, costDragPct: 0.5 };
    const r = requiredReturn(100 * CRORE, p)!;
    expect(finalValue({ ...p, grossReturnPct: r })).toBeGreaterThanOrEqual(100 * CRORE - 1);
    expect(realValue(100, 5, 10)).toBeCloseTo(100 / Math.pow(1.05, 10), 10);
    // gain 6,00,000 − exemption 1,25,000 = 4,75,000 × 12.5% = 59,375
    expect(afterTax(10 * LAKH, 4 * LAKH, DEFAULT_WEALTH_ASSUMPTIONS)).toBe(10 * LAKH - 59375);
    expect(afterTax(100, 200, DEFAULT_WEALTH_ASSUMPTIONS)).toBe(100);
  });
  it("milestone table covers ₹1 lakh → ₹100 crore and marks reached ones", () => {
    const t = milestoneTable(2 * LAKH, { initial: 2 * LAKH, monthly: 10000, stepUpPct: 10, years: 30, costDragPct: 0.5 }, DEFAULT_WEALTH_ASSUMPTIONS);
    expect(t.map((x) => x.amount)).toEqual(MILESTONES);
    expect(t[0].reached).toBe(true);
    expect(t[0].monthsByScenario.base).toBe(0);
    expect(t[1].pctComplete).toBeCloseTo(40, 6);
    const last = t.at(-1)!;
    expect(last.monthsByScenario.optimistic! <= last.monthsByScenario.base!).toBe(true);
    expect(last.shortfallAtTarget).toBeGreaterThan(0);
  });
  it("income model: zero return sums contributions; decomposition adds up", () => {
    const m = incomeModel({ annualIncome: 12 * LAKH, incomeGrowthPct: 0, savingsRatePct: 10, sideIncomeMonthly: 1000, sideIncomeGrowthPct: 0, initial: 30000, years: 2, grossReturnPct: 0, costDragPct: 0 });
    expect(m.totals.final).toBeCloseTo(30000 + 2 * (1.2 * LAKH + 12000), 6);
    expect(m.totals.growth).toBeCloseTo(0, 6);
    const g = incomeModel({ annualIncome: 12 * LAKH, incomeGrowthPct: 8, savingsRatePct: 20, sideIncomeMonthly: 5000, sideIncomeGrowthPct: 10, initial: 30000, years: 20, grossReturnPct: 10, costDragPct: 0.5 });
    expect(g.totals.initial + g.totals.fromSalary + g.totals.fromSide + g.totals.growth).toBeCloseTo(g.totals.final, 4);
    const rate = requiredSavingsRate(5 * CRORE, { annualIncome: 12 * LAKH, incomeGrowthPct: 8, sideIncomeMonthly: 0, sideIncomeGrowthPct: 0, initial: 30000, years: 25, grossReturnPct: 10, costDragPct: 0.5 })!;
    expect(incomeModel({ annualIncome: 12 * LAKH, incomeGrowthPct: 8, savingsRatePct: rate, sideIncomeMonthly: 0, sideIncomeGrowthPct: 0, initial: 30000, years: 25, grossReturnPct: 10, costDragPct: 0.5 }).totals.final).toBeGreaterThanOrEqual(5 * CRORE - 1);
  });
  it("net worth keeps the emergency fund out of investable assets", () => {
    const n = netWorth({ investments: 30000, emergencyFund: 2 * LAKH, retirementAccounts: 50000, otherInvestments: 0, businessValue: 0, property: 0, liabilities: 1 * LAKH });
    expect(n.investable).toBe(80000);
    expect(n.netWorth).toBe(30000 + 2 * LAKH + 50000 - LAKH);
  });
});

describe("Valuation methods", () => {
  it("DCF with zero growth equals a perpetuity", () => {
    // g = gT = 0, r = 10%: value = FCF / r = 10 / 0.10 = 100
    expect(dcfValue(10, 0, 0, 10)).toBeCloseTo(100, 6);
    expect(dcfValue(-1, 5, 3, 10)).toBeNull();
    expect(dcfValue(10, 5, 10, 10)).toBeNull();
  });
  it("DDM, multiples, book and Graham number", () => {
    const m = valueMethods({ eps: 50, bookValuePerShare: 200, dividendPerShare: 10 }, { fairPE: 20, peerMedianPE: 25, fairPB: 2, dividendGrowthPct: 5, discountRatePct: 12 });
    const by = Object.fromEntries(m.map((x) => [x.method, x.value]));
    expect(by["Earnings multiple (own history)"]).toBe(1000);
    expect(by["Comparable companies"]).toBe(1250);
    expect(by["Asset-based (book value)"]).toBe(400);
    expect(by["Dividend discount"]).toBeCloseTo((10 * 1.05) / 0.07, 6);
    expect(by["Graham number"]).toBeCloseTo(Math.sqrt(22.5 * 50 * 200), 6);
    expect(by["Discounted cash flow"]).toBeNull();
    for (const x of m) expect(x.limitation.length).toBeGreaterThan(20);
  });
  it("refuses to state an intrinsic value with fewer than two methods", () => {
    const s = intrinsicSummary({ eps: 50 }, { fairPE: 20 }, 900);
    expect(s.confidence).toBe("insufficient");
    expect(s.median).toBeNull();
    expect(s.marginOfSafetyPct).toBeNull();
  });
  it("computes margin of safety and flags disagreement", () => {
    const s = intrinsicSummary({ eps: 50 }, { fairPE: 20, peerMedianPE: 24 }, 880);
    expect(s.median).toBe(1100);
    expect(s.marginOfSafetyPct).toBeCloseTo(20, 6);
    expect(s.buyBelowFor(25)).toBe(825);
    const wide = intrinsicSummary({ eps: 50, bookValuePerShare: 100 }, { fairPE: 30, fairPB: 1 }, 500);
    expect(wide.confidence).toBe("low");
  });
  it("bear < base < bull", () => {
    const s = scenarioValues({ fcfPerShare: 20 }, { growthPct: 12, terminalGrowthPct: 5, discountRatePct: 12 });
    expect(s.bear!).toBeLessThan(s.base!);
    expect(s.base!).toBeLessThan(s.bull!);
  });
});

describe("Risk engine", () => {
  it("correlation and beta on constructed series", () => {
    const x = Array.from({ length: 50 }, (_, i) => Math.sin(i) / 100);
    expect(correlation(x, x)).toBeCloseTo(1, 10);
    expect(correlation(x, x.map((v) => -v))).toBeCloseTo(-1, 10);
    expect(beta(x.map((v) => 2 * v), x)).toBeCloseTo(2, 10);
    expect(correlation([1, 2], [1, 2])).toBeNull();
  });
  it("position size takes the tightest limit and refuses tiny tickets", () => {
    const base = { portfolioValue: 10 * LAKH, stockSleeveAvailable: 2 * LAKH, maxSingleStockPct: 10, maxLossPerPositionPct: 2, annualVolPct: 25, sectorWeightPct: 0, maxSectorPct: 35, maxCorrelationWithHoldings: null, avgDailyTradedValue: null, minTicket: 5000, fundamentalScore: 80 };
    const r = positionSize(base);
    // loss budget: 2% of 10L = 20,000 ÷ max(50%, 2×25%) = 40,000 (tighter than 10% cap = 1,00,000)
    expect(r.amount).toBe(40000);
    expect(r.binding).toMatch(/Loss budget/);
    expect(positionSize({ ...base, maxCorrelationWithHoldings: 0.85 }).amount).toBe(20000);
    // high volatility: 2×45% = 90% → capped at 80% → 20,000 ÷ 0.8 = 25,000
    expect(positionSize({ ...base, annualVolPct: 45 }).amount).toBe(25000);
    expect(positionSize({ ...base, portfolioValue: 30000, stockSleeveAvailable: 3000 }).amount).toBe(0);
  });
  it("time-weighted drawdown ignores new money", () => {
    // value doubles only because money was added → no gain, no drawdown
    const s = drawdownStats([
      { date: "2026-01-01", value: 100, invested: 100 },
      { date: "2026-01-02", value: 200, invested: 200 },
      { date: "2026-01-03", value: 160, invested: 200 },
    ]);
    expect(s.index[1].value).toBeCloseTo(100, 10);
    expect(s.currentDrawdownPct).toBeCloseTo(-20, 10);
    expect(s.recoveryNeededPct).toBeCloseTo(25, 10);
    expect(s.daysInDrawdown).toBe(2);
    expect(recoveryNeeded(50)).toBeCloseTo(100, 10);
  });
  it("stress tests: losses, most vulnerable holding and tolerance flag", () => {
    const h = (symbol: string, assetClass: any, name: string, value: number) => ({ symbol, name, assetClass, sector: null, quantity: 1, avgPrice: value, invested: value, lots: [], firstBuyDate: "2026-01-01", price: value, priceAsOf: null, priceSource: null, currentValue: value, unrealisedPnl: 0, returnPct: 0, dayChange: 0, weight: null });
    const holdings = [h("MF:1", "EQUITY_MF", "UTI Nifty 50 Index Fund", 15000), h("MF:2", "DEBT_MF", "Axis Liquid Fund", 10000), h("MF:3", "DEBT_MF", "DSP Short Term Fund", 5000)];
    expect(segmentOf(holdings[1])).toBe("liquid");
    expect(segmentOf(holdings[2])).toBe("short_debt");
    const r = runStressTests(holdings, 0, 20);
    const m20 = r.find((x) => x.scenario.id === "m20")!;
    expect(m20.lossAmount).toBeCloseTo(-3000, 6);
    expect(m20.lossPct).toBeCloseTo(-10, 6);
    expect(m20.mostVulnerable).toBe("MF:1");
    const gfc = r.find((x) => x.scenario.id === "gfc")!;
    // −55% × 15,000 + 0.5% × 10,000 + 2% × 5,000 = −8,250 + 50 + 100 = −8,100 → −27% > 20% tolerance
    expect(gfc.lossAmount).toBeCloseTo(-8100, 6);
    expect(gfc.exceedsTolerance).toBe(true);
    const reg = riskRegister({ holdings, cash: 0, maxSingleStockPct: 20, maxSectorPct: 35, topSectorPct: 0, ownedStocksWithFlags: [], ownedStocksWithoutResearch: [], marketPe: null, rateTrend: "rising", brokerConnected: false, lastBackupDays: null, stalePriceCount: 0 });
    expect(reg).toHaveLength(12);
    expect(reg.find((x) => x.category === "Valuation risk")!.level).toBe("Unknown");
  });
});

describe("Performance accountability", () => {
  it("CAGR and closeOn", () => {
    expect(cagr(100, 200, 10)).toBeCloseTo((Math.pow(2, 0.1) - 1) * 100, 10);
    const s = [{ date: "2026-01-01", close: 10 }, { date: "2026-01-05", close: 12 }];
    expect(closeOn(s, "2026-01-03")).toBe(10);
    expect(closeOn(s, "2025-12-31")).toBeNull();
  });
  it("benchmark replica: same flows into a doubling index → value doubles", () => {
    const series = [{ date: "2025-01-01", close: 100 }, { date: "2026-01-01", close: 200 }];
    const r = benchmarkReplica([{ date: "2025-01-01", amount: -1000 }], series, "2026-01-01")!;
    expect(r.value).toBeCloseTo(2000, 6);
    expect(r.xirrPct!).toBeCloseTo(100, 0);
  });
  it("does not annualise returns under one year", () => {
    const short = returnStats([{ date: "2026-11-18", amount: -5000 }], 4969, "2026-11-18");
    expect(short.xirrPct).toBeNull();
    expect(short.absolutePct).toBeCloseTo(-0.62, 2);
    const long = returnStats([{ date: "2025-01-01", amount: -1000 }], 1100, "2026-01-01");
    expect(long.annualised).toBe(true);
    expect(long.xirrPct!).toBeCloseTo(10, 1);
    const withSale = returnStats([{ date: "2026-01-01", amount: -1000 }, { date: "2026-03-01", amount: 300 }], 800, "2026-06-01");
    expect(withSale.absolutePct).toBeCloseTo(10, 6);
  });
  it("matches Excel's documented XIRR example (37.34%)", () => {
    expect(xirr([{ date: "2008-01-01", amount: -10000 }, { date: "2008-03-01", amount: 2750 }, { date: "2008-10-30", amount: 4250 }, { date: "2009-02-15", amount: 3250 }, { date: "2009-04-01", amount: 2750 }])!).toBeCloseTo(37.34, 2);
  });
  it("rolling returns and index evidence on a synthetic 10%/yr series", () => {
    const series: { date: string; close: number }[] = [];
    for (let d = 0; d <= 365 * 5; d++) series.push({ date: new Date(Date.UTC(2020, 0, 1) + d * 86400000).toISOString().slice(0, 10), close: 100 * Math.pow(1.1, d / 365) });
    const roll = rollingReturns(series, 365);
    expect(roll[0].returnPct).toBeCloseTo(10, 1);
    const ev = indexEvidence(series)!;
    expect(ev.cagrPct!).toBeCloseTo(10, 1);
    expect(ev.maxDrawdownPct).toBe(0);
    expect(ev.rolling3yPositivePct).toBe(100);
  });
});

describe("Behaviour analysis", () => {
  it("detects short-term trading, costly orders and unresearched stock buys", () => {
    const t = (o: any) => ({ id: 1, name: o.symbol, sector: null, stt: 0, rationale: "x", exitRationale: null, lessons: null, source: "manual", createdAt: "", brokerage: 0, otherCharges: 0, ...o });
    const f = analyseBehaviour({
      txns: [t({ date: "2026-01-01", type: "BUY", symbol: "ABC", assetClass: "EQUITY", quantity: 1, price: 500, brokerage: 20 }), t({ date: "2026-02-01", type: "SELL", symbol: "ABC", assetClass: "EQUITY", quantity: 1, price: 550 })],
      realised: [{ symbol: "ABC", name: "ABC", assetClass: "EQUITY", buyDate: "2026-01-01", sellDate: "2026-02-01", quantity: 1, costOfAcquisition: 520, saleConsideration: 550, gain: 30, holdingDays: 31 }],
      holdings: [],
      researched: new Set(),
      maxSingleStockPct: 20,
    });
    const p = f.map((x) => x.pattern);
    expect(p).toContain("Short-term trading");
    expect(p).toContain("High-cost small orders");
    expect(p).toContain("Buying stocks without a research note");
  });
});

describe("Investment committee", () => {
  const m = (value: number) => ({ value, source: "AR FY26", asOf: "FY26" });
  const strong = { revenueCagr3y: m(14), profitCagr3y: m(16), epsCagr3y: m(16), roe: m(22), roce: m(28), operatingMargin: m(24), debtToEquity: m(0.1), fcfPositiveYears5: m(5), promoterPledge: m(0), promoterHolding: m(55), governanceFlags: m(0), dividendYears5: m(5), pe: m(20), sectorPe: m(26) };
  const base = (over: any = {}) => {
    const f = over.fundamentals ?? strong;
    const price = over.price ?? 700;
    return runCommittee({
      symbol: "XYZ", price, fundamentals: f, score: fundamentalScore(f), relValuation: valuation(f),
      intrinsic: intrinsicSummary({ eps: 50 }, { fairPE: 20, peerMedianPE: 22 }, price),
      scenarios: { bear: 700, base: 1050, bull: 1250, basis: "test" },
      riskScore: 25, volatilityPct: 22, maxDrawdown1yPct: -18,
      sizing: { amount: 20000, limits: [], binding: "Loss budget", notes: [] },
      readinessOk: true, marketFromHighPct: -4, rateTrend: "stable", sector: "IT",
      thesis: "Durable franchise", invalidation: "ROE < 15%", growthDrivers: "Exports", risks: "Currency", requiredMarginOfSafetyPct: 25, ...over,
    });
  };
  it("approves only when every bar is cleared", () => {
    const ok = base();
    expect(ok.decision).toBe("ELIGIBLE FOR STAGED PURCHASE");
    expect(ok.maxAmount).toBe(20000);
    expect(ok.members.find((x) => x.member.startsWith("Skeptical"))!.reasons.length).toBeGreaterThan(0);
  });
  it("says NO INVESTMENT RECOMMENDATION when evidence is insufficient or risky", () => {
    expect(base({ fundamentals: { roe: m(30) } }).decision).toBe("NO INVESTMENT RECOMMENDATION");
    expect(base({ thesis: "", invalidation: "", risks: "" }).decision).toBe("NO INVESTMENT RECOMMENDATION");
    expect(base({ readinessOk: false }).decision).toBe("NO INVESTMENT RECOMMENDATION");
    expect(base({ fundamentals: { ...strong, promoterPledge: m(25) } }).decision).toBe("NO INVESTMENT RECOMMENDATION");
  });
  it("puts a good business at a high price on the watchlist with a buy-below level", () => {
    const r = base({ price: 1000 });
    expect(r.decision).toBe("WATCHLIST — PRICE TOO HIGH");
    expect(r.buyBelow).toBeCloseTo(787.5, 6);
  });
});
