// Domain types shared by the server and the web client.

/** Tax treatment buckets. See shared/tax.ts for the rules attached to each. */
export type AssetClass =
  | "EQUITY" // listed Indian shares
  | "EQUITY_ETF" // ETFs with >65% domestic equity (e.g. Nifty 50 ETFs)
  | "EQUITY_MF" // equity-oriented mutual funds (index funds, flexi-cap…)
  | "DEBT_MF" // debt / liquid funds (slab-rate taxation for purchases after 1-Apr-2023)
  | "GOLD_ETF" // gold / other non-equity listed ETFs
  | "GSEC" // government securities / T-bills / SGBs
  | "CASH";

export const ASSET_CLASSES: AssetClass[] = [
  "EQUITY",
  "EQUITY_ETF",
  "EQUITY_MF",
  "DEBT_MF",
  "GOLD_ETF",
  "GSEC",
  "CASH",
];

export type TxnType = "BUY" | "SELL" | "DIVIDEND";

export interface Transaction {
  id: number;
  date: string; // ISO yyyy-mm-dd (trade date)
  type: TxnType;
  symbol: string; // NSE trading symbol, or AMFI scheme code prefixed "MF:"
  name: string;
  assetClass: AssetClass;
  sector: string | null;
  quantity: number; // shares/units; for DIVIDEND the quantity held (informational)
  price: number; // per unit price; for DIVIDEND the total amount received
  brokerage: number; // ₹ total
  stt: number; // ₹ total (not deductible for capital gains)
  otherCharges: number; // ₹ exchange txn + SEBI + stamp + GST + DP
  rationale: string | null;
  exitRationale: string | null;
  lessons: string | null;
  source: "manual" | "csv" | "upstox";
  createdAt: string;
}

export type NewTransaction = Omit<Transaction, "id" | "createdAt">;

export interface Lot {
  buyDate: string;
  quantity: number;
  unitPrice: number; // trade price
  unitCost: number; // trade price + allocable buy charges excl. STT (cost of acquisition)
}

export interface Holding {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  sector: string | null;
  quantity: number;
  avgPrice: number; // average trade price of open lots (broker-style)
  invested: number; // cost incl. buy charges of open lots
  lots: Lot[];
  firstBuyDate: string;
}

export interface RealisedLot {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  buyDate: string;
  sellDate: string;
  quantity: number;
  costOfAcquisition: number; // incl. buy charges excl. STT
  saleConsideration: number; // net of sell charges excl. STT
  gain: number;
  holdingDays: number;
}

export interface Quote {
  symbol: string;
  price: number;
  prevClose: number | null;
  asOf: string; // ISO timestamp of the price itself (not of the fetch)
  source: string; // e.g. "upstox-ltp", "upstox-candle-30m", "amfi-nav", "manual"
}

export interface ValuedHolding extends Holding {
  price: number | null;
  priceAsOf: string | null;
  priceSource: string | null;
  currentValue: number | null;
  unrealisedPnl: number | null;
  returnPct: number | null;
  dayChange: number | null;
  weight: number | null; // of total invested-asset value
}

export interface PortfolioSummary {
  invested: number;
  currentValue: number;
  unrealisedPnl: number;
  realisedPnl: number;
  dividends: number;
  totalPnl: number;
  returnPct: number | null;
  dayPnl: number | null;
  cash: number;
  totalCharges: number;
  missingPrices: string[];
}

// ---------- Investor profile (onboarding) ----------
export type Horizon = "1-3" | "3-5" | "5-10" | "10+";
export type RiskTolerance = "conservative" | "moderate" | "aggressive";
export type Preference = "mutual_funds" | "etfs" | "stocks" | "combination";
export type LossTolerance = "5" | "10" | "20" | "20+";

export interface InvestorProfile {
  horizon: Horizon;
  riskTolerance: RiskTolerance;
  emergencyFund: "none" | "partial" | "full"; // full = >= 6 months expenses
  needWithin12Months: "yes" | "maybe" | "no";
  monthlyCapacity: number; // ₹ per month, 0 allowed
  preference: Preference;
  lossTolerance: LossTolerance;
  taxSlabPct: number; // marginal slab rate, used for debt-fund estimates only
  capital: number;
  completedAt: string;
}

// ---------- Research ----------
export interface MetricValue {
  value: number;
  source: string; // URL or document name
  asOf: string; // period/date the figure refers to
}

export type FundamentalKey =
  | "revenueCagr3y"
  | "profitCagr3y"
  | "epsCagr3y"
  | "roe"
  | "roce"
  | "debtToEquity"
  | "fcfPositiveYears5"
  | "operatingMargin"
  | "pe"
  | "pb"
  | "sectorPe"
  | "dividendYears5"
  | "promoterHolding"
  | "promoterPledge"
  | "institutionalHolding"
  | "governanceFlags";

export type Fundamentals = Partial<Record<FundamentalKey, MetricValue>>;

export interface ResearchNote {
  symbol: string;
  name: string;
  sector: string | null;
  assetClass: AssetClass;
  fundamentals: Fundamentals;
  thesis: string;
  growthDrivers: string;
  risks: string;
  invalidation: string;
  entryStrategy: string;
  horizon: string;
  targetPrice: number | null; // valuation-based level the user wants alerts on
  maxPe: number | null; // alert if P/E rises above this
  status: "researching" | "watchlist" | "owned" | "rejected";
  reviewBy: string | null;
  updatedAt: string;
}

export interface Alert {
  id: number;
  kind: string;
  severity: "info" | "warning" | "critical";
  symbol: string | null;
  title: string;
  why: string;
  dedupeKey: string;
  createdAt: string;
  readAt: string | null;
}
