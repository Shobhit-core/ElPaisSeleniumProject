// Intrinsic-value estimates from user-entered, sourced inputs. Each method returns null when its
// inputs are missing or invalid — the dashboard never invents a value to fill the gap.

export interface ValuationFacts {
  eps?: number; // trailing EPS ₹
  fcfPerShare?: number; // free cash flow per share ₹ (use a normalised multi-year average)
  bookValuePerShare?: number;
  dividendPerShare?: number;
}

export interface ValuationAssumptions {
  growthPct?: number; // FCF growth for years 1–5 (base case)
  terminalGrowthPct?: number; // after year 10
  discountRatePct?: number; // required return / cost of equity
  fairPE?: number; // e.g. the company's own 10-year median P/E
  peerMedianPE?: number;
  fairPB?: number;
  dividendGrowthPct?: number;
}

export interface MethodResult {
  method: string;
  value: number | null;
  note: string;
  limitation: string;
}

export const LIMITATIONS: Record<string, string> = {
  dcf: "Extremely sensitive to growth and discount-rate assumptions; small changes move value a lot. Unsuitable for banks/NBFCs and businesses with erratic cash flow.",
  earnings: "Assumes today's earnings are normal and the chosen P/E is fair; misleading at cyclical peaks or troughs.",
  comparable: "Only says whether it is cheap relative to peers — the whole sector can be overvalued.",
  asset: "Book value ignores brands, franchises and intangibles; mainly useful for banks, holding companies and asset-heavy firms.",
  ddm: "Only for stable dividend payers; ignores retained earnings reinvested at high returns.",
  graham: "Graham's rule-of-thumb (√(22.5 × EPS × BVPS)); conservative and crude, penalises high-quality, high-ROE businesses.",
};

/** Two-stage DCF: growth g for years 1–5, linear fade to terminal growth over years 6–10, Gordon terminal value. */
export function dcfValue(fcf0: number, g: number, gT: number, r: number): number | null {
  if (!(fcf0 > 0) || !(r > gT) || r <= 0) return null;
  let pv = 0;
  let fcf = fcf0;
  for (let t = 1; t <= 10; t++) {
    const growth = t <= 5 ? g : g + ((gT - g) * (t - 5)) / 5;
    fcf *= 1 + growth / 100;
    pv += fcf / Math.pow(1 + r / 100, t);
  }
  const tv = (fcf * (1 + gT / 100)) / ((r - gT) / 100);
  return pv + tv / Math.pow(1 + r / 100, 10);
}

export function valueMethods(f: ValuationFacts, a: ValuationAssumptions): MethodResult[] {
  const out: MethodResult[] = [];
  const dcf =
    f.fcfPerShare !== undefined && a.growthPct !== undefined && a.terminalGrowthPct !== undefined && a.discountRatePct !== undefined
      ? dcfValue(f.fcfPerShare, a.growthPct, a.terminalGrowthPct, a.discountRatePct)
      : null;
  out.push({ method: "Discounted cash flow", value: dcf, note: dcf === null ? "Needs positive FCF/share, growth, terminal growth and a discount rate above terminal growth" : `FCF ₹${f.fcfPerShare}, growth ${a.growthPct}% → ${a.terminalGrowthPct}%, discount ${a.discountRatePct}%`, limitation: LIMITATIONS.dcf });
  const em = f.eps && f.eps > 0 && a.fairPE ? f.eps * a.fairPE : null;
  out.push({ method: "Earnings multiple (own history)", value: em, note: em === null ? "Needs positive EPS and a fair P/E" : `EPS ₹${f.eps} × ${a.fairPE}`, limitation: LIMITATIONS.earnings });
  const cp = f.eps && f.eps > 0 && a.peerMedianPE ? f.eps * a.peerMedianPE : null;
  out.push({ method: "Comparable companies", value: cp, note: cp === null ? "Needs positive EPS and the peer median P/E" : `EPS ₹${f.eps} × peer P/E ${a.peerMedianPE}`, limitation: LIMITATIONS.comparable });
  const ab = f.bookValuePerShare && f.bookValuePerShare > 0 ? f.bookValuePerShare * (a.fairPB ?? 1) : null;
  out.push({ method: "Asset-based (book value)", value: ab, note: ab === null ? "Needs book value per share" : `BVPS ₹${f.bookValuePerShare} × P/B ${a.fairPB ?? 1}`, limitation: LIMITATIONS.asset });
  const d1 = f.dividendPerShare && f.dividendPerShare > 0 && a.dividendGrowthPct !== undefined ? f.dividendPerShare * (1 + a.dividendGrowthPct / 100) : null;
  const ddm = d1 !== null && a.discountRatePct !== undefined && a.discountRatePct > (a.dividendGrowthPct ?? 0) ? d1 / ((a.discountRatePct - (a.dividendGrowthPct ?? 0)) / 100) : null;
  out.push({ method: "Dividend discount", value: ddm, note: ddm === null ? "Needs dividend, dividend growth and a discount rate above that growth" : `D1 ₹${d1!.toFixed(2)} ÷ (${a.discountRatePct}% − ${a.dividendGrowthPct}%)`, limitation: LIMITATIONS.ddm });
  const gn = f.eps && f.eps > 0 && f.bookValuePerShare && f.bookValuePerShare > 0 ? Math.sqrt(22.5 * f.eps * f.bookValuePerShare) : null;
  out.push({ method: "Graham number", value: gn, note: gn === null ? "Needs positive EPS and book value" : "√(22.5 × EPS × BVPS)", limitation: LIMITATIONS.graham });
  return out;
}

