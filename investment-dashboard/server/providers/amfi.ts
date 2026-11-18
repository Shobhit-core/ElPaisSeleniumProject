// AMFI official daily NAV file (https://www.amfiindia.com/spages/NAVAll.txt). Free, public.
// Format: "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date"
// interleaved with category headings ("Open Ended Schemes(Debt Scheme - Liquid Fund)") and AMC names.
// Note: as observed on 18-Nov-2026 some rows carry Plan and Option as separate fields; older files fold
// them into the scheme name. Both layouts are handled.

import { httpText } from "./http.ts";

export const AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt";

export interface NavRow {
  schemeCode: string;
  isin: string | null;
  isinReinv: string | null;
  name: string;
  nav: number;
  navDate: string; // ISO
  category: string | null;
  amc: string | null;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

export function parseAmfiDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}

export function parseNavAll(text: string): NavRow[] {
  const rows: NavRow[] = [];
  let category: string | null = null;
  let amc: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.includes(";")) {
      const cat = /^(Open|Close|Interval) Ended Schemes\s*\((.*)\)\s*$/i.exec(line);
      if (cat) category = cat[2].trim();
      else amc = line;
      continue;
    }
    const f = line.split(";").map((x) => x.trim());
    if (!/^\d+$/.test(f[0])) continue; // header
    let name: string, navStr: string, dateStr: string;
    if (f.length >= 8) {
      name = [f[3], f[4], f[5]].filter((x) => x && x !== "-").join(" - ");
      navStr = f[6];
      dateStr = f[7];
    } else if (f.length === 6) {
      name = f[3];
      navStr = f[4];
      dateStr = f[5];
    } else continue;
    const nav = Number(navStr);
    const navDate = parseAmfiDate(dateStr);
    if (!Number.isFinite(nav) || nav <= 0 || !navDate) continue;
    const isin = f[1] && f[1] !== "-" ? f[1] : null;
    const isinReinv = f[2] && f[2] !== "-" ? f[2] : null;
    rows.push({ schemeCode: f[0], isin, isinReinv, name, nav, navDate, category, amc });
  }
  return rows;
}

export async function fetchNavAll(): Promise<NavRow[]> {
  const rows = parseNavAll(await httpText("AMFI", AMFI_URL, { timeoutMs: 60000, redirect: "follow" }));
  if (rows.length < 1000) throw new Error(`AMFI file looked incomplete (${rows.length} rows)`);
  return rows;
}
