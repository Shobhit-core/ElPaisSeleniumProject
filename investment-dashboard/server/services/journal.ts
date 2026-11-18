// Journal repository + validation + CSV import, and the portfolio snapshot built from it.

import { z } from "zod";
import type { DB } from "../db.ts";
import { getSetting, tx } from "../db.ts";
import { ASSET_CLASSES, type InvestorProfile, type NewTransaction, type ResearchNote, type Transaction } from "../../shared/types.ts";
import { buildLedger, valuePortfolio, LedgerError } from "../../shared/portfolio.ts";
import { getQuotes } from "./marketData.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd").refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
const money = z.coerce.number().finite().min(0).max(1e10);

export const TransactionInput = z
  .object({
    date: isoDate.refine((d) => d <= new Date(Date.now() + 86400_000).toISOString().slice(0, 10), "Date is in the future"),
    type: z.enum(["BUY", "SELL", "DIVIDEND"]),
    symbol: z.string().trim().min(1).max(40).regex(/^(MF:\d+|[A-Z0-9&.\-_ ]+)$/i, "Invalid symbol").transform((s) => s.toUpperCase().replace(/^MF:/i, "MF:")),
    name: z.string().trim().min(1).max(200),
    assetClass: z.enum(ASSET_CLASSES as [string, ...string[]]),
    sector: z.string().trim().max(80).nullish().transform((v) => v || null),
    quantity: z.coerce.number().finite().positive().max(1e9),
    price: z.coerce.number().finite().positive().max(1e9),
    brokerage: money.default(0),
    stt: money.default(0),
    otherCharges: money.default(0),
    rationale: z.string().trim().max(4000).nullish().transform((v) => v || null),
    exitRationale: z.string().trim().max(4000).nullish().transform((v) => v || null),
    lessons: z.string().trim().max(4000).nullish().transform((v) => v || null),
  })
  .superRefine((t, ctx) => {
    if (t.type === "BUY" && !t.rationale) ctx.addIssue({ code: "custom", path: ["rationale"], message: "Write down why you are buying — it is the basis for reviewing the decision later." });
    if (t.type === "SELL" && !t.exitRationale) ctx.addIssue({ code: "custom", path: ["exitRationale"], message: "Record why you are selling." });
  });

type Row = Record<string, unknown>;
const toTxn = (r: Row): Transaction => ({
  id: r.id as number,
  date: r.date as string,
  type: r.type as Transaction["type"],
  symbol: r.symbol as string,
  name: r.name as string,
  assetClass: r.asset_class as Transaction["assetClass"],
  sector: (r.sector as string) ?? null,
  quantity: r.quantity as number,
  price: r.price as number,
  brokerage: r.brokerage as number,
  stt: r.stt as number,
  otherCharges: r.other_charges as number,
  rationale: (r.rationale as string) ?? null,
  exitRationale: (r.exit_rationale as string) ?? null,
  lessons: (r.lessons as string) ?? null,
  source: r.source as Transaction["source"],
  createdAt: r.created_at as string,
});

export function listTransactions(db: DB): Transaction[] {
  return (db.prepare("SELECT * FROM transactions ORDER BY date DESC, id DESC").all() as Row[]).map(toTxn);
}

