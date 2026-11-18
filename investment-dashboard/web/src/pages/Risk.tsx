import { useEffect, useState } from "react";
import { post, put } from "../api.ts";
import { BarList, Card, Disclaimer, Empty, ErrorBox, Loading, Notice, Pct, SeverityBadge, Stat, useApi } from "../components/ui.tsx";
import { SeriesArea } from "../components/charts.tsx";
import { formatPct } from "../../../shared/format.ts";
import type { Route } from "../App.tsx";

export function Risk(_: { route: Route }) {
  const r = useApi<any>("/risk");
  const [t, setT] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (r.data) setT(r.data.thresholds);
  }, [r.data]);
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  const d = r.data;
  const sim = d.simulated;
  return (
    <div className="stack">
      <div className="grid g4">
        <Stat label="Equity exposure" value={formatPct(d.equityPct, { decimals: 0 })} />
        <Stat label="Liquid (cash + debt funds)" value={formatPct(d.liquidPct, { decimals: 0 })} />
        <Stat label="Effective no. of holdings" value={d.effectiveHoldings?.toFixed(1) ?? "—"} sub="1 ÷ Σ weight² (higher = more diversified)" />
        <Stat label="Volatility (simulated, 1y)" value={sim.volatilityPct !== null ? formatPct(sim.volatilityPct, { decimals: 1 }) : "—"} sub={sim.maxDrawdownPct !== null ? `Max drawdown ${formatPct(sim.maxDrawdownPct, { decimals: 1 })}` : "needs price history"} />
      </div>
      <Card title="Risk warnings">
        {d.warnings.length === 0 ? <Empty>No warnings against your thresholds.</Empty> : (
          <div className="stack">
            {d.warnings.map((w: any) => (
              <div key={w.title}>
                <div className="row"><SeverityBadge s={w.severity} /><strong>{w.title}</strong></div>
                <div className="small">{w.why}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="grid g2">
        <Card title="Single-stock concentration">
          <BarList items={d.singleStock.map((s: any) => ({ label: s.symbol, pct: s.pct }))} />
        </Card>
        <Card title="Sector concentration">
          <BarList items={d.sectors.map((s: any) => ({ label: s.sector, pct: s.pct }))} />
        </Card>
      </div>
      <Card title="Current holdings over the past year (simulated)" actions={<button disabled={busy} onClick={async () => { setBusy(true); try { await post("/risk/load-history"); r.reload(); } finally { setBusy(false); } }}>{busy ? "Loading…" : "Load price history"}</button>}>
        <Notice kind="info">{sim.note}</Notice>
        {sim.series.length > 1 ? <SeriesArea data={sim.series} name="Simulated value" /> : <Empty>No price history loaded yet for your listed holdings.</Empty>}
        {sim.missing.length > 0 && <p className="small muted">No history for: {sim.missing.join(", ")}.</p>}
      </Card>
      {t && (
        <Card title="Risk thresholds">
          <div className="form-grid">
            {[["maxSingleStockPct", "Max single stock %"], ["maxSectorPct", "Max sector %"], ["maxDrawdownAlertPct", "Drawdown alert %"], ["priceMoveAlertPct", "Min daily move alert %"]].map(([k, l]) => (
              <label key={k}>{l}<input type="number" value={t[k]} onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })} /></label>
            ))}
          </div>
          <button className="mt" onClick={async () => { await put("/settings/risk", t); r.reload(); }}>Save thresholds</button>
          <p className="small muted mt">Price-move alerts fire only when a move exceeds both this threshold and 2.5× the stock's own typical daily move, to avoid noise. Current 1-year drawdown of the simulated series: <Pct v={sim.maxDrawdownPct} />.</p>
        </Card>
      )}
      <Disclaimer />
    </div>
  );
}
