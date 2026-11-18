import { useEffect, useState } from "react";
import { api, del, get, post, put } from "../api.ts";
import { Card, DataTable, ErrorBox, Loading, Money, Notice, Tabs, useApi } from "../components/ui.tsx";
import { InstrumentPicker } from "../components/InstrumentPicker.tsx";
import { formatINR, formatQty } from "../../../shared/format.ts";
import type { Transaction } from "../../../shared/types.ts";
import type { Route } from "../App.tsx";

const blank = { date: new Date().toISOString().slice(0, 10), type: "BUY", symbol: "", name: "", assetClass: "EQUITY", sector: "", quantity: "", price: "", brokerage: "0", stt: "0", otherCharges: "0", rationale: "", exitRationale: "", lessons: "" };
type Form = typeof blank & { id?: number };

const kindToClass = (k: string, name: string) => (k === "mf" ? (/liquid|overnight|debt|gilt|bond|duration|money market/i.test(name) ? "DEBT_MF" : "EQUITY_MF") : k === "etf" ? (/gold|silver/i.test(name) ? "GOLD_ETF" : /liquid|gilt|bond/i.test(name) ? "DEBT_MF" : "EQUITY_ETF") : "EQUITY");

function TxnForm({ initial, onDone }: { initial: Form; onDone: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [err, setErr] = useState<Error | null>(null);
  const [est, setEst] = useState<any>(null);
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => setF(initial), [initial]);
  const estimate = async () => {
    if (!f.quantity || !f.price || f.type === "DIVIDEND") return;
    try {
      const r = await get(`/charges/estimate?side=${f.type}&quantity=${f.quantity}&price=${f.price}${f.symbol.startsWith("MF:") ? "&mf=1" : ""}`);
      setEst(r);
    } catch (e) {
      setErr(e as Error);
    }
  };
  const applyEst = () => est && setF((x) => ({ ...x, brokerage: String(est.brokerage), stt: String(est.stt), otherCharges: String(est.otherCharges) }));
  const save = async () => {
    setErr(null);
    try {
      if (f.id) await put(`/transactions/${f.id}`, f);
      else await post("/transactions", f);
      onDone();
    } catch (e) {
      setErr(e as Error);
    }
  };
  const value = Number(f.quantity) * Number(f.price) || 0;
  return (
    <div className="stack">
      {!f.id && <InstrumentPicker onPick={(i) => setF((x) => ({ ...x, symbol: i.symbol, name: i.name, assetClass: kindToClass(i.kind, i.name) }))} />}
      <div className="form-grid">
        <label>
          Type
          <select value={f.type} onChange={(e) => set("type", e.target.value)}>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
            <option value="DIVIDEND">Dividend</option>
          </select>
        </label>
        <label>
          Trade date
          <input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
        </label>
        <label>
          Symbol
          <input value={f.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="e.g. NIFTYBEES or MF:120716" />
        </label>
        <label>
          Name
          <input value={f.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>
          Asset class
          <select value={f.assetClass} onChange={(e) => set("assetClass", e.target.value)}>
            {["EQUITY", "EQUITY_ETF", "EQUITY_MF", "DEBT_MF", "GOLD_ETF", "GSEC", "CASH"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Sector (stocks)
          <input value={f.sector} onChange={(e) => set("sector", e.target.value)} placeholder="e.g. IT, Banks" />
        </label>
        <label>
          {f.type === "DIVIDEND" ? "Shares held" : "Quantity / units"}
          <input type="number" min={0} step="any" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} onBlur={estimate} />
        </label>
        <label>
          {f.type === "DIVIDEND" ? "Total dividend received (₹)" : "Price per unit / NAV (₹)"}
          <input type="number" min={0} step="any" value={f.price} onChange={(e) => set("price", e.target.value)} onBlur={estimate} />
        </label>
        <label>
          Brokerage (₹)
          <input type="number" min={0} step="any" value={f.brokerage} onChange={(e) => set("brokerage", e.target.value)} />
        </label>
        <label>
          STT (₹)
          <input type="number" min={0} step="any" value={f.stt} onChange={(e) => set("stt", e.target.value)} />
        </label>
        <label>
          Other charges (₹)
          <input type="number" min={0} step="any" value={f.otherCharges} onChange={(e) => set("otherCharges", e.target.value)} title="Exchange, SEBI, stamp duty, GST, DP" />
        </label>
      </div>
      {f.type !== "DIVIDEND" && value > 0 && (
        <div className="small muted">
          Trade value {formatINR(value)}.{" "}
          {est && (
            <>
              Estimated {est.broker.label} charges: {formatINR(est.total)} ({((est.total / value) * 100).toFixed(2)}% of value) <button className="link" onClick={applyEst}>use estimate</button>
              {est.total / value > 0.01 && <span className="neg"> — over 1% of the trade; small orders are expensive.</span>}
            </>
          )}
        </div>
      )}
      {f.type === "BUY" && (
        <label>
          Investment rationale (required) — why this, why now, what would make you wrong?
          <textarea value={f.rationale} onChange={(e) => set("rationale", e.target.value)} />
        </label>
      )}
      {f.type === "SELL" && (
        <label>
          Exit rationale (required)
          <textarea value={f.exitRationale} onChange={(e) => set("exitRationale", e.target.value)} />
        </label>
      )}
      <label>
        Mistakes & lessons (optional)
        <textarea value={f.lessons} onChange={(e) => set("lessons", e.target.value)} />
      </label>
      <ErrorBox error={err} />
      <div className="row">
        <button className="primary" onClick={save}>
          {f.id ? "Save changes" : "Record transaction"}
        </button>
        <span className="small muted">This records a trade you made at your broker — it does not place any order.</span>
      </div>
    </div>
  );
}

function CsvImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  const run = async (dry: boolean) => {
    setErr(null);
    try {
      const r = await api("POST", `/transactions/import${dry ? "?dryRun=1" : ""}`, text, "text/csv");
      setRes(r);
      if (!dry) onDone();
    } catch (e: any) {
      setRes(e.body);
      setErr(e);
    }
  };
  return (
    <div className="stack">
      <p className="small">
        Columns: <code>date,type,symbol,name,asset_class,sector,quantity,price,brokerage,stt,other_charges,rationale</code> (date as yyyy-mm-dd; type BUY/SELL/DIVIDEND; mutual funds as <code>MF:&lt;AMFI scheme code&gt;</code>). The whole file is rejected if any line is invalid or a sale exceeds holdings.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setText(await file.text());
        }}
      />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste CSV here" style={{ minHeight: 120, fontFamily: "var(--mono)" }} />
      <div className="row">
        <button onClick={() => run(true)} disabled={!text}>
          Validate
        </button>
        <button className="primary" onClick={() => run(false)} disabled={!text}>
          Import
        </button>
        <a href="/api/transactions/export.csv" className="small">
          Export journal as CSV
        </a>
      </div>
      <ErrorBox error={err} />
      {res?.errors?.length > 0 && (
        <ul className="small neg">
          {res.errors.map((x: any) => (
            <li key={x.line}>
              Line {x.line}: {x.message}
            </li>
          ))}
        </ul>
      )}
      {res && !res.errors?.length && <Notice kind="info">{res.imported ? `Imported ${res.imported} transactions.` : `${res.count} rows valid — ready to import.`}</Notice>}
    </div>
  );
}

