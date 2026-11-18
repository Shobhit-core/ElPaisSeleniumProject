// AI Investment Analyst.
//  * "local" mode (always available): deterministic, explainable answers computed from YOUR data.
//  * "research" mode (needs ANTHROPIC_API_KEY): Claude with live web search, instructed to prioritise
//    official sources (NSE, BSE, SEBI, AMFI, RBI, company filings) and to cite every factual claim.

import Anthropic from "@anthropic-ai/sdk";
import type { DB } from "../db.ts";
import { getSetting } from "../db.ts";
import { formatINR, formatPct } from "../../shared/format.ts";
import { assessReadiness, buildScenarios, type Scenario } from "../../shared/allocation.ts";
import { buildRiskReport, DEFAULT_THRESHOLDS, type RiskThresholds } from "../../shared/risk.ts";
import { compositeRank, fundamentalScore, valuation } from "../../shared/scoring.ts";
import type { ValuedHolding } from "../../shared/types.ts";
import { getProfile, listNotes, portfolioSnapshot } from "./journal.ts";
import { log } from "../log.ts";

export const ANALYST_MODEL = process.env.ANALYST_MODEL || "claude-opus-5-5";

export interface AnalystAnswer {
  mode: "local" | "research";
  answer: string;
  sources: { title: string; url: string }[];
  generatedAt: string;
  caveat: string;
}

const CAVEAT =
  "Research and education only — not personalised investment advice from a SEBI-registered investment adviser. Verify figures at the linked sources before acting; every trade needs your own review and confirmation.";

function bucketOf(h: ValuedHolding): Scenario["lines"][number]["key"] | "other" {
  switch (h.assetClass) {
    case "EQUITY":
      return "stocks";
    case "EQUITY_ETF":
    case "EQUITY_MF":
      return "nifty50";
    case "DEBT_MF":
    case "CASH":
      return "liquid";
    case "GOLD_ETF":
      return "gold";
    case "GSEC":
      return "short_debt";
  }
}

/** Where should the next ₹X go? Fill the biggest gaps vs the target scenario; never exceed equity caps. */
export function nextMoney(db: DB, amount: number): string {
  const profile = getProfile(db);
  if (!profile) return "Complete the onboarding profile first — I cannot suggest where money should go without knowing your horizon, risk tolerance and emergency-fund position.";
  const r = assessReadiness(profile);
  if (!r.ready) return `Before investing in markets:\n- ${r.blockers.join("\n- ")}\n\nSuggested use of ${formatINR(amount, { decimals: 0 })}: put it towards your emergency fund in a liquid fund or bank sweep FD.`;
  const chosenId = getSetting<string>(db, "chosen_scenario", "");
  const scenarios = buildScenarios(profile, 100);
  const target = scenarios.find((s) => s.id === chosenId) ?? [...scenarios].reverse().find((s) => s.suitability === "suitable") ?? scenarios[0];
  const { holdings, summary } = portfolioSnapshot(db);
  const merged = new Map<string, number>();
  for (const h of holdings) {
    const b = bucketOf(h);
    const k = b === "next50_mid" ? "nifty50" : b;
    merged.set(k, (merged.get(k) ?? 0) + (h.currentValue ?? h.invested));
  }
  const cashNow = Math.max(summary.cash, 0);
  const total = [...merged.values()].reduce((s, v) => s + v, 0) + cashNow + amount;
  const targetPct = new Map<string, number>();
  for (const l of target.lines) {
    const k = l.key === "next50_mid" ? "nifty50" : l.key === "short_debt" ? "liquid" : l.key;
    targetPct.set(k, (targetPct.get(k) ?? 0) + l.pct);
  }
  const gaps = [...targetPct.entries()]
    .map(([k, pct]) => ({ k, gap: (pct / 100) * total - (merged.get(k) ?? 0) - (k === "liquid" ? cashNow : 0) }))
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.gap - a.gap);
  const names: Record<string, string> = { nifty50: "diversified equity index fund/ETF (Nifty 50 core)", stocks: "researched individual stocks", gold: "gold ETF", liquid: "liquid / short-duration debt fund" };
  if (!gaps.length) return `Your portfolio is already at or above every target in the "${target.label}" plan. Keep ${formatINR(amount, { decimals: 0 })} in a liquid fund until a gap opens, rather than forcing a purchase.`;
  const MIN_TICKET = 500; // smaller slices are not worth the charges/complexity — they roll into the liquid fund
  let left = amount;
  const out: string[] = [];
  for (const g of gaps) {
    if (left <= 0) break;
    const put = Math.min(left, g.gap);
    if (put < MIN_TICKET) continue;
    left -= put;
    out.push(`- ${formatINR(put, { decimals: 0 })} → ${names[g.k] ?? g.k} (currently under target by ${formatINR(g.gap, { decimals: 0 })})`);
  }
  if (left > 0) out.push(`- ${formatINR(left, { decimals: 0 })} → liquid fund (remaining gaps too small to fill efficiently)`);
  const stockNote = gaps.some((g) => g.k === "stocks")
    ? "\n\nThe stock sleeve should only be filled with a name that passes the Research screen with a written thesis and a valuation you are comfortable with — otherwise route that amount to the index fund."
    : "";
  return `Based on your "${target.label}" target allocation (equity cap ${r.equityCapPct}%), filling the largest gaps first:\n${out.join("\n")}${stockNote}\n\nWith small amounts, check charges: a ₹20 brokerage on a ₹1,000 stock purchase is already 2% before you start. Mutual-fund purchases carry no brokerage on direct plans.`;
}

