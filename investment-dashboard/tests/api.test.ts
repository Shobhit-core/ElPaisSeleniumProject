import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { openDb, type DB } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { decryptSecret, encryptSecret, hashPassword } from "../server/security.ts";
import { resetFetch, setFetch } from "../server/providers/http.ts";
import { parseNavAll } from "../server/providers/amfi.ts";
import { parseRss, toAnnouncements } from "../server/providers/feeds.ts";
import { READ_ONLY_PATHS, tokenExpiry, upstoxFinancialYear } from "../server/providers/upstox.ts";
import { researchAnswer } from "../server/services/analyst.ts";
import { formatINR } from "../shared/format.ts";

process.env.NODE_ENV = "test";
const FX = path.join(import.meta.dirname, "fixtures");
const PASSWORD = "correct horse battery staple";

let db: DB;
let server: Server;
let base: string;
let cookie = "";
let tmp: string;

async function call(method: string, url: string, body?: unknown, opts: { csrf?: boolean; cookie?: string; type?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie ?? cookie) headers.cookie = opts.cookie ?? cookie;
  if (opts.csrf !== false) headers["x-requested-with"] = "dashboard";
  let payload: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = opts.type ?? "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload, redirect: "manual" });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

// ---- fake upstream network ----
type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | null;
let routes: Route[] = [];
function fakeNet() {
  setFetch(async (input, init) => {
    const url = String(input);
    for (const r of routes) {
      const res = await r(url, init);
      if (res) return res;
    }
    throw new TypeError(`fetch failed (no route for ${url})`);
  });
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

function seedInstruments() {
  const t = new Date().toISOString();
  const st = db.prepare("INSERT OR REPLACE INTO instruments (symbol, name, isin, instrument_key, exchange, kind, amfi_code, updated_at) VALUES (?, ?, ?, ?, 'NSE', ?, NULL, ?)");
  st.run("RELIANCE", "Reliance Industries", "INE002A01018", "NSE_EQ|INE002A01018", "stock", t);
  st.run("TCS", "Tata Consultancy Services", "INE467B01029", "NSE_EQ|INE467B01029", "stock", t);
  st.run("NIFTYBEES", "Nippon Nifty 50 ETF", "INF204KB14I2", "NSE_EQ|INF204KB14I2", "etf", t);
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pid-"));
  db = openDb(path.join(tmp, "test.db"));
  const app = createApp(db, { passwordHash: hashPassword(PASSWORD), secureCookies: false, serveStatic: null, backupDir: path.join(tmp, "backups") });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fakeNet();
  seedInstruments();
});
afterAll(() => {
  server?.close();
  resetFetch();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  routes = [];
});

describe("Authentication & security", () => {
  it("rejects unauthenticated API access", async () => {
    const r = await call("GET", "/api/portfolio", undefined, { cookie: "" });
    expect(r.status).toBe(401);
  });
  it("rejects a wrong password and accepts the right one with a hardened cookie", async () => {
    expect((await call("POST", "/api/auth/login", { password: "nope" }, { cookie: "" })).status).toBe(401);
    const ok = await call("POST", "/api/auth/login", { password: PASSWORD }, { cookie: "" });
    expect(ok.status).toBe(200);
    const set = ok.headers.get("set-cookie")!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    cookie = set.split(";")[0];
    expect((await call("GET", "/api/auth/me")).body.authenticated).toBe(true);
  });
  it("requires the CSRF header on state-changing requests", async () => {
    const r = await call("PUT", "/api/plan/choice", { scenario: "moderate" }, { csrf: false });
    expect(r.status).toBe(403);
  });
  it("sends security headers", async () => {
    const r = await call("GET", "/api/health");
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-powered-by")).toBeNull();
  });
  it("rejects malformed JSON cleanly", async () => {
    const r = await call("PUT", "/api/profile", "{bad json", { type: "application/json" });
    expect(r.status).toBe(400);
  });
  it("encrypts tokens with AES-GCM and detects tampering", () => {
    const c = encryptSecret("access-token-123", "k".repeat(10));
    expect(c).not.toContain("access-token-123");
    expect(decryptSecret(c, "k".repeat(10))).toBe("access-token-123");
    const [iv, tag, enc] = c.split(".");
    const tampered = [iv, tag, Buffer.from("x" + Buffer.from(enc, "base64").toString("latin1"), "latin1").toString("base64")].join(".");
    expect(() => decryptSecret(tampered, "k".repeat(10))).toThrow();
    expect(() => decryptSecret(c, "other-key")).toThrow();
  });
});

describe("Onboarding gate & plan", () => {
  it("withholds recommendations until the profile is complete", async () => {
    expect((await call("GET", "/api/plan")).status).toBe(409);
    expect((await call("GET", "/api/recommendations")).status).toBe(409);
  });
  it("validates the profile", async () => {
    const r = await call("PUT", "/api/profile", { horizon: "forever" });
    expect(r.status).toBe(400);
  });
  it("builds scenarios after onboarding", async () => {
    const p = { horizon: "10+", riskTolerance: "moderate", emergencyFund: "full", needWithin12Months: "no", monthlyCapacity: 5000, preference: "combination", lossTolerance: "20", taxSlabPct: 20, capital: 30000 };
    expect((await call("PUT", "/api/profile", p)).status).toBe(200);
    const r = await call("GET", "/api/plan");
    expect(r.status).toBe(200);
    expect(r.body.scenarios).toHaveLength(3);
    for (const s of r.body.scenarios) {
      expect(s.lines.reduce((a: number, l: any) => a + l.amount, 0)).toBeCloseTo(30000, 2);
      expect(s.projections[0].label).toMatch(/hypothetical/i);
    }
    expect((await call("PUT", "/api/plan/choice", { scenario: "moderate" })).status).toBe(200);
  });
});

describe("Journal, portfolio and ledger consistency", () => {
  const buy = { date: "2026-06-01", type: "BUY", symbol: "RELIANCE", name: "Reliance Industries", assetClass: "EQUITY", sector: "Energy", quantity: 5, price: 1300, brokerage: 20, stt: 7, otherCharges: 4.5, rationale: "Core holding test" };
  it("requires a written rationale for purchases", async () => {
    const r = await call("POST", "/api/transactions", { ...buy, rationale: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/rationale/);
  });
  it("rejects invalid numbers and future dates", async () => {
    expect((await call("POST", "/api/transactions", { ...buy, quantity: -1 })).status).toBe(400);
    expect((await call("POST", "/api/transactions", { ...buy, price: "abc" })).status).toBe(400);
    expect((await call("POST", "/api/transactions", { ...buy, date: "2999-01-01" })).status).toBe(400);
  });
  it("records a buy and refuses an over-sale without changing the database", async () => {
    expect((await call("POST", "/api/transactions", buy)).status).toBe(201);
    const over = await call("POST", "/api/transactions", { ...buy, type: "SELL", quantity: 6, rationale: null, exitRationale: "test" });
    expect(over.status).toBe(422);
    expect((await call("GET", "/api/transactions")).body.transactions).toHaveLength(1);
  });
  it("reports missing prices instead of inventing them, then values with a manual price", async () => {
    let p = await call("GET", "/api/portfolio");
    expect(p.body.summary.missingPrices).toEqual(["RELIANCE"]);
    expect(p.body.holdings[0].currentValue).toBeNull();
    await call("POST", "/api/quotes/manual", { symbol: "RELIANCE", price: 1400, asOf: "2026-11-17" });
    p = await call("GET", "/api/portfolio");
    const h = p.body.holdings[0];
    expect(h.currentValue).toBe(7000);
    expect(h.invested).toBe(6524.5); // 6500 + 20 + 4.5 (STT excluded from cost)
    expect(h.unrealisedPnl).toBe(475.5);
    expect(h.priceSource).toBe("manual");
  });
  it("refreshes prices from the Upstox public candle API", async () => {
    const intraday = fs.readFileSync(path.join(FX, "candles-intraday-RELIANCE.json"), "utf8");
    const day = fs.readFileSync(path.join(FX, "candles-day-RELIANCE.json"), "utf8");
    routes.push((u) => (u.includes("/historical-candle/intraday/") ? new Response(intraday) : null));
    routes.push((u) => (u.includes("/historical-candle/") ? new Response(day) : null));
    const r = await call("POST", "/api/portfolio/refresh-prices");
    expect(r.status).toBe(200);
    expect(r.body.updated).toEqual(["RELIANCE"]);
    const p = await call("GET", "/api/portfolio");
    const lastIntraday = JSON.parse(intraday).data.candles[0][4];
    expect(p.body.holdings[0].price).toBe(lastIntraday);
    expect(p.body.holdings[0].priceSource).toBe("upstox-candle-30m");
    expect(p.body.holdings[0].dayChange).not.toBeNull();
  });
  it("degrades gracefully when the market-data API is down", async () => {
    db.prepare("UPDATE quotes SET fetched_at = '2000-01-01T00:00:00Z' WHERE symbol = 'RELIANCE'").run();
    db.prepare("DELETE FROM feed_cache").run();
    routes.push(() => new Response("upstream boom", { status: 503 }));
    const r = await call("POST", "/api/portfolio/refresh-prices");
    expect(r.status).toBe(200);
    expect(r.body.failed[0].symbol).toBe("RELIANCE");
    // The previous price is retained, with its original timestamp, rather than being dropped.
    const p = await call("GET", "/api/portfolio");
    expect(p.body.holdings[0].price).not.toBeNull();
  });
  it("imports CSV with per-line validation and a dry run", async () => {
    const bad = "date,type,symbol,quantity,price\n2026-07-01,BUY,TCS,abc,3000\n";
    const r1 = await call("POST", "/api/transactions/import", bad, { type: "text/csv" });
    expect(r1.status).toBe(400);
    expect(r1.body.errors[0].line).toBe(2);
    const good = 'date,type,symbol,name,asset_class,sector,quantity,price,brokerage,stt,other_charges,rationale\n2026-07-01,BUY,TCS,"Tata Consultancy Services",EQUITY,IT,2,3000,20,6,3,"Quality, cash-rich"\n';
    const dry = await call("POST", "/api/transactions/import?dryRun=1", good, { type: "text/csv" });
    expect(dry.body.count).toBe(1);
    expect((await call("GET", "/api/transactions")).body.transactions).toHaveLength(1);
    const real = await call("POST", "/api/transactions/import", good, { type: "text/csv" });
    expect(real.body.imported).toBe(1);
  });
  it("exports CSV with a spreadsheet formula-injection guard", async () => {
    await call("POST", "/api/transactions", { ...buy, symbol: "TCS", name: "Tata", rationale: "=HYPERLINK(evil)" });
    const r = await call("GET", "/api/transactions/export.csv");
    expect(r.body).toContain("'=HYPERLINK(evil)");
  });
  it("deleting a buy that a later sale depends on is refused", async () => {
    const all = (await call("GET", "/api/transactions")).body.transactions;
    const tcsBuys = all.filter((t: any) => t.symbol === "TCS");
    await call("POST", "/api/transactions", { ...buy, symbol: "TCS", type: "SELL", date: "2026-08-01", quantity: 3, price: 3100, rationale: null, exitRationale: "Thesis played out" });
    const r = await call("DELETE", `/api/transactions/${tcsBuys[tcsBuys.length - 1].id}`);
    expect(r.status).toBe(422);
  });
  it("produces a tax estimate for realised gains", async () => {
    const r = await call("GET", "/api/tax");
    expect(r.status).toBe(200);
    expect(r.body.reports[0].fy).toBe("2026-27");
    expect(r.body.reports[0].lots[0].bucket).toBe("ST_EQ");
    expect(r.body.disclaimer).toMatch(/ESTIMATE/);
  });
  it("tracks cash and backs up the database", async () => {
    expect((await call("POST", "/api/cash", { date: "2026-05-30", amount: 30000, note: "Initial capital" })).status).toBe(201);
    expect((await call("POST", "/api/cash", { date: "2026-05-30", amount: 0 })).status).toBe(400);
    const p = await call("GET", "/api/portfolio");
    expect(p.body.summary.cash).toBeLessThan(30000);
    const b = await call("POST", "/api/backup");
    expect(fs.existsSync(path.join(tmp, "backups", b.body.file))).toBe(true);
  });
});

describe("Providers (parsers verified against real responses captured 18-Nov-2026)", () => {
  it("parses AMFI NAVAll format with category and AMC", () => {
    const rows = parseNavAll(fs.readFileSync(path.join(FX, "NAVAll.sample.txt"), "utf8"));
    const axis = rows.find((r) => r.schemeCode === "135762")!;
    expect(axis.nav).toBe(31.2107);
    expect(axis.navDate).toBe("2026-11-17");
    expect(axis.amc).toBe("Axis Mutual Fund");
    expect(axis.name).toBe("Axis Children's Fund - Direct Plan - Growth Option");
    const liquid = rows.find((r) => r.schemeCode === "151835")!;
    expect(liquid.category).toBe("Debt Scheme - Liquid Fund");
    expect(liquid.isin).toBeNull();
  });
  it("parses NSE announcements RSS", () => {
    const anns = toAnnouncements(parseRss(fs.readFileSync(path.join(FX, "nse-announcements.sample.xml"), "utf8")));
    expect(anns.length).toBe(4);
    expect(anns[0].company.length).toBeGreaterThan(2);
    expect(anns[0].link).toMatch(/^https:\/\/nsearchives\.nseindia\.com\//);
    expect(anns[0].subject).not.toMatch(/SUBJECT:/);
  });
  it("syncs NAVs and instrument master through the app", async () => {
    const nav = fs.readFileSync(path.join(FX, "NAVAll.sample.txt"), "utf8");
    const bigNav = nav + Array.from({ length: 1200 }, (_, i) => `9${i};-;-;Test Fund ${i};Direct Plan;Growth;10.5;17-Nov-2026`).join("\n");
    const nse = zlib.gzipSync(JSON.stringify([
      { segment: "NSE_EQ", name: "INFOSYS LIMITED", isin: "INE009A01021", instrument_type: "EQ", instrument_key: "NSE_EQ|INE009A01021", trading_symbol: "INFY", short_name: "Infosys", exchange: "NSE" },
      { segment: "NSE_INDEX", name: "Nifty 50", instrument_key: "NSE_INDEX|Nifty 50", exchange: "NSE" },
      { segment: "NSE_FO", name: "X", instrument_key: "NSE_FO|1", exchange: "NSE", instrument_type: "CE" },
    ]));
    const bse = zlib.gzipSync(JSON.stringify([{ segment: "BSE_INDEX", name: "BSE SENSEX", instrument_key: "BSE_INDEX|SENSEX", exchange: "BSE" }]));
    routes.push((u) => (u.includes("NAVAll") ? new Response(bigNav) : null));
    routes.push((u) => (u.endsWith("NSE.json.gz") ? new Response(nse) : null));
    routes.push((u) => (u.endsWith("BSE.json.gz") ? new Response(bse) : null));
    const r = await call("POST", "/api/instruments/sync");
    expect(r.body.instruments).toBe(3);
    expect(r.body.navs).toBeGreaterThan(1000);
    const s = await call("GET", "/api/instruments/search?q=INF");
    expect(s.body.results.some((x: any) => x.symbol === "INFY")).toBe(true);
    const f = await call("GET", "/api/funds/search?q=Liquid&category=Liquid");
    expect(f.body.results[0].name).toMatch(/Liquid/);
  });
});

describe("Research, recommendations and alerts", () => {
  const m = (value: number) => ({ value, source: "Annual report FY26 p.112", asOf: "FY26" });
  it("rejects fundamentals without a source", async () => {
    const r = await call("PUT", "/api/research/notes/TCS", { name: "TCS", fundamentals: { roe: { value: 40, source: "", asOf: "FY26" } } });
    expect(r.status).toBe(400);
  });
  it("ranks complete notes and withholds rank for incomplete ones", async () => {
    const full = { revenueCagr3y: m(9), profitCagr3y: m(10), epsCagr3y: m(10), roe: m(45), roce: m(55), operatingMargin: m(24), debtToEquity: m(0.05), fcfPositiveYears5: m(5), promoterPledge: m(0), promoterHolding: m(71), governanceFlags: m(0), dividendYears5: m(5), pe: m(25), sectorPe: m(27) };
    const saved = await call("PUT", "/api/research/notes/TCS", { name: "Tata Consultancy Services", sector: "IT", fundamentals: full, thesis: "t", invalidation: "i", status: "watchlist", targetPrice: 99999, reviewBy: "2026-01-01" });
    expect(saved.status).toBe(200);
    expect((await call("PUT", "/api/research/notes/RELIANCE", { name: "Reliance Industries", fundamentals: { roe: m(9) } })).status).toBe(200);
    const r = await call("GET", "/api/recommendations");
    expect(r.status).toBe(200);
    expect(r.body.items[0].symbol).toBe("TCS");
    expect(r.body.items[0].rank).not.toBeNull();
    expect(r.body.items[1].rank).toBeNull();
    expect(r.body.items[1].reasonsAgainst.join(" ")).toMatch(/not rankable/);
    expect(r.body.methodology.fundamental).toBeTruthy();
  });
  it("runs alerts and survives a feed outage", async () => {
    routes.push((u) => (u.includes("nsearchives") ? new Response("down", { status: 500 }) : null));
    // No price → no target alert (never guessed). Provide one explicitly.
    await call("POST", "/api/quotes/manual", { symbol: "TCS", price: 3050, asOf: "2026-11-17" });
    const r = await call("POST", "/api/alerts/run");
    expect(r.status).toBe(200);
    expect(r.body.skipped.join(" ")).toMatch(/NSE announcements unavailable/);
    const a = await call("GET", "/api/alerts");
    const kinds = a.body.alerts.map((x: any) => x.kind);
    expect(kinds).toContain("thesis_review");
    expect(kinds).toContain("target_valuation");
    for (const al of a.body.alerts) expect(al.why.length).toBeGreaterThan(20);
    // Re-running the same day must not duplicate alerts
    const again = await call("POST", "/api/alerts/run");
    expect(again.body.created).toBe(0);
  });
  it("matches a negative exchange filing to a held company", async () => {
    const xml = `<rss><channel><item><title>Tata Consultancy Services Limited</title><link>https://nsearchives.nseindia.com/x.pdf</link><description>Tata Consultancy Services Limited has informed the Exchange about Resignation |SUBJECT: Resignation of Statutory Auditor</description><pubDate>18-Nov-2026 10:00:00</pubDate></item></channel></rss>`;
    db.prepare("DELETE FROM feed_cache WHERE feed = 'nse_announcements'").run();
    routes.push((u) => (u.includes("nsearchives") ? new Response(xml) : null));
    await call("POST", "/api/alerts/run");
    const a = await call("GET", "/api/alerts");
    expect(a.body.alerts.some((x: any) => x.kind === "negative_development" && x.symbol === "TCS")).toBe(true);
  });
});

describe("Broker integration (Upstox) — mocked, NOT a live test", () => {
  it("reports missing configuration and refuses to start OAuth", async () => {
    const s = await call("GET", "/api/broker/status");
    expect(s.body.configured).toBe(false);
    expect(s.body.missingConfig).toContain("UPSTOX_CLIENT_ID");
    expect((await call("POST", "/api/broker/connect")).status).toBe(409);
  });
  it("contains no order-placement endpoints in the allowlist", () => {
    for (const p of READ_ONLY_PATHS) expect(p).not.toMatch(/order\/(place|modify|cancel)|gtt/);
  });
  it("computes token expiry at 03:30 IST", () => {
    // 20:00 IST Tuesday → 03:30 IST Wednesday
    expect(tokenExpiry(new Date("2026-11-17T14:30:00Z")).toISOString()).toBe("2026-11-17T22:00:00.000Z");
    // 02:30 IST → 03:30 IST same day
    expect(tokenExpiry(new Date("2026-11-17T21:00:00Z")).toISOString()).toBe("2026-11-17T22:00:00.000Z");
    expect(upstoxFinancialYear("2026-27")).toBe("2627");
  });
  it("completes OAuth with state validation and serves a read-only snapshot", async () => {
    Object.assign(process.env, { UPSTOX_CLIENT_ID: "cid", UPSTOX_CLIENT_SECRET: "csecret", UPSTOX_REDIRECT_URI: "http://127.0.0.1/api/broker/callback", TOKEN_ENCRYPTION_KEY: "a".repeat(64) });
    try {
      const bad = await call("GET", "/api/broker/callback?code=x&state=forged");
      expect(bad.status).toBe(302);
      expect(bad.headers.get("location")).toMatch(/broker=error/);
      const c = await call("POST", "/api/broker/connect");
      const url = new URL(c.body.url);
      expect(url.origin + url.pathname).toBe("https://api.upstox.com/v2/login/authorization/dialog");
      const state = url.searchParams.get("state")!;
      const seen: string[] = [];
      routes.push((u, init) => {
        seen.push(`${init?.method ?? "GET"} ${u.split("?")[0]}`);
        if (u.endsWith("/v2/login/authorization/token")) {
          expect(String(init?.body)).toContain("grant_type=authorization_code");
          return json({ access_token: "tok-secret-value", user_name: "Test User" });
        }
        if (u.includes("/long-term-holdings")) {
          expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-secret-value");
          return json({ status: "success", data: [{ isin: "INE528G01035", company_name: "YES BANK LTD.", trading_symbol: "YESBANK", quantity: 36, average_price: 18.75, last_price: 17.05, close_price: 17.05, pnl: -61.2, day_change: 0, day_change_percentage: 0, instrument_token: "NSE_EQ|INE528G01035", exchange: "NSE", t1_quantity: 0 }] });
        }
        if (u.includes("/short-term-positions")) return json({ status: "success", data: [] });
        if (u.includes("/get-funds-and-margin")) return json({ status: "success", data: { equity: { available_margin: 15507.46, used_margin: 0.8, payin_amount: 200 } } });
        if (u.includes("/order/retrieve-all")) return json({ status: "error", errors: [{ message: "Service unavailable" }] }, 503);
        return null;
      });
      const cb = await call("GET", `/api/broker/callback?code=abc&state=${state}`);
      expect(cb.headers.get("location")).toMatch(/broker=connected/);
      // state is single-use
      expect((await call("GET", `/api/broker/callback?code=abc&state=${state}`)).headers.get("location")).toMatch(/broker=error/);
      const stored = db.prepare("SELECT ciphertext FROM broker_tokens").get() as { ciphertext: string };
      expect(stored.ciphertext).not.toContain("tok-secret-value");
      const st = await call("GET", "/api/broker/status");
      expect(st.body.connected).toBe(true);
      expect(JSON.stringify(st.body)).not.toContain("tok-secret-value");
      const snap = await call("GET", "/api/broker/snapshot");
      expect(snap.status).toBe(200);
      expect(snap.body.holdings[0].trading_symbol).toBe("YESBANK");
      expect(snap.body.funds.equity.available_margin).toBe(15507.46);
      expect(snap.body.orders).toBeNull();
      expect(snap.body.errors.orders).toMatch(/Service unavailable|503/);
      expect(seen.filter((s) => !s.includes("/login/")).every((s) => s.startsWith("GET "))).toBe(true);
      await call("POST", "/api/broker/disconnect");
      expect((await call("GET", "/api/broker/snapshot")).status).toBe(409);
    } finally {
      for (const k of ["UPSTOX_CLIENT_ID", "UPSTOX_CLIENT_SECRET", "UPSTOX_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY"]) delete process.env[k];
    }
  });
});

describe("AI analyst", () => {
  it("answers portfolio questions locally without an API key", async () => {
    const r = await call("POST", "/api/analyst", { question: "Where should I invest my next ₹5,000?", mode: "local" });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe("local");
    expect(r.body.answer).toMatch(/₹/);
    expect(r.body.caveat).toMatch(/not personalised investment advice/);
    const risk = await call("POST", "/api/analyst", { question: "Am I overexposed to a sector?" });
    expect(risk.body.answer).toMatch(/Sector mix/);
  });
  it("refuses research mode without a key", async () => {
    const r = await call("POST", "/api/analyst", { question: "Is TCS overvalued?", mode: "research" });
    expect(r.status).toBe(503);
  });
  it("collects sources from web search results and resumes paused turns (stubbed client)", async () => {
    const calls: any[] = [];
    const stub: any = {
      beta: {
        messages: {
          create: async (params: any) => {
            calls.push(params);
            if (calls.length === 1)
              return { stop_reason: "pause_turn", content: [{ type: "web_search_tool_result", tool_use_id: "x", content: [{ type: "web_search_result", url: "https://www.nseindia.com/a", title: "NSE" }] }] };
            return { stop_reason: "end_turn", content: [{ type: "text", text: "Answer.", citations: [{ type: "web_search_result_location", url: "https://www.bseindia.com/b", title: "BSE", cited_text: "x" }] }] };
          },
        },
      },
    };
    const a = await researchAnswer(db, "Is TCS overvalued?", stub);
    expect(calls).toHaveLength(2);
    expect(calls[0].tools[0].type).toBe("web_search_20260209");
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[1].messages).toHaveLength(2);
    expect(a.sources.map((s) => s.url).sort()).toEqual(["https://www.bseindia.com/b", "https://www.nseindia.com/a"]);
    expect(a.answer).toBe("Answer.");
  });
});

describe("Regression: history cache honours the requested range", () => {
  it("refetches when a longer range is requested than was cached", async () => {
    let fetches = 0;
    const day = fs.readFileSync(path.join(FX, "candles-day-RELIANCE.json"), "utf8");
    routes.push((u) => (u.includes("/historical-candle/") && !u.includes("intraday") ? (fetches++, new Response(day)) : null));
    db.prepare("DELETE FROM feed_cache WHERE feed = 'candles:RELIANCE'").run();
    const { ensureHistory } = await import("../server/services/marketData.ts");
    await ensureHistory(db, "RELIANCE", 15);
    await ensureHistory(db, "RELIANCE", 15); // cached
    expect(fetches).toBe(1);
    await ensureHistory(db, "RELIANCE", 400); // wider range → must refetch
    expect(fetches).toBe(2);
    await ensureHistory(db, "RELIANCE", 30); // narrower than cached → no fetch
    expect(fetches).toBe(2);
  });
});

describe("Regression: fund bought after the NAV sync gets priced on refresh", () => {
  it("prices MF holdings from the stored AMFI table", async () => {
    // mf_navs already populated by the sync test above (scheme 135762 = Axis Children's Fund, NAV 31.2107)
    const r = await call("POST", "/api/transactions", { date: "2026-11-01", type: "BUY", symbol: "MF:135762", name: "Axis Children's Fund", assetClass: "EQUITY_MF", quantity: 10, price: 30, rationale: "regression" });
    expect(r.status).toBe(201);
    routes.push(() => new Response("down", { status: 503 }));
    await call("POST", "/api/portfolio/refresh-prices");
    const p = await call("GET", "/api/portfolio");
    const h = p.body.holdings.find((x: any) => x.symbol === "MF:135762");
    expect(h.price).toBe(31.2107);
    expect(h.priceSource).toBe("amfi-nav");
    expect(h.priceAsOf).toBe("2026-11-17T23:30:00+05:30");
  });
  it("caps intraday candle timestamps at the 15:30 IST close", async () => {
    const { candleEnd } = await import("../server/services/marketData.ts");
    expect(candleEnd("2026-11-18T15:15:00+05:30", Date.parse("2026-11-18T12:00:00Z"))).toBe("2026-11-18T10:00:00.000Z");
    expect(candleEnd("2026-11-18T10:00:00+05:30", Date.parse("2026-11-18T12:00:00Z"))).toBe("2026-11-18T05:00:00.000Z");
  });
});

describe("Nifty 50 constituents fallback upload", () => {
  it("validates and stores the official CSV, then breadth uses it", async () => {
    expect((await call("PUT", "/api/market/constituents", "foo,bar\n1,2", { type: "text/csv" })).status).toBe(400);
    const rows = Array.from({ length: 50 }, (_, i) => `Company ${i},Industry,SYM${i},EQ,INE00000${i}`);
    rows[0] = "Reliance Industries Ltd.,Oil Gas & Consumable Fuels,RELIANCE,EQ,INE002A01018";
    const csv = ["Company Name,Industry,Symbol,Series,ISIN Code", ...rows].join("\n");
    expect((await call("PUT", "/api/market/constituents", csv, { type: "text/csv" })).body.saved).toBe(50);
    routes.push((u) => (u.includes("niftyindices") ? new Response("blocked", { status: 403 }) : null));
    const b = await call("GET", "/api/market/breadth");
    expect(b.body.constituentsSource).toBe("manual upload");
  });
});

describe("Copy summary for Claude", () => {
  it("includes profile, holdings and risk but never secrets, and can hide amounts", async () => {
    // put a connected broker token in place to prove it is never leaked
    process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(64);
    db.prepare("INSERT OR REPLACE INTO broker_tokens (provider, ciphertext, expires_at, user_label, created_at) VALUES ('upstox', ?, '2999-01-01T00:00:00Z', 'Secret Person Name', ?)").run(encryptSecret("tok-should-not-leak", "b".repeat(64)), new Date().toISOString());
    try {
      const full = await call("GET", "/api/summary");
      expect(full.status).toBe(200);
      const t: string = full.body.text;
      expect(t).toMatch(/## My profile/);
      expect(t).toMatch(/Horizon: 10\+ years/);
      expect(t).toMatch(/## Holdings/);
      expect(t).toMatch(/RELIANCE/);
      expect(t).toMatch(/## Risk check/);
      expect(t).toMatch(/₹/);
      for (const secret of ["tok-should-not-leak", "Secret Person Name", "b".repeat(64), PASSWORD, "scrypt$"]) expect(t).not.toContain(secret);
      const hidden: string = (await call("GET", "/api/summary?amounts=0")).body.text;
      expect(hidden).toMatch(/Rupee amounts hidden/);
      // Personal money figures are hidden; public per-unit market prices may remain.
      const pf = (await call("GET", "/api/portfolio")).body.summary;
      expect(hidden).toMatch(/Invested: \[hidden\]/);
      expect(hidden).toMatch(/Available cash: \[hidden\]/);
      for (const v of [pf.invested, pf.currentValue, pf.cash]) expect(hidden).not.toContain(formatINR(v, { decimals: 0 }));
      expect(hidden).not.toMatch(/units, avg/);
      expect(hidden).toMatch(/%/);
    } finally {
      db.prepare("DELETE FROM broker_tokens").run();
      delete process.env.TOKEN_ENCRYPTION_KEY;
    }
  });
});

describe("Family view", () => {
  it("explains today, health, this month and a 6m–5y range", async () => {
    const r = await call("GET", "/api/family");
    expect(r.status).toBe(200);
    const f = r.body;
    expect(f.today.total).toBeGreaterThan(0);
    expect(["green", "amber", "red"]).toContain(f.health.status);
    expect(f.buckets.map((b: any) => b.key)).toEqual(["growth", "steady", "safe", "gold"]);
    expect(f.buckets.reduce((s: number, b: any) => s + b.pct, 0)).toBeCloseTo(100, 5);
    expect(f.projection.basis).toBe("actual");
    expect(f.projection.horizons.map((h: any) => h.months)).toEqual([6, 12, 24, 36, 60]);
    for (const h of f.projection.horizons) expect(h.p10).toBeLessThanOrEqual(h.p90);
    expect(f.projection.method).toMatch(/not predictions/);
    expect(f.todo.length).toBeGreaterThan(0);
  });
});
