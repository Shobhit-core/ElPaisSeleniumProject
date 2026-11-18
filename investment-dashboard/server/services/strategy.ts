// Strategy services for the ₹100 crore expansion: wealth journey, extended risk engine, performance
// accountability, evidence from Indian index data, investment committee, behaviour reviews, year-end review.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DB } from "../db.ts";
import { getSetting, setSetting } from "../db.ts";
import * as W from "../../shared/wealth.ts";
import { assessReadiness, buildScenarios } from "../../shared/allocation.ts";
import { buildRiskReport, DEFAULT_THRESHOLDS, annualisedVolatility, maxDrawdown, type RiskThresholds } from "../../shared/risk.ts";
import { alignReturns, beta, correlation, drawdownStats, positionSize, riskRegister, runStressTests } from "../../shared/riskEngine.ts";
import { benchmarkReplica, cagr, indexEvidence, returnStats, rollingReturns } from "../../shared/performance.ts";
import { analyseBehaviour } from "../../shared/behaviour.ts";
import { runCommittee } from "../../shared/committee.ts";
import { fundamentalScore, riskScore, valuation } from "../../shared/scoring.ts";
import { intrinsicSummary, scenarioValues } from "../../shared/valuation.ts";
import { buildTaxReport } from "../../shared/tax.ts";
import { technicalSummary } from "../../shared/indicators.ts";
import type { ResearchNote, ValuedHolding } from "../../shared/types.ts";
import { getProfile, listNotes, portfolioSnapshot } from "./journal.ts";
import { ensureHistory, getInstrument, getQuotes, storedHistory } from "./marketData.ts";
import { brokerStatus } from "./broker.ts";
import { dailyCandlesLong } from "../providers/upstox.ts";
import { log } from "../log.ts";

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

// ---------------- Settings ----------------
export const WealthSettingsSchema = z.object({
  targetAmount: z.coerce.number().positive().default(W.TARGET),
  targetYears: z.coerce.number().int().min(1).max(60).default(30),
  monthly: z.coerce.number().min(0).max(1e8).default(10000),
  stepUpPct: z.coerce.number().min(0).max(50).default(10),
  assumptions: z
    .object({
      conservative: z.coerce.number().min(-5).max(30),
      base: z.coerce.number().min(-5).max(30),
      optimistic: z.coerce.number().min(-5).max(30),
      costDragPct: z.coerce.number().min(0).max(5),
      inflationPct: z.coerce.number().min(0).max(20),
      ltcgPct: z.coerce.number().min(0).max(50),
      ltcgExemption: z.coerce.number().min(0),
    })
    .default(W.DEFAULT_WEALTH_ASSUMPTIONS)
    .refine((a) => a.conservative <= a.base && a.base <= a.optimistic, "Conservative ≤ base ≤ optimistic"),
  netWorth: z
    .object({
      emergencyFund: z.coerce.number().min(0).default(0),
      retirementAccounts: z.coerce.number().min(0).default(0),
      otherInvestments: z.coerce.number().min(0).default(0),
      businessValue: z.coerce.number().min(0).default(0),
      property: z.coerce.number().min(0).default(0),
      liabilities: z.coerce.number().min(0).default(0),
    })
    .default({ emergencyFund: 0, retirementAccounts: 0, otherInvestments: 0, businessValue: 0, property: 0, liabilities: 0 }),
  income: z
    .object({
      annualIncome: z.coerce.number().min(0).default(0),
      incomeGrowthPct: z.coerce.number().min(-20).max(50).default(8),
      sideIncomeMonthly: z.coerce.number().min(0).default(0),
      sideIncomeGrowthPct: z.coerce.number().min(-20).max(100).default(10),
    })
    .default({ annualIncome: 0, incomeGrowthPct: 8, sideIncomeMonthly: 0, sideIncomeGrowthPct: 10 }),
});
export type WealthSettings = z.infer<typeof WealthSettingsSchema>;

export function getWealthSettings(db: DB): WealthSettings {
  const profile = getProfile(db);
  const saved = getSetting<Partial<WealthSettings> | null>(db, "wealth_settings", null);
  return WealthSettingsSchema.parse({ monthly: profile?.monthlyCapacity ?? 10000, ...(saved ?? {}) });
}

