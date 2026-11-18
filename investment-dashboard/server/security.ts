// Authentication, sessions, secret encryption and HTTP hardening — Node built-ins only.

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { DB } from "./db.ts";
import { log } from "./log.ts";

export const SESSION_COOKIE = "pid_session";
const SESSION_HOURS = 12;

// ---- Password hashing (scrypt) ----
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---- Token encryption at rest (AES-256-GCM) ----
function keyFrom(secret: string): Buffer {
  // Accept a 64-hex-char key, otherwise derive one deterministically.
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, "hex");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string, secret: string): string {
  const [iv, tag, enc] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---- Sessions ----
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function createSession(db: DB): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  db.prepare("INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)").run(sha(token), expires.toISOString(), new Date().toISOString());
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return { token, expires };
}

export function destroySession(db: DB, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function isValidSession(db: DB, token: string | undefined): boolean {
  if (!token) return false;
  const row = db.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(sha(token)) as { expires_at: string } | undefined;
  return !!row && row.expires_at > new Date().toISOString();
}

export function sessionCookie(token: string, expires: Date, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
}

export function requireAuth(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isValidSession(db, readCookie(req, SESSION_COOKIE))) return next();
    res.status(401).json({ error: "Not signed in" });
  };
}

/** CSRF defence for state-changing requests: SameSite=Strict cookie + require a custom header (cannot be sent cross-site without CORS). */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.get("x-requested-with") === "dashboard") {
    next();
    return;
  }
  res.status(403).json({ error: "Missing CSRF header" });
}

// ---- Simple fixed-window rate limiter (per IP + bucket) ----
export function rateLimit(bucket: string, max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) {
      log.warn("rate_limited", { bucket, ip: req.ip });
      res.setHeader("Retry-After", Math.ceil((h.reset - now) / 1000));
      res.status(429).json({ error: "Too many requests — slow down" });
      return;
    }
    next();
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://api.upstox.com",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}
