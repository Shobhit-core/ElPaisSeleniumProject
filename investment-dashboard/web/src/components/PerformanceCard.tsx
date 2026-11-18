import { Card, ErrorBox, Loading, Money, Notice, useApi } from "./ui.tsx";
import { formatPct } from "../../../shared/format.ts";

export function PerformanceCard() {
  const p = useApi<any>("/performance");
  if (p.loading && !p.data) return <Loading />;
  if (p.error) return <ErrorBox error={p.error} onRetry={p.reload} />;
  const d = p.data;
  return (
    <Card title="Are my decisions adding value? (vs Nifty 50, after costs)">
      <Notice kind={/LESS than/.test(d.verdict) ? "crit" : "info"}>{d.verdict}</Notice>
      <div className="table-wrap mt">
        <table>
          <thead><tr><th>Part of portfolio</th><th className="num">Money in</th><th className="num">Value now</th><th className="num">Your return</th><th className="num">Same money in Nifty 50</th><th className="num">Difference</th></tr></thead>
          <tbody>
            {d.sleeves.map((s: any) => (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td className="num"><Money v={s.invested} decimals={0} /></td>
                <td className="num"><Money v={s.value} decimals={0} /></td>
                <td className="num">{s.xirrPct !== null ? `${formatPct(s.xirrPct, { sign: true, decimals: 1 })}/yr` : formatPct(s.absolutePct, { sign: true, decimals: 1 })}</td>
                <td className="num">{s.benchmark ? <><Money v={s.benchmark.value} decimals={0} /><div className="small">{s.benchmark.xirrPct !== null ? `${formatPct(s.benchmark.xirrPct, { sign: true, decimals: 1 })}/yr` : formatPct(s.benchmark.absolutePct, { sign: true, decimals: 1 })}</div></> : "—"}</td>
                <td className={`num ${s.excessPct === null ? "" : s.excessPct >= 0 ? "pos" : "neg"}`}>{formatPct(s.excessPct, { sign: true, decimals: 1 })}{s.excessPct !== null && (s.excessIsAnnual ? "/yr" : " total")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Whole portfolio: {d.portfolio.xirrPct !== null ? `XIRR ${formatPct(d.portfolio.xirrPct, { sign: true, decimals: 1 })}/yr` : `return so far ${formatPct(d.portfolio.absolutePct, { sign: true, decimals: 1 })} (under 1 year — returns are not annualised)`} · time-weighted CAGR {d.portfolio.cagrPct === null ? "needs 1 year" : formatPct(d.portfolio.cagrPct, { sign: true, decimals: 1 })} · volatility {formatPct(d.portfolio.volatilityPct, { decimals: 1 })} · max drawdown {formatPct(d.portfolio.maxDrawdownPct, { decimals: 1 })} · charges paid <Money v={d.costs.charges} /> · estimated capital-gains tax <Money v={d.costs.estimatedTax} />.
        {" "}Benchmark: {d.benchmark.name}{d.benchmark.error ? ` — unavailable (${d.benchmark.error})` : ""}. Your XIRR already includes brokerage and charges.
      </p>
    </Card>
  );
}
