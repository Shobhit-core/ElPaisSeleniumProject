import { describe, expect, it } from "vitest";
import { buildLedger, LedgerError, valuePortfolio, allocationBy, xirr } from "../shared/portfolio.ts";
import { formatINR, formatINRCompact, formatPct, round2 } from "../shared/format.ts";
import { buildTaxReport, classifyLot, financialYear, heldMoreThanMonths } from "../shared/tax.ts";
import { DEFAULT_BROKERS, estimateDeliveryCharges } from "../shared/charges.ts";
import type { Quote, Transaction } from "../shared/types.ts";

let id = 0;
function tx(p: Partial<Transaction> & Pick<Transaction, "date" | "type" | "symbol" | "quantity" | "price">): Transaction {
  return {
    id: ++id,
    name: p.symbol,
    assetClass: "EQUITY",
    sector: "IT",
    brokerage: 0,
    stt: 0,
    otherCharges: 0,
    rationale: null,
    exitRationale: null,
    lessons: null,
    source: "manual",
    createdAt: "2026-01-01",
    ...p,
  } as Transaction;
}
const q = (symbol: string, price: number, prevClose: number | null = null): [string, Quote] => [
  symbol,
  { symbol, price, prevClose, asOf: "2026-11-18T10:00:00Z", source: "test" },
];

describe("INR formatting", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(1234567.891)).toBe("₹12,34,567.89");
    expect(formatINR(30000, { decimals: 0 })).toBe("₹30,000");
    expect(formatINR(-1500.5)).toBe("-₹1,500.50");
    expect(formatINR(250, { sign: true })).toBe("+₹250.00");
    expect(formatINR(null)).toBe("—");
    expect(formatINR(Number.NaN)).toBe("—");
    expect(formatINR(-0)).toBe("₹0.00");
  });
  it("compacts to lakh/crore", () => {
    expect(formatINRCompact(125000)).toBe("₹1.25 L");
    expect(formatINRCompact(34000000)).toBe("₹3.4 Cr");
    expect(formatINRCompact(-5000)).toBe("-₹5 K");
  });
  it("formats percentages", () => {
    expect(formatPct(12.345)).toBe("12.35%");
    expect(formatPct(-3.1, { sign: true })).toBe("-3.10%");
    expect(formatPct(2, { sign: true })).toBe("+2.00%");
    expect(formatPct(-0.001)).toBe("0.00%");
  });
  it("round2 avoids float drift", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
  });
});

