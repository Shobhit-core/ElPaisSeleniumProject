import { useEffect, useState } from "react";
import { put } from "../api.ts";
import { Card, Disclaimer, ErrorBox, Loading, Money, Notice, Radio, Tabs, useApi } from "../components/ui.tsx";
import { formatINR, formatPct } from "../../../shared/format.ts";
import type { InvestorProfile } from "../../../shared/types.ts";
import type { Route } from "../App.tsx";

type Draft = Partial<Omit<InvestorProfile, "completedAt">>;

const Q = {
  horizon: { q: "1. How long can this money stay invested?", o: [["1-3", "1–3 years"], ["3-5", "3–5 years"], ["5-10", "5–10 years"], ["10+", "10+ years"]] },
  riskTolerance: { q: "2. How would you describe your risk tolerance?", o: [["conservative", "Conservative"], ["moderate", "Moderate"], ["aggressive", "Aggressive"]] },
  emergencyFund: { q: "3. Do you have an emergency fund (≈6 months of expenses) kept separately?", o: [["full", "Yes, fully"], ["partial", "Partly"], ["none", "No"]] },
  needWithin12Months: { q: "4. Might you need any of this money within the next 12 months?", o: [["no", "No"], ["maybe", "Possibly"], ["yes", "Yes"]] },
  preference: { q: "6. What do you prefer to invest through?", o: [["mutual_funds", "Mutual funds"], ["etfs", "ETFs"], ["stocks", "Individual stocks"], ["combination", "A combination"]] },
  lossTolerance: { q: "7. How large a temporary fall in your portfolio could you sit through without selling?", o: [["5", "5%"], ["10", "10%"], ["20", "20%"], ["20+", "More than 20%"]] },
} as const;

