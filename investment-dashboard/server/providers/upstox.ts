// Upstox official API (https://upstox.com/developer/api-documentation).
//
// PUBLIC (no login, verified working 18-Nov-2026): historical & intraday candles, instruments master.
// ACCOUNT (OAuth 2.0 authorization-code flow; token valid until 03:30 IST next day):
//   holdings, positions, funds & margin, order book, P&L report, LTP quotes.
//
// SAFETY: this module deliberately contains NO order placement / modification / cancellation code.
// accountGet() refuses any path that is not on the read-only allowlist below.

import zlib from "node:zlib";
import { httpJson, httpRequest, UpstreamError } from "./http.ts";

const BASE = "https://api.upstox.com";
const PROVIDER = "Upstox";

export const READ_ONLY_PATHS = new Set([
  "/v2/portfolio/long-term-holdings",
  "/v2/portfolio/short-term-positions",
  "/v2/user/get-funds-and-margin",
  "/v2/order/retrieve-all",
  "/v2/trade/profit-loss/data",
  "/v2/market-quote/ltp",
  "/v2/user/profile",
]);

export interface Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type CandleResp = { status: string; data: { candles: [string, number, number, number, number, number, number][] } };

const toCandles = (r: CandleResp): Candle[] =>
  (r.data?.candles ?? [])
    .map(([ts, open, high, low, close, volume]) => ({ ts, open, high, low, close, volume }))
    .sort((a, b) => a.ts.localeCompare(b.ts));

/** Daily candles, oldest first. Dates are yyyy-mm-dd. */
export async function dailyCandles(instrumentKey: string, from: string, to: string): Promise<Candle[]> {
  const url = `${BASE}/v2/historical-candle/${encodeURIComponent(instrumentKey)}/day/${to}/${from}`;
  return toCandles(await httpJson<CandleResp>(PROVIDER, url, { headers: { Accept: "application/json" } }));
}

/** Daily candles over long ranges (v3 endpoint; verified to return 10 years of index history on 18-Nov-2026). */
export async function dailyCandlesLong(instrumentKey: string, from: string, to: string): Promise<Candle[]> {
  const url = `${BASE}/v3/historical-candle/${encodeURIComponent(instrumentKey)}/days/1/${to}/${from}`;
  return toCandles(await httpJson<CandleResp>(PROVIDER, url, { headers: { Accept: "application/json" }, timeoutMs: 30000 }));
}

/** Today's 30-minute candles (empty outside trading days). */
export async function intradayCandles(instrumentKey: string): Promise<Candle[]> {
  const url = `${BASE}/v2/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/30minute`;
  return toCandles(await httpJson<CandleResp>(PROVIDER, url, { headers: { Accept: "application/json" } }));
}

export interface MasterInstrument {
  symbol: string;
  name: string;
  isin: string | null;
  instrumentKey: string;
  exchange: string;
  kind: "stock" | "etf" | "index";
}

interface RawInstrument {
  segment: string;
  name: string;
  isin?: string;
  instrument_type?: string;
  instrument_key: string;
  trading_symbol?: string;
  short_name?: string;
  exchange: string;
}

/** Downloads the official instruments master and keeps NSE cash-market equities, ETFs and indices. */
export async function fetchInstrumentMaster(): Promise<MasterInstrument[]> {
  const out: MasterInstrument[] = [];
  for (const ex of ["NSE", "BSE"]) {
    const res = await httpRequest(PROVIDER, `https://assets.upstox.com/market-quote/instruments/exchange/${ex}.json.gz`, { timeoutMs: 60000 });
    if (!res.ok) throw new UpstreamError(`Instrument master HTTP ${res.status}`, res.status, PROVIDER);
    const raw = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) as RawInstrument[];
    for (const r of raw) {
      if (r.segment === "NSE_INDEX" || (r.segment === "BSE_INDEX" && r.name === "BSE SENSEX")) {
        out.push({ symbol: r.segment === "BSE_INDEX" ? "SENSEX" : r.name, name: r.name, isin: null, instrumentKey: r.instrument_key, exchange: r.exchange, kind: "index" });
      } else if (ex === "NSE" && r.segment === "NSE_EQ" && ["EQ", "BE"].includes(r.instrument_type ?? "") && r.trading_symbol) {
        const isEtf = (r.isin ?? "").startsWith("INF");
        out.push({ symbol: r.trading_symbol, name: r.short_name || r.name, isin: r.isin ?? null, instrumentKey: r.instrument_key, exchange: "NSE", kind: isEtf ? "etf" : "stock" });
      }
    }
  }
  return out;
}

