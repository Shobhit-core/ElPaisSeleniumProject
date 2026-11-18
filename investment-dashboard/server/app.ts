import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DB } from "./db.ts";
import { backupDb, getSetting, setSetting } from "./db.ts";
import { log } from "./log.ts";
import {
  createSession,
  destroySession,
  isValidSession,
  rateLimit,
  readCookie,
  requireAuth,
  requireCsrfHeader,
  securityHeaders,
  SESSION_COOKIE,
  sessionCookie,
  verifyPassword,
} from "./security.ts";
import {
  addTransactions,
  cashDeposits,
  csvToTransactions,
  deleteTransaction,
  getProfile,
  LedgerError,
  listNotes,
  listTransactions,
  NotFound,
  portfolioSnapshot,
  recordDailySnapshot,
  TransactionInput,
  updateTransaction,
} from "./services/journal.ts";
import * as md from "./services/marketData.ts";
import * as broker from "./services/broker.ts";
import { listAlerts, runAlerts } from "./services/alertsService.ts";
import { localAnswer, researchAnswer, researchAvailable } from "./services/analyst.ts";
import { UpstreamError } from "./providers/http.ts";
import { parseConstituentsCsv } from "./providers/feeds.ts";
import { matchesCompany } from "../shared/alerts.ts";
import { allocationBy, xirr } from "../shared/portfolio.ts";
import { buildTaxReport } from "../shared/tax.ts";
import { ASSUMPTION_SETS, assessReadiness, blendedReturn, buildScenarios, compareDeployment, futureValue, stressLoss } from "../shared/allocation.ts";
import { annualisedVolatility, buildRiskReport, DEFAULT_THRESHOLDS, maxDrawdown, simulatedPortfolioSeries, type RiskThresholds } from "../shared/risk.ts";
import { compositeRank, fundamentalScore, METHODOLOGY, METRIC_RULES, riskScore, valuation } from "../shared/scoring.ts";
import { technicalSummary, sma, rsi } from "../shared/indicators.ts";
import { DEFAULT_BROKERS, DEFAULT_STATUTORY, estimateDeliveryCharges, type ChargeProfile, type StatutoryRates } from "../shared/charges.ts";
import type { InvestorProfile, NewTransaction, ResearchNote } from "../shared/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  passwordHash: string;
  secureCookies: boolean;
  serveStatic?: string | null;
  backupDir: string;
}

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return r.data;
}

const ProfileInput = z.object({
  horizon: z.enum(["1-3", "3-5", "5-10", "10+"]),
  riskTolerance: z.enum(["conservative", "moderate", "aggressive"]),
  emergencyFund: z.enum(["none", "partial", "full"]),
  needWithin12Months: z.enum(["yes", "maybe", "no"]),
  monthlyCapacity: z.coerce.number().min(0).max(1e8),
  preference: z.enum(["mutual_funds", "etfs", "stocks", "combination"]),
  lossTolerance: z.enum(["5", "10", "20", "20+"]),
  taxSlabPct: z.coerce.number().refine((v) => [0, 5, 10, 15, 20, 25, 30].includes(v), "Choose a valid slab"),
  capital: z.coerce.number().positive().max(1e9),
});

const Metric = z.object({ value: z.coerce.number().finite(), source: z.string().trim().min(3, "Every figure needs a source").max(500), asOf: z.string().trim().min(2, "State the period/date").max(40) });
const NoteInput = z.object({
  name: z.string().trim().min(1).max(200),
  sector: z.string().trim().max(80).nullish().transform((v) => v || null),
  assetClass: z.enum(["EQUITY", "EQUITY_ETF", "EQUITY_MF", "DEBT_MF", "GOLD_ETF", "GSEC", "CASH"]).default("EQUITY"),
  fundamentals: z.partialRecord(z.enum(METRIC_RULES.map((r) => r.key).concat(["pe", "pb", "sectorPe", "institutionalHolding"] as never[]) as [string, ...string[]]), Metric).default({}),
  thesis: z.string().max(6000).default(""),
  growthDrivers: z.string().max(4000).default(""),
  risks: z.string().max(4000).default(""),
  invalidation: z.string().max(4000).default(""),
  entryStrategy: z.string().max(4000).default(""),
  horizon: z.string().max(100).default(""),
  targetPrice: z.coerce.number().positive().nullish().transform((v) => v ?? null),
  maxPe: z.coerce.number().positive().nullish().transform((v) => v ?? null),
  status: z.enum(["researching", "watchlist", "owned", "rejected"]).default("researching"),
  reviewBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null),
});

