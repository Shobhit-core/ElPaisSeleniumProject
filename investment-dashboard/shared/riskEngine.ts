// Extended risk engine: position sizing, correlation/beta, time-weighted drawdown monitoring,
// stress tests and a 12-category risk register. Shocks are HYPOTHETICAL approximations of the broad
// pattern of past episodes, not exact replications.

import type { ValuedHolding } from "./types.ts";
import { dailyReturns, stdev } from "./risk.ts";

// ---------- correlation & beta ----------
export function alignReturns(a: { date: string; close: number }[], b: { date: string; close: number }[]): [number[], number[]] {
  const mb = new Map(b.map((x) => [x.date, x.close]));
  const common = a.filter((x) => mb.has(x.date));
  const ra = dailyReturns(common.map((x) => x.close));
  const rb = dailyReturns(common.map((x) => mb.get(x.date)!));
  return [ra, rb];
}

export function correlation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 20) return null;
  const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export function beta(asset: number[], market: number[]): number | null {
  const c = correlation(asset, market);
  if (c === null) return null;
  return (c * stdev(asset)) / stdev(market);
}

// ---------- position sizing ----------
export interface SizingInput {
  portfolioValue: number;
  stockSleeveAvailable: number; // room left in the plan's individual-stock allocation
  maxSingleStockPct: number;
  maxLossPerPositionPct: number; // max acceptable portfolio loss from ONE position in a severe fall, e.g. 2
  annualVolPct: number | null;
  sectorWeightPct: number; // current weight of the same sector
  maxSectorPct: number;
  maxCorrelationWithHoldings: number | null;
  avgDailyTradedValue: number | null; // ₹, for liquidity
  minTicket: number; // below this, charges make the purchase inefficient
  fundamentalScore: number | null;
}

export interface SizingResult {
  amount: number;
  limits: { rule: string; cap: number }[];
  binding: string;
  notes: string[];
}

export function positionSize(s: SizingInput): SizingResult {
  const notes: string[] = [];
  // Severe-fall assumption for a single stock: twice its annual volatility (a ~2-sigma year),
  // never less than 50% (single stocks can halve) and capped at 80%.
  const stressDrop = Math.min(80, Math.max(50, (s.annualVolPct ?? 0) * 2)) / 100;
  const limits = [
    { rule: `Single-stock limit ${s.maxSingleStockPct}% of portfolio`, cap: (s.portfolioValue * s.maxSingleStockPct) / 100 },
    { rule: `Loss budget: a ${Math.round(stressDrop * 100)}% fall may cost at most ${s.maxLossPerPositionPct}% of the portfolio`, cap: (s.portfolioValue * s.maxLossPerPositionPct) / 100 / stressDrop },
    { rule: `Sector room (limit ${s.maxSectorPct}%, now ${s.sectorWeightPct.toFixed(1)}%)`, cap: Math.max(0, ((s.maxSectorPct - s.sectorWeightPct) / 100) * s.portfolioValue) },
    { rule: "Room left in the plan's stock allocation", cap: Math.max(0, s.stockSleeveAvailable) },
  ];
  if (s.avgDailyTradedValue !== null) limits.push({ rule: "Liquidity: ≤1% of average daily traded value", cap: s.avgDailyTradedValue * 0.01 });
  let amount = Math.min(...limits.map((l) => l.cap));
  let binding = limits.find((l) => l.cap === amount)!.rule;
  if (s.maxCorrelationWithHoldings !== null && s.maxCorrelationWithHoldings > 0.7) {
    amount /= 2;
    binding = `Halved: daily returns are ${s.maxCorrelationWithHoldings.toFixed(2)} correlated with an existing holding (similar underlying risk)`;
  }
  if (s.fundamentalScore !== null && s.fundamentalScore < 60) {
    amount /= 2;
    notes.push("Halved because the fundamental score is below 60.");
  }
  if (amount < s.minTicket) {
    notes.push(`Computed size ₹${Math.round(amount).toLocaleString("en-IN")} is below the ₹${s.minTicket.toLocaleString("en-IN")} minimum where brokerage stays under ~0.5% — no position suggested.`);
    amount = 0;
  }
  return { amount: Math.floor(amount), limits, binding, notes };
}

// ---------- time-weighted drawdown monitoring ----------
export interface DrawdownStats {
  index: { date: string; value: number }[]; // time-weighted index starting at 100 (new money does not distort it)
  peak: { date: string; value: number } | null;
  current: number | null;
  currentDrawdownPct: number;
  maxDrawdownPct: number;
  maxDrawdownFrom: string | null;
  maxDrawdownTo: string | null;
  daysInDrawdown: number;
  recoveryNeededPct: number; // gain needed from here to regain the peak
}

