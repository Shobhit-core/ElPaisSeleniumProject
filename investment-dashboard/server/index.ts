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

// "--production" flag works on every OS (Windows cmd cannot set NODE_ENV=... inline in npm scripts).
const isProd = process.env.NODE_ENV === "production" || process.argv.includes("--production");
if (isProd) process.env.NODE_ENV = "production";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8787);

let passwordHash = process.env.APP_PASSWORD_HASH;
if (!passwordHash && process.env.APP_PASSWORD) passwordHash = hashPassword(process.env.APP_PASSWORD);
if (!passwordHash) {
  console.error("\nCannot start: no dashboard password set.\nOpen the .env file in this folder and fill in APP_PASSWORD_HASH (or APP_PASSWORD), then run npm start again.\n");
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

const server = app.listen(port, host, () => {
  log.info("listening", { url: `http://${host}:${port}`, mode: isProd ? "production" : "development" });
  if (isProd) console.log(`\n  Investment Desk is running → open http://${host}:${port} in your browser.\n  Keep this window open while you use it; press Ctrl+C to stop.\n`);
  else console.log(`\n  API running on http://${host}:${port}. Open the UI at http://localhost:5173\n`);
});
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `\nPort ${port} is already in use — is the dashboard already running in another window? Close it or set PORT in .env.\n` : `\nServer failed to start: ${e.message}\n`);
  process.exit(1);
});

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
