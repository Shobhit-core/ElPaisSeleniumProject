// "Family view": the portfolio explained in plain language for non-experts.

import type { DB } from "../db.ts";
import { getSetting } from "../db.ts";
import { assessReadiness, buildScenarios } from "../../shared/allocation.ts";
import { buildRiskReport, DEFAULT_THRESHOLDS, type RiskThresholds } from "../../shared/risk.ts";
import { BUCKETS, DEFAULT_ASSUMPTIONS, projectRange, type Bucket } from "../../shared/projection.ts";
import type { ValuedHolding } from "../../shared/types.ts";
import { getProfile, portfolioSnapshot } from "./journal.ts";
import { listAlerts } from "./alertsService.ts";

const SAFE_NAME = /(liquid|overnight|money market)/i;

export function bucketOf(h: Pick<ValuedHolding, "assetClass" | "name">): Bucket {
  switch (h.assetClass) {
    case "EQUITY":
    case "EQUITY_ETF":
    case "EQUITY_MF":
      return "growth";
    case "GOLD_ETF":
      return "gold";
    case "CASH":
      return "safe";
    case "DEBT_MF":
      return SAFE_NAME.test(h.name) ? "safe" : "steady";
    case "GSEC":
      return "steady";
  }
}

const zero = (): Record<Bucket, number> => ({ growth: 0, steady: 0, safe: 0, gold: 0 });

export function familyView(db: DB) {
  const profile = getProfile(db);
  const { holdings, summary, deposits } = portfolioSnapshot(db);
  const thresholds = getSetting<RiskThresholds>(db, "risk_thresholds", DEFAULT_THRESHOLDS);

  // ---- Today ----
  const now = zero();
  for (const h of holdings) now[bucketOf(h)] += h.currentValue ?? h.invested;
  if (summary.cash > 0) now.safe += summary.cash;
  const hasMoney = BUCKETS.some((b) => now[b] > 0);
  const total = BUCKETS.reduce((s, b) => s + now[b], 0);
  const putIn = deposits > 0 ? deposits : summary.invested;
  const gain = total - putIn;

  // ---- Plan (target split + monthly split) ----
  const scenarios = profile ? buildScenarios(profile, profile.capital) : [];
  const chosenId = getSetting<string>(db, "chosen_scenario", "");
  const plan = scenarios.find((s) => s.id === chosenId) ?? [...scenarios].reverse().find((s) => s.suitability === "suitable") ?? scenarios[0] ?? null;
  const targetPct = zero();
  if (plan) for (const l of plan.lines) {
    const b: Bucket = l.assumedClass === "equity" ? "growth" : l.assumedClass === "gold" ? "gold" : l.key === "liquid" ? "safe" : "steady";
    targetPct[b] += l.pct;
  }
  const monthlyAmount = profile?.monthlyCapacity ?? 0;
  // Monthly SIPs go to growth, gold and the bond fund (the liquid fund is only a parking place).
  const monthly = zero();
  if (plan && monthlyAmount > 0) {
    monthly.growth = (monthlyAmount * targetPct.growth) / 100;
    monthly.gold = (monthlyAmount * targetPct.gold) / 100;
    monthly.steady = monthlyAmount - monthly.growth - monthly.gold;
  }

  // ---- Projection (uses today's money, or the plan if nothing is invested yet) ----
  const basis: "actual" | "plan" | "none" = hasMoney ? "actual" : plan && profile ? "plan" : "none";
  const start = zero();
  if (basis === "actual") Object.assign(start, now);
  else if (basis === "plan") for (const b of BUCKETS) start[b] = (profile!.capital * targetPct[b]) / 100;
  const points = basis === "none" ? [] : projectRange({ start, monthly, months: 60, contributedBase: basis === "actual" ? putIn : undefined });
  const horizons = [6, 12, 24, 36, 60].map((m) => ({ months: m, label: m < 12 ? `${m} months` : m === 12 ? "1 year" : `${m / 12} years`, ...points[m] })).filter((h) => basis !== "none");

  // ---- Health check ----
  const risk = buildRiskReport(holdings, summary.cash, profile, thresholds);
  const unread = listAlerts(db, 50).filter((a) => !a.readAt);
  const issues: { level: "red" | "amber"; text: string }[] = [];
  if (!profile) issues.push({ level: "amber", text: "The profile questions are not answered yet, so the plan can't be checked." });
  else for (const b of assessReadiness(profile).blockers) issues.push({ level: "red", text: b });
  for (const w of risk.warnings) if (w.severity !== "info") issues.push({ level: w.severity === "critical" ? "red" : "amber", text: `${w.title}. ${w.why}` });
  for (const a of unread.filter((x) => x.severity === "critical").slice(0, 3)) issues.push({ level: "red", text: `${a.title}. ${a.why}` });
  if (summary.missingPrices.length) issues.push({ level: "amber", text: `We don't have today's price for ${summary.missingPrices.length} investment(s); they are counted at the amount paid.` });
  const status = issues.some((i) => i.level === "red") ? "red" : issues.length ? "amber" : "green";

  // ---- This month ----
  const todo: string[] = [];
  if (monthlyAmount > 0 && plan) {
    todo.push(`Monthly investment of ₹${Math.round(monthlyAmount).toLocaleString("en-IN")}: ₹${Math.round(monthly.growth).toLocaleString("en-IN")} to growth (Nifty 50 index fund), ₹${Math.round(monthly.steady).toLocaleString("en-IN")} to steady money (short-term bond fund)${monthly.gold ? `, ₹${Math.round(monthly.gold).toLocaleString("en-IN")} to gold` : ""}. If these are set up as SIPs, they happen automatically.`);
  }
  if (summary.cash >= 1000) todo.push(`₹${Math.round(summary.cash).toLocaleString("en-IN")} is sitting as cash. Invest it as per the plan, or move it to the liquid fund.`);
  if (plan && total > 0) {
    const growthPct = (now.growth / total) * 100;
    if (growthPct < targetPct.growth - 5) todo.push(`Growth money is ${Math.round(growthPct)}% of the total; the plan is ${targetPct.growth}%. Continue moving money from safe money into the Nifty 50 fund in monthly steps.`);
    if (growthPct > targetPct.growth + 5) todo.push(`Growth money is ${Math.round(growthPct)}% of the total, above the plan's ${targetPct.growth}%. At the next quarterly check, move the extra into safe money.`);
  }
  if (!todo.length) todo.push("Nothing to do this month. Let the investments work.");

  const plain = (b: Bucket) => DEFAULT_ASSUMPTIONS[b];
  return {
    asOf: new Date().toISOString(),
    hasProfile: !!profile,
    planLabel: plan?.label ?? null,
    today: { total, putIn, gain, gainPct: putIn > 0 ? (gain / putIn) * 100 : null, dayChange: summary.dayPnl },
    buckets: BUCKETS.map((b) => ({ key: b, label: plain(b).label, explain: plain(b).why, amount: now[b], pct: total > 0 ? (now[b] / total) * 100 : 0, targetPct: targetPct[b] })),
    health: { status, issues },
    todo,
    projection: {
      basis,
      monthlyTotal: monthlyAmount,
      points,
      horizons,
      assumptions: BUCKETS.map((b) => ({ key: b, ...DEFAULT_ASSUMPTIONS[b] })),
      method:
        "Simulates 2,000 possible futures month by month, adding the monthly investment each month, using the assumed average return and ups-and-downs of each type of money. 'Bad case' means 1 in 10 futures ended lower; 'good case' means 1 in 10 ended higher. These are not predictions or promises.",
    },
  };
}