export function createApp(db: DB, opts: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ type: ["text/csv", "text/plain"], limit: "2mb" }));
  app.use((req, _res, next) => {
    if (req.path.startsWith("/api/")) log.debug("req", { method: req.method, path: req.path });
    next();
  });

  // ---------- public ----------
  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.post(
    "/api/auth/login",
    rateLimit("login", 10, 15 * 60_000),
    h((req, res) => {
      const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
      if (!verifyPassword(password, opts.passwordHash)) {
        log.warn("login_failed", { ip: req.ip });
        throw new HttpError(401, "Incorrect password");
      }
      const s = createSession(db);
      res.setHeader("Set-Cookie", sessionCookie(s.token, s.expires, opts.secureCookies));
      return res.json({ ok: true });
    }),
  );
  app.get("/api/auth/me", (req, res) => res.json({ authenticated: isValidSession(db, readCookie(req, SESSION_COOKIE)) }));

  // OAuth redirect target. The SameSite=Strict session cookie is not sent on this cross-site redirect,
  // so the request is authenticated by the single-use, unguessable `state` created by a signed-in user.
  app.get(
    "/api/broker/callback",
    h(async (req, res) => {
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      try {
        if (!code || !state) throw new Error("Missing code/state");
        await broker.completeOAuth(db, code, state);
        res.redirect("/#/settings?broker=connected");
      } catch (e) {
        log.warn("oauth_failed", { error: String(e) });
        res.redirect(`/#/settings?broker=error&reason=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`);
      }
    }),
  );

  // ---------- authenticated ----------
  const api = express.Router();
  api.use(requireAuth(db));
  api.use(requireCsrfHeader);
  api.use(rateLimit("api", 600, 60_000));

  api.post("/auth/logout", (req, res) => {
    destroySession(db, readCookie(req, SESSION_COOKIE));
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });

  // Profile
  api.get("/profile", (_req, res) => res.json({ profile: getProfile(db) }));
  api.put(
    "/profile",
    h((req, res) => {
      const p = parse(ProfileInput, req.body);
      const profile: InvestorProfile = { ...p, completedAt: new Date().toISOString() };
      setSetting(db, "profile", profile);
      res.json({ profile, readiness: assessReadiness(profile) });
    }),
  );

  // Portfolio
  api.get(
    "/portfolio",
    h((_req, res) => {
      const { holdings, summary, ledger, txns } = portfolioSnapshot(db);
      const snaps = db.prepare("SELECT date, invested, value, cash FROM snapshots ORDER BY date").all();
      const flows = [
        ...txns.filter((t) => t.type !== "DIVIDEND").map((t) => ({
          date: t.date,
          amount: (t.type === "BUY" ? -1 : 1) * t.quantity * t.price - (t.brokerage + t.stt + t.otherCharges),
        })),
        ...ledger.dividends.map((d) => ({ date: d.date, amount: d.amount })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      if (summary.currentValue > 0) flows.push({ date: new Date().toISOString().slice(0, 10), amount: summary.currentValue });
      res.json({
        summary,
        holdings,
        byClass: allocationBy(holdings, (x) => x.assetClass, Math.max(summary.cash, 0)),
        bySector: allocationBy(holdings.filter((x) => x.assetClass === "EQUITY"), (x) => x.sector || "Unclassified"),
        snapshots: snaps,
        xirrPct: xirr(flows),
        realised: ledger.realised,
      });
    }),
  );
  api.post(
    "/portfolio/refresh-prices",
    h(async (_req, res) => {
      const { holdings } = portfolioSnapshot(db);
      const syms = holdings.map((x) => x.symbol);
      const mf = syms.filter((s) => s.startsWith("MF:"));
      const errors: string[] = [];
      if (mf.length) {
        const last = getSetting<string | null>(db, "navs_synced_at", null);
        if (!last || Date.now() - Date.parse(last) > 3 * 3600_000) await md.syncNavs(db).catch((e) => errors.push(`AMFI: ${e.message}`));
      }
      const r = await md.refreshQuotes(db, syms, 60_000);
      recordDailySnapshot(db);
      res.json({ ...r, errors });
    }),
  );

  // Transactions
  const toNew = (body: unknown): NewTransaction => ({ ...(parse(TransactionInput, body) as Omit<NewTransaction, "source">), source: "manual" });
  api.get("/transactions", (_req, res) => res.json({ transactions: listTransactions(db) }));
  api.post(
    "/transactions",
    h((req, res) => {
      const ids = addTransactions(db, [toNew(req.body)]);
      recordDailySnapshot(db);
      res.status(201).json({ id: ids[0] });
    }),
  );
  api.put(
    "/transactions/:id",
    h((req, res) => {
      updateTransaction(db, Number(req.params.id), toNew(req.body));
      res.json({ ok: true });
    }),
  );
  api.delete(
    "/transactions/:id",
    h((req, res) => {
      deleteTransaction(db, Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  api.post(
    "/transactions/import",
    h((req, res) => {
      if (typeof req.body !== "string") throw new HttpError(400, "Send the CSV as text/csv");
      const { valid, errors } = csvToTransactions(req.body);
      const dryRun = req.query.dryRun === "1";
      if (errors.length) return res.status(400).json({ imported: 0, errors, preview: valid.slice(0, 50) });
      if (dryRun) return res.json({ imported: 0, errors: [], preview: valid.slice(0, 50), count: valid.length });
      addTransactions(db, valid);
      recordDailySnapshot(db);
      return res.json({ imported: valid.length, errors: [] });
    }),
  );
  api.get("/transactions/export.csv", (_req, res) => {
    const cols = ["date", "type", "symbol", "name", "assetClass", "sector", "quantity", "price", "brokerage", "stt", "otherCharges", "rationale", "exitRationale", "lessons"] as const;
    const esc = (v: unknown) => {
      let s = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "date,type,symbol,name,asset_class,sector,quantity,price,brokerage,stt,other_charges,rationale,exit_rationale,lessons";
    const lines = listTransactions(db).map((t) => cols.map((c) => esc(t[c])).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="journal.csv"');
    res.send([header, ...lines].join("\n"));
  });

  // Cash
  api.get("/cash", (_req, res) => res.json({ entries: db.prepare("SELECT * FROM cash_ledger ORDER BY date DESC, id DESC").all(), deposits: cashDeposits(db) }));
  api.post(
    "/cash",
    h((req, res) => {
      const c = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.coerce.number().finite().refine((v) => v !== 0, "Amount cannot be zero").refine((v) => Math.abs(v) < 1e9), note: z.string().max(300).nullish() }), req.body);
      db.prepare("INSERT INTO cash_ledger (date, amount, note, created_at) VALUES (?, ?, ?, ?)").run(c.date, c.amount, c.note ?? null, new Date().toISOString());
      res.status(201).json({ ok: true });
    }),
  );
  api.delete("/cash/:id", (req, res) => {
    db.prepare("DELETE FROM cash_ledger WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  // Quotes / instruments / funds
  api.post(
    "/quotes/manual",
    h((req, res) => {
      const q = parse(z.object({ symbol: z.string().min(1).max(40), price: z.coerce.number().positive(), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
      md.setManualQuote(db, q.symbol.toUpperCase().replace(/^MF:/i, "MF:"), q.price, `${q.asOf}T15:30:00+05:30`);
      res.json({ ok: true });
    }),
  );
  api.get("/instruments/search", (req, res) => {
    const q = String(req.query.q ?? "").trim();
    res.json({ results: q.length < 2 ? [] : md.searchInstruments(db, q), instrumentsLoaded: md.instrumentCount(db), navsSyncedAt: getSetting(db, "navs_synced_at", null) });
  });
  api.post(
    "/instruments/sync",
    h(async (_req, res) => {
      const out: Record<string, unknown> = {};
      await md.syncInstruments(db).then((n) => (out.instruments = n)).catch((e) => (out.instrumentsError = e.message));
      await md.syncNavs(db).then((n) => (out.navs = n)).catch((e) => (out.navsError = e.message));
      res.json(out);
    }),
  );
  api.get("/funds/search", (req, res) =>
    res.json({
      results: md.searchFunds(db, String(req.query.q ?? ""), { category: req.query.category ? String(req.query.category) : undefined, directGrowthOnly: req.query.direct === "1" }),
      navsSyncedAt: getSetting(db, "navs_synced_at", null),
      source: "AMFI NAVAll.txt",
    }),
  );

  // Charges
  api.get("/settings/charges", (_req, res) => res.json({ brokers: getSetting(db, "brokers", DEFAULT_BROKERS), statutory: getSetting(db, "statutory", DEFAULT_STATUTORY), selected: getSetting(db, "broker_selected", "upstox") }));
  api.put(
    "/settings/charges",
    h((req, res) => {
      const b = req.body as { brokers?: ChargeProfile[]; statutory?: StatutoryRates; selected?: string };
      if (b.brokers) setSetting(db, "brokers", b.brokers);
      if (b.statutory) setSetting(db, "statutory", b.statutory);
      if (b.selected) setSetting(db, "broker_selected", b.selected);
      res.json({ ok: true });
    }),
  );
  api.get(
    "/charges/estimate",
    h((req, res) => {
      const p = parse(z.object({ side: z.enum(["BUY", "SELL"]), quantity: z.coerce.number().positive(), price: z.coerce.number().positive(), broker: z.string().optional(), mf: z.string().optional() }), req.query);
      const brokers = getSetting(db, "brokers", DEFAULT_BROKERS);
      const b = brokers.find((x) => x.id === (p.broker ?? getSetting(db, "broker_selected", "upstox"))) ?? brokers[0];
      res.json({ broker: b, ...estimateDeliveryCharges(p.side, p.quantity, p.price, b, getSetting(db, "statutory", DEFAULT_STATUTORY), { isMutualFund: p.mf === "1" }) });
    }),
  );

  // Plan (gated on profile)
  api.get(
    "/plan",
    h((_req, res) => {
      const profile = getProfile(db);
      if (!profile) return res.status(409).json({ error: "Complete your investor profile first. Recommendations are withheld until then." });
      const readiness = assessReadiness(profile);
      const scenarios = buildScenarios(profile, profile.capital).map((s) => ({
        ...s,
        stressLoss: stressLoss(s.lines),
        projections: ASSUMPTION_SETS.map((a) => {
          const r = blendedReturn(s.lines, a);
          return { label: a.label, annualPct: r, years: [3, 5, 10].map((y) => ({ years: y, lumpSumOnly: futureValue(profile.capital, 0, r, y), withMonthly: futureValue(profile.capital, profile.monthlyCapacity, r, y), totalContributed: profile.capital + profile.monthlyCapacity * 12 * y })) };
        }),
      }));
      return res.json({
        profile,
        readiness,
        scenarios,
        chosen: getSetting(db, "chosen_scenario", null),
        deployment: compareDeployment(profile.capital, 3),
        assumptions: ASSUMPTION_SETS,
      });
    }),
  );
  api.put("/plan/choice", h((req, res) => {
    const { scenario } = parse(z.object({ scenario: z.enum(["conservative", "moderate", "growth"]) }), req.body);
    setSetting(db, "chosen_scenario", scenario);
    res.json({ ok: true });
  }));

  // Research
  api.get(
    "/research/:symbol/chart",
    h(async (req, res) => {
      const symbol = String(req.params.symbol).toUpperCase();
      const days = Math.min(Math.max(Number(req.query.days ?? 400), 30), 1500);
      const hist = await md.ensureHistory(db, symbol, days);
      const closes = hist.map((c) => c.close);
      const s50 = sma(closes, 50);
      const s200 = sma(closes, 200);
      const r = rsi(closes);
      res.json({
        symbol,
        instrument: md.getInstrument(db, symbol),
        source: "Upstox historical candle API (daily, NSE)",
        lastDate: hist.at(-1)?.date ?? null,
        series: hist.map((c, i) => ({ ...c, sma50: s50[i], sma200: s200[i], rsi14: r[i] })),
        technical: technicalSummary(hist),
        warnings: hist
          .map((c, i) => (i > 0 && Math.abs(c.close / hist[i - 1].close - 1) > 0.25 ? `${c.date}: ${((c.close / hist[i - 1].close - 1) * 100).toFixed(0)}% one-day move — possibly an unadjusted split/bonus; returns and volatility around this date may be wrong.` : null))
          .filter(Boolean),
        volatilityPct: annualisedVolatility(closes.slice(-250)),
        maxDrawdown1y: maxDrawdown(closes.slice(-250)).pct,
      });
    }),
  );
  api.get("/research/notes", (_req, res) => res.json({ notes: listNotes(db), methodology: METHODOLOGY, metrics: METRIC_RULES }));
  api.get("/research/notes/:symbol", (req, res) => {
    const row = db.prepare("SELECT data FROM research_notes WHERE symbol = ?").get(String(req.params.symbol).toUpperCase()) as { data: string } | undefined;
    if (!row) return res.json({ note: null });
    const note = JSON.parse(row.data) as ResearchNote;
    const val = valuation(note.fundamentals);
    return res.json({ note, score: fundamentalScore(note.fundamentals), valuation: val });
  });
  api.put(
    "/research/notes/:symbol",
    h((req, res) => {
      const symbol = String(req.params.symbol).toUpperCase();
      const n = parse(NoteInput, req.body);
      const note: ResearchNote = { ...(n as Omit<ResearchNote, "symbol" | "updatedAt">), symbol, updatedAt: new Date().toISOString() };
      db.prepare("INSERT INTO research_notes (symbol, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").run(symbol, JSON.stringify(note), note.updatedAt);
      res.json({ note, score: fundamentalScore(note.fundamentals), valuation: valuation(note.fundamentals) });
    }),
  );
  api.delete("/research/notes/:symbol", (req, res) => {
    db.prepare("DELETE FROM research_notes WHERE symbol = ?").run(String(req.params.symbol).toUpperCase());
    res.json({ ok: true });
  });

  // Recommendations (ranked watchlist) — gated on profile
  api.get(
    "/recommendations",
    h(async (_req, res) => {
      const profile = getProfile(db);
      if (!profile) return res.status(409).json({ error: "Complete your investor profile first." });
      const readiness = assessReadiness(profile);
      const notes = listNotes(db).filter((n) => n.status !== "rejected");
      await md.refreshQuotes(db, notes.map((n) => n.symbol), 15 * 60_000).catch(() => null);
      const quotes = md.getQuotes(db, notes.map((n) => n.symbol));
      const scen = buildScenarios(profile, profile.capital);
      const chosen = scen.find((s) => s.id === getSetting<string>(db, "chosen_scenario", "")) ?? scen.find((s) => s.suitability === "suitable") ?? scen[0];
      const stockSleeve = chosen.lines.find((l) => l.key === "stocks")?.amount ?? 0;
      const items = notes
        .map((n) => {
          const f = fundamentalScore(n.fundamentals);
          const closes = md.storedHistory(db, n.symbol).map((c) => c.close).slice(-250);
          const vol = annualisedVolatility(closes);
          const q = quotes.get(n.symbol) ?? null;
          const v = valuation(n.fundamentals);
          const rk = riskScore(n.fundamentals, vol, v);
          const rank = compositeRank(f, v);
          const reasonsFor: string[] = [];
          const reasonsAgainst: string[] = [];
          for (const p of f.pillars) {
            if (p.score !== null && p.score >= 75) reasonsFor.push(`Strong ${p.pillar.toLowerCase()} (${p.score}/100)`);
            if (p.score !== null && p.score < 40) reasonsAgainst.push(`Weak ${p.pillar.toLowerCase()} (${p.score}/100)`);
          }
          if (v.peLabel === "discount" || v.pegLabel === "attractive") reasonsFor.push(v.summary);
          if (v.peLabel === "premium" || v.pegLabel === "expensive") reasonsAgainst.push(v.summary);
          if (rk.score !== null && rk.score >= 60) reasonsAgainst.push(`Elevated risk: ${rk.factors.join(", ")}`);
          if (f.confidence < 50) reasonsAgainst.push(`Only ${f.confidence}% of required data entered — not rankable`);
          const eligible = readiness.ready && stockSleeve > 0 && rank !== null && n.assetClass === "EQUITY";
          const suggested = eligible ? Math.min(stockSleeve / 2, stockSleeve) : 0;
          return {
            symbol: n.symbol,
            name: n.name,
            sector: n.sector,
            status: n.status,
            price: q?.price ?? null,
            priceAsOf: q?.asOf ?? null,
            priceSource: q?.source ?? null,
            fundamentalScore: f.score,
            confidence: f.confidence,
            valuation: v,
            riskScore: rk.score,
            riskFactors: rk.factors,
            rank,
            horizon: n.horizon,
            suggestedAmount: suggested,
            suggestedShares: suggested && q?.price ? Math.floor(suggested / q.price) : null,
            suggestionNote: !readiness.ready
              ? "Equity investing is blocked by your profile (see Plan)."
              : stockSleeve === 0
                ? "Your chosen plan has no individual-stock sleeve; use index funds instead."
                : rank === null
                  ? "Not rankable — complete the fundamentals and valuation data."
                  : `Up to half of your ₹${Math.round(stockSleeve).toLocaleString("en-IN")} stock sleeve, entered in 2–3 tranches.`,
            reasonsFor,
            reasonsAgainst,
            thesis: n.thesis,
            risks: n.risks,
            invalidation: n.invalidation,
            entryStrategy: n.entryStrategy,
            updatedAt: n.updatedAt,
          };
        })
        .sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1));
      return res.json({ items, methodology: METHODOLOGY, readiness, stockSleeve, scenario: chosen.label });
    }),
  );

  // Market intelligence
  api.get("/market/indices", h(async (_req, res) => res.json(await md.indexSnapshot(db))));
  api.get("/market/breadth", h(async (_req, res) => res.json(await md.breadth(db))));
  api.get(
    "/market/announcements",
    h(async (req, res) => {
      const feed = await md.announcements(db);
      let items = feed.data;
      if (req.query.filter === "tracked") {
        // Companies only: fund/ETF holdings would match every NAV declaration by their AMC.
        const { holdings } = portfolioSnapshot(db);
        const names = [...holdings.filter((x) => x.assetClass === "EQUITY").map((x) => x.name), ...listNotes(db).filter((n) => n.assetClass === "EQUITY").map((n) => n.name)];
        items = items.filter((a) => names.some((n) => matchesCompany(a.company, n)));
      }
      if (req.query.company) items = items.filter((a) => matchesCompany(a.company, String(req.query.company)));
      const q = String(req.query.q ?? "").toLowerCase();
      if (q) items = items.filter((a) => a.company.toLowerCase().includes(q) || a.subject.toLowerCase().includes(q));
      res.json({ items: items.slice(0, 200), fetchedAt: feed.fetchedAt, stale: feed.stale, source: "NSE corporate announcements RSS" });
    }),
  );
  api.put(
    "/market/constituents",
    h((req, res) => {
      if (typeof req.body !== "string") throw new HttpError(400, "Send the official ind_nifty50list.csv as text/csv");
      let list;
      try {
        list = parseConstituentsCsv(req.body);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : "Invalid CSV");
      }
      if (list.length < 40 || list.length > 60) throw new HttpError(400, `Expected ~50 constituents, found ${list.length}`);
      setSetting(db, "nifty50_constituents_manual", { list, savedAt: new Date().toISOString() });
      res.json({ saved: list.length });
    }),
  );
  api.get("/market/economy", h(async (_req, res) => {
    const feed = await md.rbiPress(db);
    res.json({ items: feed.data.slice(0, 30), fetchedAt: feed.fetchedAt, stale: feed.stale, source: "RBI press releases RSS" });
  }));
  api.get("/market/briefing", (_req, res) => {
    const file = path.join(here, "..", "docs", "MARKET_BRIEFING.md");
    res.json({ markdown: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null });
  });

  // Risk
  api.get(
    "/risk",
    h((_req, res) => {
      const t = getSetting<RiskThresholds>(db, "risk_thresholds", DEFAULT_THRESHOLDS);
      const { holdings, summary } = portfolioSnapshot(db);
      const report = buildRiskReport(holdings, summary.cash, getProfile(db), t);
      const listed = holdings.filter((x) => !x.symbol.startsWith("MF:"));
      const hist = new Map(listed.map((x) => [x.symbol, md.storedHistory(db, x.symbol).slice(-250).map((c) => ({ date: c.date, close: c.close }))]));
      const series = simulatedPortfolioSeries(listed, hist);
      const values = series.map((s) => s.value);
      res.json({
        ...report,
        thresholds: t,
        simulated: {
          note: "Hypothetical: today's listed holdings (excluding mutual funds) valued over the past year at constant quantities. Shows the risk you hold now, not your actual past results.",
          series,
          volatilityPct: annualisedVolatility(values),
          maxDrawdownPct: values.length ? maxDrawdown(values).pct : null,
          coverage: listed.filter((x) => (hist.get(x.symbol)?.length ?? 0) > 0).map((x) => x.symbol),
          missing: listed.filter((x) => !(hist.get(x.symbol)?.length)).map((x) => x.symbol),
        },
      });
    }),
  );
  api.put(
    "/settings/risk",
    h((req, res) => {
      const t = parse(z.object({ maxSingleStockPct: z.coerce.number().min(1).max(100), maxSectorPct: z.coerce.number().min(1).max(100), maxDrawdownAlertPct: z.coerce.number().min(1).max(100), priceMoveAlertPct: z.coerce.number().min(0.5).max(50) }), req.body);
      setSetting(db, "risk_thresholds", t);
      res.json({ ok: true });
    }),
  );
  api.post(
    "/risk/load-history",
    h(async (_req, res) => {
      const { holdings } = portfolioSnapshot(db);
      const failed: string[] = [];
      for (const x of holdings.filter((y) => !y.symbol.startsWith("MF:"))) await md.ensureHistory(db, x.symbol, 400).catch(() => failed.push(x.symbol));
      res.json({ failed });
    }),
  );

  // Tax
  api.get(
    "/tax",
    h((req, res) => {
      const profile = getProfile(db);
      const slab = req.query.slab !== undefined ? Number(req.query.slab) : (profile?.taxSlabPct ?? 30);
      const { ledger, txns } = portfolioSnapshot(db);
      const reports = buildTaxReport(ledger.realised, slab);
      const charges = txns.reduce((a, t) => ({ brokerage: a.brokerage + t.brokerage, stt: a.stt + t.stt, other: a.other + t.otherCharges }), { brokerage: 0, stt: 0, other: 0 });
      const byFyDiv = new Map<string, number>();
      for (const d of ledger.dividends) {
        const [y, m] = d.date.split("-").map(Number);
        const fy = `${m >= 4 ? y : y - 1}-${String(((m >= 4 ? y : y - 1) + 1) % 100).padStart(2, "0")}`;
        byFyDiv.set(fy, (byFyDiv.get(fy) ?? 0) + d.amount);
      }
      res.json({
        slabPct: slab,
        reports,
        dividendsByFy: Object.fromEntries(byFyDiv),
        charges,
        disclaimer:
          "ESTIMATE ONLY. Actual liability depends on your total income, surcharge, rebates, loss carry-forward, grandfathering and broker-reported figures (AIS/Tax P&L). Dividends are taxed at your slab rate and are not included in the estimate. Verify with a chartered accountant before filing.",
      });
    }),
  );

  // Alerts
  api.get("/alerts", (_req, res) => res.json({ alerts: listAlerts(db) }));
  api.post("/alerts/run", h(async (_req, res) => res.json(await runAlerts(db))));
  api.post("/alerts/:id/read", (req, res) => {
    db.prepare("UPDATE alerts SET read_at = ? WHERE id = ?").run(new Date().toISOString(), Number(req.params.id));
    res.json({ ok: true });
  });
  api.post("/alerts/read-all", (_req, res) => {
    db.prepare("UPDATE alerts SET read_at = ? WHERE read_at IS NULL").run(new Date().toISOString());
    res.json({ ok: true });
  });

  // Broker
  api.get("/broker/status", (_req, res) => res.json(broker.brokerStatus(db)));
  api.post(
    "/broker/connect",
    h((_req, res) => {
      try {
        res.json({ url: broker.beginOAuth() });
      } catch (e) {
        throw new HttpError(409, e instanceof Error ? e.message : String(e));
      }
    }),
  );
  api.post("/broker/disconnect", (_req, res) => {
    broker.disconnect(db);
    res.json({ ok: true });
  });
  api.get("/broker/snapshot", h(async (_req, res) => res.json(await broker.brokerSnapshot(db))));
  api.get("/broker/pnl", h(async (req, res) => res.json({ rows: await broker.brokerRealisedPnl(db, String(req.query.fy ?? "2026-27")) })));

  // Analyst
  api.get("/analyst/status", (_req, res) => res.json({ research: researchAvailable(), history: db.prepare("SELECT id, question, answer, sources, mode, created_at FROM analyst_log ORDER BY id DESC LIMIT 20").all() }));
  api.post(
    "/analyst",
    rateLimit("analyst", 20, 60 * 60_000),
    h(async (req, res) => {
      const { question, mode } = parse(z.object({ question: z.string().trim().min(3).max(1000), mode: z.enum(["local", "research"]).default("local") }), req.body);
      let answer;
      if (mode === "research") {
        if (!researchAvailable()) throw new HttpError(503, "Research mode needs ANTHROPIC_API_KEY on the server. Local mode is available.");
        answer = await researchAnswer(db, question);
      } else answer = localAnswer(db, question);
      db.prepare("INSERT INTO analyst_log (question, answer, sources, mode, created_at) VALUES (?, ?, ?, ?, ?)").run(question, answer.answer, JSON.stringify(answer.sources), answer.mode, answer.generatedAt);
      res.json(answer);
    }),
  );

  // Maintenance
  api.post("/backup", (_req, res) => res.json({ file: path.basename(backupDb(db, opts.backupDir)) }));
  api.get("/status", (_req, res) =>
    res.json({
      instrumentsLoaded: md.instrumentCount(db),
      instrumentsSyncedAt: getSetting(db, "instruments_synced_at", null),
      navsSyncedAt: getSetting(db, "navs_synced_at", null),
      broker: broker.brokerStatus(db),
      research: researchAvailable(),
      profileComplete: !!getProfile(db),
    }),
  );

  app.use("/api", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  if (opts.serveStatic && fs.existsSync(opts.serveStatic)) {
    app.use(express.static(opts.serveStatic, { index: "index.html", maxAge: "1h" }));
    app.get("*", (_req, res) => res.sendFile(path.join(opts.serveStatic!, "index.html")));
  }

  // Central error handler: never leak stack traces or secrets.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof LedgerError) return res.status(422).json({ error: err.message });
    if (err instanceof NotFound) return res.status(404).json({ error: err.message });
    if (err instanceof broker.NotConnected) return res.status(409).json({ error: err.message });
    if (err instanceof UpstreamError) {
      log.warn("upstream_error", { provider: err.provider, status: err.status, msg: err.message, path: req.path });
      return res.status(502).json({ error: err.message, provider: err.provider, retryable: true });
    }
    if (err instanceof SyntaxError && "body" in (err as object)) return res.status(400).json({ error: "Malformed JSON" });
    log.error("unhandled", { path: req.path, err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  });
  return app;
}
