import { useState } from "react";
import { api } from "../api.ts";
import { Card, Disclaimer, Empty, ErrorBox, Fresh, Loading, Pct, Tabs, useApi } from "../components/ui.tsx";
import type { Route } from "../App.tsx";

function Briefing() {
  const b = useApi<any>("/market/briefing");
  if (b.loading) return <Loading />;
  if (!b.data?.markdown) return <Empty>No briefing file found.</Empty>;
  return <pre className="md">{b.data.markdown}</pre>;
}

export function Market(_: { route: Route }) {
  const idx = useApi<any>("/market/indices");
  const br = useApi<any>("/market/breadth");
  const [annFilter, setAnnFilter] = useState<"all" | "tracked">("tracked");
  const [q, setQ] = useState("");
  const ann = useApi<any>(`/market/announcements?filter=${annFilter}&q=${encodeURIComponent(q)}`, [annFilter, q]);
  const eco = useApi<any>("/market/economy");
  const [tab, setTab] = useState<"announcements" | "economy" | "briefing">("announcements");

  return (
    <div className="stack">
      <div className="grid g2">
        <Card title="Indices" actions={<button onClick={idx.reload}>Refresh</button>}>
          {idx.error && <ErrorBox error={idx.error} onRetry={idx.reload} />}
          {idx.loading && !idx.data ? <Loading /> : idx.data && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Index</th><th className="num">Level</th><th className="num">Change</th><th>Freshness</th></tr></thead>
                <tbody>
                  {idx.data.indices.map((i: any) => (
                    <tr key={i.symbol}>
                      <td>{i.symbol}</td>
                      <td className="num">{i.price?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</td>
                      <td className="num"><Pct v={i.changePct} /></td>
                      <td><Fresh asOf={i.asOf} source={i.source === "upstox-candle-30m" ? "30-min candle" : i.source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {idx.data.failed.length > 0 && <p className="small neg">Unavailable: {idx.data.failed.map((f: any) => f.symbol).join(", ")}</p>}
            </div>
          )}
          <p className="small muted mt">Source: Upstox official market-data API. Without a broker connection, levels come from the latest 30-minute candle (up to ~30 min delayed).</p>
        </Card>
        <Card title="Breadth & movers (Nifty 50)">
          {br.error && <ErrorBox error={br.error} onRetry={br.reload} />}
          {br.loading && !br.data ? <Loading /> : br.data && (br.data.covered === 0 ? (
            <div className="stack">
              <Empty>Constituent list {br.data.constituentsSource}. Breadth needs the official Nifty 50 constituent file.</Empty>
              <label>
                Upload <a href="https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv" target="_blank" rel="noreferrer noopener">ind_nifty50list.csv</a> from niftyindices.com
                <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await api("PUT", "/market/constituents", await f.text(), "text/csv"); br.reload(); } catch (x) { alert((x as Error).message); } }} />
              </label>
            </div>
          ) : (
            <div className="stack">
              <div className="row">
                <span className="badge good">▲ {br.data.advances} advancing</span>
                <span className="badge bad">▼ {br.data.declines} declining</span>
                <span className="badge">{br.data.unchanged} unchanged</span>
                <span className="small muted">{br.data.covered} of 50 priced</span>
              </div>
              <div className="grid g2">
                <div><h3>Top gainers</h3>{br.data.gainers.map((g: any) => <div key={g.symbol} className="row between small"><span>{g.symbol}</span><Pct v={g.changePct} /></div>)}</div>
                <div><h3>Top losers</h3>{br.data.losers.map((g: any) => <div key={g.symbol} className="row between small"><span>{g.symbol}</span><Pct v={g.changePct} /></div>)}</div>
              </div>
              <p className="small muted">Constituents: {br.data.constituentsSource}{br.data.constituentsAsOf ? `, fetched ${new Date(br.data.constituentsAsOf).toLocaleDateString("en-IN")}` : ""}.</p>
            </div>
          ))}
        </Card>
      </div>
      <Card>
        <Tabs tabs={[{ id: "announcements", label: "Corporate announcements" }, { id: "economy", label: "RBI / economy" }, { id: "briefing", label: "Research briefing" }]} value={tab} onChange={setTab} />
        {tab === "announcements" && (
          <div className="stack">
            <div className="row">
              <select value={annFilter} onChange={(e) => setAnnFilter(e.target.value as any)} style={{ width: 220 }} aria-label="Filter">
                <option value="tracked">My holdings & watchlist</option>
                <option value="all">All NSE filings</option>
              </select>
              <input placeholder="Search company or subject (e.g. results, dividend)" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
              {ann.data && <Fresh asOf={ann.data.fetchedAt} source="NSE RSS" />}
              {ann.data?.stale && <span className="badge warn">feed unavailable — showing cached</span>}
            </div>
            {ann.error && <ErrorBox error={ann.error} onRetry={ann.reload} />}
            {ann.data && (ann.data.items.length === 0 ? <Empty>No matching filings in the current feed.</Empty> : (
              <div className="table-wrap">
                <table>
                  <tbody>
                    {ann.data.items.map((a: any) => (
                      <tr key={a.link + a.published}>
                        <td className="small muted" style={{ whiteSpace: "nowrap" }}>{a.published}</td>
                        <td><a href={a.link} target="_blank" rel="noreferrer noopener">{a.company}</a><div className="small">{a.subject}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p className="small muted">Upcoming results appear here as “Board Meeting Intimation” filings. Filter by “board meeting” to see scheduled results dates.</p>
          </div>
        )}
        {tab === "economy" && (
          <div className="stack">
            {eco.error && <ErrorBox error={eco.error} onRetry={eco.reload} />}
            {eco.data && <><Fresh asOf={eco.data.fetchedAt} source={eco.data.source} />{eco.data.items.map((i: any) => <div key={i.link}><a href={i.link} target="_blank" rel="noreferrer noopener">{i.title}</a> <span className="small muted">{i.pubDate}</span></div>)}</>}
          </div>
        )}
        {tab === "briefing" && <Briefing />}
      </Card>
      <Disclaimer />
    </div>
  );
}
