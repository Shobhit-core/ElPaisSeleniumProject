// Capital-gains ESTIMATOR for resident individual investors in India.
//
// Rules encoded (verify before filing — this is an estimate, not tax advice):
//  * Listed equity shares, equity ETFs, equity-oriented MFs (STT paid):
//      long-term if held MORE than 12 months.
//      Transfers on/after 23-Jul-2024: STCG 20%, LTCG 12.5% above ₹1.25 lakh per FY exemption.
//      Transfers before 23-Jul-2024: STCG 15%, LTCG 10% above ₹1 lakh (FY ≤ 2023-24) exemption.
//  * Debt / liquid MFs bought on/after 1-Apr-2023: gains taxed at slab rate irrespective of holding period.
//      Bought earlier: long-term if held > 24 months → 12.5% (no indexation), else slab.
//  * Gold ETFs, listed G-Secs / bonds: long-term if held > 12 months → 12.5%, else slab.
//  * Health & education cess 4% on tax. Surcharge, rebate u/s 87A (not available against these
//    special-rate gains), and loss carry-forward are NOT modelled.
// Sources: Finance (No. 2) Act 2024; Income-tax Act 2025 carries the same rates for FY 2026-27
// (cross-checked against cleartax.in/capital-gains and taxguru.in, 18-Nov-2026).

import { round2 } from "./format.ts";
import type { AssetClass, RealisedLot } from "./types.ts";

export const RATE_CHANGE_DATE = "2024-07-23";
export const DEBT_MF_SLAB_CUTOFF = "2023-04-01";
export const CESS = 0.04;

export type BucketKind = "ST_EQ" | "LT_EQ" | "ST_SLAB" | "LT_OTHER";

export interface ClassifiedLot extends RealisedLot {
  fy: string;
  term: "short" | "long";
  bucket: BucketKind;
  rate: number | null; // % ; null => slab rate
  explanation: string;
}

export interface FyTaxReport {
  fy: string;
  lots: ClassifiedLot[];
  gross: Record<BucketKind, number>; // net of same-bucket losses
  afterSetOff: Record<BucketKind, number>;
  ltcgExemptionLimit: number;
  ltcgExemptionUsed: number;
  ltcgExemptionRemaining: number;
  taxBeforeCess: number;
  cess: number;
  estimatedTax: number;
  unabsorbedLoss: { shortTerm: number; longTerm: number };
  notes: string[];
}

export function financialYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** True when held for MORE than `months` months (the sale date must be after the anniversary). */
export function heldMoreThanMonths(buyIso: string, sellIso: string, months: number): boolean {
  const [y, m, d] = buyIso.split("-").map(Number);
  const anniv = new Date(Date.UTC(y, m - 1 + months, d));
  // Clamp to month end (e.g. 31-Jan + 1 month)
  if (anniv.getUTCDate() !== d) anniv.setUTCDate(0);
  return Date.parse(sellIso + "T00:00:00Z") > anniv.getTime();
}

const isEquityLike = (a: AssetClass) => a === "EQUITY" || a === "EQUITY_ETF" || a === "EQUITY_MF";

export function classifyLot(lot: RealisedLot): ClassifiedLot {
  const fy = financialYear(lot.sellDate);
  const newRegime = lot.sellDate >= RATE_CHANGE_DATE;
  if (isEquityLike(lot.assetClass)) {
    const long = heldMoreThanMonths(lot.buyDate, lot.sellDate, 12);
    return {
      ...lot,
      fy,
      term: long ? "long" : "short",
      bucket: long ? "LT_EQ" : "ST_EQ",
      rate: long ? (newRegime ? 12.5 : 10) : newRegime ? 20 : 15,
      explanation: long
        ? `Held > 12 months → LTCG on listed equity at ${newRegime ? 12.5 : 10}% above annual exemption`
        : `Held ≤ 12 months → STCG on listed equity at ${newRegime ? 20 : 15}%`,
    };
  }
  if (lot.assetClass === "DEBT_MF") {
    if (lot.buyDate >= DEBT_MF_SLAB_CUTOFF) {
      return { ...lot, fy, term: "short", bucket: "ST_SLAB", rate: null, explanation: "Debt MF bought on/after 1-Apr-2023 → taxed at slab rate regardless of holding period" };
    }
    const long = heldMoreThanMonths(lot.buyDate, lot.sellDate, 24);
    return long
      ? { ...lot, fy, term: "long", bucket: "LT_OTHER", rate: 12.5, explanation: "Debt MF bought before 1-Apr-2023 held > 24 months → LTCG 12.5% (no indexation)" }
      : { ...lot, fy, term: "short", bucket: "ST_SLAB", rate: null, explanation: "Debt MF held ≤ 24 months → slab rate" };
  }
  if (lot.assetClass === "CASH") {
    return { ...lot, fy, term: "short", bucket: "ST_SLAB", rate: null, explanation: "Treated as slab-rate income" };
  }
  // GOLD_ETF, GSEC (listed)
  const long = heldMoreThanMonths(lot.buyDate, lot.sellDate, 12);
  return long
    ? { ...lot, fy, term: "long", bucket: "LT_OTHER", rate: 12.5, explanation: "Listed non-equity security held > 12 months → LTCG 12.5%" }
    : { ...lot, fy, term: "short", bucket: "ST_SLAB", rate: null, explanation: "Listed non-equity security held ≤ 12 months → slab rate" };
}

