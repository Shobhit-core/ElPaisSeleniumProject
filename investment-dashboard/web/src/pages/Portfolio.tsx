import { useState } from "react";
import { Card, DataTable, Disclaimer, ErrorBox, Fresh, Loading, Money, Pct, useApi, type Column } from "../components/ui.tsx";
import { formatPct, formatQty } from "../../../shared/format.ts";
import type { ValuedHolding } from "../../../shared/types.ts";
import type { Route } from "../App.tsx";

const CLASSES = ["ALL", "EQUITY", "EQUITY_ETF", "EQUITY_MF", "DEBT_MF", "GOLD_ETF", "GSEC"];

export function Portfolio(_: { route: Route }) {
  const pf = useApi<any>("/portfolio");
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("ALL");
  if (pf.loading && !pf.data) return <Loading />;
  if (pf.error) return <ErrorBox error={pf.error} onRetry={pf.reload} />;
  const rows: ValuedHolding[] = pf.data.holdings.filter((h: ValuedHolding) => cls === "ALL" || h.assetClass === cls);
  const cols: Column<ValuedHolding>[] = [
    { key: "symbol", label: "Holding", sort: (r) => r.symbol, render: (r) => (<><strong>{r.symbol.startsWith("MF:") ? r.name : r.symbol}</strong><div className="small muted">{r.symbol.startsWith("MF:") ? r.symbol : r.name}{r.sector ? ` · ${r.sector}` : ""}</div></>) },
    { key: "qty", label: "Qty", num: true, sort: (r) => r.quantity, render: (r) => formatQty(r.quantity) },
    { key: "avg", label: "Avg price", num: true, sort: (r) => r.avgPrice, render: (r) => <Money v={r.avgPrice} /> },
    { key: "ltp", label: "Current price", num: true, sort: (r) => r.price, render: (r) => (<><Money v={r.price} /><div><Fresh asOf={r.priceAsOf} source={r.priceSource} /></div></>) },
    { key: "inv", label: "Invested", num: true, sort: (r) => r.invested, render: (r) => <Money v={r.invested} /> },
    { key: "val", label: "Current value", num: true, sort: (r) => r.currentValue, render: (r) => <Money v={r.currentValue} /> },
    { key: "pnl", label: "Unrealised P&L", num: true, sort: (r) => r.unrealisedPnl, render: (r) => <Money v={r.unrealisedPnl} sign /> },
    { key: "ret", label: "Return", num: true, sort: (r) => r.returnPct, render: (r) => <Pct v={r.returnPct} /> },
    { key: "day", label: "Day", num: true, sort: (r) => r.dayChange, render: (r) => <Money v={r.dayChange} sign /> },
    { key: "w", label: "Weight", num: true, sort: (r) => r.weight, render: (r) => formatPct(r.weight, { decimals: 1 }) },
  ];
  return (
    <div className="stack">
      <Card
        title="Holdings"
        actions={
          <div className="row">
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 160 }} aria-label="Search holdings" />
            <select value={cls} onChange={(e) => setCls(e.target.value)} style={{ width: 150 }} aria-label="Filter by class">
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c === "ALL" ? "All classes" : c}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <DataTable rows={rows} columns={cols} initialSort={{ key: "val", dir: -1 }} filterText={q} filterFn={(r, s) => `${r.symbol} ${r.name} ${r.sector ?? ""}`.toLowerCase().includes(s)} empty={<>No holdings. Add transactions in the <a href="#/journal">Journal</a>.</>} />
        <p className="small muted mt">Avg price is the average trade price of open lots (FIFO). Invested includes buy-side brokerage and charges but not STT, matching the cost of acquisition used for tax.</p>
      </Card>
      <Card title="Realised P&L (FIFO lots)">
        <DataTable
          rows={pf.data.realised}
          columns={[
            { key: "s", label: "Holding", render: (r: any) => r.symbol, sort: (r: any) => r.symbol },
            { key: "b", label: "Bought", render: (r: any) => r.buyDate, sort: (r: any) => r.buyDate },
            { key: "sd", label: "Sold", render: (r: any) => r.sellDate, sort: (r: any) => r.sellDate },
            { key: "q", label: "Qty", num: true, render: (r: any) => formatQty(r.quantity) },
            { key: "c", label: "Cost", num: true, render: (r: any) => <Money v={r.costOfAcquisition} /> },
            { key: "p", label: "Proceeds", num: true, render: (r: any) => <Money v={r.saleConsideration} /> },
            { key: "g", label: "Gain", num: true, render: (r: any) => <Money v={r.gain} sign />, sort: (r: any) => r.gain },
            { key: "d", label: "Days held", num: true, render: (r: any) => r.holdingDays, sort: (r: any) => r.holdingDays },
          ]}
          initialSort={{ key: "sd", dir: -1 }}
          empty="No sales yet."
        />
      </Card>
      <Disclaimer />
    </div>
  );
}
