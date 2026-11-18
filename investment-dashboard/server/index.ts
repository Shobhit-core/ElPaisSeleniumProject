import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, getSetting } from "./db.ts";
import { createApp } from "./app.ts";
import { hashPassword } from "./security.ts";
import { log } from "./log.ts";
import * as md from "./services/marketData.ts";
import { recordDailySnapshot } from "./services/journal.ts";
import { runAlerts } from "./services/alertsService.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const isProd = process.env.NODE_ENV === "production";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8787);

let passwordHash = process.env.APP_PASSWORD_HASH;
if (!passwordHash && process.env.APP_PASSWORD) passwordHash = hashPassword(process.env.APP_PASSWORD);
if (!passwordHash) {
  log.error("startup_refused", { reason: "Set APP_PASSWORD_HASH (preferred) or APP_PASSWORD in .env — the dashboard always requires sign-in." });
  process.exit(1);
}
if (isProd && !process.env.TOKEN_ENCRYPTION_KEY) log.warn("broker_disabled", { reason: "TOKEN_ENCRYPTION_KEY not set; broker connection unavailable" });
if (host !== "127.0.0.1" && host !== "localhost" && process.env.COOKIE_SECURE !== "true") {
  log.warn("insecure_exposure", { reason: "Listening on a non-loopback address without COOKIE_SECURE=true. Put the app behind HTTPS." });
}

const db = openDb(process.env.DB_PATH || path.join(root, "data", "portfolio.db"));
const app = createApp(db, {
  passwordHash,
  secureCookies: process.env.COOKIE_SECURE === "true",
  serveStatic: isProd ? path.join(root, "dist") : null,
  backupDir: process.env.BACKUP_DIR || path.join(root, "backups"),
});

app.listen(port, host, () => log.info("listening", { url: `http://${host}:${port}`, mode: isProd ? "production" : "development" }));

// Background jobs: keep reference data fresh and evaluate alerts. Failures are logged, never fatal.
async function housekeeping() {
  try {
    const synced = getSetting<string | null>(db, "instruments_synced_at", null);
    if (!synced || Date.now() - Date.parse(synced) > 7 * 86400_000) await md.syncInstruments(db);
  } catch (e) {
    log.warn("instrument_sync_failed", { error: String(e) });
  }
  try {
    const synced = getSetting<string | null>(db, "navs_synced_at", null);
    if (!synced || Date.now() - Date.parse(synced) > 12 * 3600_000) await md.syncNavs(db);
  } catch (e) {
    log.warn("nav_sync_failed", { error: String(e) });
  }
  try {
    recordDailySnapshot(db);
    await runAlerts(db);
  } catch (e) {
    log.warn("alerts_failed", { error: String(e) });
  }
}
if (process.env.DISABLE_JOBS !== "true") {
  setTimeout(housekeeping, 5_000);
  setInterval(housekeeping, 30 * 60_000).unref();
}