export interface MacroSettings {
  marketPe: number | null;
  medianPe: number | null;
  peSource: string;
  rateTrend: "rising" | "falling" | "stable" | "unknown";
  rateSource: string;
  asOf: string;
}
export const DEFAULT_MACRO: MacroSettings = {
  marketPe: 20.6,
  medianPe: 21.9,
  peSource: "indexpe.in / trendlyne (secondary), Nifty 50 trailing P/E vs 5-yr median, 16-Nov-2026 — verify on niftyindices.com",
  rateTrend: "rising",
  rateSource: "RBI raised repo to 5.50% on 7-Oct-2026 (secondary sources); December MPC hike debated",
  asOf: "2026-11-18",
};
export const getMacro = (db: DB) => getSetting<MacroSettings>(db, "macro", DEFAULT_MACRO);

// ---------------- Wealth journey ----------------
export function wealthJourney(db: DB) {
  const s = getWealthSettings(db);
  const a = s.assumptions;
  const { summary, deposits } = portfolioSnapshot(db);
  const dashboardInvestments = summary.currentValue + Math.max(summary.cash, 0);
  const nw = W.netWorth({ investments: dashboardInvestments, ...s.netWorth });
  const current = nw.investable;
  const initial = current > 0 ? current : 30000;
  const plan = { initial, monthly: s.monthly, stepUpPct: s.stepUpPct, years: s.targetYears, costDragPct: a.costDragPct };
  const scen = { conservative: a.conservative, base: a.base, optimistic: a.optimistic };

  const horizons = [5, 10, 15, 20, 25, 30];
  const projections = Object.entries(scen).map(([name, g]) => {
    const pts = W.projectPlan({ ...plan, years: Math.max(30, s.targetYears), grossReturnPct: g });
    return {
      scenario: name,
      grossReturnPct: g,
      netReturnPct: g - a.costDragPct,
      byHorizon: horizons.map((y) => {
        const p = pts[y];
        return { years: y, contributed: p.contributed, nominal: p.value, real: W.realValue(p.value, a.inflationPct, y), afterTax: W.afterTax(p.value, p.contributed, a) };
      }),
      series: pts.map((p) => ({ year: p.year, value: p.value, contributed: p.contributed })),
      monthsToTarget: W.monthsToTarget(s.targetAmount, { ...plan, grossReturnPct: g }, 70),
    };
  });

  const stepUps = [0, 5, 10, 15, 20].map((st) => ({
    stepUpPct: st,
    byHorizon: horizons.map((y) => ({ years: y, value: W.finalValue({ ...plan, stepUpPct: st, years: y, grossReturnPct: a.base }), monthlyInFinalYear: s.monthly * Math.pow(1 + st / 100, y - 1) })),
    monthsToTarget: W.monthsToTarget(s.targetAmount, { ...plan, stepUpPct: st, grossReturnPct: a.base }, 70),
  }));

  const required = [20, 25, 30].map((y) => ({
    years: y,
    rows: Object.entries(scen).flatMap(([name, g]) =>
      [0, s.stepUpPct].filter((v, i, arr) => arr.indexOf(v) === i).map((st) => ({ scenario: name, grossReturnPct: g, stepUpPct: st, monthly: W.requiredMonthly(s.targetAmount, { ...plan, stepUpPct: st, years: y, grossReturnPct: g }) })),
    ),
  }));

  const baseAtTarget = W.finalValue({ ...plan, grossReturnPct: a.base });
  const reqReturn = W.requiredReturn(s.targetAmount, plan);
  const reqMonthlyBase = W.requiredMonthly(s.targetAmount, { ...plan, grossReturnPct: a.base });
  const realTarget = W.realValue(s.targetAmount, a.inflationPct, s.targetYears);
  const nominalForTodaysTarget = s.targetAmount * Math.pow(1 + a.inflationPct / 100, s.targetYears);
  const achievable = baseAtTarget >= s.targetAmount;
  const verdict = achievable
    ? `On the base assumptions, the current plan reaches the target in ${s.targetYears} years. This depends on keeping the step-up going and on returns no one can guarantee.`
    : `Not achievable on the current plan. With ₹${Math.round(s.monthly).toLocaleString("en-IN")}/month rising ${s.stepUpPct}% a year, the base case reaches about ₹${(baseAtTarget / W.CRORE).toFixed(2)} crore in ${s.targetYears} years — ${((baseAtTarget / s.targetAmount) * 100).toFixed(1)}% of the target. ` +
      `Reaching it would need ${reqReturn === null ? "an annual return above 40% (not realistic)" : `about ${reqReturn.toFixed(1)}% a year before costs, far above prudent long-term assumptions`}, ` +
      `or a starting monthly investment of about ₹${Math.round(reqMonthlyBase).toLocaleString("en-IN")} rising ${s.stepUpPct}% a year. The realistic path is growing income (career, skills, business) and investing most of the increase — not taking more market risk.`;

  const income = s.income.annualIncome > 0
    ? (() => {
        const savingsRate = (s.monthly * 12 * 100) / s.income.annualIncome;
        const p = { annualIncome: s.income.annualIncome, incomeGrowthPct: s.income.incomeGrowthPct, savingsRatePct: savingsRate, sideIncomeMonthly: s.income.sideIncomeMonthly, sideIncomeGrowthPct: s.income.sideIncomeGrowthPct, initial, years: s.targetYears, grossReturnPct: a.base, costDragPct: a.costDragPct };
        const m = W.incomeModel(p);
        const { savingsRatePct: _x, ...rest } = p;
        return {
          currentSavingsRatePct: savingsRate,
          model: m,
          requiredSavingsRatePct: W.requiredSavingsRate(s.targetAmount, rest),
          requiredSavingsRateNoSide: W.requiredSavingsRate(s.targetAmount, { ...rest, sideIncomeMonthly: 0 }),
          passiveIncomeAt4Pct: (m.totals.final * 0.04) / 12,
        };
      })()
    : null;

  return {
    settings: s,
    netWorth: nw,
    dashboardInvestments,
    deposits,
    milestones: W.milestoneTable(current, { ...plan, initial: current }, a),
    projections,
    stepUps,
    required,
    target: { amount: s.targetAmount, years: s.targetYears, realValueToday: realTarget, nominalNeededForTodaysValue: nominalForTodaysTarget, baseAtTarget, requiredReturnPct: reqReturn, requiredMonthlyBase: reqMonthlyBase, achievable, verdict },
    income,
    assumptionsNote: "Hypothetical, configurable assumptions. Optimistic is NOT expected. Costs are deducted every year; tax is shown as if everything were sold at the end; inflation converts future rupees into today's purchasing power. The emergency fund is excluded from investable assets.",
  };
}

