// ₹100 crore wealth-journey mathematics. Pure functions, independently tested.
//
// Conventions (stated so results can be checked by hand):
//  * Returns are annual, nominal. Net return = gross − cost drag (expense ratios, brokerage, etc.).
//  * Monthly rate i = (1 + net)^(1/12) − 1 (so 12 months of compounding equals the annual rate exactly).
//  * Contributions are made at the START of each month (SIP convention); the initial amount is invested at month 0.
//  * Step-up: the monthly contribution rises by stepUpPct once every 12 months (month 13, 25, …).
//  * Tax: shown as the value after paying LTCG on gains if everything were sold at the end
//    (12.5% on gains above the annual ₹1.25 lakh exemption, applied once — a simplification).
//  * Inflation: real value = nominal ÷ (1 + inflation)^years.

export const CRORE = 1_00_00_000;
export const LAKH = 1_00_000;
export const TARGET = 100 * CRORE;

export const MILESTONES = [1, 5, 10, 25, 50].map((l) => l * LAKH).concat([1, 2, 5, 10, 25, 50, 100].map((c) => c * CRORE));

export interface WealthAssumptions {
  conservative: number; // gross annual return %
  base: number;
  optimistic: number;
  costDragPct: number; // annual drag from costs
  inflationPct: number;
  ltcgPct: number;
  ltcgExemption: number; // ₹ per year (applied once at the end — simplification)
}

/**
 * HYPOTHETICAL, configurable. Rationale: a long-term portfolio that is mostly diversified Indian equity
 * plus some debt/gold. Base 10% gross is deliberately below the Nifty 50's often-quoted long-run
 * history so that the plan does not depend on repeating the past; optimistic is NOT an expectation.
 * Inflation 5.5%: RBI projects ~5.2% CPI for FY27 (Oct-2026 MPC, secondary sources); long-run Indian CPI has
 * mostly been 4–7%.
 */
export const DEFAULT_WEALTH_ASSUMPTIONS: WealthAssumptions = {
  conservative: 8,
  base: 10,
  optimistic: 12,
  costDragPct: 0.5,
  inflationPct: 5.5,
  ltcgPct: 12.5,
  ltcgExemption: 1.25 * LAKH,
};

export interface PlanInput {
  initial: number;
  monthly: number;
  stepUpPct: number;
  years: number;
  grossReturnPct: number;
  costDragPct: number;
}

export interface YearPoint {
  year: number;
  monthlyContribution: number; // contribution per month during this year
  contributed: number; // cumulative money put in by the end of this year
  value: number; // nominal value at the end of this year
}

export const monthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

/** Year-by-year projection (index 0 = today). */
export function projectPlan(p: PlanInput): YearPoint[] {
  const i = monthlyRate(p.grossReturnPct - p.costDragPct);
  let value = p.initial;
  let contributed = p.initial;
  let monthly = p.monthly;
  const out: YearPoint[] = [{ year: 0, monthlyContribution: 0, contributed, value }];
  for (let y = 1; y <= p.years; y++) {
    if (y > 1) monthly *= 1 + p.stepUpPct / 100;
    for (let m = 0; m < 12; m++) {
      value = (value + monthly) * (1 + i);
      contributed += monthly;
    }
    out.push({ year: y, monthlyContribution: monthly, contributed, value });
  }
  return out;
}

export const finalValue = (p: PlanInput) => projectPlan(p).at(-1)!.value;

/** Monthly SIP (in year 1, stepping up thereafter) needed to reach `target` in `years`. FV is linear in the SIP. */
export function requiredMonthly(target: number, p: Omit<PlanInput, "monthly">): number {
  const fromInitial = finalValue({ ...p, monthly: 0 });
  if (fromInitial >= target) return 0;
  const perRupee = finalValue({ ...p, initial: 0, monthly: 1 });
  return (target - fromInitial) / perRupee;
}

/** Months until the value first reaches `target` (checked at each month end), or null if not within maxYears. */
export function monthsToTarget(target: number, p: Omit<PlanInput, "years">, maxYears = 60): number | null {
  if (p.initial >= target) return 0;
  const i = monthlyRate(p.grossReturnPct - p.costDragPct);
  let value = p.initial;
  let monthly = p.monthly;
  for (let m = 1; m <= maxYears * 12; m++) {
    if (m > 1 && (m - 1) % 12 === 0) monthly *= 1 + p.stepUpPct / 100;
    value = (value + monthly) * (1 + i);
    if (value >= target) return m;
  }
  return null;
}

export function realValue(nominal: number, inflationPct: number, years: number): number {
  return nominal / Math.pow(1 + inflationPct / 100, years);
}

export function afterTax(value: number, contributed: number, a: Pick<WealthAssumptions, "ltcgPct" | "ltcgExemption">): number {
  const gain = Math.max(0, value - contributed - a.ltcgExemption);
  return value - (gain * a.ltcgPct) / 100;
}

