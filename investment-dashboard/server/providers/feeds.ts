// Official public feeds: NSE corporate announcements RSS, RBI press releases RSS, and the
// Nifty 50 constituent file published by NSE Indices. No scraping of restricted pages.

import { httpText } from "./http.ts";
import type { Announcement } from "../../shared/alerts.ts";

export const FEEDS = {
  nseAnnouncements: "https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml",
  rbiPress: "https://www.rbi.org.in/pressreleases_rss.xml",
  nifty50Constituents: "https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv",
};

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const tag = (t: string) => {
      const r = new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`).exec(m[1]);
      return r ? decode(r[1]) : "";
    };
    items.push({ title: tag("title"), link: tag("link"), description: tag("description"), pubDate: tag("pubDate") });
  }
  return items;
}

export function toAnnouncements(items: RssItem[]): Announcement[] {
  return items.map((i) => {
    const subj = /\|SUBJECT:\s*(.*)$/i.exec(i.description)?.[1];
    const about = /informed the Exchange about\s+(.*?)(\s*\|SUBJECT:|$)/i.exec(i.description)?.[1];
    return { company: i.title, subject: (subj || about || i.description).trim(), link: i.link, published: i.pubDate };
  });
}

export async function fetchNseAnnouncements(): Promise<Announcement[]> {
  return toAnnouncements(parseRss(await httpText("NSE", FEEDS.nseAnnouncements, { headers: { Accept: "application/rss+xml" } })));
}

export async function fetchRbiPress(): Promise<RssItem[]> {
  return parseRss(await httpText("RBI", FEEDS.rbiPress)).map((i) => ({ ...i, description: i.description.slice(0, 300) }));
}

export interface Constituent {
  name: string;
  industry: string;
  symbol: string;
  isin: string;
}

export function parseConstituentsCsv(csv: string): Constituent[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(",").map((h) => h.trim().toLowerCase()) ?? [];
  const idx = (k: string) => header.findIndex((h) => h.startsWith(k));
  const [iName, iInd, iSym, iIsin] = [idx("company"), idx("industry"), idx("symbol"), idx("isin")];
  if ([iName, iInd, iSym].some((i) => i < 0)) throw new Error("Unexpected constituent CSV header");
  return lines
    .map((l) => l.split(",").map((x) => x.trim()))
    .filter((c) => c[iSym])
    .map((c) => ({ name: c[iName], industry: c[iInd], symbol: c[iSym], isin: iIsin >= 0 ? c[iIsin] : "" }));
}

export async function fetchNifty50Constituents(): Promise<Constituent[]> {
  return parseConstituentsCsv(await httpText("NSE Indices", FEEDS.nifty50Constituents));
}
