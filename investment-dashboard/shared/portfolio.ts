// Portfolio engine: derives holdings, realised P&L (FIFO) and valuation from the
// transaction journal. The journal is the single source of truth.

import { round2 } from "./format.ts";
import type {
  Holding,
  Lot,
  PortfolioSummary,
  Quote,
  RealisedLot,
  Transaction,
  ValuedHolding,
} from "./types.ts";

export class LedgerError extends Error {}

export interface Ledger {
  holdings: Holding[];
  realised: RealisedLot[];
  dividends: { symbol: string; date: string; amount: number }[];
  totalCharges: number;
  cashFlowFromTrades: number; // -buys -charges +sells +dividends
}

const EPS = 1e-9;

function sortTxns(txns: Transaction[]): Transaction[] {
  const typeOrder = { BUY: 0, DIVIDEND: 1, SELL: 2 } as const;
  return [...txns].sort(
    (a, b) => a.date.localeCompare(b.date) || typeOrder[a.type] - typeOrder[b.type] || a.id - b.id,
  );
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400000);
}

/** FIFO lot matching. Throws LedgerError when a sale exceeds the quantity held. */
export function buildLedger(txns: Transaction[]): Ledger {
  const open = new Map<string, { meta: Transaction; lots: Lot[] }>();
  const realised: RealisedLot[] = [];
  const dividends: Ledger["dividends"] = [];
  let totalCharges = 0;
  let cash = 0;

  for (const t of sortTxns(txns)) {
    const charges = t.brokerage + t.stt + t.otherCharges;
    totalCharges += charges;
    const deductible = t.brokerage + t.otherCharges; // STT is not deductible (s.48)

    if (t.type === "DIVIDEND") {
      dividends.push({ symbol: t.symbol, date: t.date, amount: t.price });
      cash += t.price - charges;
      continue;
    }
    if (!(t.quantity > 0) || !(t.price >= 0)) {
      throw new LedgerError(`Transaction ${t.id} (${t.symbol}) has invalid quantity/price`);
    }

    if (t.type === "BUY") {
      cash -= t.quantity * t.price + charges;
      const entry = open.get(t.symbol) ?? { meta: t, lots: [] };
      entry.meta = { ...entry.meta, name: t.name, sector: t.sector ?? entry.meta.sector, assetClass: t.assetClass };
      entry.lots.push({
        buyDate: t.date,
        quantity: t.quantity,
        unitPrice: t.price,
        unitCost: t.price + deductible / t.quantity,
      });
      open.set(t.symbol, entry);
      continue;
    }

    // SELL
    cash += t.quantity * t.price - charges;
    const entry = open.get(t.symbol);
    const heldQty = entry ? entry.lots.reduce((s, l) => s + l.quantity, 0) : 0;
    if (!entry || heldQty + EPS < t.quantity) {
      throw new LedgerError(
        `Sale of ${t.quantity} ${t.symbol} on ${t.date} exceeds quantity held (${round4(heldQty)})`,
      );
    }
    let remaining = t.quantity;
    const netUnitProceeds = t.price - deductible / t.quantity;
    while (remaining > EPS) {
      const lot = entry.lots[0];
      const q = Math.min(lot.quantity, remaining);
      const cost = q * lot.unitCost;
      const sale = q * netUnitProceeds;
      realised.push({
        symbol: t.symbol,
        name: entry.meta.name,
        assetClass: entry.meta.assetClass,
        buyDate: lot.buyDate,
        sellDate: t.date,
        quantity: q,
        costOfAcquisition: round2(cost),
        saleConsideration: round2(sale),
        gain: round2(sale - cost),
        holdingDays: daysBetween(lot.buyDate, t.date),
      });
      lot.quantity -= q;
      remaining -= q;
      if (lot.quantity <= EPS) entry.lots.shift();
    }
    if (entry.lots.length === 0) open.delete(t.symbol);
  }

  const holdings: Holding[] = [];
  for (const [symbol, { meta, lots }] of open) {
    const quantity = lots.reduce((s, l) => s + l.quantity, 0);
    const tradeValue = lots.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const invested = lots.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    holdings.push({
      symbol,
      name: meta.name,
      assetClass: meta.assetClass,
      sector: meta.sector,
      quantity: round4(quantity),
      avgPrice: round4(tradeValue / quantity),
      invested: round2(invested),
      lots: lots.map((l) => ({ ...l })),
      firstBuyDate: lots[0].buyDate,
    });
  }
  holdings.sort((a, b) => b.invested - a.invested);
  return { holdings, realised, dividends, totalCharges: round2(totalCharges), cashFlowFromTrades: round2(cash) };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Values holdings with the supplied quotes. Missing quotes leave value fields null rather than guessing. */
export function valuePortfolio(
  ledger: Ledger,
  quotes: Map<string, Quote>,
  cashDeposits: number,
): { holdings: ValuedHolding[]; summary: PortfolioSummary } {
  const missing: string[] = [];
  const valued: ValuedHolding[] = ledger.holdings.map((h) => {
    const q = quotes.get(h.symbol);
    if (!q || !Number.isFinite(q.price)) {
      missing.push(h.symbol);
      return {
        ...h,
        price: null,
        priceAsOf: null,
        priceSource: null,
        currentValue: null,
        unrealisedPnl: null,
        returnPct: null,
        dayChange: null,
        weight: null,
      };
    }
    const currentValue = round2(h.quantity * q.price);
    const unrealisedPnl = round2(currentValue - h.invested);
    return {
      ...h,
      price: q.price,
      priceAsOf: q.asOf,
      priceSource: q.source,
      currentValue,
      unrealisedPnl,
      returnPct: h.invested > 0 ? (unrealisedPnl / h.invested) * 100 : null,
      dayChange: q.prevClose !== null ? round2(h.quantity * (q.price - q.prevClose)) : null,
      weight: null,
    };
  });

  const pricedValue = valued.reduce((s, h) => s + (h.currentValue ?? 0), 0);
  for (const h of valued) {
    if (h.currentValue !== null && pricedValue > 0) h.weight = (h.currentValue / pricedValue) * 100;
  }

  const invested = round2(ledger.holdings.reduce((s, h) => s + h.invested, 0));
  const pricedInvested = valued.reduce((s, h) => s + (h.currentValue !== null ? h.invested : 0), 0);
  const unrealisedPnl = round2(valued.reduce((s, h) => s + (h.unrealisedPnl ?? 0), 0));
  const realisedPnl = round2(ledger.realised.reduce((s, r) => s + r.gain, 0));
  const dividends = round2(ledger.dividends.reduce((s, d) => s + d.amount, 0));
  const dayParts = valued.filter((h) => h.dayChange !== null);
  const summary: PortfolioSummary = {
    invested,
    // Unpriced holdings are carried at cost so totals are not understated; flagged via missingPrices.
    currentValue: round2(pricedValue + (invested - pricedInvested)),
    unrealisedPnl,
    realisedPnl,
    dividends,
    totalPnl: round2(unrealisedPnl + realisedPnl + dividends),
    returnPct: pricedInvested > 0 ? (unrealisedPnl / pricedInvested) * 100 : null,
    dayPnl: dayParts.length ? round2(dayParts.reduce((s, h) => s + (h.dayChange ?? 0), 0)) : null,
    cash: round2(cashDeposits + ledger.cashFlowFromTrades),
    totalCharges: ledger.totalCharges,
    missingPrices: missing,
  };
  return { holdings: valued, summary };
}

/** Allocation by a key (asset class or sector) using current value, falling back to cost when unpriced. */
export function allocationBy(
  holdings: ValuedHolding[],
  key: (h: ValuedHolding) => string,
  cash = 0,
): { label: string; value: number; pct: number }[] {
  const m = new Map<string, number>();
  for (const h of holdings) {
    const v = h.currentValue ?? h.invested;
    m.set(key(h), (m.get(key(h)) ?? 0) + v);
  }
  if (cash > 0) m.set("CASH", (m.get("CASH") ?? 0) + cash);
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  return [...m.entries()]
    .map(([label, value]) => ({ label, value: round2(value), pct: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** XIRR via Newton-Raphson with bisection fallback. Cash flows: negative = invested, positive = received/current value. */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = Date.parse(flows[0].date);
  const yrs = flows.map((f) => (Date.parse(f.date) - t0) / (365 * 86400000));
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, yrs[i]), 0);
  let lo = -0.9999;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-7) return mid * 100;
    if (npv(lo) * v < 0) hi = mid;
    else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
}
