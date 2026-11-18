import { Fragment, useState } from "react";
import { Card, ErrorBox, Loading, Notice, useApi } from "./ui.tsx";
import { formatINR, formatPct } from "../../../shared/format.ts";

const LEVEL: Record<string, string> = { Low: "good", Medium: "warn", High: "bad", Unknown: "" };

export function AdvancedRisk() {
  const r = useApi<any>("/risk/advanced");
  const [open, setOpen] = useState<string | null>(null);
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  const d = r.data;
  const dd = d.drawdown;
  return (
    <div className="stack">
      <Card title="Risk register (12 categories)">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Risk</th><th>Level</th><th>Finding</th><th>What to do</th></tr></thead>
            <tbody>
              {d.register.map((x: any) => (
                <tr key={x.category}>
                  <td><strong>{x.category}</strong></td>
                  <td><span className={`badge ${LEVEL[x.level]}`}>{x.level}</span></td>
                  <td className="small">{x.finding}</td>
                  <td className="small muted">{x.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Market valuation & rate trend: {d.macro.peSource}; {d.macro.rateSource} (as of {d.macro.asOf}).</p>
      </Card>
      <Card title="Stress tests: what happens to your portfolio">
        <Notice kind="warn">{d.disclaimer}{d.toleratedLossPct !== null && ` Your stated tolerance: a ${d.toleratedLossPct}% temporary fall.`}</Notice>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Scenario</th><th className="num">Portfolio change</th><th className="num">Gain needed to recover</th><th>Most vulnerable</th><th /></tr></thead>
            <tbody>
              {d.stress.map((s: any) => (
                <Fragment key={s.scenario.id}>
                  <tr>
                    <td><strong>{s.scenario.name}</strong><div className="small muted">{s.scenario.description}</div></td>
                    <td className={`num ${s.lossAmount < 0 ? "neg" : "pos"}`}>{formatINR(Math.round(s.lossAmount), { decimals: 0, sign: true })}<div className="small">{formatPct(s.lossPct, { sign: true, decimals: 1 })}</div>{s.exceedsTolerance && <span className="badge bad">beyond your tolerance</span>}</td>
                    <td className="num">{s.recoveryNeededPct ? `+${s.recoveryNeededPct.toFixed(0)}%` : "—"}</td>
                    <td>{s.mostVulnerable ?? "—"}</td>
                    <td><button className="link" onClick={() => setOpen(open === s.scenario.id ? null : s.scenario.id)}>{open === s.scenario.id ? "Hide" : "Details"}</button></td>
                  </tr>
                  {open === s.scenario.id && (
                    <tr>
                      <td colSpan={5}>
                        <table><tbody>{s.byHolding.map((h: any) => <tr key={h.symbol}><td className="small">{h.symbol.startsWith("MF:") ? h.name : h.symbol} <span className="muted">({h.segment})</span></td><td className={`num small ${h.change < 0 ? "neg" : ""}`}>{formatINR(Math.round(h.change), { decimals: 0, sign: true })}</td></tr>)}</tbody></table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Drawdown monitor (time-weighted: new money doesn't distort it)">
        {dd.index.length < 2 ? (
          <p className="small muted">Builds from one real snapshot per day. Check back after a few days of history.</p>
        ) : (
          <div className="grid g4">
            <div className="card stat"><div className="label">Peak</div><div className="value" style={{ fontSize: 16 }}>{dd.peak?.date}</div></div>
            <div className="card stat"><div className="label">From peak now</div><div className={`value ${dd.currentDrawdownPct < 0 ? "neg" : ""}`}>{formatPct(dd.currentDrawdownPct, { decimals: 1 })}</div><div className="sub muted">{dd.daysInDrawdown} days below peak</div></div>
            <div className="card stat"><div className="label">Maximum drawdown</div><div className="value neg">{formatPct(dd.maxDrawdownPct, { decimals: 1 })}</div><div className="sub muted">{dd.maxDrawdownFrom ?? "—"} → {dd.maxDrawdownTo ?? "—"}</div></div>
            <div className="card stat"><div className="label">Gain needed to recover</div><div className="value">{dd.recoveryNeededPct ? `+${dd.recoveryNeededPct.toFixed(1)}%` : "—"}</div></div>
          </div>
        )}
      </Card>
    </div>
  );
}
