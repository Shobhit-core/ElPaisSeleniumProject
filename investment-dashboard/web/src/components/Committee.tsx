import { Card, ErrorBox, Loading, Notice, useApi } from "./ui.tsx";
import { formatINR, formatPct } from "../../../shared/format.ts";

const VOTE: Record<string, string> = { Support: "good", Neutral: "", Oppose: "bad", "Insufficient evidence": "warn" };
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatINR(Math.round(v), { decimals: 0 }));

export function Committee({ symbol }: { symbol: string }) {
  const c = useApi<any>(`/research/notes/${encodeURIComponent(symbol)}/committee`, [symbol]);
  if (c.loading && !c.data) return <Loading />;
  if (c.error) return <ErrorBox error={c.error} onRetry={c.reload} />;
  const d = c.data;
  const kind = d.decision.startsWith("ELIGIBLE") ? "info" : d.decision.startsWith("WATCHLIST") ? "warn" : "crit";
  return (
    <div className="stack">
      <Notice kind={kind} title={`Committee decision: ${d.decision}`}>
        {d.decisionReasons.join(" ")}
        {d.maxAmount > 0 && <div className="mt">Maximum position: <strong>{money(d.maxAmount)}</strong>, bought in 2–3 tranches. You place the order yourself.</div>}
      </Notice>
      <div className="grid g3">
        {d.members.map((m: any) => (
          <Card key={m.member} title={<>{m.member} <span className={`badge ${VOTE[m.vote]}`}>{m.vote}</span></>}>
            <p className="small muted">{m.focus}</p>
            <ul className="small">{m.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
          </Card>
        ))}
      </div>
      <Card title="Valuation">
        <table>
          <thead><tr><th>Method</th><th className="num">Value / share</th><th>Inputs</th><th>Limitation</th></tr></thead>
          <tbody>
            {d.intrinsic.methods.map((m: any) => (
              <tr key={m.method}><td>{m.method}</td><td className="num">{money(m.value)}</td><td className="small">{m.note}</td><td className="small muted">{m.limitation}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="small mt">
          Price {money(d.price)} · intrinsic value range {money(d.intrinsic.low)}–{money(d.intrinsic.high)} (median {money(d.intrinsic.median)}) · margin of safety {d.intrinsic.marginOfSafetyPct === null ? "—" : formatPct(d.intrinsic.marginOfSafetyPct, { decimals: 0 })} · confidence {d.intrinsic.confidence}
          {d.buyBelow && <> · buy only below {money(d.buyBelow)} (25% margin of safety)</>}
        </p>
        {d.intrinsic.notes.map((n: string) => <p key={n} className="small muted">{n}</p>)}
      </Card>
      <Card title="Bull / base / bear (per share)">
        <div className="grid g3">
          <div><div className="small muted">Bear case</div><div className="num">{money(d.cases.bear)}</div></div>
          <div><div className="small muted">Base case</div><div className="num">{money(d.cases.base)}</div></div>
          <div><div className="small muted">Bull case</div><div className="num">{money(d.cases.bull)}</div></div>
        </div>
        <p className="small muted">{d.cases.basis}. These are estimates from your inputs, not price targets.</p>
        <h3 className="mt">Reconsider when</h3>
        <ul className="small">{d.reconsiderWhen.map((r: string) => <li key={r}>{r}</li>)}</ul>
        <h3>Position sizing</h3>
        <ul className="small">{d.sizing.limits.map((l: any) => <li key={l.rule}>{l.rule}: {money(l.cap)}</li>)}{d.sizing.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
      </Card>
      <p className="small muted">Rule-based committee generated {new Date(d.generatedAt).toLocaleString("en-IN")} from your sourced research. Members are not forced to agree; any missing evidence means no recommendation.</p>
    </div>
  );
}
