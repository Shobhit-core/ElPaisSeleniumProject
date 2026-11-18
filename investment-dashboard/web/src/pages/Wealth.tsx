import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { put } from "../api.ts";
import { Card, DataTable, ErrorBox, Loading, Notice, Tabs, useApi } from "../components/ui.tsx";
import { formatINR, formatINRCompact, formatPct } from "../../../shared/format.ts";
import * as W from "../../../shared/wealth.ts";
import { OPPORTUNITIES } from "../content/learn.ts";
import type { Route } from "../App.tsx";

const cr = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v >= W.CRORE ? `₹${(v / W.CRORE).toFixed(2)} Cr` : v >= W.LAKH ? `₹${(v / W.LAKH).toFixed(2)} L` : formatINR(v, { decimals: 0 }));
const rupee = (v: number) => formatINR(Math.round(v), { decimals: 0 });
const when = (months: number | null) => {
  if (months === null) return "Not within 70 yrs";
  if (months === 0) return "Reached ✓";
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return `${d.toLocaleDateString("en-IN", { month: "short", year: "numeric" })} (${(months / 12).toFixed(1)} yrs)`;
};

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-box">
      <strong>Year {label}</strong>
      {payload.map((p: any) => <div key={p.dataKey}><span style={{ color: p.stroke }}>■</span> {p.name}: {cr(p.value)}</div>)}
    </div>
  );
}

