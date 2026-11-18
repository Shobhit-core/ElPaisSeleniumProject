// Transparent, rules-based scoring of user-entered (and sourced) fundamentals.
// Every band and weight is listed in METHODOLOGY so the UI can show exactly how a score was built.
// Missing metrics are NEVER imputed: they lower "confidence" instead.

import type { FundamentalKey, Fundamentals } from "./types.ts";

type Band = [upTo: number, points: number]; // value < upTo → points (last band: Infinity)

interface MetricRule {
  key: FundamentalKey;
  label: string;
  pillar: "Growth" | "Profitability" | "Balance sheet & cash" | "Governance & ownership";
  bands: Band[];
  note?: string;
}

export const METRIC_RULES: MetricRule[] = [
  { key: "revenueCagr3y", label: "Revenue CAGR 3y %", pillar: "Growth", bands: [[0, 0], [5, 25], [10, 50], [15, 75], [Infinity, 100]] },
  { key: "profitCagr3y", label: "Net profit CAGR 3y %", pillar: "Growth", bands: [[0, 0], [5, 25], [10, 50], [15, 75], [Infinity, 100]] },
  { key: "epsCagr3y", label: "EPS CAGR 3y %", pillar: "Growth", bands: [[0, 0], [5, 25], [10, 50], [15, 75], [Infinity, 100]] },
  { key: "roe", label: "ROE %", pillar: "Profitability", bands: [[8, 0], [12, 40], [15, 60], [20, 80], [Infinity, 100]] },
  { key: "roce", label: "ROCE %", pillar: "Profitability", bands: [[8, 0], [12, 40], [15, 60], [20, 80], [Infinity, 100]], note: "Not meaningful for banks/NBFCs — leave blank for them." },
  { key: "operatingMargin", label: "Operating margin %", pillar: "Profitability", bands: [[5, 20], [10, 40], [15, 60], [25, 80], [Infinity, 100]], note: "Compare within sector; margins differ structurally across industries." },
  { key: "debtToEquity", label: "Debt / equity", pillar: "Balance sheet & cash", bands: [[0.1, 100], [0.5, 80], [1, 50], [2, 20], [Infinity, 0]], note: "Not meaningful for banks/NBFCs — leave blank for them." },
  { key: "fcfPositiveYears5", label: "Years of positive FCF (of last 5)", pillar: "Balance sheet & cash", bands: [[1, 0], [2, 20], [3, 40], [4, 60], [5, 80], [Infinity, 100]] },
  { key: "promoterPledge", label: "Promoter pledge %", pillar: "Governance & ownership", bands: [[0.01, 100], [5, 70], [20, 30], [Infinity, 0]] },
  { key: "promoterHolding", label: "Promoter holding %", pillar: "Governance & ownership", bands: [[20, 50], [35, 50], [50, 75], [Infinity, 100]], note: "Professionally managed companies (no promoter) score a neutral 50." },
  { key: "governanceFlags", label: "Governance red flags (count)", pillar: "Governance & ownership", bands: [[1, 100], [2, 50], [Infinity, 0]], note: "Auditor resignations, qualified opinions, related-party concerns, SEBI orders." },
  { key: "dividendYears5", label: "Years dividend paid (of last 5)", pillar: "Governance & ownership", bands: [[1, 20], [3, 50], [5, 80], [Infinity, 100]] },
];

export const PILLAR_WEIGHTS = {
  Growth: 25,
  Profitability: 25,
  "Balance sheet & cash": 25,
  "Governance & ownership": 25,
} as const;

export const METHODOLOGY = {
  fundamental:
    "Fundamental score (0–100) = weighted average of four equally weighted pillars (Growth, Profitability, Balance sheet & cash, Governance & ownership). Each metric is mapped to points by fixed bands; a pillar is the average of its available metrics. Pillars with no data are excluded and confidence drops. Scores are withheld below 50% confidence.",
  valuation:
    "Valuation: P/E relative to the sector median P/E you record (<0.8× = discount, 0.8–1.2× = in line, >1.2× = premium) and PEG = P/E ÷ 3-year EPS CAGR (<1 attractive, 1–2 fair, >2 expensive; not computed when EPS growth ≤ 0). Valuation score: discount/attractive 100, in line/fair 60, premium/expensive 20; averaged across the two measures available.",
  risk:
    "Risk score (0–100, higher = riskier) = average of available factors: leverage (D/E >1 → 70, >2 → 100), promoter pledge (>0 → 50, >20% → 100), governance flags (1 → 60, ≥2 → 100), annualised volatility (from 1-year daily prices: <20% → 20, 20–30% → 50, 30–40% → 75, >40% → 100) and valuation premium (P/E >1.5× sector → 80).",
  composite:
    "Watchlist rank = 60% fundamental score + 40% valuation score, only for stocks with ≥50% data confidence AND at least one valuation measure. Risk is shown separately and is not netted off, so a high-risk stock is never hidden behind a high rank.",
};

function bandPoints(bands: Band[], v: number): number {
  for (const [upTo, pts] of bands) if (v < upTo) return pts;
  return bands[bands.length - 1][1];
}

export interface ScoreResult {
  score: number | null;
  confidence: number; // 0–100, share of metric weight that had data
  pillars: { pillar: string; score: number | null; metrics: { key: FundamentalKey; label: string; value: number | null; points: number | null }[] }[];
}

