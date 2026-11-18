// Suitability gate, portfolio scenarios and HYPOTHETICAL illustrations.
// Rules are deliberately conservative and fully explained so the user can disagree with them.

import { round2 } from "./format.ts";
import type { InvestorProfile } from "./types.ts";

export type RiskLevel = "Low" | "Low-Moderate" | "Moderate" | "High" | "Very High";

export interface AllocationLine {
  key: "liquid" | "short_debt" | "nifty50" | "next50_mid" | "stocks" | "gold";
  instrument: string;
  examples: string; // how to pick a concrete instrument — the UI shows live candidates
  amount: number;
  pct: number;
  reason: string;
  risk: RiskLevel;
  horizon: string;
  liquidity: string;
  downside: string;
  assumedClass: "equity" | "debt" | "gold";
}

export interface Scenario {
  id: "conservative" | "moderate" | "growth";
  label: string;
  equityPct: number;
  cappedByProfile: boolean;
  lines: AllocationLine[];
  suitability: "suitable" | "stretch" | "not_suitable";
  suitabilityNote: string;
}

export interface Readiness {
  ready: boolean;
  blockers: string[];
  cautions: string[];
  equityCapPct: number;
  capReasons: string[];
}

/** Assumed peak-to-trough fall of a diversified Indian large-cap equity portfolio in a severe year (2008: ~-60%, 2020: ~-38%). */
export const SEVERE_EQUITY_DRAWDOWN = 40;

const HORIZON_CAP: Record<InvestorProfile["horizon"], number> = { "1-3": 30, "3-5": 60, "5-10": 80, "10+": 90 };
const LOSS_TOLERANCE_PCT: Record<InvestorProfile["lossTolerance"], number> = { "5": 5, "10": 10, "20": 20, "20+": 36 };

export function assessReadiness(p: InvestorProfile): Readiness {
  const blockers: string[] = [];
  const cautions: string[] = [];
  const capReasons: string[] = [];
  let cap = HORIZON_CAP[p.horizon];
  capReasons.push(`Horizon ${p.horizon} years → equity at most ${cap}%.`);

  const lossCap = Math.round((LOSS_TOLERANCE_PCT[p.lossTolerance] / SEVERE_EQUITY_DRAWDOWN) * 100);
  if (lossCap < cap) {
    cap = lossCap;
    capReasons.push(
      `You can tolerate a ${p.lossTolerance}% temporary fall. Equity can fall ~${SEVERE_EQUITY_DRAWDOWN}% in a severe year, so equity is capped at ${lossCap}% to keep the whole portfolio's fall near your limit.`,
    );
  }
  const riskCap = p.riskTolerance === "conservative" ? 35 : p.riskTolerance === "moderate" ? 65 : 90;
  if (riskCap < cap) {
    cap = riskCap;
    capReasons.push(`Stated risk tolerance "${p.riskTolerance}" → equity at most ${riskCap}%.`);
  }

  if (p.needWithin12Months === "yes") {
    blockers.push("You may need this money within 12 months. Money with a short deadline should not be in equities — a 20–40% fall could coincide with when you need it.");
    cap = 0;
    capReasons.push("Money needed within 12 months → no equity.");
  } else if (p.needWithin12Months === "maybe") {
    cautions.push("You might need this money within 12 months. Keep at least the amount you might need in a liquid fund.");
    cap = Math.min(cap, 50);
    capReasons.push("Possible need within 12 months → equity at most 50%.");
  }
  if (p.emergencyFund === "none") {
    blockers.push("No emergency fund. Build 6 months of expenses in a liquid fund or savings/sweep FD before investing in equities; otherwise an emergency could force you to sell at a loss.");
    cap = 0;
    capReasons.push("No emergency fund → no equity until it is built.");
  } else if (p.emergencyFund === "partial") {
    cautions.push("Emergency fund is incomplete. Consider completing it first or directing part of this capital to it.");
  }
  if (p.monthlyCapacity === 0) cautions.push("No monthly investment capacity: growth will rely entirely on the initial capital, so avoid concentrated bets.");
  return { ready: blockers.length === 0, blockers, cautions, equityCapPct: Math.max(0, cap), capReasons };
}

const BASE_EQUITY = { conservative: 30, moderate: 55, growth: 75 } as const;

