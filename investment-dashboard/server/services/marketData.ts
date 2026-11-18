// Market-data orchestration with caching, freshness tracking and graceful degradation.
// Every quote stored carries the timestamp of the price itself and its source.

import type { DB } from "../db.ts";
import { getSetting, setSetting, tx } from "../db.ts";
import * as upstox from "../providers/upstox.ts";
import { fetchNavAll } from "../providers/amfi.ts";
import { fetchNifty50Constituents, fetchNseAnnouncements, fetchRbiPress, type Constituent } from "../providers/feeds.ts";
import type { Quote } from "../../shared/types.ts";
import { log } from "../log.ts";
import { getUpstoxToken } from "./broker.ts";

const nowIso = () => new Date().toISOString();
const istDate = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

export interface Instrument {
  symbol: string;
  name: string;
  isin: string | null;
  instrument_key: string | null;
  kind: string;
  amfi_code: string | null;
}

// ---------- instruments ----------
export function instrumentCount(db: DB): number {
  return (db.prepare("SELECT COUNT(*) n FROM instruments").get() as { n: number }).n;
}

export async function syncInstruments(db: DB): Promise<number> {
  const list = await upstox.fetchInstrumentMaster();
  const ins = db.prepare(
    `INSERT INTO instruments (symbol, name, isin, instrument_key, exchange, kind, amfi_code, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, isin=excluded.isin, instrument_key=excluded.instrument_key, exchange=excluded.exchange, kind=excluded.kind, updated_at=excluded.updated_at`,
  );
  const t = nowIso();
  tx(db, () => {
    for (const i of list) ins.run(i.symbol, i.name, i.isin, i.instrumentKey, i.exchange, i.kind, t);
  });
  setSetting(db, "instruments_synced_at", t);
  log.info("instruments_synced", { count: list.length });
  return list.length;
}

export function getInstrument(db: DB, symbol: string): Instrument | undefined {
  return db.prepare("SELECT symbol, name, isin, instrument_key, kind, amfi_code FROM instruments WHERE symbol = ?").get(symbol) as Instrument | undefined;
}

export function searchInstruments(db: DB, q: string, limit = 20): Instrument[] {
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const eq = db
    .prepare(
      `SELECT symbol, name, isin, instrument_key, kind, amfi_code FROM instruments
       WHERE kind != 'index' AND (symbol LIKE ? OR name LIKE ?)
       ORDER BY (symbol = ?) DESC, (symbol LIKE ?) DESC, length(symbol) LIMIT ?`,
    )
    .all(like, like, q.toUpperCase(), `${q.toUpperCase()}%`, limit) as unknown as Instrument[];
  const mf = db
    .prepare(`SELECT 'MF:' || scheme_code AS symbol, name, isin, NULL AS instrument_key, 'mf' AS kind, scheme_code AS amfi_code FROM mf_navs WHERE name LIKE ? ORDER BY length(name) LIMIT ?`)
    .all(like, limit) as unknown as Instrument[];
  return [...eq, ...mf].slice(0, limit * 2);
}

// ---------- mutual funds (AMFI) ----------
export async function syncNavs(db: DB): Promise<number> {
  const rows = await fetchNavAll();
  const prevQuote = db.prepare("SELECT price, as_of FROM quotes WHERE symbol = ?");
  const upQuote = db.prepare(
    `INSERT INTO quotes (symbol, price, prev_close, as_of, source, fetched_at) VALUES (?, ?, ?, ?, 'amfi-nav', ?)
     ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, prev_close=excluded.prev_close, as_of=excluded.as_of, source=excluded.source, fetched_at=excluded.fetched_at`,
  );
  const ins = db.prepare(
    `INSERT INTO mf_navs (scheme_code, isin, isin_reinv, name, nav, nav_date, category, amc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scheme_code) DO UPDATE SET isin=excluded.isin, isin_reinv=excluded.isin_reinv, name=excluded.name, nav=excluded.nav, nav_date=excluded.nav_date, category=excluded.category, amc=excluded.amc`,
  );
  const held = new Set(
    (db.prepare("SELECT DISTINCT symbol FROM transactions WHERE symbol LIKE 'MF:%'").all() as { symbol: string }[]).map((r) => r.symbol),
  );
  const t = nowIso();
  tx(db, () => {
    for (const r of rows) {
      ins.run(r.schemeCode, r.isin, r.isinReinv, r.name, r.nav, r.navDate, r.category, r.amc);
      const sym = `MF:${r.schemeCode}`;
      if (held.has(sym)) {
        const prev = prevQuote.get(sym) as { price: number; as_of: string } | undefined;
        const asOf = `${r.navDate}T23:30:00+05:30`;
        const prevClose = prev && prev.as_of < asOf ? prev.price : null;
        upQuote.run(sym, r.nav, prevClose, asOf, t);
      }
    }
  });
  setSetting(db, "navs_synced_at", t);
  log.info("navs_synced", { count: rows.length });
  return rows.length;
}

