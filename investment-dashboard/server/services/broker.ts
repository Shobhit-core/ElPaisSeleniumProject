// Upstox account connection: encrypted token storage and read-only data retrieval.
// Nothing in here (or anywhere in the codebase) can place, modify or cancel an order.

import crypto from "node:crypto";
import type { DB } from "../db.ts";
import { decryptSecret, encryptSecret } from "../security.ts";
import * as upstox from "../providers/upstox.ts";
import { log } from "../log.ts";

export class NotConnected extends Error {}

function encKey(): string | null {
  return process.env.TOKEN_ENCRYPTION_KEY || null;
}

export function brokerStatus(db: DB) {
  const cfg = upstox.upstoxConfigFromEnv();
  const row = db.prepare("SELECT expires_at, user_label, created_at FROM broker_tokens WHERE provider = 'upstox'").get() as
    | { expires_at: string; user_label: string; created_at: string }
    | undefined;
  const connected = !!row && row.expires_at > new Date().toISOString();
  return {
    provider: "upstox",
    configured: !!cfg && !!encKey(),
    missingConfig: [
      !process.env.UPSTOX_CLIENT_ID && "UPSTOX_CLIENT_ID",
      !process.env.UPSTOX_CLIENT_SECRET && "UPSTOX_CLIENT_SECRET",
      !process.env.UPSTOX_REDIRECT_URI && "UPSTOX_REDIRECT_URI",
      !encKey() && "TOKEN_ENCRYPTION_KEY",
    ].filter(Boolean),
    connected,
    expiresAt: row?.expires_at ?? null,
    connectedAt: row?.created_at ?? null,
    user: row?.user_label ?? null,
    permissions: "Read-only usage enforced in code (holdings, positions, funds, orders, P&L, quotes). Order placement is not implemented.",
  };
}

const pendingStates = new Map<string, number>();

export function beginOAuth(): string {
  const cfg = upstox.upstoxConfigFromEnv();
  if (!cfg || !encKey()) throw new Error("Upstox is not configured on the server (see .env.example)");
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now() + 10 * 60_000);
  return upstox.authorizationUrl(cfg, state);
}

export async function completeOAuth(db: DB, code: string, state: string): Promise<void> {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  if (!exp || exp < Date.now()) throw new Error("Invalid or expired OAuth state — start the connection again");
  const cfg = upstox.upstoxConfigFromEnv();
  const key = encKey();
  if (!cfg || !key) throw new Error("Upstox is not configured");
  const t = await upstox.exchangeCode(cfg, code);
  const expires = upstox.tokenExpiry(new Date());
  db.prepare(
    `INSERT INTO broker_tokens (provider, ciphertext, expires_at, user_label, created_at) VALUES ('upstox', ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET ciphertext=excluded.ciphertext, expires_at=excluded.expires_at, user_label=excluded.user_label, created_at=excluded.created_at`,
  ).run(encryptSecret(t.accessToken, key), expires.toISOString(), t.userName ? `${t.userName}` : "Upstox user", new Date().toISOString());
  log.info("upstox_connected", { expires: expires.toISOString() });
}

export function disconnect(db: DB): void {
  db.prepare("DELETE FROM broker_tokens WHERE provider = 'upstox'").run();
}

export function getUpstoxToken(db: DB): string | null {
  const key = encKey();
  if (!key) return null;
  const row = db.prepare("SELECT ciphertext, expires_at FROM broker_tokens WHERE provider = 'upstox'").get() as { ciphertext: string; expires_at: string } | undefined;
  if (!row || row.expires_at <= new Date().toISOString()) return null;
  try {
    return decryptSecret(row.ciphertext, key);
  } catch {
    log.error("token_decrypt_failed");
    return null;
  }
}

export async function brokerSnapshot(db: DB) {
  const token = getUpstoxToken(db);
  if (!token) throw new NotConnected("Upstox is not connected (or the daily token expired at 03:30 IST). Reconnect from Settings.");
  const settled = await Promise.allSettled([upstox.account.holdings(token), upstox.account.positions(token), upstox.account.funds(token), upstox.account.orders(token)]);
  const val = <T,>(i: number) => (settled[i].status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<T>).value : null);
  const err = (i: number) => (settled[i].status === "rejected" ? String((settled[i] as PromiseRejectedResult).reason?.message ?? settled[i]) : null);
  return {
    fetchedAt: new Date().toISOString(),
    holdings: val<upstox.UpstoxHolding[]>(0),
    positions: val<upstox.UpstoxPosition[]>(1),
    funds: val<upstox.UpstoxFunds>(2),
    orders: val<upstox.UpstoxOrder[]>(3),
    errors: { holdings: err(0), positions: err(1), funds: err(2), orders: err(3) },
  };
}

export async function brokerRealisedPnl(db: DB, fy: string) {
  const token = getUpstoxToken(db);
  if (!token) throw new NotConnected("Upstox is not connected (or the daily token expired at 03:30 IST).");
  return upstox.account.pnl(token, upstox.upstoxFinancialYear(fy));
}
