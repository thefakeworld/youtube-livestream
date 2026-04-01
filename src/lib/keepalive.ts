/**
 * Keepalive Service — runs inside the Next.js main process.
 *
 * Every 40 seconds it HTTP-fetches three local endpoints to keep the
 * sandbox alive and simulate user activity:
 *   1. http://localhost:81  (Caddy gateway)
 *   2. /api/monitor
 *   3. /api/processes
 *
 * All results are appended to logs/keepalive.log via appendFileSync.
 * A lightweight status blob is written to logs/keepalive-status.json
 * after each cycle so the API route can read it without scanning the
 * whole log.
 */

import {
  appendFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const INTERVAL_MS = 40_000; // 40 seconds
const LOG_DIR = '/home/z/my-project/logs';
const LOG_FILE = join(LOG_DIR, 'keepalive.log');
const STATUS_FILE = join(LOG_DIR, 'keepalive-status.json');

const TARGETS = [
  { name: 'caddy-gateway', url: 'http://localhost:81' },
  { name: 'api-monitor',   url: 'http://localhost:3000/api/monitor' },
  { name: 'api-processes', url: 'http://localhost:3000/api/processes' },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let timer: ReturnType<typeof setInterval> | null = null;
let successCount = 0;
let failCount = 0;
let startedAt: string | null = null;
let lastRunAt: string | null = null;
let lastResults: Record<string, { ok: boolean; status: number | null; ms: number }> = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(msg: string) {
  ensureLogDir();
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
}

function saveStatus() {
  ensureLogDir();
  const status = {
    running: timer !== null,
    intervalMs: INTERVAL_MS,
    startedAt,
    lastRunAt,
    successCount,
    failCount,
    uptime: startedAt
      ? Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)
      : 0,
    lastResults,
    targets: TARGETS.map((t) => t.name),
  };
  try {
    writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Core tick
// ---------------------------------------------------------------------------
async function tick() {
  const cycleStart = Date.now();
  let cycleOk = true;
  const results: typeof lastResults = {};

  log(`--- keepalive tick #${successCount + failCount + 1} ---`);

  // Fetch all targets in parallel
  const fetches = TARGETS.map(async (target) => {
    const t0 = Date.now();
    try {
      const res = await fetch(target.url, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000), // 10s per request
      });
      const ms = Date.now() - t0;
      const ok = res.ok;
      results[target.name] = { ok, status: res.status, ms };
      if (!ok) cycleOk = false;
      log(`  ${target.name}: ${res.status} (${ms}ms)`);
    } catch (err: unknown) {
      const ms = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      results[target.name] = { ok: false, status: null, ms };
      cycleOk = false;
      log(`  ${target.name}: FAIL (${ms}ms) ${message}`);
    }
  });

  await Promise.allSettled(fetches);

  lastResults = results;
  lastRunAt = new Date().toISOString();

  if (cycleOk) {
    successCount++;
  } else {
    failCount++;
  }

  const elapsed = Date.now() - cycleStart;
  log(`  cycle complete in ${elapsed}ms (success=${successCount}, fail=${failCount})`);

  saveStatus();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Start the keepalive loop (no-op if already running). */
export function startKeepalive(): void {
  if (timer !== null) {
    log('startKeepalive called but already running — ignored');
    return;
  }

  ensureLogDir();
  startedAt = new Date().toISOString();
  successCount = 0;
  failCount = 0;
  lastResults = {};

  log(`keepalive STARTED (interval=${INTERVAL_MS}ms, targets=${TARGETS.length})`);

  // Run first tick immediately
  tick();

  // Schedule subsequent ticks
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref(); // Don't prevent Node.js from exiting

  saveStatus();
}

/** Stop the keepalive loop. */
export function stopKeepalive(): void {
  if (timer === null) {
    return;
  }

  clearInterval(timer);
  timer = null;

  log(`keepalive STOPPED (total success=${successCount}, fail=${failCount})`);
  saveStatus();
}

/** Get current keepalive status object. */
export function getKeepaliveStatus(): {
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
  lastRunAt: string | null;
  successCount: number;
  failCount: number;
  uptime: number;
  lastResults: Record<string, { ok: boolean; status: number | null; ms: number }>;
  targets: string[];
} {
  return {
    running: timer !== null,
    intervalMs: INTERVAL_MS,
    startedAt,
    lastRunAt,
    successCount,
    failCount,
    uptime: startedAt
      ? Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)
      : 0,
    lastResults,
    targets: TARGETS.map((t) => t.name),
  };
}

/**
 * Ensure keepalive is running. Safe to call multiple times — typically
 * placed at the top of a GET handler to auto-start on first request.
 */
export function ensureKeepalive(): void {
  if (timer === null) {
    startKeepalive();
  }
}
