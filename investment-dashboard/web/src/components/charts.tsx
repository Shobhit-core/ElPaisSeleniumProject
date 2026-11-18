import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR, formatINRCompact } from "../../../shared/format.ts";

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

function Tip({ active, payload, label, money = true }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-box">
      <div className="muted">{new Date(label).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="row" style={{ gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.stroke }} />
          <span>{p.name}</span>
          <span className="num" style={{ marginLeft: "auto" }}>
            {money ? formatINR(p.value) : Number(p.value).toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Value vs invested over time (single axis, both in ₹). */
export function ValueChart({ data }: { data: { date: string; value: number; invested: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={30} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => formatINRCompact(v)} width={64} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
        <Tooltip content={<Tip />} />
        <Legend iconType="plainline" />
        <Line type="monotone" dataKey="value" name="Portfolio value" stroke="var(--s1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="stepAfter" dataKey="invested" name="Invested" stroke="var(--s2)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PriceChart({ data, showSma = true }: { data: { date: string; close: number; sma50?: number | null; sma200?: number | null }[]; showSma?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={40} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => formatINRCompact(v)} width={64} domain={["auto", "auto"]} tickLine={false} axisLine={false} />
        <Tooltip content={<Tip />} />
        <Legend iconType="plainline" />
        <Line type="monotone" dataKey="close" name="Close" stroke="var(--s1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        {showSma && <Line type="monotone" dataKey="sma50" name="50-day avg" stroke="var(--s2)" strokeWidth={1.5} dot={false} connectNulls />}
        {showSma && <Line type="monotone" dataKey="sma200" name="200-day avg" stroke="var(--s7)" strokeWidth={1.5} dot={false} connectNulls />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RsiChart({ data }: { data: { date: string; rsi14: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={40} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} ticks={[30, 50, 70]} width={64} tickLine={false} axisLine={false} />
        <ReferenceLine y={70} stroke="var(--muted)" strokeDasharray="3 3" />
        <ReferenceLine y={30} stroke="var(--muted)" strokeDasharray="3 3" />
        <Tooltip content={<Tip money={false} />} />
        <Line type="monotone" dataKey="rsi14" name="RSI (14)" stroke="var(--s3)" strokeWidth={1.5} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SeriesArea({ data, name }: { data: { date: string; value: number }[]; name: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={40} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => formatINRCompact(v)} width={64} domain={["auto", "auto"]} tickLine={false} axisLine={false} />
        <Tooltip content={<Tip />} />
        <Area type="monotone" dataKey="value" name={name} stroke="var(--s1)" strokeWidth={2} fill="var(--s1)" fillOpacity={0.12} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
