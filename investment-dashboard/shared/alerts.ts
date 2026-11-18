// Alert rules. Each rule explains WHY it matters; noise is filtered by requiring moves that are
// large relative to the instrument's own typical volatility.

import type { ResearchNote, ValuedHolding } from "./types.ts";
import type { RiskReport, RiskThresholds } from "./risk.ts";

export interface AlertCandidate {
  kind: string;
  severity: "info" | "warning" | "critical";
  symbol: string | null;
  title: string;
  why: string;
  dedupeKey: string; // same key on the same day is never raised twice
}

export interface Announcement {
  company: string;
  subject: string;
  link: string;
  published: string;
}

const NEGATIVE = /(resign|default|pledge|fraud|forensic|sebi order|show cause|insolven|nclt|qualified opinion|search and seizure|downgrade|penalt|suspension)/i;
const RESULTS = /(financial result|outcome of board meeting|results)/i;
// Material corporate actions worth knowing about for a stock you own. Routine compliance filings
// (trading window, interest payment confirmations, analyst-meet schedules…) are deliberately ignored.
const MATERIAL = /(dividend|bonus|split|sub-division|buy ?back|acquisition|merger|amalgamation|demerger|rights issue|credit rating|scheme of arrangement|open offer|delisting|board meeting intimation)/i;

export function normaliseCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|the|india|co|company|corporation|corp)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when an exchange filer name refers to the same company as `name` (normalised exact or long-prefix match). */
export function matchesCompany(filer: string, name: string): boolean {
  const a = normaliseCompany(filer);
  const b = normaliseCompany(name);
  if (b.length < 3) return false;
  return a === b || (b.length > 6 && a.startsWith(b + " "));
}

export function priceMoveAlerts(
  holdings: ValuedHolding[],
  dailyVolPct: Map<string, number>,
  t: RiskThresholds,
  day: string,
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const h of holdings) {
    if (h.price === null || h.dayChange === null || h.quantity <= 0) continue;
    const prev = h.price - h.dayChange / h.quantity;
    if (prev <= 0) continue;
    const move = (h.price / prev - 1) * 100;
    const vol = dailyVolPct.get(h.symbol);
    const threshold = Math.max(t.priceMoveAlertPct, vol ? 2.5 * vol : 0);
    if (Math.abs(move) < threshold) continue;
    const sigma = vol ? Math.abs(move) / vol : null;
    out.push({
      kind: "price_move",
      severity: Math.abs(move) >= threshold * 2 ? "critical" : "warning",
      symbol: h.symbol,
      title: `${h.symbol} ${move > 0 ? "up" : "down"} ${Math.abs(move).toFixed(1)}% today`,
      why:
        `This is ${sigma ? `${sigma.toFixed(1)}× its typical daily move` : `above your ${t.priceMoveAlertPct}% alert threshold`}. ` +
        `Impact on you: ${h.dayChange >= 0 ? "+" : ""}₹${Math.round(h.dayChange).toLocaleString("en-IN")}. ` +
        "Large moves usually have a cause — check announcements before acting; do not trade on the move alone.",
      dedupeKey: `price_move:${h.symbol}:${day}`,
    });
  }
  return out;
}

export function riskAlerts(report: RiskReport, day: string): AlertCandidate[] {
  return report.warnings
    .filter((w) => w.severity !== "info")
    .map((w) => ({ kind: "risk", severity: w.severity, symbol: null, title: w.title, why: w.why, dedupeKey: `risk:${w.title.replace(/[\d.]+%/g, "")}:${day.slice(0, 7)}` }));
}

export function drawdownAlert(currentDrawdownPct: number, t: RiskThresholds, day: string): AlertCandidate[] {
  if (currentDrawdownPct > -t.maxDrawdownAlertPct) return [];
  return [
    {
      kind: "drawdown",
      severity: currentDrawdownPct <= -t.maxDrawdownAlertPct * 1.5 ? "critical" : "warning",
      symbol: null,
      title: `Portfolio is ${Math.abs(currentDrawdownPct).toFixed(1)}% below its peak`,
      why: `Beyond your ${t.maxDrawdownAlertPct}% drawdown threshold. Re-read each thesis: sell only if the business case is broken, not because the price fell. Check whether the drop is market-wide or specific to your holdings.`,
      dedupeKey: `drawdown:${day.slice(0, 7)}`,
    },
  ];
}

