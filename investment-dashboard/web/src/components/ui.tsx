import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { describeAge, formatINR, formatPct } from "../../../shared/format.ts";
import { ApiError, get } from "../api.ts";

export function useApi<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      setData(await get<T>(url));
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: 10 }}>
          {title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" | null }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="sub muted">{sub}</div>}
    </div>
  );
}

export const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? null : v > 0 ? "pos" : "neg");

export function Money({ v, sign, decimals }: { v: number | null | undefined; sign?: boolean; decimals?: 0 | 2 }) {
  return <span className={`num ${sign ? (tone(v) ?? "") : ""}`}>{formatINR(v, { sign, decimals })}</span>;
}
export function Pct({ v, sign = true }: { v: number | null | undefined; sign?: boolean }) {
  return <span className={`num ${sign ? (tone(v) ?? "") : ""}`}>{formatPct(v, { sign })}</span>;
}

/** Freshness indicator: green < 1h, amber < 1 day, red older. Always shows source. */
export function Fresh({ asOf, source, label }: { asOf: string | null | undefined; source?: string | null; label?: string }) {
  if (!asOf) return <span className="badge bad" title="No data">no data</span>;
  const age = Date.now() - Date.parse(asOf);
  const cls = age < 3600_000 ? "good" : age < 4 * 86400_000 ? "warn" : "bad";
  return (
    <span className={`badge ${cls}`} title={`${source ?? ""} · ${new Date(asOf).toLocaleString("en-IN")}`}>
      {label ? `${label} ` : ""}
      {describeAge(asOf)}
      {source ? ` · ${source}` : ""}
    </span>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="notice crit row between">
      <span>{error.message}</span>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Notice({ kind = "info", title, children }: { kind?: "info" | "warn" | "crit"; title?: string; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === "crit" ? "alert" : undefined}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Disclaimer() {
  return (
    <p className="disclaimer">
      Decision-support research, not personalised advice from a SEBI-registered investment adviser. No order is ever placed by this dashboard; every trade requires your own review and confirmation at your broker.
    </p>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  num?: boolean;
  render: (row: T) => ReactNode;
  sort?: (row: T) => number | string | null;
}

export function DataTable<T>({ rows, columns, initialSort, filterText, filterFn, empty = "Nothing to show" }: { rows: T[]; columns: Column<T>[]; initialSort?: { key: string; dir: 1 | -1 }; filterText?: string; filterFn?: (r: T, q: string) => boolean; empty?: ReactNode }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const shown = useMemo(() => {
    let r = rows;
    if (filterText && filterFn) r = r.filter((x) => filterFn(x, filterText.toLowerCase()));
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sort) {
        r = [...r].sort((a, b) => {
          const va = col.sort!(a);
          const vb = col.sort!(b);
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
        });
      }
    }
    return r;
  }, [rows, sort, filterText, filterFn, columns]);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.num ? "num" : ""} ${c.sort ? "sortable" : ""}`}
                onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s?.key === c.key ? ((-s.dir) as 1 | -1) : -1 }))}
                aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <Empty>{empty}</Empty>
              </td>
            </tr>
          ) : (
            shown.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? "num" : ""}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
export const seriesColor = (i: number) => SERIES[Math.min(i, SERIES.length - 1)];

/** Horizontal bar list — magnitude + label + value; identity never carried by colour alone. */
export function BarList({ items, format = (v) => formatPct(v, { decimals: 1 }) }: { items: { label: string; pct: number; value?: number }[]; format?: (v: number) => string }) {
  if (!items.length) return <Empty>No data</Empty>;
  const max = Math.max(...items.map((i) => i.pct), 1);
  return (
    <div className="barlist" role="list">
      {items.map((it, i) => (
        <div className="item" role="listitem" key={it.label} title={it.value !== undefined ? formatINR(it.value) : undefined}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(it.pct / max) * 100}%`, background: seriesColor(i) }} />
          </div>
          <span className="num" style={{ textAlign: "right" }}>{format(it.pct)}</span>
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "active" : ""} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Radio<T extends string>({ name, options, value, onChange }: { name: string; options: { value: T; label: string }[]; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <div className="radio-group" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? "checked" : ""}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function SeverityBadge({ s }: { s: "info" | "warning" | "critical" }) {
  const map = { info: ["info", "ℹ Info"], warning: ["warn", "⚠ Warning"], critical: ["bad", "⛔ Critical"] } as const;
  return <span className={`badge ${map[s][0]}`}>{map[s][1]}</span>;
}
