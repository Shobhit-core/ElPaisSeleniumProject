import { describe, expect, it } from "vitest";
import { assessReadiness, buildScenarios, compareDeployment, futureValue, stressLoss, blendedReturn, ASSUMPTION_SETS } from "../shared/allocation.ts";
import { annualisedVolatility, buildRiskReport, maxDrawdown, simulatedPortfolioSeries } from "../shared/risk.ts";
import { compositeRank, fundamentalScore, riskScore, valuation } from "../shared/scoring.ts";
import { announcementAlerts, matchesCompany, normaliseCompany, priceMoveAlerts, researchAlerts } from "../shared/alerts.ts";
import { DEFAULT_THRESHOLDS } from "../shared/risk.ts";
import type { InvestorProfile, ValuedHolding } from "../shared/types.ts";

const profile = (p: Partial<InvestorProfile> = {}): InvestorProfile => ({
  horizon: "10+",
  riskTolerance: "moderate",
  emergencyFund: "full",
  needWithin12Months: "no",
  monthlyCapacity: 5000,
  preference: "combination",
  lossTolerance: "20",
  taxSlabPct: 20,
  capital: 30000,
  completedAt: "2026-11-18",
  ...p,
});

describe("Suitability & allocation", () => {
  it("blocks equity when money is needed within 12 months or no emergency fund", () => {
    for (const p of [profile({ needWithin12Months: "yes" }), profile({ emergencyFund: "none" })]) {
      const r = assessReadiness(p);
      expect(r.ready).toBe(false);
      expect(r.equityCapPct).toBe(0);
      for (const s of buildScenarios(p, 30000)) {
        expect(s.equityPct).toBe(0);
        expect(s.lines.every((l) => l.assumedClass !== "equity")).toBe(true);
      }
    }
  });
  it("caps equity by loss tolerance (20% tolerance / 40% severe fall = 50%)", () => {
    expect(assessReadiness(profile({ riskTolerance: "aggressive" })).equityCapPct).toBe(50);
    expect(assessReadiness(profile({ lossTolerance: "5" })).equityCapPct).toBe(13);
  });
  it("scenario amounts sum exactly to capital and percentages to 100", () => {
    for (const p of [profile(), profile({ riskTolerance: "aggressive", lossTolerance: "20+" }), profile({ horizon: "1-3" })]) {
      for (const s of buildScenarios(p, 30000)) {
        expect(s.lines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(30000, 2);
        expect(s.lines.reduce((a, l) => a + l.pct, 0)).toBe(100);
        expect(s.lines.every((l) => l.amount > 0)).toBe(true);
      }
    }
  });
  it("excludes individual stocks for mutual-fund-only preference and short horizons", () => {
    expect(buildScenarios(profile({ preference: "mutual_funds", riskTolerance: "aggressive", lossTolerance: "20+" }), 30000).flatMap((s) => s.lines).some((l) => l.key === "stocks")).toBe(false);
    expect(buildScenarios(profile({ horizon: "3-5", riskTolerance: "aggressive" }), 30000).flatMap((s) => s.lines).some((l) => l.key === "stocks")).toBe(false);
  });
  it("marks scenarios more aggressive than the profile", () => {
    const s = buildScenarios(profile({ riskTolerance: "conservative" }), 30000);
    expect(s.map((x) => x.suitability)).toEqual(["suitable", "stretch", "not_suitable"]);
  });
  it("computes future value and stress loss", () => {
    expect(futureValue(10000, 0, 0, 5)).toBe(10000);
    expect(futureValue(0, 1000, 0, 1)).toBe(12000);
    expect(futureValue(10000, 0, 10, 1)).toBeCloseTo(11000, 0);
    const [, mod] = buildScenarios(profile(), 30000);
    const eq = mod.lines.filter((l) => l.assumedClass === "equity").reduce((s, l) => s + l.amount, 0);
    expect(stressLoss(mod.lines)).toBeCloseTo(eq * 0.4, 2);
    const b = blendedReturn(mod.lines, ASSUMPTION_SETS[1]);
    expect(b).toBeGreaterThan(6.5);
    expect(b).toBeLessThan(10);
  });
  it("illustrates that staggering helps in falling markets and lags in rising ones", () => {
    const r = compareDeployment(30000, 3);
    const rising = r.find((x) => x.path === "Rising market")!;
    const falling = r.find((x) => x.path === "Falling then flat")!;
    expect(rising.lumpSumValue).toBeGreaterThan(rising.staggeredValue);
    expect(falling.staggeredValue).toBeGreaterThan(falling.lumpSumValue);
  });
});

const vh = (p: Partial<ValuedHolding>): ValuedHolding => ({
  symbol: "S", name: "S", assetClass: "EQUITY", sector: "IT", quantity: 1, avgPrice: 100, invested: 100, lots: [], firstBuyDate: "2026-01-01",
  price: 100, priceAsOf: null, priceSource: null, currentValue: 100, unrealisedPnl: 0, returnPct: 0, dayChange: 0, weight: null, ...p,
});

describe("Risk analytics", () => {
  it("volatility and drawdown", () => {
    expect(annualisedVolatility([1, 2, 3])).toBeNull();
    const flat = Array.from({ length: 30 }, () => 100);
    expect(annualisedVolatility(flat)).toBe(0);
    expect(maxDrawdown([100, 120, 90, 130, 117]).pct).toBeCloseTo(-25);
    expect(maxDrawdown([1, 2, 3]).pct).toBe(0);
  });
  it("simulates current-holdings series only on common dates", () => {
    const s = simulatedPortfolioSeries(
      [{ symbol: "A", quantity: 2 }, { symbol: "B", quantity: 1 }],
      new Map([
        ["A", [{ date: "d1", close: 10 }, { date: "d2", close: 11 }]],
        ["B", [{ date: "d2", close: 5 }]],
      ]),
    );
    expect(s).toEqual([{ date: "d2", value: 27 }]);
  });
  it("flags single-stock and sector concentration but not index funds", () => {
    const r = buildRiskReport(
      [
        vh({ symbol: "TCS", currentValue: 6000, sector: "IT" }),
        vh({ symbol: "INFY", currentValue: 2000, sector: "IT" }),
        vh({ symbol: "NIFTYBEES", assetClass: "EQUITY_ETF", currentValue: 12000, sector: null }),
      ],
      0,
      profile(),
    );
    expect(r.warnings.some((w) => w.title.startsWith("TCS"))).toBe(true);
    expect(r.warnings.some((w) => w.title.includes("NIFTYBEES"))).toBe(false);
    expect(r.warnings.some((w) => w.title.startsWith("IT sector"))).toBe(true);
    expect(r.equityPct).toBeCloseTo(100);
  });
  it("flags horizon mismatch when equity exceeds the profile cap", () => {
    const r = buildRiskReport([vh({ currentValue: 10000, assetClass: "EQUITY_MF" })], 0, profile({ needWithin12Months: "yes" }));
    expect(r.warnings.some((w) => w.severity === "critical" && /profile limit/.test(w.title))).toBe(true);
  });
});

describe("Scoring", () => {
  const m = (value: number) => ({ value, source: "AR FY26", asOf: "FY26" });
  it("withholds the score when data confidence is below 50%", () => {
    const s = fundamentalScore({ roe: m(25) });
    expect(s.score).toBeNull();
    expect(s.confidence).toBeLessThan(50);
  });
  it("scores a complete strong profile highly and is deterministic", () => {
    const f = {
      revenueCagr3y: m(16), profitCagr3y: m(18), epsCagr3y: m(18), roe: m(24), roce: m(30), operatingMargin: m(26),
      debtToEquity: m(0.05), fcfPositiveYears5: m(5), promoterPledge: m(0), promoterHolding: m(55), governanceFlags: m(0), dividendYears5: m(5),
      pe: m(27), sectorPe: m(30),
    };
    const s = fundamentalScore(f);
    expect(s.confidence).toBe(100);
    expect(s.score).toBe(100);
    const v = valuation(f);
    expect(v.peLabel).toBe("in line");
    expect(v.peg).toBeCloseTo(1.5);
    expect(v.score).toBe(60);
    expect(compositeRank(s, v)).toBe(84);
  });
  it("does not rank without valuation data and handles negative growth", () => {
    const f = { revenueCagr3y: m(-2), profitCagr3y: m(-5), epsCagr3y: m(-5), roe: m(5), roce: m(6), operatingMargin: m(3), debtToEquity: m(3), fcfPositiveYears5: m(1), promoterPledge: m(30), promoterHolding: m(40), governanceFlags: m(2), dividendYears5: m(0) };
    const s = fundamentalScore(f);
    expect(s.score).toBeLessThan(25);
    expect(compositeRank(s, valuation(f))).toBeNull();
    expect(valuation({ ...f, pe: m(20) }).peg).toBeNull();
    expect(riskScore(f, 45, valuation(f)).score).toBeGreaterThan(80);
  });
});

describe("Alerts", () => {
  it("ignores normal moves and explains large ones relative to volatility", () => {
    const small = priceMoveAlerts([vh({ quantity: 10, price: 101, dayChange: 10 })], new Map([["S", 1.5]]), DEFAULT_THRESHOLDS, "2026-11-18");
    expect(small).toHaveLength(0);
    const big = priceMoveAlerts([vh({ quantity: 10, price: 90, dayChange: -100 })], new Map([["S", 1.5]]), DEFAULT_THRESHOLDS, "2026-11-18");
    expect(big).toHaveLength(1);
    expect(big[0].why).toMatch(/6\.7× its typical daily move/);
  });
  it("matches filer names precisely (no first-word false positives)", () => {
    expect(matchesCompany("HDFC Bank Limited", "HDFC Bank")).toBe(true);
    expect(matchesCompany("HDFC Mutual Fund - HDFC NIFTY 50 ETF", "HDFC Bank")).toBe(false);
    expect(matchesCompany("Nippon India ETF Nifty 50 BeES", "Nippon Nifty 50 ETF")).toBe(false);
    expect(matchesCompany("Tata Consultancy Services Limited", "TATA CONSULTANCY SERVICES LTD")).toBe(true);
  });
  it("matches exchange announcements to tracked companies and flags negatives", () => {
    expect(normaliseCompany("Tata Consultancy Services Limited")).toBe("tata consultancy services");
    const a = announcementAlerts(
      [
        { company: "Tata Consultancy Services Limited", subject: "Resignation of Statutory Auditor", link: "l1", published: "" },
        { company: "Some Other Ltd", subject: "Financial Results", link: "l2", published: "" },
        { company: "Infosys Limited", subject: "Trading Window", link: "l3", published: "" },
      ],
      [
        { symbol: "TCS", name: "TATA CONSULTANCY SERV LT", owned: true },
        { symbol: "TCS", name: "Tata Consultancy Services Ltd", owned: true },
        { symbol: "INFY", name: "Infosys Ltd", owned: false },
      ],
    );
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("critical");
    // Routine filings for owned stocks are ignored; material corporate actions are not
    const owned = [{ symbol: "HDFCBANK", name: "HDFC Bank Limited", owned: true }];
    expect(announcementAlerts([{ company: "HDFC Bank Limited", subject: "Confirmation of Redemption/Payment of Interest and Principal", link: "x", published: "" }], owned)).toHaveLength(0);
    expect(announcementAlerts([{ company: "HDFC Bank Limited", subject: "Corporate Action-Board approves Dividend", link: "y", published: "" }], owned)[0].kind).toBe("corporate_action");
  });
  it("raises target-valuation and review alerts", () => {
    const note: any = { symbol: "HDFCBANK", targetPrice: 900, reviewBy: "2026-11-01", status: "watchlist", invalidation: "NIM < 3%" };
    const r = researchAlerts([note], new Map([["HDFCBANK", 880]]), "2026-11-18");
    expect(r.map((x) => x.kind).sort()).toEqual(["target_valuation", "thesis_review"]);
  });
});