describe("Portfolio ledger (FIFO)", () => {
  it("computes average price, invested (incl. deductible charges) and FIFO realised P&L", () => {
    const txns = [
      tx({ date: "2026-01-10", type: "BUY", symbol: "INFY", quantity: 10, price: 1500, brokerage: 20, stt: 15, otherCharges: 5 }),
      tx({ date: "2026-02-10", type: "BUY", symbol: "INFY", quantity: 10, price: 1600, brokerage: 20, stt: 16, otherCharges: 5 }),
      tx({ date: "2026-03-10", type: "SELL", symbol: "INFY", quantity: 15, price: 1700, brokerage: 20, stt: 26, otherCharges: 30 }),
    ];
    const l = buildLedger(txns);
    expect(l.holdings).toHaveLength(1);
    const h = l.holdings[0];
    expect(h.quantity).toBe(5);
    expect(h.avgPrice).toBe(1600); // remaining lot is from the 2nd buy
    expect(h.invested).toBe(round2(5 * (1600 + 25 / 10))); // 8012.5
    // Realised: lot1 10 @ 1502.5 cost, lot2 5 @ 1602.5; proceeds net of (20+30)/15 per unit
    expect(l.realised).toHaveLength(2);
    const net = 1700 - 50 / 15;
    expect(l.realised[0].gain).toBe(round2(10 * net - 10 * 1502.5));
    expect(l.realised[1].gain).toBe(round2(5 * net - 5 * 1602.5));
    expect(l.totalCharges).toBe(20 + 15 + 5 + 20 + 16 + 5 + 20 + 26 + 30);
    // cash flow: -15040 -16041 + (25500 - 76)
    expect(l.cashFlowFromTrades).toBe(round2(-15040 - 16041 + 25500 - 76));
  });

  it("rejects selling more than held", () => {
    expect(() => buildLedger([tx({ date: "2026-01-01", type: "SELL", symbol: "TCS", quantity: 1, price: 100 })])).toThrow(LedgerError);
    expect(() =>
      buildLedger([
        tx({ date: "2026-01-01", type: "BUY", symbol: "TCS", quantity: 1, price: 100 }),
        tx({ date: "2026-01-02", type: "SELL", symbol: "TCS", quantity: 2, price: 100 }),
      ]),
    ).toThrow(/exceeds quantity held/);
  });

  it("rejects non-positive quantity", () => {
    expect(() => buildLedger([tx({ date: "2026-01-01", type: "BUY", symbol: "X", quantity: 0, price: 10 })])).toThrow(LedgerError);
  });

  it("processes same-day buy before sell regardless of entry order", () => {
    const sell = tx({ date: "2026-05-05", type: "SELL", symbol: "ITC", quantity: 5, price: 410 });
    const buy = tx({ date: "2026-05-05", type: "BUY", symbol: "ITC", quantity: 5, price: 400 });
    const l = buildLedger([sell, buy]);
    expect(l.realised[0].gain).toBe(50);
    expect(l.holdings).toHaveLength(0);
  });

  it("values the portfolio, weights, day P&L and handles missing prices without guessing", () => {
    const l = buildLedger([
      tx({ date: "2026-01-01", type: "BUY", symbol: "A", quantity: 10, price: 100 }),
      tx({ date: "2026-01-01", type: "BUY", symbol: "B", quantity: 5, price: 200 }),
      tx({ date: "2026-01-02", type: "DIVIDEND", symbol: "A", quantity: 10, price: 50 }),
    ]);
    const { holdings, summary } = valuePortfolio(l, new Map([q("A", 120, 110)]), 5000);
    const a = holdings.find((h) => h.symbol === "A")!;
    const b = holdings.find((h) => h.symbol === "B")!;
    expect(a.currentValue).toBe(1200);
    expect(a.unrealisedPnl).toBe(200);
    expect(a.returnPct).toBeCloseTo(20);
    expect(a.dayChange).toBe(100);
    expect(a.weight).toBe(100); // only priced holding
    expect(b.currentValue).toBeNull();
    expect(summary.missingPrices).toEqual(["B"]);
    expect(summary.invested).toBe(2000);
    expect(summary.currentValue).toBe(2200); // B carried at cost
    expect(summary.returnPct).toBeCloseTo(20); // computed only over priced holdings
    expect(summary.dividends).toBe(50);
    expect(summary.totalPnl).toBe(250);
    expect(summary.cash).toBe(5000 - 2000 + 50);
    const alloc = allocationBy(holdings, (h) => h.assetClass, summary.cash);
    expect(alloc.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100);
  });

  it("computes XIRR", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -10000 },
      { date: "2026-01-01", amount: 11000 },
    ]);
    expect(r).toBeCloseTo(10, 1);
    expect(xirr([{ date: "2025-01-01", amount: -1 }])).toBeNull();
  });
});

