import { useState } from "react";
import { Card, DataTable, Empty, ErrorBox, Loading, Money, Notice, Stat, useApi } from "../components/ui.tsx";
import { formatINR } from "../../../shared/format.ts";
import type { Route } from "../App.tsx";

const BUCKET: Record<string, string> = { ST_EQ: "STCG – listed equity", LT_EQ: "LTCG – listed equity", ST_SLAB: "Short-term – slab rate", LT_OTHER: "LTCG – other (12.5%)" };

export function Tax(_: { route: Route }) {
  const [slab, setSlab] = useState<string>("");
  const t = useApi<any>(`/tax${slab ? `?slab=${slab}` : ""}`, [slab]);
  const pf = useApi<any>("/portfolio");
  const [fy, setFy] = useState<string | null>(null);
  if (t.loading && !t.data) return <Loading />;
  if (t.error) return <ErrorBox error={t.error} onRetry={t.reload} />;
  const d = t.data;
  const rep = d.reports.find((r: any) => r.fy === fy) ?? d.reports[d.reports.length - 1];
  const s = pf.data?.summary;
  return (
    <div className="stack">
      <Notice kind="warn" title="Estimate only">{d.disclaimer}</Notice>
      {s && (
        <div className="grid g4">
          <Stat label="Realised P&L" value={formatINR(s.realisedPnl, { sign: true })} />
          <Stat label="Unrealised P&L" value={formatINR(s.unrealisedPnl, { sign: true })} />
          <Stat label="Dividends" value={formatINR(s.dividends)} sub="Taxed at slab rate (not in estimate)" />
          <Stat label="Charges paid" value={formatINR(d.charges.brokerage + d.charges.stt + d.charges.other)} sub={`Brokerage ${formatINR(d.charges.brokerage)} · STT ${formatINR(d.charges.stt)} · other ${formatINR(d.charges.other)}`} />
        </div>
      )}
      <Card
        title="Capital gains by financial year"
        actions={
          <div className="row">
            {d.reports.length > 1 && <select value={rep?.fy ?? ""} onChange={(e) => setFy(e.target.value)} style={{ width: 120 }} aria-label="Financial year">{d.reports.map((r: any) => <option key={r.fy}>{r.fy}</option>)}</select>}
            <label className="row" style={{ gap: 6 }}>Slab<select value={slab || d.slabPct} onChange={(e) => setSlab(e.target.value)} style={{ width: 80 }}>{[0, 5, 10, 15, 20, 25, 30].map((x) => <option key={x} value={x}>{x}%</option>)}</select></label>
          </div>
        }
      >
        {!rep ? <Empty>No realised gains or losses yet.</Empty> : (
          <div className="stack">
            <div className="grid g4">
              {Object.keys(BUCKET).map((k) => (
                <div key={k} className="card stat"><div className="label">{BUCKET[k]}</div><div className="value"><Money v={rep.afterSetOff[k]} /></div><div className="sub muted">before set-off {formatINR(rep.gross[k])}</div></div>
              ))}
            </div>
            <table>
              <tbody>
                <tr><td>LTCG exemption used (limit {formatINR(rep.ltcgExemptionLimit, { decimals: 0 })})</td><td className="num"><Money v={rep.ltcgExemptionUsed} /></td></tr>
                <tr><td>Exemption remaining this FY — gains you could realise tax-free (tax-gain harvesting)</td><td className="num"><Money v={rep.ltcgExemptionRemaining} /></td></tr>
                <tr><td>Tax before cess</td><td className="num"><Money v={rep.taxBeforeCess} /></td></tr>
                <tr><td>Health & education cess (4%)</td><td className="num"><Money v={rep.cess} /></td></tr>
                <tr><td><strong>Estimated capital-gains tax for {rep.fy}</strong></td><td className="num"><strong><Money v={rep.estimatedTax} /></strong></td></tr>
                {(rep.unabsorbedLoss.shortTerm > 0 || rep.unabsorbedLoss.longTerm > 0) && <tr><td>Unabsorbed losses (ST / LT)</td><td className="num">{formatINR(rep.unabsorbedLoss.shortTerm)} / {formatINR(rep.unabsorbedLoss.longTerm)}</td></tr>}
              </tbody>
            </table>
            {rep.notes.map((n: string) => <p key={n} className="small muted">{n}</p>)}
            <h3>Capital gains report (lot-wise)</h3>
            <DataTable
              rows={rep.lots}
              columns={[
                { key: "s", label: "Security", render: (r: any) => r.symbol, sort: (r: any) => r.symbol },
                { key: "b", label: "Bought", render: (r: any) => r.buyDate },
                { key: "sd", label: "Sold", render: (r: any) => r.sellDate, sort: (r: any) => r.sellDate },
                { key: "c", label: "Cost of acquisition", num: true, render: (r: any) => <Money v={r.costOfAcquisition} /> },
                { key: "p", label: "Sale consideration", num: true, render: (r: any) => <Money v={r.saleConsideration} /> },
                { key: "g", label: "Gain", num: true, render: (r: any) => <Money v={r.gain} sign />, sort: (r: any) => r.gain },
                { key: "t", label: "Treatment", render: (r: any) => <span className="small">{r.explanation}</span> },
              ]}
            />
          </div>
        )}
      </Card>
      <p className="small muted">Rules applied: listed equity &gt;12 months = long-term; from 23-Jul-2024 STCG 20%, LTCG 12.5% above ₹1.25 lakh per FY; debt funds bought on/after 1-Apr-2023 at slab rate. Compare with your broker's tax P&L and Form 26AS/AIS before filing.</p>
    </div>
  );
}
