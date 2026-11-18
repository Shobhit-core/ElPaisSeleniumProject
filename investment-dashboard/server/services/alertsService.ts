import type { DB } from "../db.ts";
import { getSetting } from "../db.ts";
import { announcementAlerts, drawdownAlert, priceMoveAlerts, researchAlerts, riskAlerts, thesisAlerts, type AlertCandidate } from "../../shared/alerts.ts";
import { buildRiskReport, dailyReturns, DEFAULT_THRESHOLDS, stdev, type RiskThresholds } from "../../shared/risk.ts";
import type { Alert } from "../../shared/types.ts";
import { getProfile, listNotes, portfolioSnapshot } from "./journal.ts";
import { announcements, getQuotes, storedHistory } from "./marketData.ts";
import { log } from "../log.ts";

export function listAlerts(db: DB, limit = 100): Alert[] {
  return (db.prepare("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    kind: r.kind as string,
    severity: r.severity as Alert["severity"],
    symbol: (r.symbol as string) ?? null,
    title: r.title as string,
    why: r.why as string,
    dedupeKey: r.dedupe_key as string,
    createdAt: r.created_at as string,
    readAt: (r.read_at as string) ?? null,
  }));
}

export function insertAlerts(db: DB, cands: AlertCandidate[]): number {
  const st = db.prepare("INSERT OR IGNORE INTO alerts (kind, severity, symbol, title, why, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  let n = 0;
  for (const c of cands) n += Number(st.run(c.kind, c.severity, c.symbol, c.title, c.why, c.dedupeKey, new Date().toISOString()).changes);
  return n;
}

/** Evaluate every rule. Network-dependent rules degrade gracefully and report what was skipped. */
export async function runAlerts(db: DB): Promise<{ created: number; skipped: string[] }> {
  const skipped: string[] = [];
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const t = getSetting<RiskThresholds>(db, "risk_thresholds", DEFAULT_THRESHOLDS);
  const profile = getProfile(db);
  const { holdings, summary } = portfolioSnapshot(db);
  const cands: AlertCandidate[] = [];

  const vol = new Map<string, number>();
  for (const h of holdings) {
    const closes = storedHistory(db, h.symbol).map((c) => c.close).slice(-250);
    const r = dailyReturns(closes);
    if (r.length >= 20) vol.set(h.symbol, stdev(r) * 100);
  }
  cands.push(...priceMoveAlerts(holdings, vol, t, today));
  cands.push(...riskAlerts(buildRiskReport(holdings, summary.cash, profile, t), today));

  // Drawdown on value ÷ invested so that adding new money is not mistaken for a gain or a loss.
  const snaps = db.prepare("SELECT value, invested FROM snapshots WHERE invested > 0 ORDER BY date").all() as { value: number; invested: number }[];
  if (snaps.length >= 2) {
    const values = snaps.map((s) => s.value / s.invested);
    const peak = Math.max(...values);
    const current = values[values.length - 1];
    if (peak > 0) cands.push(...drawdownAlert((current / peak - 1) * 100, t, today));
  }

  const notes = listNotes(db);
  const prices = new Map([...getQuotes(db, notes.map((n) => n.symbol)).entries()].map(([k, q]) => [k, q.price]));
  cands.push(...researchAlerts(notes, prices, today));
  cands.push(...thesisAlerts(notes, new Set(holdings.map((h) => h.symbol)), today));

  try {
    const feed = await announcements(db);
    if (feed.stale) skipped.push(`NSE announcements stale (${feed.error})`);
    const tracked = [
      ...holdings.filter((h) => h.assetClass === "EQUITY").map((h) => ({ symbol: h.symbol, name: h.name, owned: true })),
      ...notes.filter((n) => n.status !== "rejected").map((n) => ({ symbol: n.symbol, name: n.name, owned: holdings.some((h) => h.symbol === n.symbol) })),
    ];
    cands.push(...announcementAlerts(feed.data, tracked));
  } catch (e) {
    skipped.push(`NSE announcements unavailable: ${e instanceof Error ? e.message : e}`);
  }
  const created = insertAlerts(db, cands);
  log.info("alerts_run", { created, skipped: skipped.length });
  return { created, skipped };
}