// ---------------- Extended risk engine ----------------
async function niftySeries(db: DB, days: number) {
  return ensureHistory(db, "Nifty 50", days).then((h) => h.map((c) => ({ date: c.date, close: c.close })));
}

export async function advancedRisk(db: DB) {
  const profile = getProfile(db);
  const t = getSetting<RiskThresholds>(db, "risk_thresholds", DEFAULT_THRESHOLDS);
  const macro = getMacro(db);
  const { holdings, summary } = portfolioSnapshot(db);
  const notes = listNotes(db);
  const report = buildRiskReport(holdings, summary.cash, profile, t);
  const betas = new Map<string, number>();
  try {
    const nifty = await niftySeries(db, 400);
    for (const h of holdings.filter((x) => x.assetClass === "EQUITY")) {
      const [ra, rb] = alignReturns(storedHistory(db, h.symbol).map((c) => ({ date: c.date, close: c.close })), nifty);
      const b = beta(ra, rb);
      if (b !== null) betas.set(h.symbol, b);
    }
  } catch (e) {
    log.warn("beta_unavailable", { error: String(e) });
  }
  const tolerated = profile ? { "5": 5, "10": 10, "20": 20, "20+": 30 }[profile.lossTolerance] : null;
  const stress = runStressTests(holdings, summary.cash, tolerated, betas);
  const snaps = db.prepare("SELECT date, value, invested FROM snapshots ORDER BY date").all() as { date: string; value: number; invested: number }[];
  const dd = drawdownStats(snaps);
  const backups = (() => {
    try {
      const dir = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".db")).map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
      return files.length ? Math.floor((Date.now() - Math.max(...files)) / 86400000) : null;
    } catch {
      return null;
    }
  })();
  const owned = holdings.filter((h) => h.assetClass === "EQUITY");
  const noteBy = new Map(notes.map((n) => [n.symbol, n]));
  const register = riskRegister({
    holdings,
    cash: summary.cash,
    maxSingleStockPct: t.maxSingleStockPct,
    maxSectorPct: t.maxSectorPct,
    topSectorPct: report.sectors.filter((x) => !["Diversified equity (fund)", "Non-equity", "Unclassified"].includes(x.sector))[0]?.pct ?? 0,
    ownedStocksWithFlags: owned.filter((h) => (noteBy.get(h.symbol)?.fundamentals.governanceFlags?.value ?? 0) > 0 || (noteBy.get(h.symbol)?.fundamentals.promoterPledge?.value ?? 0) > 0).map((h) => h.symbol),
    ownedStocksWithoutResearch: owned.filter((h) => !noteBy.has(h.symbol)).map((h) => h.symbol),
    marketPe: macro.marketPe && macro.medianPe ? { pe: macro.marketPe, medianPe: macro.medianPe, source: macro.peSource } : null,
    rateTrend: macro.rateTrend,
    brokerConnected: brokerStatus(db).connected,
    lastBackupDays: backups,
    stalePriceCount: summary.missingPrices.length + holdings.filter((h) => h.priceAsOf && Date.now() - Date.parse(h.priceAsOf) > 4 * 86400000).length,
  });
  return { register, stress, drawdown: { ...dd, index: dd.index.slice(-400) }, betas: Object.fromEntries(betas), toleratedLossPct: tolerated, macro, disclaimer: "Stress shocks are hypothetical approximations of the broad pattern of past episodes, not exact replications. No equity portfolio is risk-proof." };
}