function Cash() {
  const c = useApi<any>("/cash");
  const [d, setD] = useState({ date: new Date().toISOString().slice(0, 10), amount: "", note: "" });
  const [err, setErr] = useState<Error | null>(null);
  const add = async (sign: 1 | -1) => {
    try {
      await post("/cash", { ...d, amount: sign * Number(d.amount) });
      setD({ ...d, amount: "", note: "" });
      c.reload();
    } catch (e) {
      setErr(e as Error);
    }
  };
  return (
    <div className="stack">
      <p className="small muted">Record money moved into or out of your broker account. Available cash = deposits − withdrawals − purchases − charges + sales + dividends.</p>
      <div className="form-grid">
        <label>
          Date
          <input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
        </label>
        <label>
          Amount (₹)
          <input type="number" min={0} value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} />
        </label>
        <label>
          Note
          <input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <button className="primary" disabled={!d.amount} onClick={() => add(1)}>
          Add deposit
        </button>
        <button disabled={!d.amount} onClick={() => add(-1)}>
          Record withdrawal
        </button>
      </div>
      <ErrorBox error={err} />
      {c.data && (
        <DataTable
          rows={c.data.entries}
          columns={[
            { key: "d", label: "Date", render: (r: any) => r.date },
            { key: "a", label: "Amount", num: true, render: (r: any) => <Money v={r.amount} sign /> },
            { key: "n", label: "Note", render: (r: any) => r.note },
            { key: "x", label: "", render: (r: any) => <button className="link danger" onClick={() => del(`/cash/${r.id}`).then(c.reload)}>Delete</button> },
          ]}
          empty="No cash entries yet."
        />
      )}
    </div>
  );
}

