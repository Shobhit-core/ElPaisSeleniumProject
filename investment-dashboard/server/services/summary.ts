// Plain-text portfolio summary for pasting into a Claude chat.
// Contains NO passwords, keys, tokens, broker user names or account identifiers.
// With amounts=false every ₹ figure is replaced by percentages only.

import type { DB } from "../db.ts";
import { getSetting } from "../db.ts";
import { formatINR, formatPct, formatQty, describeAge } from "../../shared/format.ts";
import { assessReadiness, buildScenarios } from "../../shared/allocation.ts";
import { allocationBy, xirr } from "../../shared/portfolio.ts";
import { buildRiskReport, DEFAULT_THRESHOLDS, type RiskThresholds } from "../../shared/risk.ts";
import { compositeRank, fundamentalScore, valuation } from "../../shared/scoring.ts";
import { getProfile, listNotes, portfolioSnapshot } from "./journal.ts";
import { listAlerts } from "./alertsService.ts";

const CLASS: Record<string, string> = { EQUITY: "Stock", EQUITY_ETF: "Equity ETF", EQUITY_MF: "Equity fund", DEBT_MF: "Debt/liquid fund", GOLD_ETF: "Gold", GSEC: "Govt bond", CASH: "Cash" };
const PROFILE_LABEL: Record<string, Record<string, string>> = {
  emergencyFund: { full: "yes, fully", partial: "partly", none: "no" },
  needWithin12Months: { yes: "yes", maybe: "possibly", no: "no" },
  preference: { mutual_funds: "mutual funds", etfs: "ETFs", stocks: "individual stocks", combination: "a combination" },
};