// ---------------- Performance accountability ----------------
export async function performance(db: DB) {
  const { holdings, summary, ledger, txns } = portfolioSnapshot(db);
  const end = today();
  const equityClasses = new Set(["EQUITY", "EQUITY_ETF", "EQUITY_MF"]);
  const flowsFor = (pred: (assetClass: string) => boolean) =>
    txns
      .filter((t) => pred(t.assetClass) && t.type !== "DIVIDEND")
      .map((t) => ({ date: t.date, amount: (t.type === "BUY" ? -1 : 1) * t.quantity * t.price - (t.brokerage + t.stt + t.otherCharges) }))
      .concat(ledger.dividends.filter((d) => pred(txns.find((t) => t.symbol === d.symbol)?.assetClass ?? "")).map((d) => ({ date: d.date, amount: d.amount })))
      .sort((a, b) => a.date.localeCompare(b.date));
  const valueOf = (pred: (assetClass: string) => boolean) => holdings.filter((h) => pred(h.assetClass)).reduce((s, h) => s + (h.currentValue ?? h.invested), 0);
  const firstDate = txns.length ? txns[txns.length - 1].date : null;
  const historyYears = firstDate ? (Date.parse(end) - Date.parse(firstDate)) / (365 * 86400000) : 0;
  let nifty: { date: string; close: number }[] = [];
  let benchError: string | null = null;
  if (firstDate) {
    try {
      const days = Math.ceil((Date.parse(end) - Date.parse(firstDate)) / 86400000) + 10;
      nifty = days > 380 ? (await dailyCandlesLong(getInstrument(db, "Nifty 50")?.instrument_key ?? "NSE_INDEX|Nifty 50", firstDate, end)).map((c) => ({ date: c.ts.slice(0, 10), close: c.close })) : await niftySeries(db, Math.max(days, 30));
    } catch (e) {
      benchError = e instanceof Error ? e.message : String(e);
    }
  }
  const sleeve = (label: string, pred: (c: string) => boolean) => {
    const flows = flowsFor(pred);
    if (!flows.length) return { label, invested: 0, value: 0, xirrPct: null as number | null, absolutePct: null as number | null, benchmark: null as null | { value: number; xirrPct: number | null; absolutePct: number | null }, excessPct: null as number | null, excessIsAnnual: false };
    const value = valueOf(pred);
    const mine = returnStats(flows, value, end);
    const b = nifty.length ? benchmarkReplica(flows, nifty, end) : null;
    const bench = b ? returnStats(flows, b.value, end) : null;
    const annual = mine.annualised && mine.xirrPct !== null && bench?.xirrPct != null;
    return {
      label,
      invested: -flows.filter((f) => f.amount < 0).reduce((s, f) => s + f.amount, 0),
      value,
      xirrPct: mine.xirrPct,
      absolutePct: mine.absolutePct,
      benchmark: b ? { value: b.value, xirrPct: bench!.xirrPct, absolutePct: bench!.absolutePct } : null,
      excessPct: annual ? mine.xirrPct! - bench!.xirrPct! : mine.absolutePct !== null && bench?.absolutePct != null ? mine.absolutePct - bench.absolutePct : null,
      excessIsAnnual: annual,
    };
  };
  const sleeves = [sleeve("All equity (stocks + equity funds)", (c) => equityClasses.has(c)), sleeve("Individual stocks only (active choices)", (c) => c === "EQUITY")];
  const snaps = db.prepare("SELECT date, value, invested FROM snapshots ORDER BY date").all() as { date: string; value: number; invested: number }[];
  const dd = drawdownStats(snaps);
  const twr = dd.index;
  const tax = buildTaxReport(ledger.realised, getProfile(db)?.taxSlabPct ?? 30);
  const costs = { charges: summary.totalCharges, estimatedTax: tax.reduce((s, r) => s + r.estimatedTax, 0) };
  const stocks = sleeves[1];
  let verdict: string;
  if (!txns.length) verdict = "No transactions yet.";
  else if (historyYears < 1) verdict = `Only ${Math.max(1, Math.round(historyYears * 12))} month(s) of history — too early to judge skill. Returns under a year are mostly noise; XIRR is shown but not annualised meaningfully.`;
  else if (stocks.excessIsAnnual && stocks.excessPct !== null && stocks.excessPct < -2) verdict = `Your individual stock picks have returned ${stocks.excessPct.toFixed(1)}% a year LESS than simply buying the Nifty 50 with the same money (after your costs). Consider moving new money to the index fund and keeping stock picking to a small sleeve until the research process improves.`;
  else if (stocks.excessPct !== null) verdict = `Individual stocks are ${stocks.excessPct >= 0 ? "ahead of" : "slightly behind"} the Nifty 50 by ${Math.abs(stocks.excessPct).toFixed(1)}% a year after costs. Keep monitoring over full market cycles.`;
  else verdict = "Equity performance compared against the Nifty 50 below.";
  return {
    historyYears,
    benchmark: { name: "Nifty 50 (price index; excludes dividends, so it slightly understates the true benchmark)", error: benchError, points: nifty.length },
    sleeves,
    portfolio: { ...(() => { const r = returnStats(flowsFor(() => true), summary.currentValue, end); return { xirrPct: r.xirrPct, absolutePct: r.absolutePct }; })(), twrIndex: twr.slice(-400), cagrPct: twr.length > 1 && historyYears >= 1 ? cagr(twr[0].value, twr.at(-1)!.value, historyYears) : null, rolling1y: twr.length > 260 ? rollingReturns(twr.map((p) => ({ date: p.date, close: p.value })), 365).slice(-200) : [], volatilityPct: annualisedVolatility(twr.map((p) => p.value)), maxDrawdownPct: dd.maxDrawdownPct },
    costs,
    verdict,
  };
}

