// INR and number formatting using Indian digit grouping (1,23,45,678.90).

const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 });

export function formatINR(value: number | null | undefined, opts: { decimals?: 0 | 2; sign?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const v = Object.is(value, -0) ? 0 : value;
  const s = (opts.decimals === 0 ? inr0 : inr2).format(Math.abs(v));
  if (v < 0) return `-${s}`;
  return opts.sign && v > 0 ? `+${s}` : s;
}

/** ₹1.25 L, ₹3.4 Cr — for compact display in cards and charts. */
export function formatINRCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const a = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)} K`;
  return `${sign}₹${trim(a)}`;
}

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

export function formatPct(value: number | null | undefined, opts: { sign?: boolean; decimals?: number } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const d = opts.decimals ?? 2;
  const s = `${Math.abs(value).toFixed(d)}%`;
  if (value < 0 && Number(Math.abs(value).toFixed(d)) !== 0) return `-${s}`;
  return opts.sign && value > 0 ? `+${s}` : s;
}

export function formatQty(value: number): string {
  return num.format(value);
}

/** Round to paise to avoid floating-point drift in money totals. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Human description of how old a timestamp is. */
export function describeAge(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const mins = Math.round((now.getTime() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}