function Roadmap({ w }: { w: any }) {
  const t = w.target;
  const chart = w.projections[1].series.map((p: any, i: number) => ({ year: p.year, contributed: p.contributed, base: p.value, conservative: w.projections[0].series[i].value, optimistic: w.projections[2].series[i].value }));
  return (
    <div className="stack">
      <Notice kind={t.achievable ? "info" : "crit"} title={t.achievable ? "On the base assumptions, the plan reaches the target" : "Honest verdict: the target is not reachable on the current plan"}>{t.verdict}</Notice>
      <div className="grid g4">
        <div className="card stat"><div className="label">Net worth</div><div className="value">{cr(w.netWorth.netWorth)}</div><div className="sub muted">Assets {cr(w.netWorth.assets)} − loans {cr(w.netWorth.liabilities)}</div></div>
        <div className="card stat"><div className="label">Investable assets</div><div className="value">{cr(w.netWorth.investable)}</div><div className="sub muted">Excludes emergency fund & property</div></div>
        <div className="card stat"><div className="label">Monthly investment</div><div className="value">{rupee(w.settings.monthly)}</div><div className="sub muted">+{w.settings.stepUpPct}% every year · {rupee(w.settings.monthly * 12)}/yr now</div></div>
        <div className="card stat"><div className="label">Base case in {t.years} yrs</div><div className="value">{cr(t.baseAtTarget)}</div><div className="sub muted">{formatPct((t.baseAtTarget / t.amount) * 100, { decimals: 1 })} of target</div></div>
      </div>
      <Card title="What ₹100 crore really means">
        <ul>
          <li>₹100 crore in {t.years} years will buy what about <strong>{cr(t.realValueToday)}</strong> buys today (inflation {w.settings.assumptions.inflationPct}%/yr).</li>
          <li>To have the purchasing power of ₹100 crore <em>today</em>, you would need about <strong>{cr(t.nominalNeededForTodaysValue)}</strong> in {t.years} years.</li>
          <li>To reach ₹100 crore in {t.years} years at the base return you'd need to start at <strong>{rupee(t.requiredMonthlyBase)}/month</strong>, rising {w.settings.stepUpPct}% a year — or earn <strong>{t.requiredReturnPct === null ? ">40%" : `${t.requiredReturnPct.toFixed(1)}%`}</strong> a year, which no prudent plan should assume.</li>
        </ul>
      </Card>
      <Card title="Projected wealth (nominal ₹)">
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="year" tickLine={false} axisLine={false} tickFormatter={(y) => `${y}y`} />
              <YAxis tickFormatter={(v) => formatINRCompact(v)} width={70} tickLine={false} axisLine={false} />
              <Tooltip content={<Tip />} />
              <Legend iconType="plainline" />
              <Line dataKey="optimistic" name={`Optimistic (${w.settings.assumptions.optimistic}%)`} stroke="var(--s3)" strokeWidth={2} dot={false} strokeDasharray="4 3" />
              <Line dataKey="base" name={`Base (${w.settings.assumptions.base}%)`} stroke="var(--s1)" strokeWidth={2} dot={false} />
              <Line dataKey="conservative" name={`Conservative (${w.settings.assumptions.conservative}%)`} stroke="var(--s2)" strokeWidth={2} dot={false} strokeDasharray="4 3" />
              <Line dataKey="contributed" name="Money put in" stroke="var(--muted)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="table-wrap mt">
          <table className="wide">
            <thead><tr><th>After</th><th className="num">Put in</th>{w.projections.map((p: any) => <th key={p.scenario} className="num">{p.scenario} ({p.grossReturnPct}%)</th>)}</tr></thead>
            <tbody>
              {w.projections[0].byHorizon.map((h: any, i: number) => (
                <tr key={h.years}>
                  <td>{h.years} years</td>
                  <td className="num">{cr(h.contributed)}</td>
                  {w.projections.map((p: any) => (
                    <td key={p.scenario} className="num">{cr(p.byHorizon[i].nominal)}<div className="small muted">today's ₹: {cr(p.byHorizon[i].real)}</div><div className="small muted">after tax: {cr(p.byHorizon[i].afterTax)}</div></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{w.assumptionsNote} Returns are before tax; {w.settings.assumptions.costDragPct}% a year is deducted for fund expenses and transaction costs.</p>
      </Card>
      <Card title="Milestones">
        <div className="table-wrap">
          <table className="wide">
            <thead><tr><th>Milestone</th><th>Progress</th><th>Conservative</th><th>Base</th><th>Optimistic</th><th className="num">Starting SIP needed by year {w.settings.targetYears}</th><th className="num">Shortfall at year {w.settings.targetYears}</th></tr></thead>
            <tbody>
              {w.milestones.map((m: any) => (
                <tr key={m.amount}>
                  <td><strong>{cr(m.amount)}</strong></td>
                  <td style={{ minWidth: 120 }}><div className="barlist"><div className="track"><div className="fill" style={{ width: `${m.pctComplete}%`, background: "var(--s1)" }} /></div></div><span className="small">{m.pctComplete.toFixed(m.pctComplete < 1 ? 2 : 0)}%</span></td>
                  <td className="small">{when(m.monthsByScenario.conservative)}</td>
                  <td className="small"><strong>{when(m.monthsByScenario.base)}</strong></td>
                  <td className="small">{when(m.monthsByScenario.optimistic)}</td>
                  <td className="num">{m.reached ? "Reached" : m.shortfallAtTarget === 0 ? <span className="pos">On track</span> : <>{rupee(m.requiredMonthlyByTarget)}<div className="small muted">vs {rupee(w.settings.monthly)} now</div></>}</td>
                  <td className="num">{m.shortfallAtTarget > 0 ? cr(m.shortfallAtTarget) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Dates assume today's investable assets, {rupee(w.settings.monthly)}/month and a {w.settings.stepUpPct}% yearly step-up. "On track" means your current plan reaches it before year {w.settings.targetYears} in the base case. Otherwise the amount shown is the starting monthly SIP (then rising {w.settings.stepUpPct}%/yr) needed to reach it by year {w.settings.targetYears}.</p>
      </Card>
    </div>
  );
}

function Calculator({ w }: { w: any }) {
  const [c, setC] = useState({ initial: Math.round(w.netWorth.investable || 30000), monthly: w.settings.monthly, stepUpPct: w.settings.stepUpPct, years: w.settings.targetYears, grossReturnPct: w.settings.assumptions.base, costDragPct: w.settings.assumptions.costDragPct, inflationPct: w.settings.assumptions.inflationPct, target: w.target.amount });
  const set = (k: keyof typeof c, v: number) => setC((x) => ({ ...x, [k]: Number.isFinite(v) ? v : 0 }));
  const r = useMemo(() => {
    const pts = W.projectPlan(c);
    const end = pts.at(-1)!;
    return {
      pts,
      end,
      real: W.realValue(end.value, c.inflationPct, c.years),
      afterTax: W.afterTax(end.value, end.contributed, w.settings.assumptions),
      months: W.monthsToTarget(c.target, c, 70),
      req: W.requiredMonthly(c.target, c),
      reqReturn: W.requiredReturn(c.target, c),
    };
  }, [c, w.settings.assumptions]);
  const fields: [keyof typeof c, string, number][] = [["initial", "Starting amount (₹)", 1000], ["monthly", "Monthly investment (₹)", 1000], ["stepUpPct", "Yearly increase in SIP (%)", 1], ["years", "Years", 1], ["grossReturnPct", "Assumed return (% a year)", 0.5], ["costDragPct", "Costs (% a year)", 0.1], ["inflationPct", "Inflation (% a year)", 0.5], ["target", "Target (₹)", 1000000]];
  return (
    <div className="stack">
      <Card title="Interactive calculator">
        <div className="form-grid">
          {fields.map(([k, l, step]) => (
            <label key={k}>{l}<input type="number" step={step} value={c[k]} onChange={(e) => set(k, Number(e.target.value))} /></label>
          ))}
        </div>
        {c.grossReturnPct > 14 && <Notice kind="warn">Returns above ~14% a year sustained for decades are rare for diversified portfolios. Treat this as a best case, not a plan.</Notice>}
      </Card>
      <div className="grid g4">
        <div className="card stat"><div className="label">After {c.years} years</div><div className="value">{cr(r.end.value)}</div><div className="sub muted">You put in {cr(r.end.contributed)}</div></div>
        <div className="card stat"><div className="label">In today's money</div><div className="value">{cr(r.real)}</div><div className="sub muted">after {c.inflationPct}% inflation</div></div>
        <div className="card stat"><div className="label">After tax if sold</div><div className="value">{cr(r.afterTax)}</div><div className="sub muted">LTCG {w.settings.assumptions.ltcgPct}%</div></div>
        <div className="card stat"><div className="label">Reaches {cr(c.target)}</div><div className="value" style={{ fontSize: 16 }}>{when(r.months)}</div><div className="sub muted">Needs {rupee(r.req)}/month to hit it in {c.years} yrs</div></div>
      </div>
      <Card title="Year by year">
        <DataTable
          rows={r.pts.filter((p) => p.year > 0 && (p.year <= 5 || p.year % 5 === 0))}
          columns={[
            { key: "y", label: "Year", render: (p) => p.year },
            { key: "m", label: "Monthly SIP that year", num: true, render: (p) => rupee(p.monthlyContribution) },
            { key: "c", label: "Total put in", num: true, render: (p) => cr(p.contributed) },
            { key: "v", label: "Value", num: true, render: (p) => cr(p.value) },
            { key: "g", label: "Growth earned", num: true, render: (p) => cr(p.value - p.contributed) },
          ]}
        />
        <p className="small muted">Required return to hit the target with these inputs: {r.reqReturn === null ? "above 40% — not realistic" : `${r.reqReturn.toFixed(1)}% a year`}. Hypothetical; actual returns vary year to year and can be negative.</p>
      </Card>
    </div>
  );
}

function StepUps({ w }: { w: any }) {
  return (
    <div className="stack">
      <Card title={`Impact of raising your SIP every year (base return ${w.settings.assumptions.base}%)`}>
        <div className="table-wrap">
          <table className="wide">
            <thead><tr><th>Yearly increase</th>{w.stepUps[0].byHorizon.map((h: any) => <th key={h.years} className="num">{h.years} yrs</th>)}<th>Reaches ₹100 Cr</th></tr></thead>
            <tbody>
              {w.stepUps.map((s: any) => (
                <tr key={s.stepUpPct}>
                  <td><strong>{s.stepUpPct}%</strong></td>
                  {s.byHorizon.map((h: any) => <td key={h.years} className="num">{cr(h.value)}<div className="small muted">SIP {rupee(h.monthlyInFinalYear)}/m</div></td>)}
                  <td className="small">{when(s.monthsToTarget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">"SIP …/m" is the monthly amount you'd be investing in that final year. A 20% yearly step-up means your SIP roughly doubles every 4 years — only realistic if your income grows that fast.</p>
      </Card>
      <Card title="Monthly investment needed to reach ₹100 crore (starting SIP)">
        <div className="table-wrap">
          <table className="wide">
            <thead><tr><th>Timeline</th><th>Return</th>{[...new Set(w.required[0].rows.map((r: any) => r.stepUpPct))].map((s: any) => <th key={s} className="num">{s === 0 ? "Flat SIP" : `+${s}%/yr`}</th>)}</tr></thead>
            <tbody>
              {w.required.flatMap((y: any) =>
                ["conservative", "base", "optimistic"].map((sc) => {
                  const rows = y.rows.filter((r: any) => r.scenario === sc);
                  return (
                    <tr key={`${y.years}-${sc}`}>
                      <td>{y.years} years</td>
                      <td>{sc} ({rows[0].grossReturnPct}%)</td>
                      {rows.map((r: any) => <td key={r.stepUpPct} className="num">{rupee(r.monthly)}</td>)}
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
        <p className="small muted">Compare with your current {rupee(w.settings.monthly)}/month. The gap is closed mainly by income growth — see the next tab.</p>
      </Card>
    </div>
  );
}

function NetWorthIncome({ w, onSaved }: { w: any; onSaved: (d: any) => void }) {
  const [s, setS] = useState(w.settings);
  const [err, setErr] = useState<Error | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setS(w.settings), [w.settings]);
  const num = (path: string[], v: string) => setS((x: any) => { const y = structuredClone(x); let o = y; for (const k of path.slice(0, -1)) o = o[k]; o[path.at(-1)!] = Number(v); return y; });
  const save = async () => {
    setErr(null);
    try {
      onSaved(await put("/wealth/settings", s));
      setMsg("Saved.");
    } catch (e) {
      setErr(e as Error);
    }
  };
  const inc = w.income;
  const field = (path: string[], label: string, step = 1000) => {
    let v: any = s;
    for (const k of path) v = v[k];
    return <label key={path.join(".")}>{label}<input type="number" step={step} value={v} onChange={(e) => num(path, e.target.value)} /></label>;
  };
  return (
    <div className="stack">
      <Card title="Net worth (enter what is NOT already in this dashboard)">
        <div className="form-grid">
          {field(["netWorth", "emergencyFund"], "Emergency fund (kept separate)")}
          {field(["netWorth", "retirementAccounts"], "EPF / PPF / NPS")}
          {field(["netWorth", "otherInvestments"], "Other investments (FDs etc.)")}
          {field(["netWorth", "businessValue"], "Business ownership value")}
          {field(["netWorth", "property"], "Property value")}
          {field(["netWorth", "liabilities"], "Loans outstanding")}
        </div>
        <p className="small muted">Dashboard investments (portfolio + cash) are added automatically: {cr(w.dashboardInvestments)}. The emergency fund counts toward net worth but is never treated as investable.</p>
      </Card>
      <Card title="Plan & assumptions">
        <div className="form-grid">
          {field(["monthly"], "Monthly investment (₹)")}
          {field(["stepUpPct"], "Yearly SIP increase (%)", 1)}
          {field(["targetYears"], "Target in (years)", 1)}
          {field(["targetAmount"], "Target (₹)", 10000000)}
          {field(["assumptions", "conservative"], "Conservative return %", 0.5)}
          {field(["assumptions", "base"], "Base return %", 0.5)}
          {field(["assumptions", "optimistic"], "Optimistic return %", 0.5)}
          {field(["assumptions", "costDragPct"], "Costs % a year", 0.1)}
          {field(["assumptions", "inflationPct"], "Inflation %", 0.5)}
        </div>
      </Card>
      <Card title="Income & wealth acceleration">
        <div className="form-grid">
          {field(["income", "annualIncome"], "Take-home income (₹/year)", 50000)}
          {field(["income", "incomeGrowthPct"], "Expected yearly raise %", 1)}
          {field(["income", "sideIncomeMonthly"], "Side/business income invested (₹/month)")}
          {field(["income", "sideIncomeGrowthPct"], "Side income growth % a year", 1)}
        </div>
        {!inc ? (
          <p className="small muted mt">Enter your take-home income and save to see how income growth changes the timeline.</p>
        ) : (
          <div className="stack mt">
            <div className="grid g4">
              <div className="card stat"><div className="label">You invest now</div><div className="value">{formatPct(inc.currentSavingsRatePct, { decimals: 0 })}</div><div className="sub muted">of take-home pay</div></div>
              <div className="card stat"><div className="label">Needed for target</div><div className="value">{inc.requiredSavingsRatePct === null ? ">100%" : formatPct(inc.requiredSavingsRatePct, { decimals: 0 })}</div><div className="sub muted">with your income growth{inc.requiredSavingsRateNoSide !== inc.requiredSavingsRatePct ? " + side income" : ""}</div></div>
              <div className="card stat"><div className="label">Corpus (income model)</div><div className="value">{cr(inc.model.totals.final)}</div><div className="sub muted">in {w.settings.targetYears} yrs, base return</div></div>
              <div className="card stat"><div className="label">Passive income it could give</div><div className="value">{cr(inc.passiveIncomeAt4Pct)}/m</div><div className="sub muted">at a 4%/yr withdrawal (nominal)</div></div>
            </div>
            <h3>Where the money would come from</h3>
            <table>
              <tbody>
                <tr><td>Starting capital</td><td className="num">{cr(inc.model.totals.initial)}</td></tr>
                <tr><td>Active income (salary savings)</td><td className="num">{cr(inc.model.totals.fromSalary)}</td></tr>
                <tr><td>Business / side income invested</td><td className="num">{cr(inc.model.totals.fromSide)}</td></tr>
                <tr><td>Capital appreciation (investment growth)</td><td className="num">{cr(inc.model.totals.growth)}</td></tr>
                <tr><td><strong>Total</strong></td><td className="num"><strong>{cr(inc.model.totals.final)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        )}
        <ErrorBox error={err} />
        <div className="row mt"><button className="primary" onClick={save}>Save & recalculate</button>{msg && <span className="small">{msg}</span>}</div>
      </Card>
      <Card title="Ways to grow earning capacity (evaluate like investments)">
        <DataTable
          rows={OPPORTUNITIES}
          columns={[
            { key: "n", label: "Opportunity", render: (o) => <><strong>{o.name}</strong><div className="small muted">{o.category}</div></> },
            { key: "c", label: "Capital", render: (o) => <span className="small">{o.capital}</span> },
            { key: "s", label: "Skills", render: (o) => <span className="small">{o.skills}</span> },
            { key: "t", label: "Time", render: (o) => <span className="small">{o.time}</span> },
            { key: "r", label: "Risk", render: (o) => <span className={`badge ${o.risk === "High" ? "bad" : o.risk === "Medium" ? "warn" : "good"}`}>{o.risk}</span> },
            { key: "p", label: "Realistic potential", render: (o) => <span className="small">{o.potential}<div className="muted">{o.note}</div></span> },
          ]}
        />
        <p className="small muted">No recommendation to quit your job or start a business. Test any idea part-time, with a paying customer, before committing money or leaving employment.</p>
      </Card>
    </div>
  );
}

function YearEnd() {
  const y = useApi<any>("/year-end");
  if (y.loading && !y.data) return <Loading />;
  if (y.error) return <ErrorBox error={y.error} onRetry={y.reload} />;
  const d = y.data;
  const toggle = async (id: string, done: boolean) => {
    await put("/year-end/manual", { id, done });
    y.reload();
  };
  return (
    <div className="stack">
      <div className="grid g4">
        <div className="card stat"><div className="label">Days left in 2026</div><div className="value">{d.daysLeftIn2026}</div></div>
        <div className="card stat"><div className="label">Capital deployed</div><div className="value">{formatPct(d.deployedPct, { decimals: 0 })}</div><div className="sub muted">{rupee(d.invested)} of {rupee(d.capital)}</div></div>
        <div className="card stat"><div className="label">Cash reserve</div><div className="value">{rupee(Math.max(d.cash, 0))}</div><div className="sub muted">staging money / buffer</div></div>
        <div className="card stat"><div className="label">If shares fall 20%</div><div className="value neg">{rupee(d.downside20.loss)}</div><div className="sub muted">{formatPct(d.downside20.pct, { decimals: 1 })} of portfolio</div></div>
      </div>
      <Card title="Year-end 2026 checklist">
        <ul style={{ listStyle: "none", padding: 0 }}>
          {d.checklist.map((c: any) => (
            <li key={c.id} className="row" style={{ marginBottom: 8 }}>
              {c.auto ? <span>{c.done ? "✅" : "⬜"}</span> : <input type="checkbox" style={{ width: "auto" }} checked={c.done} onChange={(e) => toggle(c.id, e.target.checked)} aria-label={c.label} />}
              <span>{c.label}{c.auto && <span className="small muted"> (checked automatically)</span>}</span>
            </li>
          ))}
        </ul>
        <p className="small muted">Equity now {formatPct(d.equityPct, { decimals: 0 })}{d.planEquityPct !== null && ` vs plan ${d.planEquityPct}%`} · holding period {d.holdingPeriod}.</p>
      </Card>
      <Card title="Guidance">
        <ul>{d.guidance.map((g: string) => <li key={g}>{g}</li>)}</ul>
      </Card>
    </div>
  );
}

export function Wealth({ route }: { route: Route }) {
  const w = useApi<any>("/wealth");
  const [tab, setTab] = useState<string>(route.params.get("tab") ?? "roadmap");
  if (w.loading && !w.data) return <Loading />;
  if (w.error) return <ErrorBox error={w.error} onRetry={w.reload} />;
  return (
    <div className="stack">
      <Tabs
        tabs={[
          { id: "roadmap", label: "Roadmap & milestones" },
          { id: "calc", label: "Calculator" },
          { id: "stepup", label: "Step-up & SIP needed" },
          { id: "networth", label: "Net worth & income" },
          { id: "yearend", label: "Year-end 2026" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "roadmap" && <Roadmap w={w.data} />}
      {tab === "calc" && <Calculator w={w.data} />}
      {tab === "stepup" && <StepUps w={w.data} />}
      {tab === "networth" && <NetWorthIncome w={w.data} onSaved={(d) => w.setData(d)} />}
      {tab === "yearend" && <YearEnd />}
      <p className="disclaimer">Projections are hypothetical and depend on assumptions you can change. No one can guarantee returns or that any wealth target will be reached. Not advice from a SEBI-registered adviser.</p>
    </div>
  );
}