export function localAnswer(db: DB, question: string): AnalystAnswer {
  const q = question.toLowerCase();
  const profile = getProfile(db);
  const thresholds = getSetting<RiskThresholds>(db, "risk_thresholds", DEFAULT_THRESHOLDS);
  const { holdings, summary } = portfolioSnapshot(db);
  const risk = buildRiskReport(holdings, summary.cash, profile, thresholds);
  const parts: string[] = [];
  const amt = /₹?\s?([\d,]{3,})/.exec(question)?.[1];

  if (/(next|where should|invest my|deploy)/.test(q)) {
    parts.push(nextMoney(db, amt ? Number(amt.replace(/,/g, "")) : 5000));
  } else if (/(perform|how am i doing|returns?|p&l|profit)/.test(q)) {
    const best = [...holdings].filter((h) => h.returnPct !== null).sort((a, b) => b.returnPct! - a.returnPct!);
    parts.push(
      `Invested ${formatINR(summary.invested)}; current value ${formatINR(summary.currentValue)}; unrealised P&L ${formatINR(summary.unrealisedPnl, { sign: true })} (${formatPct(summary.returnPct, { sign: true })}). Realised P&L ${formatINR(summary.realisedPnl, { sign: true })}, dividends ${formatINR(summary.dividends)}, charges paid ${formatINR(summary.totalCharges)}.`,
    );
    if (best.length) parts.push(`Best: ${best[0].symbol} ${formatPct(best[0].returnPct, { sign: true })}. Weakest: ${best[best.length - 1].symbol} ${formatPct(best[best.length - 1].returnPct, { sign: true })}.`);
    if (summary.missingPrices.length) parts.push(`No current price for: ${summary.missingPrices.join(", ")} (valued at cost).`);
    parts.push("Judge performance over years, not weeks; compare against a Nifty 50 index fund over the same period before concluding a stock pick is working.");
  } else if (/(risk|overexpos|concentrat|sector|diversif)/.test(q)) {
    parts.push(`Equity ${risk.equityPct.toFixed(0)}% · liquid ${risk.liquidPct.toFixed(0)}% · effective number of holdings ${risk.effectiveHoldings?.toFixed(1) ?? "—"}.`);
    parts.push(`Sector mix: ${risk.sectors.map((s) => `${s.sector} ${s.pct.toFixed(0)}%`).join(", ") || "no holdings"}.`);
    parts.push(risk.warnings.length ? `Issues:\n${risk.warnings.map((w) => `- [${w.severity}] ${w.title}: ${w.why}`).join("\n")}` : "No concentration or profile-mismatch issues against your thresholds.");
  } else if (/(worth research|which stocks|watchlist|undervalued|overvalued|buy more|should i buy|wait)/.test(q)) {
    const notes = listNotes(db).filter((n) => n.status !== "rejected");
    const ranked = notes
      .map((n) => {
        const f = fundamentalScore(n.fundamentals);
        const v = valuation(n.fundamentals);
        return { n, f, v, rank: compositeRank(f, v) };
      })
      .sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1));
    const mentioned = ranked.find((x) => q.includes(x.n.symbol.toLowerCase()) || q.includes(x.n.name.toLowerCase()));
    if (mentioned) {
      parts.push(`${mentioned.n.symbol}: fundamental score ${mentioned.f.score ?? "withheld"} (confidence ${mentioned.f.confidence}%). Valuation: ${mentioned.v.summary}.`);
      parts.push(`Your thesis: ${mentioned.n.thesis || "(none written)"}\nInvalidation: ${mentioned.n.invalidation || "(none written)"}`);
      parts.push(
        mentioned.v.peLabel === "premium" || mentioned.v.pegLabel === "expensive"
          ? "Valuation is stretched on your own data — waiting for a better price or staging small entries is the disciplined choice."
          : "Valuation is not stretched on your data; if the thesis still holds, staged buying within your allocation limits is reasonable.",
      );
    } else if (ranked.length) {
      parts.push("From your research notes (ranking methodology on the Recommendations page):");
      for (const x of ranked.slice(0, 5)) parts.push(`- ${x.n.symbol}: rank ${x.rank ?? "n/a (insufficient data)"}, valuation: ${x.v.summary}`);
    } else parts.push("You have no research notes yet. Add companies on the Stock Research page with sourced fundamentals; the dashboard will not invent them.");
    parts.push("For live market valuations and news, configure ANTHROPIC_API_KEY to enable research mode with web sources.");
  } else {
    parts.push("Local mode answers questions about your own portfolio (performance, risk/concentration, where to put new money, your watchlist). Market-wide questions need research mode, which uses live web search with sources — set ANTHROPIC_API_KEY on the server to enable it.");
  }
  if (!profile) parts.push("\nNote: your investor profile is incomplete, so suitability checks are limited.");
  return { mode: "local", answer: parts.join("\n\n"), sources: [], generatedAt: new Date().toISOString(), caveat: CAVEAT };
}

