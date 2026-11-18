// Performance accountability: benchmark replication, CAGR, rolling returns and factor-index evidence.

import { xirr } from "./portfolio.ts";
import { annualisedVolatility, maxDrawdown } from "./risk.ts";

export function cagr(start: number, end: number, years: number): number | null {
  if (!(start > 0) || !(end > 0) || !(years > 0)) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

/** Close on `date` or the most recent earlier trading day. `series` must be sorted ascending. */
export function closeOn(series: { date: string; close: number }[], date: string): number | null {
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? series[ans].close : null;
}

/**
 * "What if every rupee had gone into the benchmark instead?" Replays the same cash flows
 * (negative = money in, positive = money out) into benchmark units and returns its XIRR and value.
 */
export function benchmarkReplica(flows: { date: string; amount: number }[], series: { date: string; close: number }[], endDate: string) {
  let units = 0;
  const used: { date: string; amount: number }[] = [];
  for (const f of [...flows].sort((a, b) => a.date.localeCompare(b.date))) {
    const px = closeOn(series, f.date);
    if (px === null) return null; // benchmark history does not cover this flow
    units += -f.amount / px;
    used.push(f);
  }
  const last = closeOn(series, endDate);
  if (last === null) return null;
  const value = units * last;
  return { value, xirrPct: xirr([...used, { date: endDate, amount: value }]) };
}

/** Rolling returns over a window of `days` calendar days, annualised when the window exceeds a year. */
export function rollingReturns(series: { date: string; close: number }[], days: number): { date: string; returnPct: number }[] {
  const out: { date: string; returnPct: number }[] = [];
  for (const p of series) {
    const startDate = new Date(Date.parse(p.date) - days * 86400000).toISOString().slice(0, 10);
    if (startDate < series[0].date) continue;
    const s = closeOn(series, startDate);
    if (!s) continue;
    const r = days > 366 ? cagr(s, p.close, days / 365)! : (p.close / s - 1) * 100;
    out.push({ date: p.date, returnPct: r });
  }
  return out;
}

export interface IndexEvidence {
  cagrPct: number | null;
  volatilityPct: number | null;
  maxDrawdownPct: number;
  maxDrawdownFrom: string;
  maxDrawdownTo: string;
  recoveryDays: number | null; // from trough to a new high, null if not recovered
  worstYearPct: number | null;
  bestYearPct: number | null;
  rolling3yPositivePct: number | null;
  rolling3yMinPct: number | null;
  covidDrawdownPct: number | null;
  years: number;
  from: string;
  to: string;
}

export function indexEvidence(series: { date: string; close: number }[]): IndexEvidence | null {
  if (series.length < 250) return null;
  const closes = series.map((c) => c.close);
  const from = series[0].date, to = series.at(-1)!.date;
  const years = (Date.parse(to) - Date.parse(from)) / (365 * 86400000);
  const dd = maxDrawdown(closes);
  const peakClose = closes[dd.peakIndex];
  const recIdx = closes.findIndex((c, i) => i > dd.troughIndex && c >= peakClose);
  const byYear = new Map<string, { first: number; last: number }>();
  for (const c of series) {
    const y = c.date.slice(0, 4);
    const e = byYear.get(y);
    if (!e) byYear.set(y, { first: c.close, last: c.close });
    else e.last = c.close;
  }
  // calendar-year returns using the previous year's last close (skip the first, partial year)
  const ys = [...byYear.keys()].sort();
  const yr: number[] = [];
  for (let i = 1; i < ys.length; i++) if (ys[i] < to.slice(0, 4)) yr.push((byYear.get(ys[i])!.last / byYear.get(ys[i - 1])!.last - 1) * 100);
  const roll = rollingReturns(series, 3 * 365);
  const covid = series.filter((c) => c.date >= "2020-01-01" && c.date <= "2020-06-30").map((c) => c.close);
  return {
    cagrPct: cagr(closes[0], closes.at(-1)!, years),
    volatilityPct: annualisedVolatility(closes),
    maxDrawdownPct: dd.pct,
    maxDrawdownFrom: series[dd.peakIndex].date,
    maxDrawdownTo: series[dd.troughIndex].date,
    recoveryDays: recIdx > 0 ? Math.round((Date.parse(series[recIdx].date) - Date.parse(series[dd.troughIndex].date)) / 86400000) : null,
    worstYearPct: yr.length ? Math.min(...yr) : null,
    bestYearPct: yr.length ? Math.max(...yr) : null,
    rolling3yPositivePct: roll.length ? (roll.filter((r) => r.returnPct > 0).length / roll.length) * 100 : null,
    rolling3yMinPct: roll.length ? Math.min(...roll.map((r) => r.returnPct)) : null,
    covidDrawdownPct: covid.length > 20 ? maxDrawdown(covid).pct : null,
    years,
    from,
    to,
  };
}

/**
 * Return statistics for irregular cash flows (negative = money in, positive = money out) plus the
 * current value. XIRR is only reported once the first flow is at least 365 days old — annualising a
 * few days or weeks of movement produces meaningless numbers (e.g. −90% from a 0.1% dip).
 */
export function returnStats(flows: { date: string; amount: number }[], endValue: number, endDate: string) {
  if (!flows.length) return { days: 0, absolutePct: null as number | null, xirrPct: null as number | null, annualised: false };
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const days = Math.round((Date.parse(endDate) - Date.parse(sorted[0].date)) / 86400000);
  const paidIn = -sorted.filter((f) => f.amount < 0).reduce((s, f) => s + f.amount, 0);
  const paidOut = sorted.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  const absolutePct = paidIn > 0 ? ((endValue + paidOut) / paidIn - 1) * 100 : null;
  const annualised = days >= 365;
  return { days, absolutePct, xirrPct: annualised && endValue > 0 ? xirr([...sorted, { date: endDate, amount: endValue }]) : null, annualised };
}
