/**
 * Engine Keeper — 自动启动并保持 Stream Engine 运行
 * 
 * 在沙箱环境中，独立的后台进程会被自动清理。
 * 解决方案：将引擎作为 Next.js 的子进程运行。
 */
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';

const ENGINE_DIR = process.env.ENGINE_DIR || '/home/z/my-project/mini-services/stream-engine';
const ENGINE_PORT = 3001;
// In production (mini-services-dist), the built file is named mini-service-stream-engine.js
// In development, it's index.ts in the source directory
function getEngineEntryPath(): string {
  const distEntry = `${ENGINE_DIR}/mini-service-stream-engine.js`;
  const devEntry = `${ENGINE_DIR}/index.ts`;
  if (existsSync(distEntry)) return distEntry;
  return devEntry;
}
const HEALTH_URL = `http://127.0.0.1:${ENGINE_PORT}/health`;
const MAX_START_RETRIES = 3;
const START_RETRY_DELAY_MS = 2000;

let engineProcess: ChildProcess | null = null;
let isStarting = false;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Check if the engine is responding to health checks.
 */
export async function isEngineHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start the engine process if not already running.
 * Returns true if engine is healthy after starting, false otherwise.
 */
export async function ensureEngineRunning(): Promise<boolean> {
  // Already healthy?
  if (await isEngineHealthy()) {
    return true;
  }

  // Prevent concurrent starts
  if (isStarting) {
    // Wait for the other start to complete
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (await isEngineHealthy()) return true;
    }
    return false;
  }

  // Kill any existing (zombie) process
  if (engineProcess) {
    try { engineProcess.kill('SIGTERM'); } catch { /* ignore */ }
    engineProcess = null;
  }

  isStarting = true;
  console.log('[engine-keeper] Engine not healthy, starting...');

  for (let attempt = 1; attempt <= MAX_START_RETRIES; attempt++) {
    try {
      const entryPath = getEngineEntryPath();
      console.log(`[engine-keeper] Starting engine: ${entryPath}`);
      engineProcess = spawn('bun', [entryPath], {
        cwd: ENGINE_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Log engine output
      engineProcess.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) console.log(`[engine] ${text}`);
      });

      engineProcess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) console.error(`[engine] ${text}`);
      });

      engineProcess.on('exit', (code, signal) => {
        console.log(`[engine-keeper] Engine process exited: code=${code}, signal=${signal}`);
        engineProcess = null;
      });

      engineProcess.on('error', (err) => {
        console.error(`[engine-keeper] Engine process error: ${err.message}`);
        engineProcess = null;
      });

      // Wait for engine to become healthy
      const healthy = await waitForEngine(15000);
      if (healthy) {
        console.log(`[engine-keeper] Engine started successfully (attempt ${attempt})`);
        isStarting = false;
        return true;
      }

      console.warn(`[engine-keeper] Engine did not become healthy (attempt ${attempt}/${MAX_START_RETRIES})`);
    } catch (err) {
      console.error(`[engine-keeper] Failed to start engine (attempt ${attempt}):`, err);
    }

    if (attempt < MAX_START_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, START_RETRY_DELAY_MS));
    }
  }

  isStarting = false;
  console.error('[engine-keeper] Failed to start engine after all retries');
  return false;
}

/**
 * Stop the engine process.
 */
export function stopEngine(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }

  if (engineProcess) {
    try { engineProcess.kill('SIGTERM'); } catch { /* ignore */ }
    engineProcess = null;
  }
}

/**
 * Wait for the engine to become healthy.
 */
async function waitForEngine(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isEngineHealthy()) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Start periodic health checks with auto-restart.
 * Call this once from server startup.
 */
export function startHealthWatchdog(intervalMs = 10000): void {
  if (healthCheckInterval) return; // Already running

  healthCheckInterval = setInterval(async () => {
    const healthy = await isEngineHealthy();
    if (!healthy && engineProcess === null) {
      console.log('[engine-keeper] Health check failed, engine process is dead — restarting...');
      await ensureEngineRunning();
    }
  }, intervalMs);

  console.log(`[engine-keeper] Health watchdog started (interval: ${intervalMs}ms)`);

  // Don't prevent process exit
  if (healthCheckInterval.unref) {
    healthCheckInterval.unref();
  }
}
