// Simulated investment committee. Six independent, rule-based reviewers examine the same evidence;
// their votes are NOT forced to agree. The default outcome is "NO INVESTMENT RECOMMENDATION".

import type { Fundamentals } from "./types.ts";
import type { ScoreResult, ValuationResult } from "./scoring.ts";
import type { IntrinsicSummary } from "./valuation.ts";
import type { SizingResult } from "./riskEngine.ts";

export type Vote = "Support" | "Neutral" | "Oppose" | "Insufficient evidence";

export interface MemberReview {
  member: string;
  focus: string;
  vote: Vote;
  reasons: string[];
}

export interface CommitteeInput {
  symbol: string;
  price: number | null;
  fundamentals: Fundamentals;
  score: ScoreResult;
  relValuation: ValuationResult;
  intrinsic: IntrinsicSummary;
  scenarios: { bear: number | null; base: number | null; bull: number | null; basis: string };
  riskScore: number | null;
  volatilityPct: number | null;
  maxDrawdown1yPct: number | null;
  sizing: SizingResult;
  readinessOk: boolean;
  marketFromHighPct: number | null; // Nifty distance from 52-week high
  rateTrend: "rising" | "falling" | "stable" | "unknown";
  sector: string | null;
  thesis: string;
  invalidation: string;
  growthDrivers: string;
  risks: string;
  requiredMarginOfSafetyPct: number;
}

export interface CommitteeOutcome {
  members: MemberReview[];
  decision: "ELIGIBLE FOR STAGED PURCHASE" | "WATCHLIST — PRICE TOO HIGH" | "NO INVESTMENT RECOMMENDATION";
  decisionReasons: string[];
  maxAmount: number;
  buyBelow: number | null;
  cases: { bull: number | null; base: number | null; bear: number | null; basis: string };
  reconsiderWhen: string[];
}

const v = (f: Fundamentals, k: keyof Fundamentals) => f[k]?.value;

