// Portfolio risk analytics. All figures are computed from the user's own holdings and
// real price history; nothing here is estimated from outside assumptions except where labelled.

import type { InvestorProfile, ValuedHolding } from "./types.ts";
import { assessReadiness } from "./allocation.ts";

export interface RiskThresholds {
  maxSingleStockPct: number; // individual shares only (funds are already diversified)
  maxSectorPct: number;
  maxDrawdownAlertPct: number;
  priceMoveAlertPct: number;
}

export const DEFAULT_THRESHOLDS: RiskThresholds = {
  maxSingleStockPct: 20,
  maxSectorPct: 35,
  maxDrawdownAlertPct: 15,
  priceMoveAlertPct: 4,
};

export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function dailyReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}

/** Annualised volatility in % from daily closes (252 trading days). */
export function annualisedVolatility(closes: number[]): number | null {
  const r = dailyReturns(closes);
  if (r.length < 20) return null;
  return stdev(r) * Math.sqrt(252) * 100;
}

/** Maximum peak-to-trough decline in % (negative number or 0). */
export function maxDrawdown(values: number[]): { pct: number; peakIndex: number; troughIndex: number } {
  let peak = -Infinity;
  let peakIdx = 0;
  let best = { pct: 0, peakIndex: 0, troughIndex: 0 };
  values.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
    const dd = peak > 0 ? (v / peak - 1) * 100 : 0;
    if (dd < best.pct) best = { pct: dd, peakIndex: peakIdx, troughIndex: i };
  });
  return best;
}

/**
 * Simulated value series of the CURRENT holdings over past dates (constant quantities).
 * Only dates where every included holding has a close are used.
 */
export function simulatedPortfolioSeries(
  holdings: { symbol: string; quantity: number }[],
  history: Map<string, { date: string; close: number }[]>,
): { date: string; value: number }[] {
  const withHist = holdings.filter((h) => (history.get(h.symbol)?.length ?? 0) > 0);
  if (!withHist.length) return [];
  const maps = withHist.map((h) => new Map(history.get(h.symbol)!.map((c) => [c.date, c.close])));
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  return dates.map((d) => ({ date: d, value: withHist.reduce((s, h, i) => s + h.quantity * maps[i].get(d)!, 0) }));
}

export interface RiskWarning {
  severity: "info" | "warning" | "critical";
  title: string;
  why: string;
}

export interface RiskReport {
  singleStock: { symbol: string; pct: number }[];
  sectors: { sector: string; pct: number }[];
  effectiveHoldings: number | null; // 1 / HHI
  equityPct: number;
  liquidPct: number; // redeemable/sellable within T+1
  warnings: RiskWarning[];
}

const EQUITY_CLASSES = new Set(["EQUITY", "EQUITY_ETF", "EQUITY_MF"]);

export function buildRiskReport(
  holdings: ValuedHolding[],
  cash: number,
  profile: InvestorProfile | null,
  t: RiskThresholds = DEFAULT_THRESHOLDS,
): RiskReport {
  const val = (h: ValuedHolding) => h.currentValue ?? h.invested;
  const total = holdings.reduce((s, h) => s + val(h), 0) + Math.max(cash, 0);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const warnings: RiskWarning[] = [];

  const singleStock = holdings
    .filter((h) => h.assetClass === "EQUITY")
    .map((h) => ({ symbol: h.symbol, pct: pct(val(h)) }))
    .sort((a, b) => b.pct - a.pct);
  for (const s of singleStock) {
    if (s.pct > t.maxSingleStockPct) {
      warnings.push({
        severity: s.pct > t.maxSingleStockPct * 1.5 ? "critical" : "warning",
        title: `${s.symbol} is ${s.pct.toFixed(1)}% of your portfolio`,
        why: `Above your ${t.maxSingleStockPct}% single-stock limit. One adverse event (results miss, governance issue) in this company would materially hurt the whole portfolio. Consider directing new money elsewhere rather than selling in a hurry.`,
      });
    }
  }

  // Sector exposure: diversified funds are bucketed as "Diversified (fund)" to avoid false sector alarms.
  const sectorMap = new Map<string, number>();
  for (const h of holdings) {
    const key = h.assetClass === "EQUITY" ? h.sector || "Unclassified" : h.assetClass === "EQUITY_ETF" || h.assetClass === "EQUITY_MF" ? "Diversified equity (fund)" : "Non-equity";
    sectorMap.set(key, (sectorMap.get(key) ?? 0) + val(h));
  }
  const sectors = [...sectorMap.entries()].map(([sector, v]) => ({ sector, pct: pct(v) })).sort((a, b) => b.pct - a.pct);
  for (const s of sectors) {
    if (!["Diversified equity (fund)", "Non-equity", "Unclassified"].includes(s.sector) && s.pct > t.maxSectorPct) {
      warnings.push({
        severity: "warning",
        title: `${s.sector} sector is ${s.pct.toFixed(1)}% of the portfolio`,
        why: `Above your ${t.maxSectorPct}% sector limit. Companies in one sector tend to fall together on sector-wide news (regulation, commodity prices, rate cycle).`,
      });
    }
  }
  if (sectors.some((s) => s.sector === "Unclassified")) {
    warnings.push({ severity: "info", title: "Some stocks have no sector", why: "Sector concentration cannot be checked for them. Add a sector in the journal entry." });
  }

  const weights = holdings.map((h) => pct(val(h)) / 100);
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const equityPct = pct(holdings.filter((h) => EQUITY_CLASSES.has(h.assetClass)).reduce((s, h) => s + val(h), 0));
  const liquidPct = pct(
    holdings.filter((h) => h.assetClass === "DEBT_MF" || h.assetClass === "CASH").reduce((s, h) => s + val(h), 0) + Math.max(cash, 0),
  );

  if (profile) {
    const r = assessReadiness(profile);
    if (equityPct > r.equityCapPct + 5) {
      warnings.push({
        severity: r.equityCapPct === 0 ? "critical" : "warning",
        title: `Equity is ${equityPct.toFixed(0)}% vs your profile limit of ${r.equityCapPct}%`,
        why: `Investment-horizon / risk mismatch. ${r.capReasons[r.capReasons.length - 1]} A large market fall could exceed the loss you said you can tolerate.`,
      });
    }
    if (profile.needWithin12Months !== "no" && liquidPct < 20 && total > 0) {
      warnings.push({
        severity: "warning",
        title: `Only ${liquidPct.toFixed(0)}% is in cash/liquid instruments`,
        why: "You indicated you may need money within 12 months. Selling equity to meet a near-term need risks crystallising losses.",
      });
    }
  }
  if (holdings.length > 0 && hhi > 0.5 && singleStock.length > 0) {
    warnings.push({
      severity: "warning",
      title: "Portfolio is highly concentrated",
      why: `Effective number of holdings is ${(1 / hhi).toFixed(1)}. Diversification across a broad index fund reduces single-company risk.`,
    });
  }
  return { singleStock, sectors, effectiveHoldings: hhi > 0 ? 1 / hhi : null, equityPct, liquidPct, warnings };
}
