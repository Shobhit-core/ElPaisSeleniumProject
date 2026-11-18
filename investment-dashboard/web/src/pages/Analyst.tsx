import { useState, type FormEvent } from "react";
import { post } from "../api.ts";
import { Card, ErrorBox, Notice, Radio, useApi } from "../components/ui.tsx";
import type { Route } from "../App.tsx";

const SUGGESTED = [
  "Which stocks are currently worth researching?",
  "Is TCS overvalued?",
  "Should I buy more or wait?",
  "Which sectors have attractive fundamentals?",
  "How is my portfolio performing?",
  "Am I overexposed to a particular sector?",
  "What are the biggest risks in my portfolio?",
  "Where should I invest my next ₹5,000?",
];

interface Msg {
  q: string;
  a?: { answer: string; sources: { title: string; url: string }[]; mode: string; generatedAt: string; caveat: string };
  error?: Error;
}

export function Analyst(_: { route: Route }) {
  const status = useApi<any>("/analyst/status");
  const [mode, setMode] = useState<"local" | "research">("local");
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setMsgs((m) => [...m, { q: question }]);
    setQ("");
    try {
      const a = await post("/analyst", { question, mode });
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, a } : x)));
    } catch (e) {
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, error: e as Error } : x)));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(q);
  };
  return (
    <div className="stack">
      <Card>
        <div className="row between">
          <Radio
            name="mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "local", label: "Portfolio analysis (local, instant)" },
              { value: "research", label: `Market research with sources${status.data && !status.data.research ? " — needs API key" : ""}` },
            ]}
          />
        </div>
        {mode === "research" && status.data && !status.data.research && (
          <Notice kind="warn">Research mode uses Claude with live web search and needs <code>ANTHROPIC_API_KEY</code> in the server's .env (paid API usage). Local mode works without it.</Notice>
        )}
        <p className="small muted mt">
          {mode === "local"
            ? "Local mode reasons only over your own data (holdings, profile, research notes, risk metrics). It never guesses market facts."
            : "Research mode searches the web, prioritising NSE, BSE, SEBI, RBI, AMFI and company filings, and lists every source it used. Verify before acting."}
        </p>
        <div className="chips mt">
          {SUGGESTED.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <div className="chat" aria-live="polite">
          {msgs.length === 0 && <p className="muted">Ask a question about your portfolio or the market.</p>}
          {msgs.map((m, i) => (
            <div key={i} className="stack">
              <div className="bubble q">{m.q}</div>
              {m.error && <ErrorBox error={m.error} />}
              {!m.a && !m.error && <div className="bubble a muted">Thinking{mode === "research" ? " and searching sources (this can take a minute)" : ""}…</div>}
              {m.a && (
                <div className="bubble a">
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    {m.a.mode === "research" ? "Research mode" : "Local analysis"} · {new Date(m.a.generatedAt).toLocaleString("en-IN")}
                  </div>
                  {m.a.answer}
                  {m.a.sources.length > 0 && (
                    <div className="small mt">
                      <strong>Sources</strong>
                      <ol>
                        {m.a.sources.map((s) => (
                          <li key={s.url}>
                            <a href={s.url} target="_blank" rel="noreferrer noopener">
                              {s.title || s.url}
                            </a>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <p className="disclaimer">{m.a.caveat}</p>
                </div>
              )}
            </div>
          ))}
        </div>
        <form className="row mt" onSubmit={submit}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a stock, sector or your portfolio…" style={{ flex: 1, minWidth: 200 }} maxLength={1000} />
          <button className="primary" disabled={busy || q.trim().length < 3}>
            Ask
          </button>
        </form>
      </Card>
    </div>
  );
}