export function fundamentalScore(f: Fundamentals): ScoreResult {
  const pillars = (Object.keys(PILLAR_WEIGHTS) as (keyof typeof PILLAR_WEIGHTS)[]).map((pillar) => {
    const rules = METRIC_RULES.filter((r) => r.pillar === pillar);
    const metrics = rules.map((r) => {
      const v = f[r.key]?.value;
      return { key: r.key, label: r.label, value: v ?? null, points: v === undefined || !Number.isFinite(v) ? null : bandPoints(r.bands, v) };
    });
    const have = metrics.filter((m) => m.points !== null);
    return {
      pillar,
      score: have.length ? have.reduce((s, m) => s + (m.points ?? 0), 0) / have.length : null,
      metrics,
      coverage: have.length / rules.length,
    };
  });
  const confidence = pillars.reduce((s, p) => s + p.coverage * PILLAR_WEIGHTS[p.pillar as keyof typeof PILLAR_WEIGHTS], 0);
  const scored = pillars.filter((p) => p.score !== null);
  const wsum = scored.reduce((s, p) => s + PILLAR_WEIGHTS[p.pillar as keyof typeof PILLAR_WEIGHTS], 0);
  const raw = wsum ? scored.reduce((s, p) => s + (p.score ?? 0) * PILLAR_WEIGHTS[p.pillar as keyof typeof PILLAR_WEIGHTS], 0) / wsum : null;
  return {
    score: confidence >= 50 && raw !== null ? Math.round(raw) : null,
    confidence: Math.round(confidence),
    pillars: pillars.map(({ coverage: _c, ...p }) => ({ ...p, score: p.score === null ? null : Math.round(p.score) })),
  };
}

export interface ValuationResult {
  peVsSector: number | null;
  peLabel: "discount" | "in line" | "premium" | null;
  peg: number | null;
  pegLabel: "attractive" | "fair" | "expensive" | null;
  score: number | null;
  summary: string;
}

/** `currentPe` lets the caller pass a P/E re-based on today's price (pe × price / priceAtEntry). */
export function valuation(f: Fundamentals, currentPe?: number | null): ValuationResult {
  const pe = currentPe ?? f.pe?.value ?? null;
  const sectorPe = f.sectorPe?.value ?? null;
  const growth = f.epsCagr3y?.value ?? null;
  const ratio = pe !== null && sectorPe ? pe / sectorPe : null;
  const peLabel = ratio === null ? null : ratio < 0.8 ? "discount" : ratio <= 1.2 ? "in line" : "premium";
  const peg = pe !== null && pe > 0 && growth !== null && growth > 0 ? pe / growth : null;
  const pegLabel = peg === null ? null : peg < 1 ? "attractive" : peg <= 2 ? "fair" : "expensive";
  const pts = [peLabel && { discount: 100, "in line": 60, premium: 20 }[peLabel], pegLabel && { attractive: 100, fair: 60, expensive: 20 }[pegLabel]].filter(
    (x): x is number => typeof x === "number",
  );
  const score = pts.length ? Math.round(pts.reduce((s, x) => s + x, 0) / pts.length) : null;
  const parts: string[] = [];
  if (ratio !== null) parts.push(`P/E ${pe!.toFixed(1)} is ${ratio.toFixed(2)}× sector median (${peLabel})`);
  if (peg !== null) parts.push(`PEG ${peg.toFixed(2)} (${pegLabel})`);
  if (pe !== null && pe <= 0) parts.push("Negative earnings — P/E not meaningful");
  if (growth !== null && growth <= 0) parts.push("EPS has not grown over 3 years — PEG not meaningful");
  return { peVsSector: ratio, peLabel, peg, pegLabel, score, summary: parts.join("; ") || "Insufficient valuation data" };
}

export function riskScore(f: Fundamentals, annualVolPct: number | null, val: ValuationResult): { score: number | null; factors: string[] } {
  const parts: { pts: number; why: string }[] = [];
  const de = f.debtToEquity?.value;
  if (de !== undefined) parts.push({ pts: de > 2 ? 100 : de > 1 ? 70 : de > 0.5 ? 40 : 10, why: `D/E ${de}` });
  const pledge = f.promoterPledge?.value;
  if (pledge !== undefined) parts.push({ pts: pledge > 20 ? 100 : pledge > 0 ? 50 : 0, why: `Pledge ${pledge}%` });
  const flags = f.governanceFlags?.value;
  if (flags !== undefined) parts.push({ pts: flags >= 2 ? 100 : flags >= 1 ? 60 : 0, why: `${flags} governance flag(s)` });
  if (annualVolPct !== null) parts.push({ pts: annualVolPct > 40 ? 100 : annualVolPct > 30 ? 75 : annualVolPct > 20 ? 50 : 20, why: `Volatility ${annualVolPct.toFixed(0)}%/yr` });
  if (val.peVsSector !== null) parts.push({ pts: val.peVsSector > 1.5 ? 80 : val.peVsSector > 1.2 ? 50 : 20, why: `P/E ${val.peVsSector.toFixed(2)}× sector` });
  if (!parts.length) return { score: null, factors: [] };
  return { score: Math.round(parts.reduce((s, p) => s + p.pts, 0) / parts.length), factors: parts.map((p) => p.why) };
}

export function compositeRank(fund: ScoreResult, val: ValuationResult): number | null {
  // No valuation data → no rank: a good company is not a good investment at every price.
  if (fund.score === null || fund.confidence < 50 || val.score === null) return null;
  return Math.round(fund.score * 0.6 + val.score * 0.4);
}