/** snapshots: daily {date, value, invested}; new money = change in invested between snapshots. */
export function drawdownStats(snapshots: { date: string; value: number; invested: number }[]): DrawdownStats {
  const index: { date: string; value: number }[] = [];
  let idx = 100;
  for (let k = 0; k < snapshots.length; k++) {
    if (k > 0) {
      const prev = snapshots[k - 1];
      const cur = snapshots[k];
      const flow = cur.invested - prev.invested;
      if (prev.value > 0) idx *= (cur.value - flow) / prev.value;
    }
    index.push({ date: snapshots[k].date, value: idx });
  }
  let peakV = -Infinity, peakD = "", maxDd = 0, ddFrom: string | null = null, ddTo: string | null = null, runPeakD = "";
  for (const p of index) {
    if (p.value > peakV) {
      peakV = p.value;
      runPeakD = p.date;
    }
    const dd = (p.value / peakV - 1) * 100;
    if (dd < maxDd) {
      maxDd = dd;
      ddFrom = runPeakD;
      ddTo = p.date;
    }
    peakD = runPeakD;
  }
  const last = index.at(-1) ?? null;
  const curDd = last ? (last.value / peakV - 1) * 100 : 0;
  const days = last && curDd < 0 ? Math.round((Date.parse(last.date) - Date.parse(peakD)) / 86400000) : 0;
  return {
    index,
    peak: index.length ? { date: peakD, value: peakV } : null,
    current: last?.value ?? null,
    currentDrawdownPct: curDd,
    maxDrawdownPct: maxDd,
    maxDrawdownFrom: ddFrom,
    maxDrawdownTo: ddTo,
    daysInDrawdown: days,
    recoveryNeededPct: curDd < 0 ? (1 / (1 + curDd / 100) - 1) * 100 : 0,
  };
}

/** Gain needed to recover from a loss of `lossPct` (e.g. 50% loss needs +100%). */
export const recoveryNeeded = (lossPct: number) => (lossPct >= 100 ? Infinity : (1 / (1 - lossPct / 100) - 1) * 100);

// ---------- stress tests ----------
export type Segment = "stocks" | "equity_funds" | "liquid" | "short_debt" | "gilt" | "gold" | "cash" | "international";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  shocks: Record<Segment, number>; // % change
}

const S = (o: Partial<Record<Segment, number>>): Record<Segment, number> => ({ stocks: 0, equity_funds: 0, liquid: 0, short_debt: 0, gilt: 0, gold: 0, cash: 0, international: 0, ...o });

export const STRESS_SCENARIOS: Scenario[] = [
  { id: "m10", name: "Market falls 10%", description: "An ordinary correction; happens most years.", shocks: S({ stocks: -12, equity_funds: -10 }) },
  { id: "m20", name: "Market falls 20%", description: "A bear market; happens every few years.", shocks: S({ stocks: -25, equity_funds: -20, gold: 2 }) },
  { id: "m30", name: "Market falls 30%", description: "A deep bear market.", shocks: S({ stocks: -38, equity_funds: -30, gold: 4 }) },
  { id: "gfc", name: "2008-style financial crisis", description: "Indian shares fell roughly 60% peak-to-trough in 2008 (approximate); rates were later cut sharply.", shocks: S({ stocks: -65, equity_funds: -55, short_debt: 2, gilt: 6, liquid: 0.5, gold: 5, international: -40 }) },
  { id: "covid", name: "COVID-style crash (Feb–Mar 2020)", description: "Nifty fell roughly 38% in about five weeks (approximate); credit markets froze briefly.", shocks: S({ stocks: -42, equity_funds: -38, short_debt: -1, gilt: 2, gold: 3, international: -30 }) },
  { id: "rates", name: "Interest-rate shock (+2%)", description: "Rates rise 2 percentage points: bond prices fall, valuations compress.", shocks: S({ stocks: -12, equity_funds: -10, short_debt: -4, gilt: -12, liquid: -0.2, gold: -3, international: -8 }) },
  { id: "recession", name: "Recession", description: "Earnings fall; rates are cut.", shocks: S({ stocks: -35, equity_funds: -28, short_debt: 3, gilt: 7, gold: 5, international: -20 }) },
  { id: "inr", name: "Rupee falls 15%", description: "Foreign outflows hit shares; gold and foreign assets rise in rupee terms.", shocks: S({ stocks: -8, equity_funds: -6, short_debt: -1, gilt: -3, gold: 12, international: 15 }) },
];