const SYSTEM_PROMPT = `You are the research analyst inside a personal investment dashboard for an Indian retail investor (beginner-to-intermediate). Today's date is provided in the user turn.

Principles:
- Capital preservation, sensible valuations, diversification and long-term compounding come first. Challenge weak ideas plainly; recommend against an investment when evidence does not support it.
- Use web search for any market fact (prices, valuations, results, news, rates). Prefer official sources in this order: NSE, BSE, SEBI, RBI, AMFI, company annual reports / quarterly results / investor presentations, AMC factsheets; then reputable financial media. Avoid forums, tip sites and social media.
- Never state a number you did not get from a source or from the portfolio data provided. If you cannot verify something, say so.
- Separate clearly: **Verified facts** (with source and date), **Assumptions**, and **Analysis/opinion**.
- For any security you discuss: valuation versus its own history and peers, key risks, and what would invalidate the thesis.
- Never recommend F&O, leverage, intraday trading, penny stocks, or concentrating the user's small capital. Never promise returns.
- You are not a SEBI-registered investment adviser; frame output as research to support the user's own decision. Any trade requires the user's own review and confirmation; you cannot place orders.
- Be concise: lead with the answer, then the evidence. Use INR with Indian digit grouping.`;

export async function researchAnswer(db: DB, question: string, client?: Anthropic): Promise<AnalystAnswer> {
  const anthropic = client ?? new Anthropic();
  const profile = getProfile(db);
  const { holdings, summary } = portfolioSnapshot(db);
  const risk = buildRiskReport(holdings, summary.cash, profile, getSetting(db, "risk_thresholds", DEFAULT_THRESHOLDS));
  const context = {
    today: new Date().toISOString().slice(0, 10),
    profile,
    readiness: profile ? assessReadiness(profile) : null,
    summary,
    holdings: holdings.map((h) => ({ symbol: h.symbol, name: h.name, class: h.assetClass, sector: h.sector, qty: h.quantity, avg: h.avgPrice, price: h.price, priceAsOf: h.priceAsOf, weightPct: h.weight && Math.round(h.weight * 10) / 10, returnPct: h.returnPct && Math.round(h.returnPct * 10) / 10 })),
    riskWarnings: risk.warnings.map((w) => w.title),
    researchNotes: listNotes(db).map((n) => ({ symbol: n.symbol, status: n.status, thesis: n.thesis.slice(0, 400), invalidation: n.invalidation.slice(0, 300) })),
  };
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    { role: "user", content: `Portfolio context (from the user's dashboard, JSON):\n${JSON.stringify(context)}\n\nQuestion: ${question}` },
  ];
  const sources = new Map<string, string>();
  let text = "";
  for (let turn = 0; turn < 4; turn++) {
    const res = await anthropic.beta.messages.create({
      model: ANALYST_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "IN", timezone: "Asia/Kolkata" } }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    });
    for (const block of res.content) {
      if (block.type === "text") {
        text += block.text;
        for (const c of block.citations ?? []) if ("url" in c && c.url) sources.set(c.url, ("title" in c && c.title) || c.url);
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === "web_search_result") sources.set(r.url, r.title);
      }
    }
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
      continue;
    }
    if (res.stop_reason === "refusal") text ||= "The model declined to answer this question.";
    break;
  }
  log.info("analyst_research", { chars: text.length, sources: sources.size });
  return {
    mode: "research",
    answer: text.trim() || "No answer was produced.",
    sources: [...sources.entries()].map(([url, title]) => ({ url, title })),
    generatedAt: new Date().toISOString(),
    caveat: CAVEAT,
  };
}

export function researchAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