// ---------------- Evidence from Indian index data ----------------
export const EVIDENCE_INDICES = [
  { key: "NSE_INDEX|Nifty 50", name: "Nifty 50", style: "Bogle — low-cost broad index (the benchmark)" },
  { key: "NSE_INDEX|Nifty50 Value 20", name: "Nifty50 Value 20", style: "Graham — value (cheap on earnings/book)" },
  { key: "NSE_INDEX|NIFTY100 Qualty30", name: "NIFTY100 Quality 30", style: "Buffett / Fisher / Munger — high-quality businesses" },
  { key: "NSE_INDEX|NIFTY MIDCAP 150", name: "Nifty Midcap 150", style: "Lynch / Jhunjhunwala — growth in mid-sized companies" },
  { key: "NSE_INDEX|NIFTY SMLCAP 250", name: "Nifty Smallcap 250", style: "Small companies — highest growth potential and risk" },
  { key: "NSE_INDEX|Nifty200Momentm30", name: "Nifty200 Momentum 30", style: "Momentum (trend-following) — contrast to value thinking" },
];

export async function factorEvidence(db: DB) {
  const row = db.prepare("SELECT data, fetched_at FROM feed_cache WHERE feed = 'factor_evidence'").get() as { data: string; fetched_at: string } | undefined;
  if (row && Date.now() - Date.parse(row.fetched_at) < 24 * 3600_000) return JSON.parse(row.data);
  const to = today();
  const from = new Date(Date.parse(to) - 10 * 365.25 * 86400000).toISOString().slice(0, 10);
  const results = [];
  for (const ix of EVIDENCE_INDICES) {
    try {
      const c = await dailyCandlesLong(ix.key, from, to);
      results.push({ ...ix, evidence: indexEvidence(c.map((x) => ({ date: x.ts.slice(0, 10), close: x.close }))) });
    } catch (e) {
      results.push({ ...ix, evidence: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const data = { results, source: "Upstox market-data API (NSE index daily closes; price indices, dividends excluded)", fetchedAt: new Date().toISOString() };
  if (results.some((r) => r.evidence)) db.prepare("INSERT INTO feed_cache (feed, data, fetched_at) VALUES ('factor_evidence', ?, ?) ON CONFLICT(feed) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at").run(JSON.stringify(data), data.fetchedAt);
  return data;
}

// ---------------- Investment committee ----------------
export async function committee(db: DB, note: ResearchNote) {
  const profile = getProfile(db);
  const t = getSetting<RiskThresholds>(db, "risk_thresholds", DEFAULT_THRESHOLDS);
  const macro = getMacro(db);
  const { holdings, summary } = portfolioSnapshot(db);
  let hist: { date: string; close: number }[] = [];
  try {
    hist = (await ensureHistory(db, note.symbol, 400)).map((c) => ({ date: c.date, close: c.close }));
  } catch {
    /* unknown symbol: proceed without price history */
  }
  const price = getQuotes(db, [note.symbol]).get(note.symbol)?.price ?? hist.at(-1)?.close ?? null;
  const closes = hist.map((c) => c.close);
  const vol = annualisedVolatility(closes.slice(-250));
  const rel = valuation(note.fundamentals);
  const score = fundamentalScore(note.fundamentals);
  const facts = Object.fromEntries(Object.entries(note.valuationFacts ?? {}).map(([k, m]) => [k, (m as { value: number }).value]));
  const intrinsic = intrinsicSummary(facts, note.valuationAssumptions ?? {}, price);
  const total = summary.currentValue + Math.max(summary.cash, 0);
  const scen = profile ? buildScenarios(profile, Math.max(total, profile.capital)) : [];
  const chosen = scen.find((x) => x.id === getSetting<string>(db, "chosen_scenario", "")) ?? scen.find((x) => x.suitability === "suitable");
  const stockTarget = chosen?.lines.find((l) => l.key === "stocks")?.amount ?? 0;
  const stocksNow = holdings.filter((h) => h.assetClass === "EQUITY").reduce((s, h) => s + (h.currentValue ?? h.invested), 0);
  const sectorNow = total ? (holdings.filter((h) => h.assetClass === "EQUITY" && h.sector && h.sector === note.sector).reduce((s, h) => s + (h.currentValue ?? h.invested), 0) / total) * 100 : 0;
  let maxCorr: number | null = null;
  for (const h of holdings.filter((x) => x.assetClass === "EQUITY" && x.symbol !== note.symbol)) {
    const [a, b] = alignReturns(hist, storedHistory(db, h.symbol).map((c) => ({ date: c.date, close: c.close })));
    const c = correlation(a, b);
    if (c !== null) maxCorr = Math.max(maxCorr ?? -1, c);
  }
  const sizing = positionSize({ portfolioValue: total, stockSleeveAvailable: stockTarget - stocksNow, maxSingleStockPct: t.maxSingleStockPct, maxLossPerPositionPct: 2, annualVolPct: vol, sectorWeightPct: sectorNow, maxSectorPct: t.maxSectorPct, maxCorrelationWithHoldings: maxCorr, avgDailyTradedValue: null, minTicket: 5000, fundamentalScore: score.score });
  let niftyFromHigh: number | null = null;
  try {
    niftyFromHigh = technicalSummary(await niftySeries(db, 400)).fromHighPct;
  } catch {
    /* ignore */
  }
  const out = runCommittee({
    symbol: note.symbol,
    price,
    fundamentals: note.fundamentals,
    score,
    relValuation: rel,
    intrinsic,
    scenarios: scenarioValues(facts, note.valuationAssumptions ?? {}),
    riskScore: riskScore(note.fundamentals, vol, rel).score,
    volatilityPct: vol,
    maxDrawdown1yPct: closes.length > 20 ? maxDrawdown(closes.slice(-250)).pct : null,
    sizing,
    readinessOk: profile ? assessReadiness(profile).ready : false,
    marketFromHighPct: niftyFromHigh,
    rateTrend: macro.rateTrend,
    sector: note.sector,
    thesis: note.thesis,
    invalidation: note.invalidation,
    growthDrivers: note.growthDrivers,
    risks: note.risks,
    requiredMarginOfSafetyPct: 25,
  });
  return { ...out, price, intrinsic: { ...intrinsic, buyBelowFor: undefined }, sizing, generatedAt: new Date().toISOString() };
}

// ---------------- Behaviour & post-investment reviews ----------------
export function behaviourAndReviews(db: DB) {
  const t = getSetting<RiskThresholds>(db, "risk_thresholds", DEFAULT_THRESHOLDS);
  const { holdings, ledger, txns } = portfolioSnapshot(db);
  const snaps = db.prepare("SELECT date, value, invested FROM snapshots ORDER BY date").all() as { date: string; value: number; invested: number }[];
  const idx = drawdownStats(snaps).index;
  const ddOn = (date: string) => {
    const upto = idx.filter((p) => p.date <= date);
    if (!upto.length) return null;
    const peak = Math.max(...upto.map((p) => p.value));
    return (upto.at(-1)!.value / peak - 1) * 100;
  };
  const findings = analyseBehaviour({ txns, realised: ledger.realised, holdings, researched: new Set(listNotes(db).map((n) => n.symbol)), maxSingleStockPct: t.maxSingleStockPct, drawdownOnDate: ddOn });
  const reviews = db.prepare("SELECT * FROM reviews ORDER BY review_date DESC, id DESC").all() as Record<string, unknown>[];
  const reviewed = (sym: string, since: string) => reviews.some((r) => r.symbol === sym && (r.review_date as string) >= since);
  const due: { symbol: string; name: string; kind: "sale" | "holding"; reason: string }[] = [];
  const soldSymbols = new Map<string, string>();
  for (const r of ledger.realised) if (!soldSymbols.has(r.symbol) || soldSymbols.get(r.symbol)! < r.sellDate) soldSymbols.set(r.symbol, r.sellDate);
  for (const [sym, date] of soldSymbols) if (!reviewed(sym, date)) due.push({ symbol: sym, name: ledger.realised.find((r) => r.symbol === sym)!.name, kind: "sale", reason: `Sold on ${date} — was the thesis right, and was the exit disciplined?` });
  const sixMonthsAgo = new Date(Date.now() - 182 * 86400000).toISOString().slice(0, 10);
  for (const h of holdings) if (h.firstBuyDate <= sixMonthsAgo && !reviewed(h.symbol, sixMonthsAgo)) due.push({ symbol: h.symbol, name: h.name, kind: "holding", reason: `Held since ${h.firstBuyDate} — six-monthly thesis review.` });
  const tally = (k: string, v: string) => reviews.filter((r) => r[k] === v).length;
  return { findings, due, reviews, scorecard: reviews.length ? { total: reviews.length, thesisRight: tally("thesis_correct", "yes"), thesisWrong: tally("thesis_correct", "no"), undisciplined: tally("disciplined", "no") } : null };
}

export const ReviewInput = z.object({
  symbol: z.string().trim().min(1).max(40),
  kind: z.enum(["sale", "holding", "decision"]),
  thesisCorrect: z.enum(["yes", "partly", "no", "too_early"]),
  disciplined: z.enum(["yes", "partly", "no"]),
  outcome: z.string().trim().max(2000).optional(),
  lesson: z.string().trim().min(3, "Write at least one lesson").max(2000),
});

// ---------------- Year-end 2026 review ----------------
export function yearEndReview(db: DB) {
  const profile = getProfile(db);
  const s = getWealthSettings(db);
  const macro = getMacro(db);
  const { holdings, summary, deposits, txns } = portfolioSnapshot(db);
  const total = summary.currentValue + Math.max(summary.cash, 0);
  const capital = deposits > 0 ? deposits : summary.invested;
  const deployedPct = capital > 0 ? (summary.invested / capital) * 100 : 0;
  const stress20 = runStressTests(holdings, summary.cash, null).find((x) => x.scenario.id === "m20")!;
  const scen = profile ? buildScenarios(profile, profile.capital) : [];
  const plan = scen.find((x) => x.id === getSetting<string>(db, "chosen_scenario", "")) ?? null;
  const notes = listNotes(db);
  const stocks = holdings.filter((h) => h.assetClass === "EQUITY");
  const manual = getSetting<Record<string, boolean>>(db, "year_end_manual", {});
  const equityPct = total ? (holdings.filter((h: ValuedHolding) => ["EQUITY", "EQUITY_ETF", "EQUITY_MF"].includes(h.assetClass)).reduce((a, h) => a + (h.currentValue ?? h.invested), 0) / total) * 100 : 0;
  const checklist = [
    { id: "profile", label: "Investor profile completed", done: !!profile, auto: true },
    { id: "emergency", label: "Emergency fund kept separate (recorded in the ₹100 Cr Journey → Net worth)", done: s.netWorth.emergencyFund > 0 || profile?.emergencyFund === "full", auto: true },
    { id: "plan", label: "Allocation plan chosen", done: !!plan, auto: true },
    { id: "capital", label: "Initial capital recorded in the Journal", done: deposits > 0, auto: true },
    { id: "deployed", label: "Initial deployment done per plan (staged equity in progress is fine)", done: holdings.length > 0, auto: true },
    { id: "sip", label: "Monthly SIPs set up at the broker", done: !!manual.sip, auto: false },
    { id: "stockResearch", label: "Every individual stock has a written thesis and invalidation", done: stocks.every((h) => notes.some((n) => n.symbol === h.symbol && n.thesis && n.invalidation)), auto: true },
    { id: "nominee", label: "Nominee added to demat and mutual fund folios", done: !!manual.nominee, auto: false },
    { id: "backup", label: "Dashboard database backed up", done: !!manual.backup, auto: false },
    { id: "wealthPlan", label: "₹100 Cr Journey assumptions reviewed and saved", done: !!getSetting(db, "wealth_settings", null), auto: true },
  ];
  const daysLeft = Math.max(0, Math.ceil((Date.parse("2026-12-31T23:59:59+05:30") - Date.now()) / 86400000));
  return {
    daysLeftIn2026: daysLeft,
    capital,
    invested: summary.invested,
    cash: summary.cash,
    deployedPct,
    totalValue: total,
    unrealisedPnl: summary.unrealisedPnl,
    equityPct,
    planEquityPct: plan?.equityPct ?? null,
    downside20: { loss: stress20.lossAmount, pct: stress20.lossPct },
    macro,
    holdingPeriod: profile ? `${profile.horizon} years (your profile)` : "Not set",
    checklist,
    transactions: txns.length,
    guidance: [
      "Finish 2026 with the plan in place, not with a profit target. A small loss in December on money meant for 3–5 years is not a failure.",
      "Keep staging equity in monthly steps; do not accelerate purchases to 'catch' a year-end rally.",
      `Market context: Nifty trailing P/E ${macro.marketPe ?? "—"} vs median ${macro.medianPe ?? "—"}; rates ${macro.rateTrend}. Valuations are reasonable, not cheap — a reason for staging, not for waiting indefinitely.`,
      "Before 31 March 2027, check whether any realised long-term gains can use the ₹1.25 lakh exemption (Performance & Tax page).",
    ],
  };
}

export function setYearEndManual(db: DB, id: string, done: boolean) {
  const m = getSetting<Record<string, boolean>>(db, "year_end_manual", {});
  m[id] = done;
  setSetting(db, "year_end_manual", m);
}