function line(
  key: AllocationLine["key"],
  pct: number,
  capital: number,
  p: InvestorProfile,
): AllocationLine | null {
  if (pct <= 0) return null;
  const amount = round2((capital * pct) / 100);
  const useEtf = p.preference === "etfs";
  const defs: Record<AllocationLine["key"], Omit<AllocationLine, "amount" | "pct" | "key">> = {
    liquid: {
      instrument: "Liquid fund (direct plan)",
      examples: "Any large AMC liquid fund, direct-growth; compare expense ratio and AUM on AMFI. ETF route: a liquid ETF.",
      reason: "Capital safety and a parking place for staged equity investing.",
      risk: "Low",
      horizon: "Any (days to months)",
      liquidity: "T+1 redemption",
      downside: "Very low; credit events in underlying paper are possible but rare in liquid funds.",
      assumedClass: "debt",
    },
    short_debt: {
      instrument: "Short-duration debt or gilt fund",
      examples: "Short-duration / gilt index funds (direct). Prefer high-credit-quality portfolios.",
      reason: "Stability and modest returns above liquid funds for money held 1–3 years.",
      risk: "Low-Moderate",
      horizon: "1–3 years",
      liquidity: "T+1 to T+2",
      downside: "NAV falls when interest rates rise (RBI moved to a tightening stance in Oct-2026); taxed at slab rate.",
      assumedClass: "debt",
    },
    nifty50: {
      instrument: useEtf ? "Nifty 50 ETF" : "Nifty 50 index fund (direct)",
      examples: useEtf
        ? "Nifty 50 ETFs on NSE — check tracking error, expense ratio and traded volume (thin ETFs trade away from NAV)."
        : "Nifty 50 index funds — compare expense ratio and tracking error; all track the same index.",
      reason: "Low-cost, diversified core across India's 50 largest companies; no stock-picking risk.",
      risk: "High",
      horizon: "5+ years",
      liquidity: useEtf ? "Exchange hours, T+1 settlement" : "T+2/T+3 redemption",
      downside: "Market risk: falls of 30–60% have happened (2008, 2020). Recovery can take years.",
      assumedClass: "equity",
    },
    next50_mid: {
      instrument: "Nifty Next 50 or Nifty Midcap 150 index fund",
      examples: "Index funds/ETFs on Nifty Next 50 or Midcap 150 — only as a satellite to the Nifty 50 core.",
      reason: "Adds exposure to the next tier of companies with potentially higher growth.",
      risk: "Very High",
      horizon: "7+ years",
      liquidity: "T+2/T+3",
      downside: "More volatile than Nifty 50; mid-cap drawdowns have exceeded 50%. Valuations in this segment are often rich.",
      assumedClass: "equity",
    },
    stocks: {
      instrument: "Researched large-cap stocks (1–2 names)",
      examples: "Only stocks that pass the Research page's fundamental + valuation screen, with a written thesis.",
      reason: "Learning and targeted exposure. Kept small so a single mistake cannot damage the plan.",
      risk: "Very High",
      horizon: "3–5+ years per thesis",
      liquidity: "Exchange hours",
      downside: "Single-company risk: thesis can break; with ₹30k this sleeve holds only 1–2 stocks, i.e. high concentration.",
      assumedClass: "equity",
    },
    gold: {
      instrument: "Gold ETF / gold fund",
      examples: "Gold ETFs on NSE; check expense ratio and liquidity.",
      reason: "Diversifier that has historically held up in some equity sell-offs and rupee weakness.",
      risk: "Moderate",
      horizon: "3+ years",
      liquidity: "Exchange hours",
      downside: "Can stagnate for years; no income.",
      assumedClass: "gold",
    },
  };
  return { key, pct, amount, ...defs[key] };
}

