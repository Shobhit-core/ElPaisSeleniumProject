// Range projection ("what might our money become?") using a seeded Monte Carlo simulation.
// This is NOT a prediction: it shows how wide the outcomes can be under stated, hypothetical
// assumptions, including monthly contributions. Deterministic for a given seed (testable).

import { round2 } from "./format.ts";

export type Bucket = "growth" | "steady" | "safe" | "gold";

export interface BucketAssumption {
  label: string;
  annualReturnPct: number; // expected (mean) annual return, hypothetical
  annualVolPct: number; // annual volatility
  why: string;
}

/** Hypothetical long-run assumptions. Volatility for growth is close to the Nifty 50's measured 14.4% over Nov-2025→Nov-2026 (Upstox data); slightly higher to be prudent. */
export const DEFAULT_ASSUMPTIONS: Record<Bucket, BucketAssumption> = {
  growth: { label: "Growth money (shares via Nifty 50 index fund)", annualReturnPct: 10, annualVolPct: 16, why: "Shares grow most over many years but can fall 20–40% in a bad year." },
  steady: { label: "Steady money (short-term bond fund)", annualReturnPct: 6.5, annualVolPct: 2, why: "Small, steady growth; can dip slightly when interest rates rise." },
  safe: { label: "Safe money (liquid fund / cash)", annualReturnPct: 6, annualVolPct: 0.5, why: "Very stable, like a better savings account. Available in 1 day." },
  gold: { label: "Gold", annualReturnPct: 7, annualVolPct: 18, why: "Can protect when shares fall, but swings a lot (−25% this year)." },
};

export const BUCKETS: Bucket[] = ["growth", "steady", "safe", "gold"];

export interface ProjectionInput {
  start: Record<Bucket, number>; // ₹ today in each bucket
  monthly: Record<Bucket, number>; // ₹ added each month to each bucket
  months: number;
  /** Money actually put in so far (defaults to the start value). Used for "money put in" and the below-put-in chance. */
  contributedBase?: number;
  paths?: number;
  seed?: number;
  assumptions?: Record<Bucket, BucketAssumption>;
}

export interface ProjectionPoint {
  month: number;
  contributed: number; // money put in by this month (start + monthly × month)
  p10: number; // 1-in-10 chance of ending lower ("bad case")
  p50: number; // middle outcome
  p90: number; // 1-in-10 chance of ending higher ("good case")
  chanceBelowContributed: number; // % of simulated paths worth less than what was put in
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Simulates month by month; returns a point for every month 0..months. Buckets are treated as independent (a simplification). */
export function projectRange(input: ProjectionInput): ProjectionPoint[] {
  const { start, monthly, months } = input;
  const paths = input.paths ?? 2000;
  const a = input.assumptions ?? DEFAULT_ASSUMPTIONS;
  const rand = mulberry32(input.seed ?? 20261118);
  const normal = () => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  // Log-normal monthly growth whose mean annual return equals annualReturnPct.
  const params = Object.fromEntries(
    BUCKETS.map((b) => {
      const sigmaA = a[b].annualVolPct / 100;
      const muLog = Math.log(1 + a[b].annualReturnPct / 100) - (sigmaA * sigmaA) / 2;
      return [b, { drift: muLog / 12, sigma: sigmaA / Math.sqrt(12) }];
    }),
  ) as Record<Bucket, { drift: number; sigma: number }>;

  const totals: number[][] = Array.from({ length: months + 1 }, () => new Array(paths));
  const startTotal = BUCKETS.reduce((s, b) => s + start[b], 0);
  const monthlyTotal = BUCKETS.reduce((s, b) => s + monthly[b], 0);
  for (let p = 0; p < paths; p++) {
    const v = { ...start };
    totals[0][p] = startTotal;
    for (let m = 1; m <= months; m++) {
      let sum = 0;
      for (const b of BUCKETS) {
        const g = params[b].sigma === 0 ? Math.exp(params[b].drift) : Math.exp(params[b].drift + params[b].sigma * normal());
        v[b] = v[b] * g + monthly[b];
        sum += v[b];
      }
      totals[m][p] = sum;
    }
  }
  return totals.map((vals, month) => {
    const contributed = (input.contributedBase ?? startTotal) + monthlyTotal * month;
    const sorted = [...vals].sort((x, y) => x - y);
    const below = vals.filter((x) => x < contributed - 0.5).length;
    return {
      month,
      contributed: round2(contributed),
      p10: round2(quantile(sorted, 0.1)),
      p50: round2(quantile(sorted, 0.5)),
      p90: round2(quantile(sorted, 0.9)),
      chanceBelowContributed: month === 0 ? 0 : Math.round((below / paths) * 100),
    };
  });
}
