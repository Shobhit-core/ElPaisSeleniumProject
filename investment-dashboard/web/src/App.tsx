import { useEffect, useState, type FormEvent } from "react";
import { get, post, setUnauthorizedHandler } from "./api.ts";
import { Overview } from "./pages/Overview.tsx";
import { Family } from "./pages/Family.tsx";
import { Portfolio } from "./pages/Portfolio.tsx";
import { Analyst } from "./pages/Analyst.tsx";
import { Research } from "./pages/Research.tsx";
import { Recommendations } from "./pages/Recommendations.tsx";
import { Market } from "./pages/Market.tsx";
import { Journal } from "./pages/Journal.tsx";
import { Risk } from "./pages/Risk.tsx";
import { Tax } from "./pages/Tax.tsx";
import { Plan } from "./pages/Plan.tsx";
import { Alerts } from "./pages/Alerts.tsx";
import { Settings } from "./pages/Settings.tsx";
import { SummaryButton } from "./components/SummaryButton.tsx";

const PAGES = [
  { id: "family", label: "🏠 Family view", el: Family },
  { id: "overview", label: "Overview", el: Overview },
  { id: "portfolio", label: "My Portfolio", el: Portfolio },
  { id: "analyst", label: "AI Analyst", el: Analyst },
  { id: "research", label: "Stock Research", el: Research },
  { id: "recommendations", label: "Recommended", el: Recommendations },
  { id: "market", label: "Market Intelligence", el: Market },
  { id: "journal", label: "Investment Journal", el: Journal },
  { id: "risk", label: "Risk Management", el: Risk },
  { id: "tax", label: "Performance & Tax", el: Tax },
  { id: "plan", label: "Profile & ₹ Plan", el: Plan },
  { id: "alerts", label: "Alerts", el: Alerts },
  { id: "settings", label: "Settings & Broker", el: Settings },
] as const;

export type Route = { page: string; params: URLSearchParams };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [page, qs] = h.split("?");
  return { page: page || "family", params: new URLSearchParams(qs ?? "") };
}

export function navigate(page: string, params?: Record<string, string>) {
  window.location.hash = `/${page}${params ? `?${new URLSearchParams(params)}` : ""}`;
}

type Theme = "system" | "light" | "dark";
function applyTheme(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
function loadTheme(): Theme {
  try {
    return (localStorage.getItem("theme") as Theme) || "system";
  } catch {
    return "system";
  }
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await post("/auth/login", { password: pw });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">₹</span> Investment Desk
        </div>
        <p className="muted small">Personal portfolio & research dashboard. Sign in with the dashboard password set on your server (this is not your broker password — never enter that here).</p>
        <label>
          Dashboard password
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        {err && <div className="notice crit">{err}</div>}
        <button className="primary" disabled={busy || !pw}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [route, setRoute] = useState<Route>(parseHash());
  const [theme, setTheme] = useState<Theme>(loadTheme());
  const [menu, setMenu] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    get<{ authenticated: boolean }>("/auth/me").then((r) => setAuthed(r.authenticated)).catch(() => setAuthed(false));
    const onHash = () => {
      setRoute(parseHash());
      setMenu(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!authed) return;
    const load = () => get<{ alerts: { readAt: string | null }[] }>("/alerts").then((r) => setUnread(r.alerts.filter((a) => !a.readAt).length)).catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [authed, route.page]);

  if (authed === null) return <div className="empty">Loading…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const page = PAGES.find((p) => p.id === route.page) ?? PAGES[0];
  const Page = page.el;
  return (
    <div className="shell">
      <aside className={`side ${menu ? "open" : ""}`} aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark">₹</span> Investment Desk
        </div>
        <nav className="nav">
          {PAGES.map((p, i) => (
            <div key={p.id}>
            {i === 1 && <div className="nav-section">Detailed tools</div>}
            <a href={`#/${p.id}`} className={p.id === page.id ? "active" : ""} aria-current={p.id === page.id ? "page" : undefined}>
              {p.label}
              {p.id === "alerts" && unread > 0 && <span className="count">{unread}</span>}
            </a>
            </div>
          ))}
        </nav>
        <div style={{ padding: "16px 8px 0" }}>
          <label>
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <button className="link small" style={{ marginTop: 12 }} onClick={() => post("/auth/logout").finally(() => setAuthed(false))}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="row">
            <button className="menu-btn" aria-label="Open menu" onClick={() => setMenu((m) => !m)}>
              ☰
            </button>
            <h1>{page.label}</h1>
          </div>
          <div className="actions">
            <SummaryButton />
          </div>
        </div>
        <Page route={route} />
      </main>
    </div>
  );
}
