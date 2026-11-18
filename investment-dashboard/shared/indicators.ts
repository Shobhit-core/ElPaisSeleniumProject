// Technical indicators from daily closes. Used for context only — the dashboard does not generate
// trading signals from them.

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  });
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function periodReturn(series: { date: string; close: number }[], days: number): number | null {
  if (!series.length) return null;
  const last = series[series.length - 1];
  const cutoff = new Date(Date.parse(last.date) - days * 86400_000).toISOString().slice(0, 10);
  const base = [...series].reverse().find((c) => c.date <= cutoff);
  return base ? (last.close / base.close - 1) * 100 : null;
}

export function technicalSummary(series: { date: string; close: number }[]) {
  const closes = series.map((c) => c.close);
  const last = closes[closes.length - 1] ?? null;
  const s50 = sma(closes, 50).at(-1) ?? null;
  const s200 = sma(closes, 200).at(-1) ?? null;
  const r = rsi(closes).at(-1) ?? null;
  const yr = series.filter((c) => c.date >= new Date(Date.parse(series.at(-1)?.date ?? "1970-01-01") - 365 * 86400_000).toISOString().slice(0, 10));
  const hi = yr.length ? Math.max(...yr.map((c) => c.close)) : null;
  const lo = yr.length ? Math.min(...yr.map((c) => c.close)) : null;
  return {
    last,
    sma50: s50,
    sma200: s200,
    rsi14: r,
    high52w: hi,
    low52w: lo,
    fromHighPct: hi && last ? (last / hi - 1) * 100 : null,
    returns: { "1M": periodReturn(series, 30), "3M": periodReturn(series, 91), "6M": periodReturn(series, 182), "1Y": periodReturn(series, 365) },
    trend: s50 && s200 && last ? (last > s50 && s50 > s200 ? "uptrend" : last < s50 && s50 < s200 ? "downtrend" : "mixed") : "insufficient history",
  };
}