export function runCommittee(c: CommitteeInput): CommitteeOutcome {
  const f = c.fundamentals;
  const members: MemberReview[] = [];
  const mos = c.intrinsic.marginOfSafetyPct;

  // 1. Value investor (Graham/Buffett): price vs intrinsic value, balance sheet
  {
    const r: string[] = [];
    let vote: Vote;
    if (c.intrinsic.confidence === "insufficient" || mos === null) {
      vote = "Insufficient evidence";
      r.push("Fewer than two valuation methods (or no price) — cannot judge value.");
    } else {
      r.push(`Intrinsic value range ₹${c.intrinsic.low!.toFixed(0)}–₹${c.intrinsic.high!.toFixed(0)}, median ₹${c.intrinsic.median!.toFixed(0)}; margin of safety ${mos.toFixed(0)}%.`);
      if (c.intrinsic.confidence === "low") r.push("Valuation methods disagree widely — low confidence.");
      vote = mos >= c.requiredMarginOfSafetyPct && c.intrinsic.confidence !== "low" ? "Support" : mos >= 0 ? "Neutral" : "Oppose";
    }
    const de = v(f, "debtToEquity");
    if (de !== undefined && de > 1) {
      r.push(`Debt/equity ${de} is high for a value investor.`);
      if (vote === "Support") vote = "Neutral";
    }
    members.push({ member: "Value investor", focus: "Intrinsic value, margin of safety, balance sheet", vote, reasons: r });
  }

  // 2. Growth investor (Fisher/Lynch)
  {
    const r: string[] = [];
    const g = [v(f, "revenueCagr3y"), v(f, "profitCagr3y"), v(f, "epsCagr3y")].filter((x): x is number => x !== undefined);
    let vote: Vote;
    if (g.length < 2) {
      vote = "Insufficient evidence";
      r.push("Needs at least two of revenue, profit and EPS growth.");
    } else {
      const avg = g.reduce((s, x) => s + x, 0) / g.length;
      r.push(`Average 3-year growth ${avg.toFixed(1)}%.`);
      const roe = v(f, "roe");
      if (roe !== undefined) r.push(`ROE ${roe}% ${roe >= 15 ? "supports reinvestment at good returns" : "is modest"}.`);
      vote = avg >= 12 && (roe ?? 0) >= 15 ? "Support" : avg >= 6 ? "Neutral" : "Oppose";
      if (c.relValuation.pegLabel === "expensive") {
        r.push(`PEG ${c.relValuation.peg?.toFixed(2)} — growth is already priced in.`);
        if (vote === "Support") vote = "Neutral";
      }
    }
    if (!c.growthDrivers.trim()) r.push("No growth drivers written down.");
    members.push({ member: "Growth investor", focus: "Durable growth, reinvestment, PEG", vote, reasons: r });
  }

  // 3. Financial risk analyst
  {
    const r: string[] = [];
    let vote: Vote = "Neutral";
    if (c.riskScore === null) {
      vote = "Insufficient evidence";
      r.push("Not enough data for a risk score.");
    } else {
      r.push(`Risk score ${c.riskScore}/100.`);
      vote = c.riskScore >= 60 ? "Oppose" : c.riskScore <= 35 ? "Support" : "Neutral";
    }
    if (c.volatilityPct !== null) r.push(`Volatility ${c.volatilityPct.toFixed(0)}%/yr; worst 1-year fall ${c.maxDrawdown1yPct?.toFixed(0) ?? "—"}%.`);
    const pledge = v(f, "promoterPledge");
    if (pledge !== undefined && pledge > 0) {
      r.push(`Promoter pledge ${pledge}% — forced selling risk in a downturn.`);
      vote = "Oppose";
    }
    if ((v(f, "governanceFlags") ?? 0) > 0) {
      r.push("Governance flags recorded.");
      vote = "Oppose";
    }
    members.push({ member: "Financial risk analyst", focus: "Leverage, governance, volatility", vote, reasons: r });
  }

  // 4. Macro analyst
  {
    const r: string[] = [];
    let vote: Vote = "Neutral";
    if (c.marketFromHighPct !== null) r.push(`Nifty is ${Math.abs(c.marketFromHighPct).toFixed(1)}% below its 52-week high.`);
    r.push(`Interest-rate trend: ${c.rateTrend}.`);
    const rateSensitive = /(bank|nbfc|finance|real|housing|infra|auto)/i.test(c.sector ?? "");
    if (c.rateTrend === "rising" && rateSensitive) {
      r.push(`${c.sector} is rate-sensitive — rising rates are a headwind.`);
      vote = "Oppose";
    } else if (c.marketFromHighPct !== null && c.marketFromHighPct <= -15) {
      r.push("Broad market already corrected — better entry environment.");
      vote = "Support";
    } else r.push("No strong macro signal either way; macro timing is unreliable.");
    members.push({ member: "Macroeconomic analyst", focus: "Rates, cycle, market level", vote, reasons: r });
  }

  // 5. Portfolio manager
  {
    const r: string[] = [];
    let vote: Vote;
    if (!c.readinessOk) {
      vote = "Oppose";
      r.push("Your profile currently blocks equity investing.");
    } else if (c.sizing.amount <= 0) {
      vote = "Oppose";
      r.push(...c.sizing.notes, `Binding limit: ${c.sizing.binding}.`);
    } else {
      vote = "Support";
      r.push(`Position size limit ₹${c.sizing.amount.toLocaleString("en-IN")} (${c.sizing.binding}).`);
    }
    members.push({ member: "Portfolio manager", focus: "Fit, sizing, concentration, correlation", vote, reasons: r });
  }

  // 6. Skeptical reviewer — actively searches for reasons NOT to invest
  const skeptic: string[] = [];
  if (c.score.confidence < 70) skeptic.push(`Only ${c.score.confidence}% of fundamental data entered.`);
  if (!c.thesis.trim()) skeptic.push("No written thesis.");
  if (!c.invalidation.trim()) skeptic.push("No invalidation conditions — you would not know when you are wrong.");
  if (!c.risks.trim()) skeptic.push("Risks section is empty.");
  if (c.relValuation.peLabel === "premium") skeptic.push(c.relValuation.summary);
  if ((v(f, "fcfPositiveYears5") ?? 5) < 4) skeptic.push("Free cash flow has been inconsistent — earnings quality may be weak.");
  if ((v(f, "profitCagr3y") ?? 0) > (v(f, "revenueCagr3y") ?? 0) + 15) skeptic.push("Profit is growing far faster than revenue — check for one-offs or margin peaks.");
  if (c.intrinsic.confidence === "low") skeptic.push("Valuation methods disagree by more than 2×.");
  if (c.scenarios.bear !== null && c.price !== null && c.scenarios.bear < c.price * 0.6) skeptic.push(`Bear-case value ₹${c.scenarios.bear.toFixed(0)} is >40% below today's price.`);
  skeptic.push("A Nifty 50 index fund already gives exposure to large companies without single-company risk — the stock must clearly beat that alternative.");
  const critical = skeptic.length - 1; // the index-fund reminder is always present and not itself disqualifying
  members.push({ member: "Skeptical independent reviewer", focus: "Reasons NOT to invest", vote: critical >= 2 ? "Oppose" : critical === 1 ? "Neutral" : "Neutral", reasons: skeptic });

  // ---- Decision (strict) ----
  const reasons: string[] = [];
  const opposes = members.filter((m) => m.vote === "Oppose").map((m) => m.member);
  const insufficient = members.filter((m) => m.vote === "Insufficient evidence").map((m) => m.member);
  if (insufficient.length) reasons.push(`Insufficient evidence for: ${insufficient.join(", ")}.`);
  if (opposes.length) reasons.push(`Opposed by: ${opposes.join(", ")}.`);
  let decision: CommitteeOutcome["decision"] = "NO INVESTMENT RECOMMENDATION";
  const buyBelow = c.intrinsic.buyBelowFor(c.requiredMarginOfSafetyPct);
  const nonPriceOpposes = opposes.filter((m) => m !== "Value investor");
  if (!insufficient.length && !nonPriceOpposes.length && c.score.confidence >= 70 && mos !== null) {
    if (mos >= c.requiredMarginOfSafetyPct && !opposes.length) {
      decision = "ELIGIBLE FOR STAGED PURCHASE";
      reasons.push(`No reviewer opposes; margin of safety ${mos.toFixed(0)}% ≥ required ${c.requiredMarginOfSafetyPct}%.`);
    } else {
      decision = "WATCHLIST — PRICE TOO HIGH";
      reasons.push(`The business passes every other check, but the margin of safety is ${mos.toFixed(0)}% (need ${c.requiredMarginOfSafetyPct}%). Buy only below about ₹${buyBelow?.toFixed(0)}.`);
    }
  } else if (!reasons.length) reasons.push(`Data confidence below 70% or no margin-of-safety estimate (need ${c.requiredMarginOfSafetyPct}% MoS).`);

  const reconsider = [
    ...(c.invalidation.trim() ? [`Your invalidation conditions: ${c.invalidation.trim()}`] : []),
    ...(buyBelow ? [`Price falls below ₹${buyBelow.toFixed(0)} (≥${c.requiredMarginOfSafetyPct}% margin of safety).`] : []),
    "New quarterly/annual results change growth, margins or debt materially.",
    "Governance events: auditor resignation, pledge increase, regulatory action.",
  ];
  return { members, decision, decisionReasons: reasons, maxAmount: decision === "ELIGIBLE FOR STAGED PURCHASE" ? c.sizing.amount : 0, buyBelow, cases: { bull: c.scenarios.bull, base: c.scenarios.base, bear: c.scenarios.bear, basis: c.scenarios.basis }, reconsiderWhen: reconsider };
}
