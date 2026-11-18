// Structured JSON logging. Never pass secrets or tokens to these functions.

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = (process.env.LOG_LEVEL as Level) || (process.env.NODE_ENV === "test" ? "error" : "info");

const REDACT = /(token|secret|password|authorization|api[_-]?key|code)/i;

function redact(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return meta;
  return Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : v]));
}

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (order[level] < order[min]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...redact(meta) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (m: string, meta?: Record<string, unknown>) => write("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => write("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write("error", m, meta),
};