export interface IntrinsicSummary {
  methods: MethodResult[];
  used: number;
  low: number | null;
  median: number | null;
  high: number | null;
  dispersion: number | null; // high ÷ low
  marginOfSafetyPct: number | null; // (median − price) ÷ median
  buyBelowFor: (mosPct: number) => number | null;
  confidence: "insufficient" | "low" | "moderate";
  notes: string[];
}

export function intrinsicSummary(f: ValuationFacts, a: ValuationAssumptions, price: number | null): IntrinsicSummary {
  const methods = valueMethods(f, a);
  const vals = methods.map((m) => m.value).filter((v): v is number => v !== null && Number.isFinite(v) && v > 0).sort((x, y) => x - y);
  const notes: string[] = [];
  const median = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;
  const dispersion = vals.length >= 2 ? vals[vals.length - 1] / vals[0] : null;
  let confidence: IntrinsicSummary["confidence"] = vals.length < 2 ? "insufficient" : dispersion! > 2 ? "low" : "moderate";
  if (vals.length < 2) notes.push("Fewer than two valuation methods have inputs — no intrinsic value is stated.");
  if (dispersion !== null && dispersion > 2) notes.push(`Methods disagree widely (highest is ${dispersion.toFixed(1)}× the lowest) — treat the value as very uncertain.`);
  if (confidence === "insufficient") return { methods, used: vals.length, low: null, median: null, high: null, dispersion, marginOfSafetyPct: null, buyBelowFor: () => null, confidence, notes };
  const mos = price && median ? ((median - price) / median) * 100 : null;
  if (price === null) notes.push("No current price — margin of safety cannot be computed.");
  return {
    methods,
    used: vals.length,
    low: vals[0],
    median,
    high: vals[vals.length - 1],
    dispersion,
    marginOfSafetyPct: mos,
    buyBelowFor: (m: number) => (median ? median * (1 - m / 100) : null),
    confidence,
    notes,
  };
}

/** Bull/base/bear values from the DCF with shifted growth, or from multiples ±20% when no DCF inputs exist. */
export function scenarioValues(f: ValuationFacts, a: ValuationAssumptions): { bear: number | null; base: number | null; bull: number | null; basis: string } {
  if (f.fcfPerShare && a.growthPct !== undefined && a.terminalGrowthPct !== undefined && a.discountRatePct !== undefined) {
    return {
      bear: dcfValue(f.fcfPerShare, Math.max(0, a.growthPct - 6), Math.max(0, a.terminalGrowthPct - 1), a.discountRatePct + 1),
      base: dcfValue(f.fcfPerShare, a.growthPct, a.terminalGrowthPct, a.discountRatePct),
      bull: dcfValue(f.fcfPerShare, a.growthPct + 3, a.terminalGrowthPct, Math.max(a.discountRatePct - 1, a.terminalGrowthPct + 1)),
      basis: "DCF: bear = growth −6pp, terminal −1pp, discount +1pp; bull = growth +3pp, discount −1pp",
    };
  }
  const pe = a.fairPE ?? a.peerMedianPE;
  if (f.eps && f.eps > 0 && pe) return { bear: f.eps * pe * 0.7, base: f.eps * pe, bull: f.eps * pe * 1.2, basis: "Earnings multiple: bear = P/E −30%, bull = P/E +20%" };
  return { bear: null, base: null, bull: null, basis: "Insufficient inputs" };
}