export function segmentOf(h: Pick<ValuedHolding, "assetClass" | "name">): Segment {
  switch (h.assetClass) {
    case "EQUITY":
      return "stocks";
    case "EQUITY_ETF":
    case "EQUITY_MF":
      return /(nasdaq|s&p|us |global|international|world|fang|overseas)/i.test(h.name) ? "international" : "equity_funds";
    case "DEBT_MF":
      return /(liquid|overnight|money market)/i.test(h.name) ? "liquid" : /(gilt|long|dynamic bond|10 ?yr|constant maturity)/i.test(h.name) ? "gilt" : "short_debt";
    case "GSEC":
      return "gilt";
    case "GOLD_ETF":
      return "gold";
    case "CASH":
      return "cash";
  }
}

export interface StressResult {
  scenario: Scenario;
  lossAmount: number; // negative = loss
  lossPct: number;
  recoveryNeededPct: number;
  exceedsTolerance: boolean;
  byHolding: { symbol: string; name: string; segment: Segment; value: number; change: number }[];
  mostVulnerable: string | null;
}

/** betas: optional per-symbol beta vs Nifty to scale stock shocks (clamped 0.5–2). */
export function runStressTests(holdings: ValuedHolding[], cash: number, toleratedLossPct: number | null, betas: Map<string, number> = new Map()): StressResult[] {
  return STRESS_SCENARIOS.map((sc) => {
    const byHolding = holdings.map((h) => {
      const seg = segmentOf(h);
      const value = h.currentValue ?? h.invested;
      let shock = sc.shocks[seg];
      const b = betas.get(h.symbol);
      if (seg === "stocks" && b !== undefined) shock = sc.shocks.equity_funds * Math.min(2, Math.max(0.5, b));
      return { symbol: h.symbol, name: h.name, segment: seg, value, change: (value * shock) / 100 };
    });
    const total = holdings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0) + Math.max(cash, 0);
    const change = byHolding.reduce((s, x) => s + x.change, 0);
    const lossPct = total > 0 ? (change / total) * 100 : 0;
    const worst = [...byHolding].sort((a, b) => a.change - b.change)[0];
    return {
      scenario: sc,
      lossAmount: change,
      lossPct,
      recoveryNeededPct: lossPct < 0 ? recoveryNeeded(-lossPct) : 0,
      exceedsTolerance: toleratedLossPct !== null && -lossPct > toleratedLossPct,
      byHolding,
      mostVulnerable: worst && worst.change < 0 ? worst.symbol : null,
    };
  });
}

// ---------- risk register ----------
export type Level = "Low" | "Medium" | "High" | "Unknown";
export interface RiskItem {
  category: string;
  level: Level;
  finding: string;
  action: string;
}

export interface RegisterInput {
  holdings: ValuedHolding[];
  cash: number;
  maxSingleStockPct: number;
  maxSectorPct: number;
  topSectorPct: number;
  ownedStocksWithFlags: string[]; // governance flags / pledge from research notes
  ownedStocksWithoutResearch: string[];
  marketPe: { pe: number; medianPe: number; source: string } | null;
  rateTrend: "rising" | "falling" | "stable" | "unknown";
  brokerConnected: boolean;
  lastBackupDays: number | null;
  stalePriceCount: number;
}

