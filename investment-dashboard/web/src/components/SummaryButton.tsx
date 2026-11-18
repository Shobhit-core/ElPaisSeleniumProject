import { useEffect, useRef, useState } from "react";
import { get } from "../api.ts";

/** "Copy summary for Claude": preview + copy a plain-text summary with no secrets. */
export function SummaryButton() {
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState(true);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setText("Loading…");
    get<{ text: string }>(`/summary${amounts ? "" : "?amounts=0"}`)
      .then((r) => setText(r.text))
      .catch((e) => setText(`Could not build the summary: ${e.message}`));
  }, [open, amounts]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied! Paste it into your Claude chat.");
    } catch {
      // Fallback for browsers that block the clipboard API
      ref.current?.select();
      const ok = document.execCommand("copy");
      setStatus(ok ? "Copied! Paste it into your Claude chat." : "Select the text above and press Ctrl+C.");
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)}>Copy summary for Claude</button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Summary for Claude" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 50, display: "grid", placeItems: "center", padding: 16 }} onClick={() => setOpen(false)}>
          <div className="card stack" style={{ width: "100%", maxWidth: 760, maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>Summary for Claude</h2>
              <button className="link" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <p className="small muted">Your profile, plan, holdings, risk warnings, alerts, watchlist and recent trades as plain text. It never includes passwords, keys, tokens or your broker login name. Paste it into a Claude chat and ask your question.</p>
            <label className="row" style={{ gap: 8, color: "var(--text)" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={amounts} onChange={(e) => setAmounts(e.target.checked)} />
              Include ₹ amounts (untick to share percentages only)
            </label>
            <textarea ref={ref} readOnly value={text} style={{ minHeight: 320, fontFamily: "var(--mono)", fontSize: 12 }} />
            <div className="row">
              <button className="primary" onClick={copy} disabled={text === "Loading…"}>Copy to clipboard</button>
              {status && <span className="small">{status}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
