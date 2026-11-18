import { useEffect, useState } from "react";
import { get, post, put } from "../api.ts";
import { Card, DataTable, ErrorBox, Fresh, Loading, Money, Notice, useApi } from "../components/ui.tsx";
import type { Route } from "../App.tsx";

function Broker({ route }: { route: Route }) {
  const st = useApi<any>("/broker/status");
  const [snap, setSnap] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const result = route.params.get("broker");
  const connect = async () => {
    try {
      const r = await post("/broker/connect");
      window.location.href = r.url; // Upstox's own login page — credentials are entered there, never here.
    } catch (e) {
      setErr(e as Error);
    }
  };
  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      setSnap(await get("/broker/snapshot"));
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };
  if (st.loading) return <Loading />;
  const s = st.data;
  return (
    <Card title="Broker connection — Upstox (read-only)">
      {result === "connected" && <Notice kind="info">Upstox connected.</Notice>}
      {result === "error" && <Notice kind="crit">Connection failed: {route.params.get("reason")}</Notice>}
      <p className="small">{s?.permissions}</p>
      <ul className="small muted">
        <li>You sign in on Upstox's own page (OAuth). Your password, PIN and OTP are never seen by this dashboard.</li>
        <li>The access token is encrypted (AES-256-GCM) in the server database and expires daily at 03:30 IST — reconnect each trading day.</li>
        <li>Upstox tokens are not scope-limited; read-only is enforced by this codebase, which contains no order-placement calls.</li>
      </ul>
      {!s?.configured ? (
        <Notice kind="warn" title="Not configured on the server">
          Missing: {s?.missingConfig.join(", ")}. Create an app at Upstox Developer Apps, set the redirect URL to <code>{window.location.origin}/api/broker/callback</code>, and put the keys in the server's <code>.env</code> (see docs/SETUP.md).
        </Notice>
      ) : s.connected ? (
        <div className="row">
          <span className="badge good">Connected · {s.user}</span>
          <span className="small muted">expires {new Date(s.expiresAt).toLocaleString("en-IN")}</span>
          <button onClick={load} disabled={busy}>{busy ? "Loading…" : "Load holdings, funds & orders"}</button>
          <button className="danger" onClick={() => post("/broker/disconnect").then(() => { setSnap(null); st.reload(); })}>Disconnect</button>
        </div>
      ) : (
        <button className="primary" onClick={connect}>Connect Upstox</button>
      )}
      <ErrorBox error={err} />
      {snap && (
        <div className="stack mt">
          <Fresh asOf={snap.fetchedAt} source="Upstox API" />
          {Object.entries(snap.errors).filter(([, v]) => v).map(([k, v]) => <div key={k} className="notice warn small">{k}: {v as string}</div>)}
          {snap.funds?.equity && <div className="small">Available funds: <Money v={snap.funds.equity.available_margin} /> · Used margin <Money v={snap.funds.equity.used_margin} /></div>}
          <h3>Broker holdings</h3>
          <DataTable
            rows={snap.holdings ?? []}
            columns={[
              { key: "s", label: "Symbol", render: (r: any) => r.trading_symbol },
              { key: "q", label: "Qty", num: true, render: (r: any) => r.quantity + (r.t1_quantity ? ` (+${r.t1_quantity} T1)` : "") },
              { key: "a", label: "Avg price", num: true, render: (r: any) => <Money v={r.average_price} /> },
              { key: "l", label: "LTP", num: true, render: (r: any) => <Money v={r.last_price} /> },
              { key: "p", label: "P&L", num: true, render: (r: any) => <Money v={r.pnl} sign /> },
            ]}
            empty="No holdings at broker."
          />
          <h3>Positions</h3>
          <DataTable rows={snap.positions ?? []} columns={[{ key: "s", label: "Symbol", render: (r: any) => r.trading_symbol }, { key: "q", label: "Qty", num: true, render: (r: any) => r.quantity }, { key: "p", label: "P&L", num: true, render: (r: any) => <Money v={r.pnl} sign /> }]} empty="No open positions." />
          <h3>Today's orders</h3>
          <DataTable rows={snap.orders ?? []} columns={[{ key: "t", label: "Time", render: (r: any) => r.order_timestamp }, { key: "s", label: "Symbol", render: (r: any) => r.trading_symbol }, { key: "x", label: "Side", render: (r: any) => r.transaction_type }, { key: "q", label: "Filled/Qty", num: true, render: (r: any) => `${r.filled_quantity}/${r.quantity}` }, { key: "p", label: "Avg", num: true, render: (r: any) => <Money v={r.average_price} /> }, { key: "st", label: "Status", render: (r: any) => r.status }]} empty="No orders today." />
          <p className="small muted">Broker data is shown alongside your journal, not merged automatically: record trades in the Journal (or CSV import) so rationale, charges and tax lots stay accurate.</p>
        </div>
      )}
    </Card>
  );
}