export function riskRegister(r: RegisterInput): RiskItem[] {
  const val = (h: ValuedHolding) => h.currentValue ?? h.invested;
  const total = r.holdings.reduce((s, h) => s + val(h), 0) + Math.max(r.cash, 0);
  const pct = (pred: (h: ValuedHolding) => boolean) => (total > 0 ? (r.holdings.filter(pred).reduce((s, h) => s + val(h), 0) / total) * 100 : 0);
  const equity = pct((h) => ["EQUITY", "EQUITY_ETF", "EQUITY_MF"].includes(h.assetClass));
  const stocksMax = total > 0 ? Math.max(0, ...r.holdings.filter((h) => h.assetClass === "EQUITY").map((h) => (val(h) / total) * 100)) : 0;
  const durationDebt = pct((h) => ["short_debt", "gilt"].includes(segmentOf(h)));
  const gilt = pct((h) => segmentOf(h) === "gilt");
  const cashLike = pct((h) => ["liquid", "cash"].includes(segmentOf(h))) + (total > 0 ? (Math.max(r.cash, 0) / total) * 100 : 0);
  const intl = pct((h) => segmentOf(h) === "international");
  const gold = pct((h) => h.assetClass === "GOLD_ETF");
  const amc = new Map<string, number>();
  for (const h of r.holdings.filter((x) => x.symbol.startsWith("MF:"))) {
    const k = h.name.split(/\s+/)[0].toUpperCase();
    amc.set(k, (amc.get(k) ?? 0) + val(h));
  }
  const topAmc = [...amc.entries()].sort((a, b) => b[1] - a[1])[0];
  const topAmcPct = topAmc && total > 0 ? (topAmc[1] / total) * 100 : 0;
  const items: RiskItem[] = [
    { category: "Market risk", level: equity > 60 ? "High" : equity > 30 ? "Medium" : "Low", finding: `${equity.toFixed(0)}% of the portfolio is in shares.`, action: "Keep equity within the profile limit; stress-test below." },
    { category: "Company-specific risk", level: stocksMax > r.maxSingleStockPct ? "High" : stocksMax > 5 ? "Medium" : "Low", finding: stocksMax ? `Largest single stock is ${stocksMax.toFixed(1)}%.` : "No individual stocks — company risk is spread across index funds.", action: `Keep any one stock under ${r.maxSingleStockPct}%.` },
    { category: "Valuation risk", level: !r.marketPe ? "Unknown" : r.marketPe.pe > r.marketPe.medianPe * 1.15 ? "High" : r.marketPe.pe > r.marketPe.medianPe * 0.9 ? "Medium" : "Low", finding: r.marketPe ? `Market P/E ${r.marketPe.pe} vs median ${r.marketPe.medianPe} (${r.marketPe.source}).` : "Market valuation not recorded.", action: "Stage purchases when valuations are above median; never lump-sum at peaks." },
    { category: "Liquidity risk", level: pct((h) => h.assetClass === "EQUITY") > 50 ? "Medium" : "Low", finding: `${cashLike.toFixed(0)}% can be withdrawn within about one working day.`, action: "Keep the emergency fund outside this portfolio." },
    { category: "Interest-rate risk", level: gilt > 20 || (durationDebt > 30 && r.rateTrend === "rising") ? "High" : durationDebt > 15 ? "Medium" : "Low", finding: `${durationDebt.toFixed(0)}% in bond funds whose prices fall when rates rise (rate trend: ${r.rateTrend}).`, action: "Prefer short-duration/liquid funds while rates are rising." },
    { category: "Inflation risk", level: cashLike > 50 ? "High" : cashLike > 25 ? "Medium" : "Low", finding: `${cashLike.toFixed(0)}% in cash-like assets that may barely beat inflation after tax.`, action: "Long-term money needs growth assets; cash is for safety and staging." },
    { category: "Currency risk", level: intl === 0 ? "Medium" : "Low", finding: intl === 0 ? `All assets are in rupees (gold ${gold.toFixed(0)}% gives a partial hedge).` : `${intl.toFixed(0)}% international.`, action: "Consider a small international fund later, within LRS/fund limits." },
    { category: "Sector concentration", level: r.topSectorPct > r.maxSectorPct ? "High" : r.topSectorPct > r.maxSectorPct * 0.7 ? "Medium" : "Low", finding: `Largest stock sector weight: ${r.topSectorPct.toFixed(0)}%.`, action: `Keep sectors under ${r.maxSectorPct}%.` },
    { category: "Corporate governance", level: r.ownedStocksWithFlags.length ? "High" : r.ownedStocksWithoutResearch.length ? "Unknown" : "Low", finding: r.ownedStocksWithFlags.length ? `Flags recorded for: ${r.ownedStocksWithFlags.join(", ")}.` : r.ownedStocksWithoutResearch.length ? `No research note for: ${r.ownedStocksWithoutResearch.join(", ")}.` : "No governance flags recorded for owned stocks.", action: "Record promoter pledge, auditor changes and related-party issues for every stock." },
    { category: "Regulatory & tax risk", level: "Medium", finding: "Capital-gains rules changed in July 2024; plans assume today's rules continue.", action: "Re-check tax assumptions after every Union Budget." },
    { category: "Counterparty risk", level: topAmcPct > 60 ? "Medium" : "Low", finding: topAmc ? `Largest fund house: ${topAmc[0]} (${topAmcPct.toFixed(0)}%). Mutual fund assets are held by trustees/custodians, separate from the AMC's own balance sheet.` : "No fund-house concentration.", action: "Spreading across 2–3 fund houses is sensible as the portfolio grows." },
    { category: "Technology & broker integration", level: r.stalePriceCount > 0 || (r.lastBackupDays ?? 999) > 30 ? "Medium" : "Low", finding: `Broker ${r.brokerConnected ? "connected" : "not connected (data from journal)"}; ${r.stalePriceCount} stale/unpriced holdings; last backup ${r.lastBackupDays === null ? "never" : `${r.lastBackupDays} days ago`}.`, action: "Back up weekly; reconcile the journal with broker statements monthly." },
  ];
  return items;
}