export function ltcgExemptionFor(fy: string): number {
  return Number(fy.slice(0, 4)) >= 2024 ? 125000 : 100000;
}

const zero = (): Record<BucketKind, number> => ({ ST_EQ: 0, LT_EQ: 0, ST_SLAB: 0, LT_OTHER: 0 });

/**
 * Builds a per-FY estimate. Set-off (simplified, within the FY only):
 *  short-term losses → short-term gains (higher-rate bucket first), then long-term gains;
 *  long-term losses → long-term gains only (fully-taxed LT_OTHER first, then LT_EQ which has the exemption).
 */
export function buildTaxReport(realised: RealisedLot[], slabRatePct: number): FyTaxReport[] {
  const byFy = new Map<string, ClassifiedLot[]>();
  for (const r of realised) {
    const c = classifyLot(r);
    byFy.set(c.fy, [...(byFy.get(c.fy) ?? []), c]);
  }
  const reports: FyTaxReport[] = [];
  for (const [fy, lots] of [...byFy.entries()].sort()) {
    const notes: string[] = [];
    // Per-bucket blended rate (handles FY 2024-25 where rates changed mid-year).
    const gains = zero();
    const losses = zero();
    const weightedRate = zero();
    for (const l of lots) {
      if (l.gain >= 0) {
        gains[l.bucket] += l.gain;
        weightedRate[l.bucket] += l.gain * (l.rate ?? slabRatePct);
      } else losses[l.bucket] += -l.gain;
    }
    const rateOf = (b: BucketKind) => (gains[b] > 0 ? weightedRate[b] / gains[b] : b === "ST_SLAB" ? slabRatePct : 0);
    const gross = zero();
    (Object.keys(gross) as BucketKind[]).forEach((b) => (gross[b] = round2(gains[b] - losses[b])));

    // Same-bucket netting already happened via gross. Now cross-bucket set-off of remaining losses.
    const net = { ...gross };
    let stLoss = 0;
    let ltLoss = 0;
    for (const b of ["ST_EQ", "ST_SLAB"] as BucketKind[]) if (net[b] < 0) { stLoss += -net[b]; net[b] = 0; }
    for (const b of ["LT_EQ", "LT_OTHER"] as BucketKind[]) if (net[b] < 0) { ltLoss += -net[b]; net[b] = 0; }

    const absorb = (loss: number, order: BucketKind[]) => {
      for (const b of order) {
        if (loss <= 0) break;
        const used = Math.min(loss, net[b]);
        net[b] -= used;
        loss -= used;
      }
      return loss;
    };
    const stOrder: BucketKind[] = rateOf("ST_SLAB") > rateOf("ST_EQ") ? ["ST_SLAB", "ST_EQ"] : ["ST_EQ", "ST_SLAB"];
    stLoss = absorb(stLoss, [...stOrder, "LT_OTHER", "LT_EQ"]);
    ltLoss = absorb(ltLoss, ["LT_OTHER", "LT_EQ"]);
    if (stLoss > 0 || ltLoss > 0) notes.push("Unabsorbed losses can be carried forward for 8 years if the return is filed on time (not modelled).");

    const limit = ltcgExemptionFor(fy);
    const exemptionUsed = Math.min(limit, net.LT_EQ);
    const taxableLtEq = net.LT_EQ - exemptionUsed;

    const tax =
      net.ST_EQ * rateOf("ST_EQ") / 100 +
      net.ST_SLAB * slabRatePct / 100 +
      taxableLtEq * (gains.LT_EQ > 0 ? rateOf("LT_EQ") : 12.5) / 100 +
      net.LT_OTHER * (gains.LT_OTHER > 0 ? rateOf("LT_OTHER") : 12.5) / 100;
    const cess = tax * CESS;
    if (net.ST_SLAB > 0) notes.push(`Slab-rate gains estimated at your stated marginal slab of ${slabRatePct}%.`);
    notes.push("Surcharge and the s.87A rebate are not modelled; rebate is not available against special-rate capital gains.");

    const afterSetOff = zero();
    (Object.keys(net) as BucketKind[]).forEach((b) => (afterSetOff[b] = round2(net[b])));
    reports.push({
      fy,
      lots,
      gross,
      afterSetOff,
      ltcgExemptionLimit: limit,
      ltcgExemptionUsed: round2(exemptionUsed),
      ltcgExemptionRemaining: round2(limit - exemptionUsed),
      taxBeforeCess: round2(tax),
      cess: round2(cess),
      estimatedTax: round2(tax + cess),
      unabsorbedLoss: { shortTerm: round2(stLoss), longTerm: round2(ltLoss) },
      notes,
    });
  }
  return reports;
}
