import { useState } from "react";
import { post } from "../api.ts";
import { Card, Empty, ErrorBox, Loading, SeverityBadge, useApi } from "../components/ui.tsx";
import type { Route } from "../App.tsx";

export function Alerts(_: { route: Route }) {
  const a = useApi<any>("/alerts");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sev, setSev] = useState("all");
  if (a.loading && !a.data) return <Loading />;
  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  const list = a.data.alerts.filter((x: any) => sev === "all" || x.severity === sev);
  return (
    <Card
      title="Alerts"
      actions={
        <div className="row">
          <select value={sev} onChange={(e) => setSev(e.target.value)} style={{ width: 130 }} aria-label="Severity">
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <button onClick={() => post("/alerts/read-all").then(a.reload)}>Mark all read</button>
          <button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await post("/alerts/run"); setMsg(`${r.created} new alert(s).${r.skipped.length ? ` Skipped: ${r.skipped.join("; ")}` : ""}`); a.reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }}>
            {busy ? "Checking…" : "Check now"}
          </button>
        </div>
      }
    >
      <p className="small muted">Checked automatically every 30 minutes while the server runs. Rules: unusual price moves (relative to each stock's volatility), concentration and profile breaches, portfolio drawdown, your valuation entry levels, thesis review dates, results and negative filings for companies you own or watch.</p>
      {msg && <div className="notice info small">{msg}</div>}
      {list.length === 0 ? <Empty>No alerts.</Empty> : (
        <div className="stack mt">
          {list.map((x: any) => (
            <div key={x.id} className="card" style={{ opacity: x.readAt ? 0.65 : 1 }}>
              <div className="row between">
                <div className="row"><SeverityBadge s={x.severity} /><strong>{x.title}</strong></div>
                <span className="small muted">{new Date(x.createdAt).toLocaleString("en-IN")}</span>
              </div>
              <p className="small mt"><strong>Why it matters:</strong> {x.why}</p>
              {!x.readAt && <button className="link small" onClick={() => post(`/alerts/${x.id}/read`).then(a.reload)}>Mark read</button>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