function Charges() {
  const c = useApi<any>("/settings/charges");
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    if (c.data) setD(c.data);
  }, [c.data]);
  if (!d) return <Loading />;
  const upd = (i: number, k: string, v: any) => setD({ ...d, brokers: d.brokers.map((b: any, j: number) => (j === i ? { ...b, [k]: v } : b)) });
  return (
    <Card title="Broker & statutory charges">
      <label style={{ maxWidth: 240 }}>
        Broker used for estimates
        <select value={d.selected} onChange={(e) => setD({ ...d, selected: e.target.value })}>
          {d.brokers.map((b: any) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      <div className="table-wrap mt">
        <table>
          <thead><tr><th>Broker</th><th>Brokerage/order ₹</th><th>% cap</th><th>Min ₹</th><th>DP/sell ₹</th><th>AMC/yr ₹</th><th>Source</th></tr></thead>
          <tbody>
            {d.brokers.map((b: any, i: number) => (
              <tr key={b.id}>
                <td>{b.label} {!b.verified && <span className="badge warn">unverified</span>}</td>
                {(["brokerageFlat", "brokeragePct", "brokerageMin", "dpChargePerScripSell", "amcPerYear"] as const).map((k) => (
                  <td key={k} style={{ width: 90 }}><input type="number" step="any" value={b[k] ?? ""} onChange={(e) => upd(i, k, e.target.value === "" ? null : Number(e.target.value))} /></td>
                ))}
                <td className="small muted">{b.source} (checked {b.checkedOn})</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid mt">
        {[["sttPct", "STT % (delivery)"], ["stampPctBuy", "Stamp duty % (buy)"], ["exchangeTxnPct", "Exchange txn %"], ["sebiPerCrore", "SEBI ₹/crore"], ["gstPct", "GST %"]].map(([k, l]) => (
          <label key={k}>{l}<input type="number" step="any" value={d.statutory[k]} onChange={(e) => setD({ ...d, statutory: { ...d.statutory, [k]: Number(e.target.value) } })} /></label>
        ))}
      </div>
      <p className="small muted">{d.statutory.source} — checked {d.statutory.checkedOn}. Rates change; verify on the broker's and exchange's pages.</p>
      <button onClick={async () => { await put("/settings/charges", d); c.reload(); }}>Save charges</button>
    </Card>
  );
}

function DataSync() {
  const s = useApi<any>("/status");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Reference data & backups">
      {s.data && (
        <table>
          <tbody>
            <tr><td>NSE instrument list (Upstox master)</td><td>{s.data.instrumentsLoaded.toLocaleString("en-IN")} instruments</td><td><Fresh asOf={s.data.instrumentsSyncedAt} /></td></tr>
            <tr><td>Mutual fund NAVs (AMFI)</td><td /><td><Fresh asOf={s.data.navsSyncedAt} /></td></tr>
            <tr><td>AI research mode</td><td colSpan={2}>{s.data.research ? <span className="badge good">enabled</span> : <span className="badge warn">ANTHROPIC_API_KEY not set</span>}</td></tr>
          </tbody>
        </table>
      )}
      <div className="row mt">
        <button disabled={busy} onClick={async () => { setBusy(true); try { const r = await post("/instruments/sync"); setMsg(JSON.stringify(r)); s.reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Syncing…" : "Sync data now"}</button>
        <button onClick={async () => { try { const r = await post("/backup"); setMsg(`Backup written: ${r.file}`); } catch (e) { setMsg((e as Error).message); } }}>Back up database</button>
      </div>
      {msg && <p className="small muted mt">{msg}</p>}
    </Card>
  );
}

export function Settings({ route }: { route: Route }) {
  const e = useApi<any>("/status");
  return (
    <div className="stack">
      <ErrorBox error={e.error} />
      <Broker route={route} />
      <DataSync />
      <Charges />
    </div>
  );
}
