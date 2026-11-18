import { useEffect, useState } from "react";
import { del, get, put } from "../api.ts";
import { Card, Disclaimer, Empty, ErrorBox, Fresh, Loading, Money, Notice, Pct, Tabs, useApi } from "../components/ui.tsx";
import { InstrumentPicker } from "../components/InstrumentPicker.tsx";
import { PriceChart, RsiChart } from "../components/charts.tsx";
import { navigate, type Route } from "../App.tsx";

const EXTRA = [
  { key: "pe", label: "P/E (at the date stated)" },
  { key: "sectorPe", label: "Sector median P/E" },
  { key: "pb", label: "P/B" },
  { key: "institutionalHolding", label: "Institutional holding % (FII+DII)" },
];

function Fundamentals({ symbol, name }: { symbol: string; name: string }) {
  const meta = useApi<any>("/research/notes");
  const cur = useApi<any>(`/research/notes/${symbol}`, [symbol]);
  const [n, setN] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [saved, setSaved] = useState<any>(null);
  useEffect(() => {
    if (cur.data) {
      setN(cur.data.note ?? { name, sector: "", assetClass: "EQUITY", fundamentals: {}, thesis: "", growthDrivers: "", risks: "", invalidation: "", entryStrategy: "", horizon: "3–5 years", targetPrice: null, maxPe: null, status: "researching", reviewBy: null });
      setSaved(cur.data.note ? { score: cur.data.score, valuation: cur.data.valuation } : null);
    }
  }, [cur.data, name]);
  if (!n || !meta.data) return <Loading />;
  const metrics = [...meta.data.metrics.map((m: any) => ({ key: m.key, label: m.label, note: m.note })), ...EXTRA];
  const setF = (k: string, field: "value" | "source" | "asOf", v: string) =>
    setN((x: any) => {
      const f = { ...x.fundamentals, [k]: { ...(x.fundamentals[k] ?? { value: "", source: "", asOf: "" }), [field]: v } };
      if (!f[k].value && !f[k].source && !f[k].asOf) delete f[k];
      return { ...x, fundamentals: f };
    });
  const save = async () => {
    setErr(null);
    try {
      const body = { ...n, fundamentals: Object.fromEntries(Object.entries(n.fundamentals).filter(([, m]: any) => m.value !== "" && m.value !== null)) };
      const r = await put(`/research/notes/${symbol}`, body);
      setSaved({ score: r.score, valuation: r.valuation });
    } catch (e) {
      setErr(e as Error);
    }
  };
  return (
    <div className="stack">
      <Notice kind="info">
        Enter figures from primary sources only — annual report, quarterly results, the exchange shareholding-pattern filing. Every figure needs its source and period. Nothing is pre-filled because the dashboard has no licensed fundamentals feed and will not invent numbers.
      </Notice>
      {saved && (
        <div className="grid g3">
          <div className="card stat"><div className="label">Fundamental score</div><div className="value">{saved.score.score ?? "withheld"}</div><div className="sub muted">Data confidence {saved.score.confidence}%</div></div>
          <div className="card stat"><div className="label">Valuation</div><div className="value" style={{ fontSize: 16 }}>{saved.valuation.peLabel ?? "—"} / {saved.valuation.pegLabel ?? "—"}</div><div className="sub muted">{saved.valuation.summary}</div></div>
          <div className="card"><h3>Pillars</h3>{saved.score.pillars.map((p: any) => <div key={p.pillar} className="row between small"><span>{p.pillar}</span><span className="num">{p.score ?? "no data"}</span></div>)}</div>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Metric</th><th>Value</th><th>Source (URL / document & page)</th><th>Period / as-of</th></tr></thead>
          <tbody>
            {metrics.map((m: any) => {
              const v = n.fundamentals[m.key] ?? { value: "", source: "", asOf: "" };
              return (
                <tr key={m.key}>
                  <td className="small">{m.label}{m.note && <div className="muted">{m.note}</div>}</td>
                  <td style={{ width: 110 }}><input type="number" step="any" value={v.value} onChange={(e) => setF(m.key, "value", e.target.value)} aria-label={m.label} /></td>
                  <td><input value={v.source} onChange={(e) => setF(m.key, "source", e.target.value)} placeholder="e.g. AR FY26 p.142" /></td>
                  <td style={{ width: 120 }}><input value={v.asOf} onChange={(e) => setF(m.key, "asOf", e.target.value)} placeholder="FY26 / Q2FY27" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="form-grid">
        <label>Sector<input value={n.sector ?? ""} onChange={(e) => setN({ ...n, sector: e.target.value })} /></label>
        <label>Status<select value={n.status} onChange={(e) => setN({ ...n, status: e.target.value })}>{["researching", "watchlist", "owned", "rejected"].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Investment horizon<input value={n.horizon} onChange={(e) => setN({ ...n, horizon: e.target.value })} /></label>
        <label>Entry level for alert (₹)<input type="number" value={n.targetPrice ?? ""} onChange={(e) => setN({ ...n, targetPrice: e.target.value ? Number(e.target.value) : null })} /></label>
        <label>Review thesis by<input type="date" value={n.reviewBy ?? ""} onChange={(e) => setN({ ...n, reviewBy: e.target.value || null })} /></label>
      </div>
      {(["thesis", "growthDrivers", "risks", "invalidation", "entryStrategy"] as const).map((k) => (
        <label key={k}>
          {{ thesis: "Investment thesis", growthDrivers: "Key growth drivers", risks: "Major risks", invalidation: "What would invalidate the thesis?", entryStrategy: "Entry strategy (staging, price levels)" }[k]}
          <textarea value={n[k]} onChange={(e) => setN({ ...n, [k]: e.target.value })} />
        </label>
      ))}
      <ErrorBox error={err} />
      <div className="row">
        <button className="primary" onClick={save}>Save research</button>
        {cur.data?.note && <button className="danger" onClick={async () => { if (confirm("Delete this research note?")) { await del(`/research/notes/${symbol}`); cur.reload(); } }}>Delete note</button>}
      </div>
      <details>
        <summary>Scoring methodology</summary>
        <p className="small">{meta.data.methodology.fundamental}</p>
        <p className="small">{meta.data.methodology.valuation}</p>
        <p className="small">{meta.data.methodology.risk}</p>
      </details>
    </div>
  );
}

function Announcements({ name }: { name: string }) {
  const a = useApi<any>(`/market/announcements?company=${encodeURIComponent(name)}`, [name]);
  if (a.loading) return <Loading />;
  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  return (
    <div className="stack">
      <div className="small muted">Source: {a.data.source} <Fresh asOf={a.data.fetchedAt} /></div>
      {a.data.items.length === 0 ? <Empty>No filings by “{name}” in the current NSE announcements feed (it only carries the most recent filings across all companies).</Empty> : a.data.items.map((x: any) => (
        <div key={x.link} className="small"><a href={x.link} target="_blank" rel="noreferrer noopener">{x.company}</a> — {x.subject} <span className="muted">{x.published}</span></div>
      ))}
    </div>
  );
}

export function Research({ route }: { route: Route }) {
  const symbol = route.params.get("symbol");
  const name = route.params.get("name") ?? symbol ?? "";
  const notes = useApi<any>("/research/notes");
  const [tab, setTab] = useState<"chart" | "fundamentals" | "news">("chart");
  const [days, setDays] = useState(400);
  const [chart, setChart] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  useEffect(() => {
    if (!symbol || symbol.startsWith("MF:")) return;
    setChart(null);
    setErr(null);
    get(`/research/${encodeURIComponent(symbol)}/chart?days=${days}`).then(setChart).catch(setErr);
  }, [symbol, days]);

  return (
    <div className="stack">
      <Card>
        <InstrumentPicker placeholder="Search an NSE stock or ETF to research…" onPick={(i) => navigate("research", { symbol: i.symbol, name: i.name })} />
        {notes.data?.notes?.length > 0 && (
          <div className="chips mt">
            {notes.data.notes.map((n: any) => (
              <button key={n.symbol} onClick={() => navigate("research", { symbol: n.symbol, name: n.name })}>{n.symbol} · {n.status}</button>
            ))}
          </div>
        )}
      </Card>
      {!symbol ? (
        <Card><Empty>Search for a company to see price history, technicals, exchange filings and your fundamental research.</Empty></Card>
      ) : symbol.startsWith("MF:") ? (
        <Card><Notice>Mutual funds are tracked by NAV from AMFI. Use the fund factsheet for portfolio and expense details.</Notice></Card>
      ) : (
        <Card title={<>{symbol} <span className="muted small">{name}</span></>}>
          <Tabs tabs={[{ id: "chart", label: "Price & technicals" }, { id: "fundamentals", label: "Fundamentals & thesis" }, { id: "news", label: "Announcements" }]} value={tab} onChange={setTab} />
          {tab === "chart" && (
            <>
              <ErrorBox error={err} />
              {!chart && !err && <Loading />}
              {chart && (
                <div className="stack">
                  <div className="row between">
                    <span className="small muted">{chart.source} · last close {chart.lastDate}</span>
                    <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 120 }} aria-label="Range">
                      <option value={200}>6 months</option>
                      <option value={400}>1 year</option>
                      <option value={1100}>3 years</option>
                    </select>
                  </div>
                  {chart.warnings?.map((w: string) => <Notice key={w} kind="warn">{w}</Notice>)}
                  <PriceChart data={chart.series} />
                  <RsiChart data={chart.series} />
                  <div className="grid g4">
                    {Object.entries(chart.technical.returns).map(([k, v]) => (
                      <div key={k} className="card stat"><div className="label">{k} return</div><div className="value"><Pct v={v as number} /></div></div>
                    ))}
                  </div>
                  <table>
                    <tbody>
                      <tr><td>Last close</td><td className="num"><Money v={chart.technical.last} /></td><td>52-week range</td><td className="num"><Money v={chart.technical.low52w} /> – <Money v={chart.technical.high52w} /></td></tr>
                      <tr><td>50-day average</td><td className="num"><Money v={chart.technical.sma50} /></td><td>200-day average</td><td className="num"><Money v={chart.technical.sma200} /></td></tr>
                      <tr><td>RSI (14)</td><td className="num">{chart.technical.rsi14?.toFixed(1) ?? "—"}</td><td>From 52-week high</td><td className="num"><Pct v={chart.technical.fromHighPct} /></td></tr>
                      <tr><td>Annualised volatility (1y)</td><td className="num">{chart.volatilityPct?.toFixed(1) ?? "—"}%</td><td>Max drawdown (1y)</td><td className="num"><Pct v={chart.maxDrawdown1y} /></td></tr>
                    </tbody>
                  </table>
                  <p className="small muted">Trend: <strong>{chart.technical.trend}</strong>. Technicals describe past price behaviour only; this dashboard does not produce trading signals. For long-term investing, business quality and valuation matter far more.</p>
                </div>
              )}
            </>
          )}
          {tab === "fundamentals" && <Fundamentals symbol={symbol} name={name} />}
          {tab === "news" && <Announcements name={name} />}
        </Card>
      )}
      <Disclaimer />
    </div>
  );
}