export function searchFunds(db: DB, q: string, opts: { category?: string; directGrowthOnly?: boolean } = {}, limit = 25) {
  const where = ["name LIKE ?"];
  const args: (string | number)[] = [`%${q.replace(/[%_]/g, "")}%`];
  if (opts.category) {
    where.push("category LIKE ?");
    args.push(`%${opts.category}%`);
  }
  if (opts.directGrowthOnly) where.push("name LIKE '%Direct%' AND name LIKE '%Growth%' AND name NOT LIKE '%IDCW%'");
  args.push(limit);
  return db.prepare(`SELECT scheme_code, isin, name, nav, nav_date, category, amc FROM mf_navs WHERE ${where.join(" AND ")} ORDER BY name LIMIT ?`).all(...args);
}

// ---------- candles & quotes ----------
export function storedHistory(db: DB, symbol: string, fromIso?: string): { date: string; close: number; open: number | null; high: number | null; low: number | null; volume: number | null }[] {
  return db
    .prepare("SELECT date, open, high, low, close, volume FROM candles WHERE symbol = ? AND date >= ? ORDER BY date")
    .all(symbol, fromIso ?? "1900-01-01") as never;
}

/** Fetch ~1 year of daily candles if the stored series is stale. Returns the stored series. */
export async function ensureHistory(db: DB, symbol: string, days = 400) {
  const inst = getInstrument(db, symbol);
  if (!inst?.instrument_key) throw new Error(`Unknown instrument ${symbol}. Sync the instrument list first.`);
  const key = `candles:${symbol}`;
  const to = istDate();
  const from = istDate(new Date(Date.now() - days * 86400_000));
  const last = db.prepare("SELECT data, fetched_at FROM feed_cache WHERE feed = ?").get(key) as { data: string; fetched_at: string } | undefined;
  const coveredFrom = last ? ((JSON.parse(last.data) as { from?: string }).from ?? "9999") : "9999";
  // Refetch when stale OR when the cached fetch did not reach back as far as requested.
  if (!last || Date.now() - Date.parse(last.fetched_at) > 6 * 3600_000 || coveredFrom > from) {
    const candles = await upstox.dailyCandles(inst.instrument_key, from, to);
    const up = db.prepare(
      "INSERT INTO candles (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume",
    );
    tx(db, () => {
      for (const c of candles) up.run(symbol, c.ts.slice(0, 10), c.open, c.high, c.low, c.close, c.volume);
      const covered = last && coveredFrom < from && Date.now() - Date.parse(last.fetched_at) <= 6 * 3600_000 ? coveredFrom : from;
      db.prepare("INSERT INTO feed_cache (feed, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(feed) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at").run(key, JSON.stringify({ from: covered }), nowIso());
    });
  }
  return storedHistory(db, symbol, istDate(new Date(Date.now() - days * 86400_000)));
}

export function getQuotes(db: DB, symbols: string[]): Map<string, Quote> {
  const m = new Map<string, Quote>();
  const st = db.prepare("SELECT symbol, price, prev_close, as_of, source FROM quotes WHERE symbol = ?");
  for (const s of symbols) {
    const r = st.get(s) as { symbol: string; price: number; prev_close: number | null; as_of: string; source: string } | undefined;
    if (r) m.set(s, { symbol: r.symbol, price: r.price, prevClose: r.prev_close, asOf: r.as_of, source: r.source });
  }
  return m;
}

function putQuote(db: DB, q: Quote) {
  db.prepare(
    `INSERT INTO quotes (symbol, price, prev_close, as_of, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, prev_close=excluded.prev_close, as_of=excluded.as_of, source=excluded.source, fetched_at=excluded.fetched_at`,
  ).run(q.symbol, q.price, q.prevClose, q.asOf, q.source, nowIso());
}

export function setManualQuote(db: DB, symbol: string, price: number, asOf: string) {
  putQuote(db, { symbol, price, prevClose: null, asOf, source: "manual" });
}

