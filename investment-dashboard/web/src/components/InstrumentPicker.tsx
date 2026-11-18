import { useEffect, useState } from "react";
import { get } from "../api.ts";

export interface PickedInstrument {
  symbol: string;
  name: string;
  kind: string;
  isin: string | null;
}

/** Search NSE stocks/ETFs (Upstox instrument master) and mutual funds (AMFI). */
export function InstrumentPicker({ onPick, placeholder = "Search stock, ETF or mutual fund…" }: { onPick: (i: PickedInstrument) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<PickedInstrument[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([]);
      return;
    }
    const t = setTimeout(() => {
      get(`/instruments/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          setRes(r.results);
          setErr(r.instrumentsLoaded === 0 ? "Instrument list not loaded — sync it in Settings, or type the NSE symbol manually." : null);
          setOpen(true);
        })
        .catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div style={{ position: "relative" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search instruments" onFocus={() => setOpen(true)} />
      {err && <div className="small muted">{err}</div>}
      {open && res.length > 0 && (
        <div className="card" style={{ position: "absolute", zIndex: 10, left: 0, right: 0, maxHeight: 300, overflowY: "auto", padding: 4 }}>
          {res.map((r) => (
            <button
              key={r.symbol}
              className="link"
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", color: "var(--text)" }}
              onClick={() => {
                onPick(r);
                setQ("");
                setOpen(false);
              }}
            >
              <strong>{r.kind === "mf" ? "MF" : r.symbol}</strong> <span className="small muted">{r.name}</span> <span className="badge">{r.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
