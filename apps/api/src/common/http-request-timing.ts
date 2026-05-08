import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request cumulative time spent awaiting Postgres (via wrapped client). */
export type HttpRequestTimingStore = { dbMs: number };

export const httpRequestTimingAls = new AsyncLocalStorage<HttpRequestTimingStore>();

export function getHttpRequestDbTimingStore(): HttpRequestTimingStore | undefined {
  return httpRequestTimingAls.getStore();
}

/**
 * When true, logs every HTTP response (method, path, status, total ms, db ms) with ANSI thresholds.
 * Opt-in only: set `YANNIS_HTTP_REQUEST_LOG=true` (or `1` / `yes` / `on`) in any environment, including dev.
 * Unset or `false` / `0` / `no` / `off` → no logging and no Postgres timing wrapper.
 */
export function shouldLogHttpRequests(): boolean {
  const raw = process.env.YANNIS_HTTP_REQUEST_LOG?.trim().toLowerCase();
  if (!raw || raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') {
    return false;
  }
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') {
    return true;
  }
  return false;
}

function parseMsEnv(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const httpLogThresholds = {
  get totalGoodMs() {
    return parseMsEnv('YANNIS_HTTP_LOG_TOTAL_GOOD_MS', 300);
  },
  get totalWarnMs() {
    return parseMsEnv('YANNIS_HTTP_LOG_TOTAL_WARN_MS', 1000);
  },
  get dbGoodMs() {
    return parseMsEnv('YANNIS_HTTP_LOG_DB_GOOD_MS', 50);
  },
  get dbWarnMs() {
    return parseMsEnv('YANNIS_HTTP_LOG_DB_WARN_MS', 250);
  },
};

const ansi = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

function colorForMs(ms: number, good: number, warn: number): string {
  if (ms <= good) return ansi.green;
  if (ms <= warn) return ansi.yellow;
  return ansi.red;
}

const RULE = `${ansi.dim}--------------${ansi.reset}`;

export function formatHttpRequestLogLine(input: {
  method: string;
  url: string;
  statusCode: number;
  totalMs: number;
  dbMs: number;
}): string {
  const { method, url, statusCode, totalMs, dbMs } = input;
  const t = httpLogThresholds;
  const totalColor = colorForMs(totalMs, t.totalGoodMs, t.totalWarnMs);
  const dbColor = colorForMs(dbMs, t.dbGoodMs, t.dbWarnMs);
  const path = url.length > 200 ? `${url.slice(0, 197)}…` : url;
  const totalStr = `${totalMs.toFixed(0)}ms`;
  const dbStr = `${dbMs.toFixed(0)}ms`;

  return [
    RULE,
    `${ansi.dim}${method}${ansi.reset} ${path}`,
    `    → ${statusCode}`,
    `${ansi.dim}total${ansi.reset}  ${totalColor}${totalStr}${ansi.reset}`,
    `${ansi.dim}db${ansi.reset}     ${dbColor}${dbStr}${ansi.reset}`,
    RULE,
  ].join('\n');
}