export function buildScenarios(p: InvestorProfile, capital: number): Scenario[] {
  const r = assessReadiness(p);
  const allowStocks = p.preference !== "mutual_funds" && p.preference !== "etfs" && (p.horizon === "5-10" || p.horizon === "10+") && p.riskTolerance !== "conservative";
  const allowMid = p.horizon === "5-10" || p.horizon === "10+";

  return (["conservative", "moderate", "growth"] as const).map((id) => {
    const target = BASE_EQUITY[id];
    const equity = Math.min(target, r.equityCapPct);
    const capped = equity < target;
    let stocks = 0;
    let mid = 0;
    if (equity > 0) {
      if (allowStocks && id !== "conservative") stocks = Math.min(id === "growth" ? 20 : 10, Math.round(equity * 0.3));
      if (allowMid && id !== "conservative") mid = Math.round((equity - stocks) * (id === "growth" ? 0.3 : 0.2));
    }
    const core = equity - stocks - mid;
    const gold = equity > 0 && p.horizon !== "1-3" ? (id === "conservative" ? 5 : 10) : 0;
    const nonEquity = 100 - equity - gold;
    const liquid = r.ready ? (id === "conservative" ? Math.round(nonEquity * 0.5) : Math.round(nonEquity * 0.6)) : nonEquity;
    const shortDebt = nonEquity - liquid;

    const lines = [
      line("nifty50", core, capital, p),
      line("next50_mid", mid, capital, p),
      line("stocks", stocks, capital, p),
      line("gold", gold, capital, p),
      line("short_debt", shortDebt, capital, p),
      line("liquid", liquid, capital, p),
    ].filter((x): x is AllocationLine => x !== null);

    // Fix rounding so amounts sum exactly to capital
    const diff = round2(capital - lines.reduce((s, l) => s + l.amount, 0));
    if (lines.length && diff !== 0) lines[lines.length - 1].amount = round2(lines[lines.length - 1].amount + diff);

    const riskOrder = { conservative: 0, moderate: 1, aggressive: 2 }[p.riskTolerance];
    const scenOrder = { conservative: 0, moderate: 1, growth: 2 }[id];
    const suitability: Scenario["suitability"] = !r.ready
      ? id === "conservative" ? "suitable" : "not_suitable"
      : scenOrder <= riskOrder ? "suitable" : scenOrder === riskOrder + 1 ? "stretch" : "not_suitable";
    const suitabilityNote = !r.ready
      ? "Equity is blocked until the issues above are resolved; only capital-protection allocations apply."
      : suitability === "suitable"
        ? "Consistent with your stated risk tolerance, horizon and loss tolerance."
        : suitability === "stretch"
          ? "One step more aggressive than your stated risk tolerance — only if you are sure you will hold through a large fall."
          : "More aggressive than your profile supports.";

    return {
      id,
      label: { conservative: "Conservative", moderate: "Moderate", growth: "Growth-oriented" }[id],
      equityPct: equity,
      cappedByProfile: capped,
      lines,
      suitability,
      suitabilityNote,
    };
  });
}

// ---------------- Hypothetical illustrations ----------------

export interface ReturnAssumptions {
  label: string;
  equity: number;
  debt: number;
  gold: number;
}

/** HYPOTHETICAL annual return assumptions (nominal, pre-tax). Not forecasts. */
export const ASSUMPTION_SETS: ReturnAssumptions[] = [
  { label: "Conservative (hypothetical)", equity: 6, debt: 5.5, gold: 3 },
  { label: "Moderate (hypothetical)", equity: 10, debt: 6.5, gold: 6 },
  { label: "Optimistic (hypothetical)", equity: 13, debt: 7.5, gold: 9 },
];

export function blendedReturn(lines: AllocationLine[], a: ReturnAssumptions): number {
  const total = lines.reduce((s, l) => s + l.pct, 0) || 1;
  return lines.reduce((s, l) => s + (l.pct / total) * a[l.assumedClass], 0);
}

/** Future value of a lump sum plus a monthly contribution at a constant annual rate (monthly compounding). */
export function futureValue(lumpSum: number, monthly: number, annualPct: number, years: number): number {
  const i = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  const n = Math.round(years * 12);
  const fvLump = lumpSum * Math.pow(1 + i, n);
  const fvSip = i === 0 ? monthly * n : monthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
  return round2(fvLump + fvSip);
}

export function stressLoss(lines: AllocationLine[], equityFallPct = SEVERE_EQUITY_DRAWDOWN): number {
  return round2(lines.filter((l) => l.assumedClass === "equity").reduce((s, l) => s + l.amount * (equityFallPct / 100), 0));
}

/**
 * Lump sum vs staggered deployment over hypothetical price paths. Shows units accumulated and
 * value at the end of the path — demonstrates that neither method wins in every market.
 */
export function compareDeployment(amount: number, tranches: number): {
  path: string;
  prices: number[];
  lumpSumValue: number;
  staggeredValue: number;
}[] {
  const paths: Record<string, number[]> = {
    "Rising market": [100, 104, 108, 112, 116, 120],
    "Falling then flat": [100, 90, 82, 80, 80, 80],
    "Dip then recovery": [100, 85, 78, 88, 98, 105],
  };
  const n = Math.max(1, Math.min(tranches, 6));
  return Object.entries(paths).map(([path, prices]) => {
    const end = prices[prices.length - 1];
    const lumpUnits = amount / prices[0];
    const per = amount / n;
    const stagUnits = prices.slice(0, n).reduce((s, p) => s + per / p, 0);
    return { path, prices, lumpSumValue: round2(lumpUnits * end), staggeredValue: round2(stagUnits * end) };
  });
}