export function researchAlerts(notes: ResearchNote[], prices: Map<string, number>, today: string): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const n of notes) {
    const p = prices.get(n.symbol);
    if (n.targetPrice && p !== undefined && p <= n.targetPrice && n.status !== "rejected") {
      out.push({
        kind: "target_valuation",
        severity: "info",
        symbol: n.symbol,
        title: `${n.symbol} at ₹${p} — at/below your entry level of ₹${n.targetPrice}`,
        why: "Price has reached the valuation level you set during research. Re-check that the thesis and fundamentals still hold (a falling price can signal a deteriorating business) before considering a staged entry.",
        dedupeKey: `target:${n.symbol}:${today}`,
      });
    }
    if (n.reviewBy && n.reviewBy <= today && n.status !== "rejected") {
      out.push({
        kind: "thesis_review",
        severity: "info",
        symbol: n.symbol,
        title: `Thesis review due for ${n.symbol}`,
        why: `You scheduled a review for ${n.reviewBy}. Check the latest results against your thesis and invalidation conditions: "${n.invalidation.slice(0, 160)}"`,
        dedupeKey: `review:${n.symbol}:${n.reviewBy}`,
      });
    }
  }
  return out;
}

export function announcementAlerts(
  anns: Announcement[],
  tracked: { symbol: string; name: string; owned: boolean }[],
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const a of anns) {
    const hit = tracked.find((t) => matchesCompany(a.company, t.name));
    if (!hit) continue;
    const negative = NEGATIVE.test(a.subject);
    const results = RESULTS.test(a.subject);
    const material = MATERIAL.test(a.subject);
    if (!negative && !results && !(hit.owned && material)) continue; // no alerts for routine filings
    out.push({
      kind: negative ? "negative_development" : results ? "results" : "corporate_action",
      severity: negative ? (hit.owned ? "critical" : "warning") : "info",
      symbol: hit.symbol,
      title: `${hit.symbol}: ${a.subject.slice(0, 120)}`,
      why: negative
        ? `Potentially negative corporate development for a ${hit.owned ? "stock you own" : "watchlist stock"}. Read the filing (${a.link}) and test it against your thesis invalidation conditions.`
        : results
          ? `New results/board outcome filed. Compare revenue, margin and EPS trends with your thesis before the next review. Filing: ${a.link}`
          : `Corporate action for a stock you own — check record dates and how it affects your holding: ${a.link}`,
      dedupeKey: `ann:${hit.symbol}:${a.link}`,
    });
  }
  return out;
}

/** Quantitative thesis tripwires from the latest recorded fundamentals of owned/watchlist stocks. */
export function thesisAlerts(notes: ResearchNote[], owned: Set<string>, today: string): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const n of notes) {
    if (n.status === "rejected" || n.assetClass !== "EQUITY") continue;
    const f = n.fundamentals;
    const isFin = /(bank|nbfc|finance|insurance)/i.test(n.sector ?? "");
    const trips: string[] = [];
    if ((f.profitCagr3y?.value ?? 0) < 0) trips.push(`profit has shrunk (3-yr CAGR ${f.profitCagr3y!.value}%, ${f.profitCagr3y!.asOf})`);
    if ((f.revenueCagr3y?.value ?? 0) < 0) trips.push(`revenue has shrunk (3-yr CAGR ${f.revenueCagr3y!.value}%)`);
    if (!isFin && (f.debtToEquity?.value ?? 0) > 1.5) trips.push(`debt/equity is ${f.debtToEquity!.value} (dangerously high for a non-financial company)`);
    if ((f.promoterPledge?.value ?? 0) > 10) trips.push(`promoter pledge is ${f.promoterPledge!.value}%`);
    if ((f.governanceFlags?.value ?? 0) > 0) trips.push(`${f.governanceFlags!.value} governance flag(s) recorded`);
    if ((f.roe?.value ?? 99) < 10) trips.push(`ROE has fallen to ${f.roe!.value}% — competitive advantage may be weakening`);
    if (!trips.length) continue;
    out.push({
      kind: "thesis_tripwire",
      severity: owned.has(n.symbol) ? "critical" : "warning",
      symbol: n.symbol,
      title: `${n.symbol}: thesis check — ${trips.length} warning sign(s)`,
      why: `Your recorded figures show ${trips.join("; ")}. Compare with your thesis and invalidation conditions ("${n.invalidation.slice(0, 140) || "none written"}") before adding money.`,
      dedupeKey: `tripwire:${n.symbol}:${trips.join("|").length}:${today.slice(0, 7)}`,
    });
  }
  return out;
}