describe("Capital gains tax", () => {
  it("determines financial year", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });
  it("requires MORE than 12 months for long-term", () => {
    expect(heldMoreThanMonths("2025-01-15", "2026-01-15", 12)).toBe(false);
    expect(heldMoreThanMonths("2025-01-15", "2026-01-16", 12)).toBe(true);
    expect(heldMoreThanMonths("2024-01-31", "2025-01-31", 12)).toBe(false);
    expect(heldMoreThanMonths("2024-02-29", "2025-03-01", 12)).toBe(true);
  });
  it("classifies by asset class and date", () => {
    const base = { symbol: "X", name: "X", quantity: 1, costOfAcquisition: 100, saleConsideration: 200, gain: 100, holdingDays: 0 };
    expect(classifyLot({ ...base, assetClass: "EQUITY", buyDate: "2025-01-01", sellDate: "2025-12-01" }).rate).toBe(20);
    expect(classifyLot({ ...base, assetClass: "EQUITY", buyDate: "2023-01-01", sellDate: "2024-06-01" }).rate).toBe(10);
    expect(classifyLot({ ...base, assetClass: "EQUITY_MF", buyDate: "2023-01-01", sellDate: "2024-06-01" }).term).toBe("long");
    expect(classifyLot({ ...base, assetClass: "DEBT_MF", buyDate: "2023-05-01", sellDate: "2026-06-01" }).bucket).toBe("ST_SLAB");
    expect(classifyLot({ ...base, assetClass: "DEBT_MF", buyDate: "2022-05-01", sellDate: "2026-06-01" }).rate).toBe(12.5);
    expect(classifyLot({ ...base, assetClass: "GOLD_ETF", buyDate: "2025-01-01", sellDate: "2026-06-01" }).rate).toBe(12.5);
  });
  it("applies ₹1.25 lakh LTCG exemption, set-off and 4% cess", () => {
    const lot = (assetClass: any, buyDate: string, sellDate: string, gain: number) => ({
      symbol: "S", name: "S", assetClass, buyDate, sellDate, quantity: 1, costOfAcquisition: 0, saleConsideration: gain, gain, holdingDays: 0,
    });
    const [r] = buildTaxReport(
      [
        lot("EQUITY", "2025-01-01", "2026-06-01", 200000), // LTCG
        lot("EQUITY", "2026-04-10", "2026-07-01", 30000), // STCG
        lot("EQUITY", "2026-04-10", "2026-08-01", -10000), // STCL
      ],
      30,
    );
    expect(r.fy).toBe("2026-27");
    expect(r.afterSetOff.ST_EQ).toBe(20000);
    expect(r.ltcgExemptionUsed).toBe(125000);
    // tax = 20000*20% + 75000*12.5% = 4000 + 9375 = 13375 ; cess 535
    expect(r.taxBeforeCess).toBe(13375);
    expect(r.cess).toBe(535);
    expect(r.estimatedTax).toBe(13910);
  });
  it("lets short-term losses absorb long-term gains but not vice versa", () => {
    const lot = (buyDate: string, sellDate: string, gain: number) => ({
      symbol: "S", name: "S", assetClass: "EQUITY" as const, buyDate, sellDate, quantity: 1, costOfAcquisition: 0, saleConsideration: 0, gain, holdingDays: 0,
    });
    const [a] = buildTaxReport([lot("2026-04-10", "2026-06-01", -50000), lot("2024-01-01", "2026-06-01", 200000)], 30);
    expect(a.afterSetOff.LT_EQ).toBe(150000);
    expect(a.taxBeforeCess).toBe(round2(25000 * 0.125));
    const [b] = buildTaxReport([lot("2024-01-01", "2026-06-01", -50000), lot("2026-04-10", "2026-06-01", 40000)], 30);
    expect(b.afterSetOff.ST_EQ).toBe(40000);
    expect(b.unabsorbedLoss.longTerm).toBe(50000);
  });
  it("taxes debt-fund gains at the slab rate", () => {
    const [r] = buildTaxReport(
      [{ symbol: "L", name: "L", assetClass: "DEBT_MF", buyDate: "2026-04-05", sellDate: "2026-10-05", quantity: 1, costOfAcquisition: 0, saleConsideration: 0, gain: 1000, holdingDays: 0 }],
      20,
    );
    expect(r.taxBeforeCess).toBe(200);
  });
});

describe("Delivery charges", () => {
  const upstox = DEFAULT_BROKERS.find((b) => b.id === "upstox")!;
  const groww = DEFAULT_BROKERS.find((b) => b.id === "groww")!;
  it("estimates Upstox buy charges for ₹10,000 delivery", () => {
    const c = estimateDeliveryCharges("BUY", 10, 1000, upstox);
    expect(c.brokerage).toBe(20);
    expect(c.stt).toBe(10);
    expect(c.stamp).toBe(2); // 0.015% of 10,000 = 1.5 → rounded to ₹2
    expect(c.dp).toBe(0);
    expect(c.exchangeTxn).toBeCloseTo(0.3, 2);
    expect(c.gst).toBeCloseTo((20 + 0.297 + 0.01) * 0.18, 2);
    expect(c.total).toBeCloseTo(c.brokerage + c.stt + c.exchangeTxn + c.sebi + c.stamp + c.dp + c.gst, 2);
  });
  it("adds DP charge on sells and applies min/percentage brokerage", () => {
    expect(estimateDeliveryCharges("SELL", 10, 1000, upstox).dp).toBe(20);
    expect(estimateDeliveryCharges("BUY", 1, 1000, groww).brokerage).toBe(5); // min(20, 0.1% = 1) floored at 5
    expect(estimateDeliveryCharges("BUY", 100, 1000, groww).brokerage).toBe(20);
  });
  it("treats MF purchases as stamp duty only", () => {
    const c = estimateDeliveryCharges("BUY", 100, 100, upstox, undefined, { isMutualFund: true });
    expect(c.total).toBe(0.5);
  });
});
