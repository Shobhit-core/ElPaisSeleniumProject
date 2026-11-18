import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorBox, Loading, useApi } from "../components/ui.tsx";
import { formatINR, formatINRCompact } from "../../../shared/format.ts";
import type { Route } from "../App.tsx";

const ICON: Record<string, string> = { growth: "🌱", steady: "🛡️", safe: "💧", gold: "🪙" };
const COLOR: Record<string, string> = { growth: "var(--s1)", steady: "var(--s3)", safe: "var(--s7)", gold: "var(--s4)" };
const STATUS = {
  green: { icon: "✅", title: "All good", text: "Everything is on track. Nothing needs to be done right now.", cls: "fam-green" },
  amber: { icon: "⚠️", title: "Needs a look", text: "Nothing urgent, but please read the points below.", cls: "fam-amber" },
  red: { icon: "⛔", title: "Action needed", text: "Something important needs attention.", cls: "fam-red" },
} as const;

const rupees = (v: number | null | undefined) => formatINR(v === null || v === undefined ? v : Math.round(v), { decimals: 0 });
const monthLabel = (m: number) => (m === 0 ? "Now" : m % 12 === 0 ? `${m / 12} yr` : `${m} mo`);

function FanTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tooltip-box">
      <strong>{monthLabel(label)}</strong>
      <div>Good case: {rupees(d.p90)}</div>
      <div>Most likely: {rupees(d.p50)}</div>
      <div>Bad case: {rupees(d.p10)}</div>
      <div className="muted">Money put in: {rupees(d.contributed)}</div>
    </div>
  );
}