export function Journal({ route }: { route: Route }) {
  const tx = useApi<{ transactions: Transaction[] }>("/transactions");
  const [tab, setTab] = useState<"list" | "add" | "import" | "cash">((route.params.get("tab") as any) || "list");
  const [editing, setEditing] = useState<Form>({ ...blank });
  const [q, setQ] = useState("");
  if (tx.loading && !tx.data) return <Loading />;
  const done = () => {
    tx.reload();
    setTab("list");
    setEditing({ ...blank });
  };
  return (
    <Card>
      <Tabs
        tabs={[
          { id: "list", label: "Transactions" },
          { id: "add", label: editing.id ? "Edit transaction" : "Add transaction" },
          { id: "import", label: "CSV import / export" },
          { id: "cash", label: "Cash" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <ErrorBox error={tx.error} onRetry={tx.reload} />
      {tab === "list" && tx.data && (
        <>
          <input placeholder="Search symbol, rationale, lessons…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 10 }} />
          <DataTable
            rows={tx.data.transactions}
            filterText={q}
            filterFn={(r, s) => `${r.symbol} ${r.name} ${r.rationale ?? ""} ${r.exitRationale ?? ""} ${r.lessons ?? ""}`.toLowerCase().includes(s)}
            initialSort={{ key: "date", dir: -1 }}
            columns={[
              { key: "date", label: "Date", sort: (r) => r.date, render: (r) => r.date },
              { key: "type", label: "Type", sort: (r) => r.type, render: (r) => <span className={`badge ${r.type === "BUY" ? "info" : r.type === "SELL" ? "warn" : "good"}`}>{r.type}</span> },
              { key: "sym", label: "Instrument", sort: (r) => r.symbol, render: (r) => (<><strong>{r.symbol}</strong><div className="small muted">{r.name}</div></>) },
              { key: "qty", label: "Qty", num: true, render: (r) => (r.type === "DIVIDEND" ? "—" : formatQty(r.quantity)) },
              { key: "price", label: "Price / amount", num: true, render: (r) => <Money v={r.price} /> },
              { key: "chg", label: "Charges", num: true, render: (r) => <Money v={r.brokerage + r.stt + r.otherCharges} /> },
              { key: "why", label: "Rationale / lessons", render: (r) => <div className="small" style={{ maxWidth: 360 }}>{r.rationale || r.exitRationale}{r.lessons && <div className="muted">Lesson: {r.lessons}</div>}</div> },
              {
                key: "act",
                label: "",
                render: (r) => (
                  <div className="row">
                    <button className="link" onClick={() => { setEditing({ ...(r as any), sector: r.sector ?? "", rationale: r.rationale ?? "", exitRationale: r.exitRationale ?? "", lessons: r.lessons ?? "", quantity: String(r.quantity), price: String(r.price), brokerage: String(r.brokerage), stt: String(r.stt), otherCharges: String(r.otherCharges) }); setTab("add"); }}>Edit</button>
                    <button className="link danger" onClick={async () => { if (confirm(`Delete ${r.type} ${r.symbol} on ${r.date}?`)) { try { await del(`/transactions/${r.id}`); tx.reload(); } catch (e) { alert((e as Error).message); } } }}>Delete</button>
                  </div>
                ),
              },
            ]}
            empty="No transactions recorded yet."
          />
        </>
      )}
      {tab === "add" && <TxnForm initial={editing} onDone={done} />}
      {tab === "import" && <CsvImport onDone={done} />}
      {tab === "cash" && <Cash />}
    </Card>
  );
}