// ---------------- OAuth (account) ----------------

export interface UpstoxConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function upstoxConfigFromEnv(env = process.env): UpstoxConfig | null {
  const { UPSTOX_CLIENT_ID, UPSTOX_CLIENT_SECRET, UPSTOX_REDIRECT_URI } = env;
  if (!UPSTOX_CLIENT_ID || !UPSTOX_CLIENT_SECRET || !UPSTOX_REDIRECT_URI) return null;
  return { clientId: UPSTOX_CLIENT_ID, clientSecret: UPSTOX_CLIENT_SECRET, redirectUri: UPSTOX_REDIRECT_URI };
}

export function authorizationUrl(cfg: UpstoxConfig, state: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state });
  return `${BASE}/v2/login/authorization/dialog?${q}`;
}

/** Token validity: until 03:30 IST on the next day (or the same day if generated before 03:30). */
export function tokenExpiry(issuedAt: Date): Date {
  const IST = 5.5 * 3600_000;
  const local = new Date(issuedAt.getTime() + IST);
  const exp = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3, 30));
  if (local.getTime() >= exp.getTime()) exp.setUTCDate(exp.getUTCDate() + 1);
  return new Date(exp.getTime() - IST);
}

export async function exchangeCode(cfg: UpstoxConfig, code: string): Promise<{ accessToken: string; userName: string; userId: string }> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  const r = await httpJson<{ access_token?: string; user_name?: string; user_id?: string }>(PROVIDER, `${BASE}/v2/login/authorization/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    retries: 0, // authorization codes are single-use
  });
  if (!r.access_token) throw new UpstreamError("Upstox did not return an access token", null, PROVIDER);
  return { accessToken: r.access_token, userName: r.user_name ?? "", userId: r.user_id ?? "" };
}

async function accountGet<T>(token: string, path: string, query?: Record<string, string>): Promise<T> {
  if (!READ_ONLY_PATHS.has(path)) throw new Error(`Refusing non-allowlisted Upstox path ${path}`);
  const url = `${BASE}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const r = await httpJson<{ status: string; data: T }>(PROVIDER, url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  return r.data;
}

export interface UpstoxHolding {
  isin: string;
  company_name: string;
  trading_symbol: string;
  quantity: number;
  t1_quantity: number;
  average_price: number;
  last_price: number;
  close_price: number;
  pnl: number;
  day_change: number;
  day_change_percentage: number;
  instrument_token: string;
  exchange: string;
}
export interface UpstoxPosition {
  trading_symbol: string;
  exchange: string;
  product: string;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  realised: number;
  unrealised: number;
  instrument_token: string;
}
export interface UpstoxOrder {
  order_id: string;
  trading_symbol: string;
  transaction_type: "BUY" | "SELL";
  quantity: number;
  filled_quantity: number;
  average_price: number;
  price: number;
  status: string;
  product: string;
  order_type: string;
  order_timestamp: string;
  status_message: string | null;
}
export interface UpstoxFunds {
  equity?: { available_margin: number; used_margin: number; payin_amount: number };
}
export interface UpstoxPnlRow {
  quantity: number;
  isin: string;
  scrip_name: string;
  trade_type: string;
  buy_date: string;
  buy_average: number;
  sell_date: string;
  sell_average: number;
  buy_amount: number;
  sell_amount: number;
}

export const account = {
  holdings: (t: string) => accountGet<UpstoxHolding[]>(t, "/v2/portfolio/long-term-holdings"),
  positions: (t: string) => accountGet<UpstoxPosition[]>(t, "/v2/portfolio/short-term-positions"),
  funds: (t: string) => accountGet<UpstoxFunds>(t, "/v2/user/get-funds-and-margin", { segment: "SEC" }),
  orders: (t: string) => accountGet<UpstoxOrder[]>(t, "/v2/order/retrieve-all"),
  pnl: (t: string, financialYear: string, page = 1) =>
    accountGet<UpstoxPnlRow[]>(t, "/v2/trade/profit-loss/data", { segment: "EQ", financial_year: financialYear, page_number: String(page), page_size: "500" }),
  ltp: (t: string, instrumentKeys: string[]) =>
    accountGet<Record<string, { last_price: number; instrument_token: string }>>(t, "/v2/market-quote/ltp", { instrument_key: instrumentKeys.join(",") }),
};

/** "2026-27" → "2627" as required by the P&L report API. */
export function upstoxFinancialYear(fy: string): string {
  const start = Number(fy.slice(0, 4));
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}