export function Family(_: { route: Route }) {
  const f = useApi<any>("/family");
  const [h, setH] = useState(12);
  if (f.loading && !f.data) return <Loading />;
  if (f.error) return <ErrorBox error={f.error} onRetry={f.reload} />;
  const d = f.data;
  const st = STATUS[d.health.status as keyof typeof STATUS];
  const hz = d.projection.horizons.find((x: any) => x.months === h);
  const chart = d.projection.points.map((p: any) => ({ ...p, band: [p.p10, p.p90] }));
  const t = d.today;

  return (
    <div className="stack fam">
      <p className="muted">Our family money, explained simply. Updated {new Date(d.asOf).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.</p>

      {/* 1. How much do we have? */}
      <section className="card">
        <h2>💰 How much do we have?</h2>
        {t.total > 0 ? (
          <div className="grid g3">
            <div><div className="fam-label">Our money today</div><div className="fam-big">{rupees(t.total)}</div></div>
            <div><div className="fam-label">Money we put in</div><div className="fam-big muted">{rupees(t.putIn)}</div></div>
            <div>
              <div className="fam-label">{t.gain >= 0 ? "Grown by" : "Lower by"}</div>
              <div className={`fam-big ${t.gain >= 0 ? "pos" : "neg"}`}>{rupees(Math.abs(t.gain))}{t.gainPct !== null && <span className="fam-small"> ({t.gain >= 0 ? "+" : "−"}{Math.abs(t.gainPct).toFixed(1)}%)</span>}</div>
            </div>
          </div>
        ) : (
          <p>Nothing invested yet. Once purchases are recorded in the Journal, this shows what our money is worth.</p>
        )}
        {t.total > 0 && (
          <p className="fam-sentence">
            {t.gain >= 0
              ? `So far our money has grown by ${rupees(t.gain)}.`
              : `Right now our money is ${rupees(-t.gain)} below what we put in. This is normal in the short term — share prices go up and down. It only becomes a real loss if we sell in a panic.`}
          </p>
        )}
      </section>

      {/* 2. Is everything OK? */}
      <section className={`card ${st.cls}`}>
        <h2>{st.icon} Is everything okay? — {st.title}</h2>
        <p className="fam-sentence">{st.text}</p>
        {d.health.issues.length > 0 && (
          <ul>
            {d.health.issues.map((i: any) => (
              <li key={i.text}>
                <strong>{i.level === "red" ? "Important: " : "Note: "}</strong>
                {i.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Where is it? */}
      <section className="card">
        <h2>🧺 Where is our money?</h2>
        <div className="stack">
          {d.buckets.map((b: any) => (
            <div key={b.key} className="fam-bucket">
              <div className="row between">
                <strong>{ICON[b.key]} {b.label}</strong>
                <span className="num">{rupees(b.amount)} · {b.pct.toFixed(0)}%</span>
              </div>
              <div className="fam-track" aria-hidden="true">
                <div style={{ width: `${Math.min(b.pct, 100)}%`, background: COLOR[b.key] }} />
                {d.hasProfile && <span className="fam-target" style={{ left: `${Math.min(b.targetPct, 100)}%` }} title={`Plan: ${b.targetPct}%`} />}
              </div>
              <div className="small muted">{b.explain}{d.hasProfile && ` Plan: ${b.targetPct}%.`}</div>
            </div>
          ))}
        </div>
        {d.hasProfile && <p className="small muted">The thin line on each bar is the plan's target ({d.planLabel} plan).</p>}
      </section>

      {/* 4. What could it become? */}
      <section className="card">
        <h2>🔭 What could our money become?</h2>
        {!hz ? (
          <p>Answer the profile questions first, and this will show what the plan could grow into.</p>
        ) : (
          <>
            <div className="chips" role="tablist" aria-label="Time ahead">
              {d.projection.horizons.map((x: any) => (
                <button key={x.months} role="tab" aria-selected={h === x.months} className={h === x.months ? "primary" : ""} onClick={() => setH(x.months)}>
                  {x.label}
                </button>
              ))}
            </div>
            <p className="fam-sentence mt">
              In <strong>{hz.label}</strong>{d.projection.monthlyTotal > 0 && <>, if we keep investing <strong>{rupees(d.projection.monthlyTotal)} every month</strong></>}, we will have put in <strong>{rupees(hz.contributed)}</strong>.
            </p>
            <div className="grid g3">
              <div className="fam-case"><div className="fam-label">😟 Bad case</div><div className="fam-mid">{rupees(hz.p10)}</div><div className="small muted">1 in 10 chance of less</div></div>
              <div className="fam-case fam-likely"><div className="fam-label">🙂 Most likely</div><div className="fam-big">{rupees(hz.p50)}</div><div className="small muted">middle outcome</div></div>
              <div className="fam-case"><div className="fam-label">😀 Good case</div><div className="fam-mid">{rupees(hz.p90)}</div><div className="small muted">1 in 10 chance of more</div></div>
            </div>
            <p className="fam-sentence">
              Chance of having <strong>less than we put in</strong> after {hz.label}: <strong>{hz.chanceBelowContributed}%</strong>.{" "}
              {hz.months < 24 ? "Over short periods this chance is higher — that's why the plan is for 3–5 years." : "The longer we stay invested, the smaller this chance becomes."}
            </p>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} ticks={[0, 6, 12, 24, 36, 48, 60]} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => formatINRCompact(v)} width={64} tickLine={false} axisLine={false} />
                  <Tooltip content={<FanTip />} />
                  <Legend iconType="plainline" />
                  <Area dataKey="band" name="Range (bad → good case)" stroke="none" fill="var(--s1)" fillOpacity={0.18} />
                  <Line dataKey="p50" name="Most likely" stroke="var(--s1)" strokeWidth={2} dot={false} />
                  <Line dataKey="contributed" name="Money put in" stroke="var(--s2)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="notice warn mt">
              <strong>This is not a prediction or a promise.</strong>
              Nobody knows the future. These are ranges from {d.projection.basis === "plan" ? "our plan" : "what we hold today"} plus the monthly investment, using typical behaviour of each type of money. A very bad crash (like 2008 or 2020) can be worse than the "bad case" for a while.
            </div>
            <details className="mt">
              <summary>How is this calculated?</summary>
              <p className="small">{d.projection.method}</p>
              <ul className="small">
                {d.projection.assumptions.map((a: any) => (
                  <li key={a.key}>{a.label}: assumed average {a.annualReturnPct}% a year, ups-and-downs about ±{a.annualVolPct}% a year (hypothetical).</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      {/* 5. This month */}
      <section className="card">
        <h2>📝 What do we do this month?</h2>
        <ul className="fam-todo">
          {d.todo.map((x: string) => <li key={x}>{x}</li>)}
        </ul>
        <p className="small muted">Golden rule: don't sell because of scary news or a bad week. Keep the monthly investment going — it buys more when prices are low.</p>
      </section>

      {/* 6. Words explained */}
      <section className="card">
        <details>
          <summary><strong>📖 Words explained</strong></summary>
          <dl className="fam-glossary">
            <dt>Mutual fund</dt><dd>A basket where many people pool money; experts or an index decide what it holds.</dd>
            <dt>Nifty 50 index fund</dt><dd>One fund that owns India's 50 biggest companies (like HDFC Bank, Reliance, Infosys). Cheap and simple.</dd>
            <dt>Liquid fund</dt><dd>Very safe fund for short-term money. Can be withdrawn in about 1 working day.</dd>
            <dt>Short-term bond fund</dt><dd>Lends money to the government and large companies for 1–3 years. Steady, small growth.</dd>
            <dt>SIP</dt><dd>A fixed amount invested automatically every month.</dd>
            <dt>NAV</dt><dd>The price of one unit of a mutual fund, updated once a day.</dd>
            <dt>Profit / loss on paper</dt><dd>What we'd gain or lose if we sold today. It is not real until we sell.</dd>
          </dl>
        </details>
      </section>
      <p className="disclaimer">For our family's understanding. Not advice from a SEBI-registered adviser. The dashboard never buys or sells anything by itself.</p>
    </div>
  );
}
