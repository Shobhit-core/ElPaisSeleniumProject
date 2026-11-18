import { useState } from "react";
import { post } from "../api.ts";
import { BarList, Card, Disclaimer, Empty, ErrorBox, Fresh, Loading, Money, Notice, Pct, SeverityBadge, Stat, tone, useApi } from "../components/ui.tsx";
import { ValueChart } from "../components/charts.tsx";
import { formatINR, formatPct } from "../../../shared/format.ts";
import type { Route } from "../App.tsx";

const CLASS_LABEL: Record<string, string> = { EQUITY: "Stocks", EQUITY_ETF: "Equity ETFs", EQUITY_MF: "Equity funds", DEBT_MF: "Debt/liquid funds", GOLD_ETF: "Gold", GSEC: "G-Secs", CASH: "Cash" };

export function Overview(_: { route: Route }) {
  const pf = useApi<any>("/portfolio");
  const status = useApi<any>("/status");
  const idx = useApi<any>("/market/indices");
  const alerts = useApi<any>("/alerts");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await post("/portfolio/refresh-prices");
      setRefreshMsg(r.failed.length ? `Could not update: ${r.failed.map((f: any) => `${f.symbol} (${f.error})`).join(", ")}` : `Updated ${r.updated.length} price(s) via ${r.source || "cache"}.`);
      pf.reload();
    } catch (e) {
      setRefreshMsg((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  if (pf.loading && !pf.data) return <Loading />;
  if (pf.error) return <ErrorBox error={pf.error} onRetry={pf.reload} />;
  const s = pf.data.summary;
  const oldest = pf.data.holdings.filter((h: any) => h.priceAsOf).sort((a: any, b: any) => a.priceAsOf.localeCompare(b.priceAsOf))[0];
  const empty = pf.data.holdings.length === 0 && s.cash === 0;

  return (
    <div className="stack">
      {status.data && !status.data.profileComplete && (
        <Notice kind="warn" title="Complete your investor profile">
          Recommendations are locked until you answer the onboarding questions. <a href="#/plan">Open the questionnaire →</a>
        </Notice>
      )}
      {status.data && status.data.instrumentsLoaded === 0 && (
        <Notice kind="info" title="Reference data not loaded yet">
          The NSE instrument list and AMFI NAVs sync automatically on startup. If this persists, use Settings → Sync data.
        </Notice>
      )}
      <div className="row between">
        <div className="row small muted">
          Prices: {oldest ? <Fresh asOf={oldest.priceAsOf} source={oldest.priceSource} label="oldest" /> : "none yet"}
          {s.missingPrices.length > 0 && <span className="badge bad">{s.missingPrices.length} unpriced (valued at cost)</span>}
        </div>
        <button onClick={refresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh prices"}
        </button>
      </div>
      {refreshMsg && <div className="notice info small">{refreshMsg}</div>}

      <div className="grid g4">
        <Stat label="Total invested" value={formatINR(s.invested)} sub="Cost of open holdings incl. charges" />
        <Stat label="Current value" value={formatINR(s.currentValue)} sub={pf.data.xirrPct !== null ? `XIRR ${formatPct(pf.data.xirrPct, { sign: true })}` : "XIRR needs more history"} />
        <Stat label="Total P&L" value={formatINR(s.totalPnl, { sign: true })} tone={tone(s.totalPnl)} sub={`Unrealised ${formatINR(s.unrealisedPnl, { sign: true })} · Realised ${formatINR(s.realisedPnl, { sign: true })}`} />
        <Stat label="Today" value={s.dayPnl === null ? "—" : formatINR(s.dayPnl, { sign: true })} tone={tone(s.dayPnl)} sub="Change vs previous close" />
        <Stat label="Overall return" value={formatPct(s.returnPct, { sign: true })} tone={tone(s.returnPct)} sub="Unrealised, on priced holdings" />
        <Stat label="Available cash" value={formatINR(s.cash)} sub="Deposits − purchases + sales + dividends" />
        <Stat label="Dividends received" value={formatINR(s.dividends)} />
        <Stat label="Charges paid" value={formatINR(s.totalCharges)} sub="Brokerage + STT + statutory" />
      </div>

      {empty ? (
        <Card>
          <Empty>
            No holdings yet. Record your capital under <a href="#/journal">Journal → Cash</a>, then add purchases (or import a CSV / connect Upstox in <a href="#/settings">Settings</a>).
          </Empty>
        </Card>
      ) : (
        <div className="grid g3">
          <Card title="Portfolio value" className="span2">
            {pf.data.snapshots.length >= 2 ? (
              <ValueChart data={pf.data.snapshots} />
            ) : (
              <Empty>The chart builds from one real snapshot per day (no back-filled history). Check back after a few days.</Empty>
            )}
          </Card>
          <Card title="Asset allocation">
            <BarList items={pf.data.byClass.map((x: any) => ({ label: CLASS_LABEL[x.label] ?? x.label, pct: x.pct, value: x.value }))} />
            <h3 className="mt">Stocks by sector</h3>
            <BarList items={pf.data.bySector.map((x: any) => ({ label: x.label, pct: x.pct, value: x.value }))} />
          </Card>
        </div>
      )}

      <div className="grid g2">
        <Card title="Markets" actions={<a href="#/market" className="small">More →</a>}>
          {idx.error && <ErrorBox error={idx.error} onRetry={idx.reload} />}
          {idx.loading && !idx.data ? (
            <Loading />
          ) : (
            idx.data && (
              <table>
                <tbody>
                  {idx.data.indices.slice(0, 6).map((i: any) => (
                    <tr key={i.symbol}>
                      <td>{i.symbol}</td>
                      <td className="num">{i.price?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</td>
                      <td className="num">
                        <Pct v={i.changePct} />
                      </td>
                      <td className="num">
                        <Fresh asOf={i.asOf} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </Card>
        <Card title="Latest alerts" actions={<a href="#/alerts" className="small">All →</a>}>
          {alerts.data?.alerts?.length ? (
            <div className="stack">
              {alerts.data.alerts.slice(0, 5).map((a: any) => (
                <div key={a.id}>
                  <div className="row">
                    <SeverityBadge s={a.severity} />
                    <strong className="small">{a.title}</strong>
                  </div>
                  <div className="small muted">{a.why}</div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No alerts. Alerts only fire for moves and events that matter.</Empty>
          )}
        </Card>
      </div>
      {pf.data.holdings.length > 0 && (
        <Card title="Top holdings" actions={<a href="#/portfolio" className="small">Full portfolio →</a>}>
          <table>
            <tbody>
              {pf.data.holdings.slice(0, 5).map((h: any) => (
                <tr key={h.symbol}>
                  <td>
                    <strong>{h.symbol}</strong> <span className="small muted">{h.name}</span>
                  </td>
                  <td className="num">
                    <Money v={h.currentValue ?? h.invested} />
                  </td>
                  <td className="num">
                    <Pct v={h.returnPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Disclaimer />
    </div>
  );
}
