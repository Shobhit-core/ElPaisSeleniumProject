// Equity-delivery charge estimator. All rates are configurable in Settings because they
// change; defaults carry their source and the date they were last checked.

import { round2 } from "./format.ts";

export interface ChargeProfile {
  id: string;
  label: string;
  brokerageFlat: number; // ₹ per executed order
  brokeragePct: number | null; // if set, brokerage = min(flat, pct% × value)
  brokerageMin: number; // floor per order
  dpChargePerScripSell: number; // ₹ per scrip per sell day, excl. GST
  amcPerYear: number | null; // ₹ excl. GST
  source: string;
  checkedOn: string;
  verified: boolean; // false => figure could not be confirmed from an official page
}

export interface StatutoryRates {
  sttPct: number; // on buy and sell, delivery
  stampPctBuy: number;
  exchangeTxnPct: number; // NSE equity cash
  sebiPerCrore: number;
  gstPct: number;
  source: string;
  checkedOn: string;
}

export const DEFAULT_STATUTORY: StatutoryRates = {
  sttPct: 0.1,
  stampPctBuy: 0.015,
  exchangeTxnPct: 0.00297,
  sebiPerCrore: 10,
  gstPct: 18,
  source: "Upstox charges help-centre article 257381; NSE circulars (exchange txn charge 0.00297% from 1-Oct-2024 — verify on nseindia.com)",
  checkedOn: "2026-11-18",
};

export const DEFAULT_BROKERS: ChargeProfile[] = [
  {
    id: "upstox",
    label: "Upstox",
    brokerageFlat: 20,
    brokeragePct: null,
    brokerageMin: 0,
    dpChargePerScripSell: 20,
    amcPerYear: 300,
    source: "upstox.com/brokerage-charges and help-centre article 257381 (DP ₹20 + GST; AMC ₹300 + GST for non-BSDA, waived in year 1 for new users)",
    checkedOn: "2026-11-18",
    verified: true,
  },
  {
    id: "zerodha",
    label: "Zerodha",
    brokerageFlat: 0,
    brokeragePct: null,
    brokerageMin: 0,
    dpChargePerScripSell: 13.5,
    amcPerYear: 300,
    source: "zerodha.com/charges — equity delivery brokerage ₹0; DP and AMC figures NOT re-verified in this session",
    checkedOn: "2026-11-18",
    verified: false,
  },
  {
    id: "groww",
    label: "Groww",
    brokerageFlat: 20,
    brokeragePct: 0.1,
    brokerageMin: 5,
    dpChargePerScripSell: 20,
    amcPerYear: 0,
    source: "groww.in/pricing — ₹20 or 0.1% (min ₹5); DP and AMC figures NOT re-verified in this session",
    checkedOn: "2026-11-18",
    verified: false,
  },
];

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchangeTxn: number;
  sebi: number;
  stamp: number;
  dp: number;
  gst: number;
  total: number;
  /** brokerage + other charges except STT — maps to the journal's "otherCharges" field minus brokerage */
  otherCharges: number;
}

export function estimateDeliveryCharges(
  side: "BUY" | "SELL",
  quantity: number,
  price: number,
  broker: ChargeProfile,
  rates: StatutoryRates = DEFAULT_STATUTORY,
  opts: { isMutualFund?: boolean } = {},
): ChargeBreakdown {
  const value = quantity * price;
  if (opts.isMutualFund) {
    // Direct MF purchases via most brokers carry no brokerage/STT on purchase; stamp duty 0.005% applies on purchase.
    const stamp = side === "BUY" ? round2(value * 0.00005) : 0;
    return { brokerage: 0, stt: 0, exchangeTxn: 0, sebi: 0, stamp, dp: 0, gst: 0, total: stamp, otherCharges: stamp };
  }
  let brokerage = broker.brokerageFlat;
  if (broker.brokeragePct !== null) brokerage = Math.min(brokerage, (value * broker.brokeragePct) / 100);
  brokerage = Math.max(brokerage, broker.brokerageMin);
  if (value === 0) brokerage = 0;
  const stt = (value * rates.sttPct) / 100;
  const exchangeTxn = (value * rates.exchangeTxnPct) / 100;
  const sebi = (value / 1e7) * rates.sebiPerCrore;
  const stamp = side === "BUY" ? (value * rates.stampPctBuy) / 100 : 0;
  const dp = side === "SELL" ? broker.dpChargePerScripSell : 0;
  const gst = ((brokerage + exchangeTxn + sebi + dp) * rates.gstPct) / 100;
  const b = {
    brokerage: round2(brokerage),
    // STT is rounded to the nearest rupee by exchanges
    stt: Math.round(stt),
    exchangeTxn: round2(exchangeTxn),
    sebi: round2(sebi),
    stamp: Math.round(stamp),
    dp: round2(dp),
    gst: round2(gst),
  };
  const total = round2(b.brokerage + b.stt + b.exchangeTxn + b.sebi + b.stamp + b.dp + b.gst);
  return { ...b, total, otherCharges: round2(total - b.brokerage - b.stt) };
}

/** Round-trip cost as % of trade value — useful to show why tiny, frequent trades are expensive. */
export function roundTripCostPct(quantity: number, price: number, broker: ChargeProfile, rates?: StatutoryRates): number {
  const buy = estimateDeliveryCharges("BUY", quantity, price, broker, rates);
  const sell = estimateDeliveryCharges("SELL", quantity, price, broker, rates);
  return ((buy.total + sell.total) / (quantity * price)) * 100;
}