function isStale(db: DB, symbol: string, maxAgeMs: number): boolean {
  const r = db.prepare("SELECT fetched_at, source FROM quotes WHERE symbol = ?").get(symbol) as { fetched_at: string; source: string } | undefined;
  if (!r) return true;
  if (r.source === "manual") return true; // try to replace manual prices with market data
  return Date.now() - Date.parse(r.fetched_at) > maxAgeMs;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export interface RefreshResult {
  updated: string[];
  failed: { symbol: string; error: string }[];
  source: string;
}

/**
 * Refresh exchange-traded quotes. Uses the account LTP API when Upstox is connected; otherwise the
 * public intraday candle API (price = close of the latest 30-min candle, so up to ~30 min delayed),
 * falling back to the last daily close.
 */
/** Mutual funds: price from the stored AMFI NAV table (filled by syncNavs). */
function refreshFundQuotes(db: DB, symbols: string[], res: RefreshResult): void {
  const nav = db.prepare("SELECT nav, nav_date FROM mf_navs WHERE scheme_code = ?");
  const prevQ = db.prepare("SELECT price, as_of FROM quotes WHERE symbol = ?");
  for (const s of symbols) {
    const row = nav.get(s.slice(3)) as { nav: number; nav_date: string } | undefined;
    if (!row) {
      res.failed.push({ symbol: s, error: "Scheme code not found in AMFI NAV file" });
      continue;
    }
    const asOf = `${row.nav_date}T23:30:00+05:30`;
    const prev = prevQ.get(s) as { price: number; as_of: string } | undefined;
    if (prev && prev.as_of === asOf) continue; // already current
    putQuote(db, { symbol: s, price: row.nav, prevClose: prev && prev.as_of < asOf ? prev.price : null, asOf, source: "amfi-nav" });
    res.updated.push(s);
  }
}

/** End of a 30-minute candle, capped at the 15:30 IST close and at "now". */
export function candleEnd(ts: string, now = Date.now()): string {
  const start = Date.parse(ts);
  const ist = new Date(start + 5.5 * 3600_000);
  const close = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 15, 30) - 5.5 * 3600_000;
  return new Date(Math.min(start + 30 * 60_000, close, now)).toISOString();
}

export async function refreshQuotes(db: DB, symbols: string[], maxAgeMs = 5 * 60_000): Promise<RefreshResult> {
  const listed = symbols.filter((s) => !s.startsWith("MF:"));
  const funds = symbols.filter((s) => s.startsWith("MF:"));
  const due = listed.filter((s) => isStale(db, s, maxAgeMs));
  const res: RefreshResult = { updated: [], failed: [], source: "" };
  refreshFundQuotes(db, funds, res);
  if (!due.length) return res;
  const withKey = due.map((s) => ({ s, inst: getInstrument(db, s) }));
  for (const { s, inst } of withKey) if (!inst?.instrument_key) res.failed.push({ symbol: s, error: "Not in instrument list (sync instruments, or enter price manually)" });
  const known = withKey.filter((x) => x.inst?.instrument_key);

  const prevCloseOf = async (sym: string): Promise<number | null> => {
    try {
      const hist = await ensureHistory(db, sym, 15);
      const today = istDate();
      const prior = hist.filter((c) => c.date < today);
      return prior.length ? prior[prior.length - 1].close : null;
    } catch {
      return null;
    }
  };

  const token = getUpstoxToken(db);
  if (token && known.length) {
    try {
      res.source = "upstox-ltp";
      const data = await upstox.account.ltp(token, known.map((k) => k.inst!.instrument_key!));
      const byToken = new Map(Object.values(data).map((v) => [v.instrument_token, v.last_price]));
      for (const { s, inst } of known) {
        const p = byToken.get(inst!.instrument_key!);
        if (p === undefined) {
          res.failed.push({ symbol: s, error: "No LTP returned" });
          continue;
        }
        putQuote(db, { symbol: s, price: p, prevClose: await prevCloseOf(s), asOf: nowIso(), source: "upstox-ltp" });
        res.updated.push(s);
      }
      return res;
    } catch (e) {
      log.warn("ltp_failed_falling_back", { error: String(e) });
    }
  }

  res.source = "upstox-public-candles";
  await mapLimit(known, 3, async ({ s, inst }) => {
    try {
      const intra = await upstox.intradayCandles(inst!.instrument_key!);
      const prevClose = await prevCloseOf(s);
      if (intra.length) {
        const last = intra[intra.length - 1];
        putQuote(db, { symbol: s, price: last.close, prevClose, asOf: candleEnd(last.ts), source: "upstox-candle-30m" });
      } else {
        const hist = await ensureHistory(db, s, 15);
        if (!hist.length) throw new Error("No price data returned");
        const lastD = hist[hist.length - 1];
        const prev = hist.length > 1 ? hist[hist.length - 2].close : null;
        putQuote(db, { symbol: s, price: lastD.close, prevClose: prev, asOf: `${lastD.date}T15:30:00+05:30`, source: "upstox-daily-close" });
      }
      res.updated.push(s);
    } catch (e) {
      res.failed.push({ symbol: s, error: e instanceof Error ? e.message : String(e) });
    }
  });
  return res;
}