export function buildSummary(db: DB, opts: { amounts: boolean }): string {
  const money = (v: number | null | undefined) => (opts.amounts ? formatINR(v, { decimals: 0 }) : "[hidden]");
  const out: string[] = [];
  const now = new Date();
  out.push(`MY INVESTMENT DASHBOARD SUMMARY — ${now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);
  out.push("Please explain this in simple words and tell me what, if anything, I should do next. Point out risks and mistakes honestly.");
  if (!opts.amounts) out.push("(Rupee amounts hidden by me; percentages are real.)");

  // Profile
  const p = getProfile(db);
  out.push("", "## My profile");
  if (!p) out.push("Not completed yet.");
  else {
    out.push(
      `- Horizon: ${p.horizon} years · Risk tolerance: ${p.riskTolerance} · Can tolerate a temporary fall of: ${p.lossTolerance}%`,
      `- Emergency fund: ${PROFILE_LABEL.emergencyFund[p.emergencyFund]} · Might need this money within 12 months: ${PROFILE_LABEL.needWithin12Months[p.needWithin12Months]}`,
      `- Prefers: ${PROFILE_LABEL.preference[p.preference]} · Monthly investing capacity: ${money(p.monthlyCapacity)} · Capital planned: ${money(p.capital)} · Tax slab: ${p.taxSlabPct}%`,
    );
    const r = assessReadiness(p);
    out.push(`- Equity limit from my profile: ${r.equityCapPct}%`);
    for (const b of r.blockers) out.push(`- BLOCKER: ${b}`);
    for (const c of r.cautions) out.push(`- Caution: ${c}`);
    const scen = buildScenarios(p, p.capital);
    const chosen = scen.find((s) => s.id === getSetting<string>(db, "chosen_scenario", ""));
    const shown = chosen ?? scen.find((s) => s.suitability === "suitable") ?? scen[0];
    out.push("", `## Target plan: ${shown.label}${chosen ? " (chosen by me)" : " (not yet chosen — default suggestion)"}`);
    for (const l of shown.lines) out.push(`- ${l.instrument}: ${l.pct}% (${money(l.amount)}) — risk ${l.risk}, horizon ${l.horizon}`);
  }

  // Portfolio
  const { holdings, summary, ledger, txns } = portfolioSnapshot(db);
  out.push("", "## Portfolio now");
  if (!holdings.length && summary.cash === 0) out.push("No holdings or cash recorded yet.");
  else {
    out.push(
      `- Invested: ${money(summary.invested)} · Current value: ${money(summary.currentValue)} · Available cash: ${money(summary.cash)}`,
      `- Unrealised P&L: ${money(summary.unrealisedPnl)} (${formatPct(summary.returnPct, { sign: true })}) · Realised P&L: ${money(summary.realisedPnl)} · Dividends: ${money(summary.dividends)} · Charges paid: ${money(summary.totalCharges)}`,
    );
    const flows = txns
      .filter((t) => t.type !== "DIVIDEND")
      .map((t) => ({ date: t.date, amount: (t.type === "BUY" ? -1 : 1) * t.quantity * t.price - (t.brokerage + t.stt + t.otherCharges) }))
      .concat(ledger.dividends.map((d) => ({ date: d.date, amount: d.amount })))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (summary.currentValue > 0) flows.push({ date: now.toISOString().slice(0, 10), amount: summary.currentValue });
    const x = xirr(flows);
    if (x !== null) out.push(`- Annualised return (XIRR): ${formatPct(x, { sign: true })}${txns.length && Date.now() - Date.parse(txns[txns.length - 1].date) < 365 * 86400_000 ? " — under 1 year of history, so not meaningful yet" : ""}`);
    out.push(`- Allocation: ${allocationBy(holdings, (h) => CLASS[h.assetClass] ?? h.assetClass, Math.max(summary.cash, 0)).map((a) => `${a.label} ${a.pct.toFixed(0)}%`).join(", ")}`);
    if (holdings.length) {
      out.push("", "## Holdings");
      for (const h of holdings) {
        const name = h.symbol.startsWith("MF:") ? h.name : `${h.symbol} (${h.name})`;
        const qty = opts.amounts ? `${formatQty(h.quantity)} units, avg ₹${h.avgPrice}, ` : "";
        const price = h.price !== null ? `price ₹${h.price} (${describeAge(h.priceAsOf)})` : "no current price";
        out.push(`- ${name} — ${CLASS[h.assetClass] ?? h.assetClass}${h.sector ? `, ${h.sector}` : ""}: ${qty}${price}, value ${money(h.currentValue ?? h.invested)}, return ${formatPct(h.returnPct, { sign: true })}, ${formatPct(h.weight, { decimals: 1 })} of holdings`);
      }
    }
    if (summary.missingPrices.length) out.push(`- Unpriced (valued at cost): ${summary.missingPrices.join(", ")}`);
  }

  // Risk
  const t = getSetting<RiskThresholds>(db, "risk_thresholds", DEFAULT_THRESHOLDS);
  const risk = buildRiskReport(holdings, summary.cash, p, t);
  out.push("", "## Risk check");
  out.push(`- Equity ${risk.equityPct.toFixed(0)}% · Cash & liquid ${risk.liquidPct.toFixed(0)}% · Effective number of holdings ${risk.effectiveHoldings?.toFixed(1) ?? "—"}`);
  if (!risk.warnings.length) out.push("- No warnings against my thresholds.");
  for (const w of risk.warnings) out.push(`- [${w.severity}] ${w.title}`);

  // Alerts
  const alerts = listAlerts(db, 50).filter((a) => !a.readAt).slice(0, 5);
  if (alerts.length) {
    out.push("", "## Unread alerts");
    for (const a of alerts) out.push(`- [${a.severity}] ${a.title}`);
  }

  // Research watchlist
  const notes = listNotes(db).filter((n) => n.status !== "rejected");
  if (notes.length) {
    out.push("", "## My research watchlist");
    for (const n of notes) {
      const f = fundamentalScore(n.fundamentals);
      const v = valuation(n.fundamentals);
      out.push(`- ${n.symbol} (${n.status}): rank ${compositeRank(f, v) ?? "n/a"}, data confidence ${f.confidence}%, valuation: ${v.summary}${n.thesis ? `. Thesis: ${n.thesis.slice(0, 200)}` : ""}`);
    }
  }

  // Recent trades
  if (txns.length) {
    out.push("", "## Recent trades (latest 10)");
    for (const x of txns.slice(0, 10)) {
      const amt = opts.amounts ? (x.type === "DIVIDEND" ? ` ₹${x.price}` : ` ${formatQty(x.quantity)} @ ₹${x.price}`) : "";
      const why = x.type === "SELL" ? x.exitRationale : x.rationale;
      out.push(`- ${x.date} ${x.type} ${x.symbol.startsWith("MF:") ? x.name : x.symbol}${amt}${why ? ` — why: ${why.slice(0, 120)}` : ""}`);
    }
  }
  out.push("", "Source: my self-hosted dashboard (prices from Upstox/AMFI with the ages shown). Research and education only — I make my own decisions.");
  return out.join("\n");
}