/** Required gross annual return to reach target (bisection), or null if > 40%. */
export function requiredReturn(target: number, p: Omit<PlanInput, "grossReturnPct">): number | null {
  let lo = -5;
  let hi = 40;
  if (finalValue({ ...p, grossReturnPct: hi }) < target) return null;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (finalValue({ ...p, grossReturnPct: mid }) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

export interface MilestoneRow {
  amount: number;
  pctComplete: number;
  reached: boolean;
  monthsByScenario: { conservative: number | null; base: number | null; optimistic: number | null };
  requiredMonthlyByTarget: number; // base return, chosen step-up, by the target date
  shortfallAtTarget: number; // base scenario
}

export function milestoneTable(current: number, plan: Omit<PlanInput, "grossReturnPct">, a: WealthAssumptions): MilestoneRow[] {
  const baseAtTarget = finalValue({ ...plan, grossReturnPct: a.base });
  return MILESTONES.map((amount) => {
    const scen = (g: number) => monthsToTarget(amount, { ...plan, initial: current, grossReturnPct: g });
    return {
      amount,
      pctComplete: Math.min(100, (current / amount) * 100),
      reached: current >= amount,
      monthsByScenario: { conservative: scen(a.conservative), base: scen(a.base), optimistic: scen(a.optimistic) },
      requiredMonthlyByTarget: requiredMonthly(amount, { ...plan, initial: current, grossReturnPct: a.base }),
      shortfallAtTarget: Math.max(0, amount - baseAtTarget),
    };
  });
}

// ---------------- Income / wealth acceleration ----------------

export interface IncomeInput {
  annualIncome: number; // take-home from employment, ₹/year
  incomeGrowthPct: number; // yearly raise
  savingsRatePct: number; // % of take-home invested
  sideIncomeMonthly: number; // freelancing / consulting / business profit available to invest, ₹/month today
  sideIncomeGrowthPct: number;
  initial: number;
  years: number;
  grossReturnPct: number;
  costDragPct: number;
}

export interface IncomeYear {
  year: number;
  salary: number;
  fromSalary: number; // invested from salary this year
  fromSide: number; // invested from side/business income this year
  value: number;
  contributed: number;
}

export function incomeModel(p: IncomeInput): { years: IncomeYear[]; totals: { fromSalary: number; fromSide: number; initial: number; growth: number; final: number } } {
  const i = monthlyRate(p.grossReturnPct - p.costDragPct);
  let value = p.initial;
  let contributed = p.initial;
  let salary = p.annualIncome;
  let side = p.sideIncomeMonthly;
  let totSalary = 0;
  let totSide = 0;
  const years: IncomeYear[] = [{ year: 0, salary, fromSalary: 0, fromSide: 0, value, contributed }];
  for (let y = 1; y <= p.years; y++) {
    if (y > 1) {
      salary *= 1 + p.incomeGrowthPct / 100;
      side *= 1 + p.sideIncomeGrowthPct / 100;
    }
    const mSalary = (salary * p.savingsRatePct) / 100 / 12;
    for (let m = 0; m < 12; m++) value = (value + mSalary + side) * (1 + i);
    contributed += 12 * (mSalary + side);
    totSalary += 12 * mSalary;
    totSide += 12 * side;
    years.push({ year: y, salary, fromSalary: 12 * mSalary, fromSide: 12 * side, value, contributed });
  }
  return { years, totals: { fromSalary: totSalary, fromSide: totSide, initial: p.initial, growth: value - contributed, final: value } };
}

/** Savings rate (% of take-home) needed to reach target with the income path, or null if > 100%. */
export function requiredSavingsRate(target: number, p: Omit<IncomeInput, "savingsRatePct">): number | null {
  const at = (r: number) => incomeModel({ ...p, savingsRatePct: r }).totals.final;
  if (at(100) < target) return null;
  let lo = 0;
  let hi = 100;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

// ---------------- Net worth ----------------

export interface NetWorthInput {
  investments: number; // from the dashboard portfolio (market value + cash)
  emergencyFund: number; // kept SEPARATE — counted in net worth, never in investable capital
  retirementAccounts: number; // EPF / PPF / NPS
  otherInvestments: number; // FDs, bonds, gold held elsewhere
  businessValue: number; // fair estimate of business equity you own
  property: number; // market value of property (incl. home)
  liabilities: number; // all loans outstanding
}

export function netWorth(n: NetWorthInput) {
  const investable = n.investments + n.otherInvestments + n.retirementAccounts;
  const assets = investable + n.emergencyFund + n.businessValue + n.property;
  return { assets, investable, liabilities: n.liabilities, netWorth: assets - n.liabilities, productive: investable + n.businessValue };
}