/** Inserts after verifying the whole journal still balances (no sale exceeds holdings). */
export function addTransactions(db: DB, items: NewTransaction[], externalIds?: (string | null)[]): number[] {
  return tx(db, () => {
    const st = db.prepare(
      `INSERT INTO transactions (date, type, symbol, name, asset_class, sector, quantity, price, brokerage, stt, other_charges, rationale, exit_rationale, lessons, source, external_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ids = items.map((t, i) =>
      Number(
        st.run(t.date, t.type, t.symbol, t.name, t.assetClass, t.sector, t.quantity, t.price, t.brokerage, t.stt, t.otherCharges, t.rationale, t.exitRationale, t.lessons, t.source, externalIds?.[i] ?? null, new Date().toISOString())
          .lastInsertRowid,
      ),
    );
    buildLedger(listTransactions(db)); // throws LedgerError → rollback
    return ids;
  });
}

export function updateTransaction(db: DB, id: number, t: NewTransaction): void {
  tx(db, () => {
    const r = db
      .prepare(
        `UPDATE transactions SET date=?, type=?, symbol=?, name=?, asset_class=?, sector=?, quantity=?, price=?, brokerage=?, stt=?, other_charges=?, rationale=?, exit_rationale=?, lessons=? WHERE id=?`,
      )
      .run(t.date, t.type, t.symbol, t.name, t.assetClass, t.sector, t.quantity, t.price, t.brokerage, t.stt, t.otherCharges, t.rationale, t.exitRationale, t.lessons, id);
    if (r.changes === 0) throw new NotFound("Transaction not found");
    buildLedger(listTransactions(db));
  });
}

export function deleteTransaction(db: DB, id: number): void {
  tx(db, () => {
    const r = db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
    if (r.changes === 0) throw new NotFound("Transaction not found");
    buildLedger(listTransactions(db));
  });
}

export class NotFound extends Error {}
export { LedgerError };

// ---- CSV import ----
// Expected header (case-insensitive): date,type,symbol,name,asset_class,sector,quantity,price,brokerage,stt,other_charges,rationale
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function csvToTransactions(text: string): { valid: NewTransaction[]; errors: { line: number; message: string }[] } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return { valid: [], errors: [{ line: 1, message: "Empty file" }] };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const need = ["date", "type", "symbol", "quantity", "price"];
  const missing = need.filter((n) => !header.includes(n));
  if (missing.length) return { valid: [], errors: [{ line: 1, message: `Missing columns: ${missing.join(", ")}` }] };
  const valid: NewTransaction[] = [];
  const errors: { line: number; message: string }[] = [];
  rows.slice(1).forEach((r, i) => {
    const o: Record<string, string> = {};
    header.forEach((h, j) => (o[h] = (r[j] ?? "").trim()));
    const parsed = TransactionInput.safeParse({
      date: o.date,
      type: o.type?.toUpperCase(),
      symbol: o.symbol,
      name: o.name || o.symbol,
      assetClass: (o.asset_class || "EQUITY").toUpperCase(),
      sector: o.sector,
      quantity: o.quantity,
      price: o.price,
      brokerage: o.brokerage || 0,
      stt: o.stt || 0,
      otherCharges: o.other_charges || 0,
      rationale: o.rationale || (o.type?.toUpperCase() === "BUY" ? "Imported from CSV" : null),
      exitRationale: o.exit_rationale || (o.type?.toUpperCase() === "SELL" ? "Imported from CSV" : null),
      lessons: o.lessons,
    });
    if (parsed.success) valid.push({ ...(parsed.data as Omit<NewTransaction, "source">), source: "csv" });
    else errors.push({ line: i + 2, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
  });
  return { valid, errors };
}

// ---- cash ----
export function cashDeposits(db: DB): number {
  return (db.prepare("SELECT COALESCE(SUM(amount), 0) s FROM cash_ledger").get() as { s: number }).s;
}

// ---- profile & notes ----
export function getProfile(db: DB): InvestorProfile | null {
  return getSetting<InvestorProfile | null>(db, "profile", null);
}

export function listNotes(db: DB): ResearchNote[] {
  return (db.prepare("SELECT data FROM research_notes ORDER BY updated_at DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

// ---- snapshot ----
export function portfolioSnapshot(db: DB) {
  const txns = listTransactions(db);
  const ledger = buildLedger(txns);
  const quotes = getQuotes(db, ledger.holdings.map((h) => h.symbol));
  const deposits = cashDeposits(db);
  const v = valuePortfolio(ledger, quotes, deposits);
  return { ...v, ledger, txns, deposits };
}

/** Record one value point per day for the performance chart (real, not back-filled). */
export function recordDailySnapshot(db: DB): void {
  const { summary } = portfolioSnapshot(db);
  if (summary.invested === 0 && summary.cash === 0) return;
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  db.prepare(
    "INSERT INTO snapshots (date, invested, value, cash) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET invested=excluded.invested, value=excluded.value, cash=excluded.cash",
  ).run(day, summary.invested, summary.currentValue, summary.cash);
}