function Onboarding({ initial, onSaved }: { initial: Draft | null; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(initial ?? { capital: 30000, taxSlabPct: 20 });
  const [err, setErr] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Draft, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const missing = (["horizon", "riskTolerance", "emergencyFund", "needWithin12Months", "preference", "lossTolerance"] as const).filter((k) => !d[k]);
  const save = async () => {
    setSaving(true);
    try {
      await put("/profile", d);
      onSaved();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Investor profile">
      <p className="muted">Recommendations stay locked until this is complete. Answer honestly — the plan is built to protect you from the outcomes you say you can't tolerate.</p>
      <div className="stack mt">
        {(Object.keys(Q) as (keyof typeof Q)[]).slice(0, 4).map((k) => (
          <div key={k}>
            <label>{Q[k].q}</label>
            <Radio name={k} options={Q[k].o.map(([value, label]) => ({ value, label }))} value={d[k] as string} onChange={(v) => set(k, v)} />
          </div>
        ))}
        <label>
          5. How much can you invest every month (₹)? Enter 0 if nothing regular.
          <input type="number" min={0} step={500} value={d.monthlyCapacity ?? ""} onChange={(e) => set("monthlyCapacity", e.target.value === "" ? undefined : Number(e.target.value))} style={{ maxWidth: 220 }} />
        </label>
        {(["preference", "lossTolerance"] as const).map((k) => (
          <div key={k}>
            <label>{Q[k].q}</label>
            <Radio name={k} options={Q[k].o.map(([value, label]) => ({ value, label }))} value={d[k] as string} onChange={(v) => set(k, v)} />
          </div>
        ))}
        <div className="form-grid">
          <label>
            Capital to plan (₹)
            <input type="number" min={1000} step={1000} value={d.capital ?? ""} onChange={(e) => set("capital", Number(e.target.value))} />
          </label>
          <label>
            Your income-tax slab (for debt-fund tax estimates)
            <select value={d.taxSlabPct ?? 20} onChange={(e) => set("taxSlabPct", Number(e.target.value))}>
              {[0, 5, 10, 15, 20, 25, 30].map((s) => (
                <option key={s} value={s}>
                  {s}%
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorBox error={err} />
        <button className="primary" disabled={missing.length > 0 || d.monthlyCapacity === undefined || saving} onClick={save}>
          {saving ? "Saving…" : missing.length || d.monthlyCapacity === undefined ? "Answer all questions to continue" : "Save profile & build plan"}
        </button>
      </div>
    </Card>
  );
}

const SUIT: Record<string, [string, string]> = { suitable: ["good", "Fits your profile"], stretch: ["warn", "Stretch"], not_suitable: ["bad", "Not suitable"] };

export function Plan(_: { route: Route }) {
  const profile = useApi<{ profile: InvestorProfile | null }>("/profile");
  const [editing, setEditing] = useState(false);
  const plan = useApi<any>(profile.data?.profile && !editing ? "/plan" : null, [profile.data, editing]);
  const [tab, setTab] = useState<string>("moderate");
  useEffect(() => {
    if (plan.data) setTab(plan.data.chosen ?? plan.data.scenarios.find((s: any) => s.suitability === "suitable")?.id ?? "conservative");
  }, [plan.data]);

  if (profile.loading) return <Loading />;
  if (profile.error) return <ErrorBox error={profile.error} onRetry={profile.reload} />;
  if (!profile.data?.profile || editing)
    return (
      <Onboarding
        initial={profile.data?.profile ?? null}
        onSaved={() => {
          setEditing(false);
          profile.reload();
        }}
      />
    );
  if (plan.loading || !plan.data) return plan.error ? <ErrorBox error={plan.error} /> : <Loading />;
  const p = plan.data;
  const s = p.scenarios.find((x: any) => x.id === tab) ?? p.scenarios[0];
  const choose = async () => {
    await put("/plan/choice", { scenario: s.id });
    plan.reload();
  };
  return (
    <div className="stack">
      <div className="row between">
        <span className="muted small">
          Profile: {p.profile.horizon} yrs · {p.profile.riskTolerance} · tolerates {p.profile.lossTolerance}% fall · {formatINR(p.profile.monthlyCapacity, { decimals: 0 })}/month
        </span>
        <button onClick={() => setEditing(true)}>Edit profile</button>
      </div>
      {p.readiness.blockers.map((b: string) => (
        <Notice key={b} kind="crit" title="Fix this before investing in equities">
          {b}
        </Notice>
      ))}
      {p.readiness.cautions.map((b: string) => (
        <Notice key={b} kind="warn">
          {b}
        </Notice>
      ))}
      <Card title={`Your ${formatINR(p.profile.capital, { decimals: 0 })} plan`}>
        <details>
          <summary>Why equity is capped at {p.readiness.equityCapPct}%</summary>
          <ul className="small">
            {p.readiness.capReasons.map((r: string) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
        <Tabs tabs={p.scenarios.map((x: any) => ({ id: x.id, label: `${x.label} · ${x.equityPct}% equity` }))} value={tab} onChange={setTab} />
        <div className="row between">
          <span className={`badge ${SUIT[s.suitability][0]}`}>{SUIT[s.suitability][1]}</span>
          <span className="small muted">{s.suitabilityNote}</span>
          {p.chosen === s.id ? <span className="badge info">Your chosen plan</span> : <button onClick={choose} disabled={s.suitability === "not_suitable"}>Use this plan</button>}
        </div>
        {s.cappedByProfile && <p className="small muted mt">Equity reduced from the scenario's default because of your profile limits.</p>}
        <div className="table-wrap mt">
          <table className="wide">
            <thead>
              <tr>
                <th>Instrument</th>
                <th className="num">Amount</th>
                <th className="num">%</th>
                <th>Risk</th>
                <th>Horizon</th>
                <th>Liquidity</th>
                <th>Why / main downside</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l: any) => (
                <tr key={l.key}>
                  <td>
                    <strong>{l.instrument}</strong>
                    <div className="small muted">{l.examples}</div>
                  </td>
                  <td className="num">
                    <Money v={l.amount} decimals={0} />
                  </td>
                  <td className="num">{l.pct}%</td>
                  <td>{l.risk}</td>
                  <td>{l.horizon}</td>
                  <td>{l.liquidity}</td>
                  <td className="small">
                    {l.reason}
                    <div className="neg">↓ {l.downside}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notice kind="warn" title="Stress test">
          If equities fell 40% (as in 2008/2020-type crashes), this plan would lose about {formatINR(s.stressLoss, { decimals: 0 })} ({formatPct((s.stressLoss / p.profile.capital) * 100, { decimals: 1 })} of capital) before any recovery.
        </Notice>
      </Card>

      <div className="grid g2">
        <Card title="How to deploy: lump sum vs staggered vs SIP">
          <p className="small">
            Recommended: invest the debt/liquid portion now; move the equity portion in <strong>3 monthly tranches</strong> from the liquid fund, then continue with a monthly SIP of {formatINR(p.profile.monthlyCapacity, { decimals: 0 })}. This limits regret if markets fall soon after you start, at the cost of lagging if they rise.
          </p>
          <div className="table-wrap mt"><table>
            <thead>
              <tr>
                <th>Hypothetical path</th>
                <th className="num">Lump sum</th>
                <th className="num">3 tranches</th>
              </tr>
            </thead>
            <tbody>
              {p.deployment.map((d: any) => (
                <tr key={d.path}>
                  <td>
                    {d.path}
                    <div className="small muted">index: {d.prices.join(" → ")}</div>
                  </td>
                  <td className="num">
                    <Money v={d.lumpSumValue} decimals={0} />
                  </td>
                  <td className="num">
                    <Money v={d.staggeredValue} decimals={0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="small muted">Neither method wins every time. These paths are made up to illustrate the trade-off.</p>
        </Card>
        <Card title="Illustrative outcomes (HYPOTHETICAL — not a forecast)">
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>Assumption set</th>
                <th className="num">Blended %/yr</th>
                <th className="num">5 yrs</th>
                <th className="num">10 yrs</th>
              </tr>
            </thead>
            <tbody>
              {s.projections.map((pr: any) => (
                <tr key={pr.label}>
                  <td>{pr.label}</td>
                  <td className="num">{pr.annualPct.toFixed(1)}%</td>
                  {pr.years
                    .filter((y: any) => y.years !== 3)
                    .map((y: any) => (
                      <td key={y.years} className="num">
                        <Money v={y.withMonthly} decimals={0} />
                        <div className="small muted">paid in {formatINR(y.totalContributed, { decimals: 0 })}</div>
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="small muted">
            Assumes constant annual returns (equity {p.assumptions.map((a: any) => a.equity).join("/")}%, debt {p.assumptions.map((a: any) => a.debt).join("/")}%, gold {p.assumptions.map((a: any) => a.gold).join("/")}%), pre-tax and pre-cost, including your monthly contribution. Real returns are uneven and can be negative for years. Nothing here is guaranteed.
          </p>
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}
