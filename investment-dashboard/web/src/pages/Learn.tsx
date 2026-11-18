import { useState } from "react";
import { post } from "../api.ts";
import { Card, Empty, ErrorBox, Loading, Notice, Tabs, useApi } from "../components/ui.tsx";
import { formatPct } from "../../../shared/format.ts";
import { CASES, PHILOSOPHIES, TOPICS } from "../content/learn.ts";
import type { Route } from "../App.tsx";

const pct = (v: number | null | undefined, d = 1) => formatPct(v, { decimals: d, sign: true });

function Evidence({ ev }: { ev: any }) {
  if (ev.loading && !ev.data) return <Loading />;
  if (ev.error) return <ErrorBox error={ev.error} onRetry={ev.reload} />;
  const rows = ev.data.results;
  return (
    <Card title="Tested on Indian market data: 10 years of NSE strategy indices">
      <div className="table-wrap">
        <table className="wide">
          <thead><tr><th>Index (closest to…)</th><th className="num">CAGR</th><th className="num">Volatility</th><th className="num">Worst fall</th><th className="num">Recovery</th><th className="num">Worst year</th><th className="num">Best year</th><th className="num">3-yr periods positive</th><th className="num">COVID fall</th></tr></thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.name}>
                <td><strong>{r.name}</strong><div className="small muted">{r.style}</div></td>
                {r.evidence ? (
                  <>
                    <td className="num">{pct(r.evidence.cagrPct)}</td>
                    <td className="num">{formatPct(r.evidence.volatilityPct, { decimals: 0 })}</td>
                    <td className="num neg">{pct(r.evidence.maxDrawdownPct, 0)}<div className="small muted">{r.evidence.maxDrawdownFrom.slice(0, 7)} → {r.evidence.maxDrawdownTo.slice(0, 7)}</div></td>
                    <td className="num">{r.evidence.recoveryDays === null ? "not yet" : `${Math.round(r.evidence.recoveryDays / 30)} mo`}</td>
                    <td className="num">{pct(r.evidence.worstYearPct, 0)}</td>
                    <td className="num">{pct(r.evidence.bestYearPct, 0)}</td>
                    <td className="num">{formatPct(r.evidence.rolling3yPositivePct, { decimals: 0 })}</td>
                    <td className="num">{pct(r.evidence.covidDrawdownPct, 0)}</td>
                  </>
                ) : (
                  <td colSpan={8} className="small muted">Unavailable: {r.error}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Source: {ev.data.source}; period {rows.find((r: any) => r.evidence)?.evidence.from} → {rows.find((r: any) => r.evidence)?.evidence.to}. Price indices exclude dividends (true returns are roughly 1–1.5% a year higher). These are back-tested index rules, not what any investor actually earned, and one decade may not repeat. Strategy indices have costs and tracking error when bought through funds.
      </p>
      <Notice kind="info" title="How to read this">
        Higher return has come with deeper falls and longer recoveries. Strategies that looked best over these 10 years (often momentum or small caps) also had the worst crashes. No style wins in every period, which is why your core stays in a broad, low-cost index and any style tilt stays small.
      </Notice>
    </Card>
  );
}

function Philosophies({ ev }: { ev: any }) {
  const [open, setOpen] = useState<string | null>("bogle");
  const byName = new Map((ev.data?.results ?? []).map((r: any) => [r.name, r.evidence]));
  return (
    <div className="stack">
      <Notice kind="warn">Principles are summarised from each investor's published books, letters and interviews. Don't copy famous portfolios: their access, scale, research time and risk capacity can't be replicated, and famous winners hide many failures (survivorship bias).</Notice>
      {PHILOSOPHIES.map((p) => {
        const e: any = p.evidenceIndex ? byName.get(p.evidenceIndex) : null;
        return (
          <Card key={p.id} title={<>{p.name} <span className="small muted">— {p.known}</span></>} actions={<button className="link" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Hide" : "Show"}</button>}>
            {open === p.id && (
              <div className="stack">
                <p className="small muted">Sources: {p.sources}</p>
                <div className="grid g2">
                  <div><h3>Principles</h3><ul className="small">{p.principles.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  <div><h3>Works best when</h3><p className="small">{p.suits}</p><h3>How it fails</h3><p className="small">{p.failure}</p></div>
                  <div><h3>Strengths</h3><ul className="small">{p.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  <div><h3>Weaknesses</h3><ul className="small">{p.weaknesses.map((x) => <li key={x}>{x}</li>)}</ul></div>
                </div>
                {e && <p className="small"><strong>Indian data ({p.evidenceIndex}, 10 yrs):</strong> {pct(e.cagrPct)} a year, worst fall {pct(e.maxDrawdownPct, 0)}, volatility {formatPct(e.volatilityPct, { decimals: 0 })}.</p>}
                <Notice kind="info" title="In your portfolio">{p.forYou}</Notice>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Knowledge() {
  const [kind, setKind] = useState("All");
  return (
    <div className="stack">
      <Card title="Case studies" actions={<select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 130 }} aria-label="Filter">{["All", "Crash", "Failure", "Success"].map((k) => <option key={k}>{k}</option>)}</select>}>
        <div className="stack">
          {CASES.filter((c) => kind === "All" || c.kind === kind).map((c) => (
            <div key={c.title}>
              <div className="row"><span className={`badge ${c.kind === "Success" ? "good" : c.kind === "Crash" ? "warn" : "bad"}`}>{c.kind}</span><strong>{c.title}</strong><span className="small muted">{c.when}</span></div>
              <p className="small">{c.what}</p>
              <ul className="small">{c.lessons.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="small muted">Historical figures are approximate and widely reported; verify specifics before relying on them.</p>
      </Card>
      {TOPICS.map((t) => (
        <Card key={t.title} title={t.title}><ul className="small">{t.points.map((p) => <li key={p}>{p}</li>)}</ul></Card>
      ))}
    </div>
  );
}

function Behaviour() {
  const b = useApi<any>("/behaviour");
  const [form, setForm] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  if (b.loading && !b.data) return <Loading />;
  if (b.error) return <ErrorBox error={b.error} onRetry={b.reload} />;
  const d = b.data;
  const submit = async () => {
    setErr(null);
    try {
      await post("/reviews", form);
      setForm(null);
      b.reload();
    } catch (e) {
      setErr(e as Error);
    }
  };
  return (
    <div className="stack">
      <Card title="Patterns found in your own decisions">
        {d.findings.length === 0 ? <Empty>No transactions to analyse yet.</Empty> : d.findings.map((f: any) => (
          <div key={f.pattern} style={{ marginBottom: 10 }}>
            <div className="row"><span className={`badge ${f.severity === "warning" ? "warn" : "good"}`}>{f.severity === "warning" ? "⚠ Pattern" : "✓"}</span><strong>{f.pattern}</strong></div>
            <div className="small">{f.evidence}</div>
            <div className="small muted">Why it matters: {f.why} Fix: {f.fix}</div>
          </div>
        ))}
      </Card>
      <Card title="Post-investment reviews due">
        {d.due.length === 0 ? <Empty>Nothing due. Reviews are requested after every sale and every six months for each holding.</Empty> : d.due.map((x: any) => (
          <div key={x.symbol + x.kind} className="row between" style={{ marginBottom: 6 }}>
            <span className="small"><strong>{x.symbol.startsWith("MF:") ? x.name : x.symbol}</strong> — {x.reason}</span>
            <button onClick={() => setForm({ symbol: x.symbol, kind: x.kind, thesisCorrect: "too_early", disciplined: "yes", outcome: "", lesson: "" })}>Review</button>
          </div>
        ))}
        {form && (
          <div className="stack mt">
            <div className="form-grid">
              <label>Was the original thesis right?<select value={form.thesisCorrect} onChange={(e) => setForm({ ...form, thesisCorrect: e.target.value })}><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option><option value="too_early">Too early to tell</option></select></label>
              <label>Was the decision disciplined (followed the plan/rules)?<select value={form.disciplined} onChange={(e) => setForm({ ...form, disciplined: e.target.value })}><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option></select></label>
            </div>
            <label>What happened?<textarea value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} /></label>
            <label>Lesson learned (required)<textarea value={form.lesson} onChange={(e) => setForm({ ...form, lesson: e.target.value })} /></label>
            <ErrorBox error={err} />
            <div className="row"><button className="primary" onClick={submit}>Save review</button><button onClick={() => setForm(null)}>Cancel</button></div>
          </div>
        )}
      </Card>
      {d.scorecard && (
        <Card title="Decision scorecard">
          <p>{d.scorecard.total} reviews · thesis right {d.scorecard.thesisRight} · thesis wrong {d.scorecard.thesisWrong} · undisciplined decisions {d.scorecard.undisciplined}</p>
          <ul className="small">{d.reviews.slice(0, 10).map((r: any) => <li key={r.id}>{r.review_date} {r.symbol}: thesis {r.thesis_correct}, disciplined {r.disciplined} — {r.lesson}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

export function Learn(_: { route: Route }) {
  const ev = useApi<any>("/learn/evidence");
  const [tab, setTab] = useState("philosophy");
  return (
    <div className="stack">
      <Tabs tabs={[{ id: "philosophy", label: "Investment philosophies" }, { id: "evidence", label: "Evidence from Indian data" }, { id: "knowledge", label: "Knowledge centre" }, { id: "behaviour", label: "My behaviour & reviews" }]} value={tab} onChange={setTab} />
      {tab === "philosophy" && <Philosophies ev={ev} />}
      {tab === "evidence" && <Evidence ev={ev} />}
      {tab === "knowledge" && <Knowledge />}
      {tab === "behaviour" && <Behaviour />}
    </div>
  );
}