// ---------- Indices, breadth, feeds ----------
export const INDEX_WATCH = [
  "Nifty 50",
  "SENSEX",
  "Nifty Next 50",
  "Nifty Bank",
  "Nifty IT",
  "Nifty FMCG",
  "Nifty Pharma",
  "Nifty Auto",
  "Nifty Metal",
  "Nifty Energy",
  "Nifty Realty",
  "Nifty PSU Bank",
  "Nifty Fin Service",
  "Nifty Infra",
  "India VIX",
];

export async function indexSnapshot(db: DB) {
  const known = INDEX_WATCH.filter((s) => getInstrument(db, s));
  const r = await refreshQuotes(db, known, 5 * 60_000);
  const q = getQuotes(db, known);
  return {
    indices: known.map((s) => {
      const x = q.get(s);
      return {
        symbol: s,
        price: x?.price ?? null,
        change: x && x.prevClose ? x.price - x.prevClose : null,
        changePct: x && x.prevClose ? (x.price / x.prevClose - 1) * 100 : null,
        asOf: x?.asOf ?? null,
        source: x?.source ?? null,
      };
    }),
    failed: r.failed,
  };
}

export async function getConstituents(db: DB): Promise<{ list: Constituent[]; asOf: string | null; source: string }> {
  const cached = getSetting<{ list: Constituent[]; fetchedAt: string } | null>(db, "nifty50_constituents", null);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 7 * 86400_000) return { list: cached.list, asOf: cached.fetchedAt, source: "niftyindices.com" };
  try {
    const list = await fetchNifty50Constituents();
    setSetting(db, "nifty50_constituents", { list, fetchedAt: nowIso() });
    return { list, asOf: nowIso(), source: "niftyindices.com" };
  } catch (e) {
    log.warn("constituents_unavailable", { error: String(e) });
    if (cached) return { list: cached.list, asOf: cached.fetchedAt, source: "niftyindices.com (stale cache)" };
    const manual = getSetting<{ list: Constituent[]; savedAt: string } | null>(db, "nifty50_constituents_manual", null);
    return { list: manual?.list ?? [], asOf: manual?.savedAt ?? null, source: manual ? "manual upload" : "unavailable" };
  }
}

export async function breadth(db: DB) {
  const { list, asOf, source } = await getConstituents(db);
  const syms = list.map((c) => c.symbol).filter((s) => getInstrument(db, s));
  const r = await refreshQuotes(db, syms, 15 * 60_000);
  const q = getQuotes(db, syms);
  const moves = syms
    .map((s) => {
      const x = q.get(s);
      return x && x.prevClose ? { symbol: s, price: x.price, changePct: (x.price / x.prevClose - 1) * 100, sector: list.find((c) => c.symbol === s)?.industry ?? "" } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.changePct - a.changePct);
  return {
    universe: "Nifty 50",
    constituentsSource: source,
    constituentsAsOf: asOf,
    advances: moves.filter((m) => m.changePct > 0).length,
    declines: moves.filter((m) => m.changePct < 0).length,
    unchanged: moves.filter((m) => m.changePct === 0).length,
    gainers: moves.slice(0, 5),
    losers: moves.slice(-5).reverse(),
    covered: moves.length,
    failed: r.failed.length,
  };
}

async function cachedFeed<T>(db: DB, feed: string, maxAgeMs: number, fetcher: () => Promise<T>): Promise<{ data: T; fetchedAt: string; stale: boolean; error?: string }> {
  const row = db.prepare("SELECT data, fetched_at FROM feed_cache WHERE feed = ?").get(feed) as { data: string; fetched_at: string } | undefined;
  if (row && Date.now() - Date.parse(row.fetched_at) < maxAgeMs) return { data: JSON.parse(row.data), fetchedAt: row.fetched_at, stale: false };
  try {
    const data = await fetcher();
    db.prepare("INSERT INTO feed_cache (feed, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(feed) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at").run(feed, JSON.stringify(data), nowIso());
    return { data, fetchedAt: nowIso(), stale: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (row) return { data: JSON.parse(row.data), fetchedAt: row.fetched_at, stale: true, error };
    throw e;
  }
}

export const announcements = (db: DB) => cachedFeed(db, "nse_announcements", 10 * 60_000, fetchNseAnnouncements);
export const rbiPress = (db: DB) => cachedFeed(db, "rbi_press", 60 * 60_000, fetchRbiPress);
