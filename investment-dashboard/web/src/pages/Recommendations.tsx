import { Card, Disclaimer, Empty, ErrorBox, Fresh, Loading, Money, Notice, useApi } from "../components/ui.tsx";
import type { Route } from "../App.tsx";

export function Recommendations(_: { route: Route }) {
  const r = useApi<any>("/recommendations");
  if (r.loading) return <Loading />;
  if (r.error) return r.error.status === 409 ? <Notice kind="warn" title="Profile required">{r.error.message} <a href="#/plan">Complete it →</a></Notice> : <ErrorBox error={r.error} onRetry={r.reload} />;
  const d = r.data;
  return (
    <div className="stack">
      {!d.readiness.ready && <Notice kind="crit" title="Equity investing is blocked by your profile">{d.readiness.blockers.join(" ")}</Notice>}
      <Notice kind="info" title="How this list works">
        These are the companies <em>you</em> have researched, ranked by a published methodology. Index funds remain the default core for your plan (“{d.scenario}”); individual stocks are limited to the stock sleeve of {d.stockSleeve > 0 ? <Money v={d.stockSleeve} decimals={0} /> : "₹0"}. A high rank is a reason to research further, never a buy signal.
      </Notice>
      {d.items.length === 0 ? (
        <Card><Empty>No researched companies yet. Add one on the <a href="#/research">Stock Research</a> page.</Empty></Card>
      ) : (
        d.items.map((x: any, i: number) => (
          <Card key={x.symbol} title={<>#{i + 1} {x.symbol} <span className="small muted">{x.name}{x.sector ? ` · ${x.sector}` : ""}</span></>} actions={<a className="small" href={`#/research?symbol=${encodeURIComponent(x.symbol)}&name=${encodeURIComponent(x.name)}`}>Open research →</a>}>
            <div className="grid g4">
              <div><div className="small muted">Price</div><Money v={x.price} /> <div><Fresh asOf={x.priceAsOf} source={x.priceSource} /></div></div>
              <div><div className="small muted">Rank / Fundamental score</div><span className="num">{x.rank ?? "n/a"} / {x.fundamentalScore ?? "withheld"}</span> <div className="small muted">confidence {x.confidence}%</div></div>
              <div><div className="small muted">Valuation</div>{x.valuation.summary}</div>
              <div><div className="small muted">Risk score</div><span className={`badge ${x.riskScore === null ? "" : x.riskScore >= 60 ? "bad" : x.riskScore >= 40 ? "warn" : "good"}`}>{x.riskScore ?? "n/a"}</span><div className="small muted">{x.riskFactors.join(", ")}</div></div>
            </div>
            <div className="grid g2 mt">
              <div><h3>Reasons to consider</h3>{x.reasonsFor.length ? <ul className="small">{x.reasonsFor.map((t: string) => <li key={t}>{t}</li>)}</ul> : <p className="small muted">None identified from your data.</p>}</div>
              <div><h3>Reasons to avoid</h3>{x.reasonsAgainst.length ? <ul className="small neg">{x.reasonsAgainst.map((t: string) => <li key={t}>{t}</li>)}</ul> : <p className="small muted">None identified — look harder before buying.</p>}</div>
            </div>
            <div className="small mt">
              <strong>Suggested allocation:</strong> {x.suggestedAmount ? <><Money v={x.suggestedAmount} decimals={0} /> {x.suggestedShares !== null && `(≈${x.suggestedShares} shares at the current price)`}</> : "none"} — {x.suggestionNote}
              {x.horizon && <> · Horizon: {x.horizon}</>}
            </div>
            {x.thesis && <details className="mt"><summary>Thesis, risks and invalidation</summary><p className="small"><strong>Thesis:</strong> {x.thesis}</p><p className="small"><strong>Risks:</strong> {x.risks}</p><p className="small"><strong>Invalidation:</strong> {x.invalidation}</p><p className="small"><strong>Entry:</strong> {x.entryStrategy}</p><p className="small muted">Research last updated {new Date(x.updatedAt).toLocaleDateString("en-IN")}</p></details>}
          </Card>
        ))
      )}
      <details>
        <summary>Methodology</summary>
        {Object.entries(d.methodology).map(([k, v]) => <p key={k} className="small"><strong>{k}:</strong> {v as string}</p>)}
      </details>
      <Disclaimer />
    </div>
  );
}
