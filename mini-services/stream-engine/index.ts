/**
 * FFmpeg Stream Engine
 *
 * Real-time FFmpeg process management service for live streaming.
 * Provides HTTP API + WebSocket for controlling and monitoring FFmpeg processes.
 *
 * Endpoints:
 *   GET  /health             — Engine health check
 *   POST /api/stream/start   — Start FFmpeg process pushing video to RTMP
 *   POST /api/stream/stop    — Kill an FFmpeg streaming process
 *   POST /api/relay/start    — Start relay from YouTube to multiple RTMP targets
 *   POST /api/relay/stop     — Kill a relay process
 *   POST /api/playlist/start — Start playlist rotation streaming
 *   POST /api/playlist/stop  — Stop a playlist rotation
 *   GET  /api/processes      — List all managed processes with real stats
 *   GET  /api/processes/:id  — Get single process details
 *   GET  /api/system         — Real system stats (CPU, memory, disk, network)
 *   WS   /ws                 — Real-time process status broadcasts every 2s
 */

import { spawn, spawnSync, execSync, ChildProcess, type SpawnOptions } from "child_process";
import { readFileSync, existsSync, mkdirSync, statSync, readdirSync } from "fs";
import { join } from "path";
import { getStreamUrl, downloadSync, YTDL_PATH } from "./lib/yt-dlp";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface StreamStartRequest {
  taskId: string;
  inputPath: string;
  primaryRtmp: string;
  backupRtmp?: string;
  videoBitrate: number;
  audioBitrate: number;
  resolution: string; // e.g. "1920x1080"
  fps: number;
  preset: string;
  loopVideo?: boolean;
}

interface RelayTarget {
  platform: string;
  rtmpUrl: string;
  streamKey: string;
}

interface RelayStartRequest {
  taskId: string;
  sourceUrl: string;
  sourceQuality?: string;
  targets: RelayTarget[];
}

interface StopRequest {
  taskId: string;
}

interface PlaylistVideo {
  id: string;
  localPath: string;
  youtubeId?: string;
  sourceUrl?: string;
}

interface PlaylistStartRequest {
  taskId: string;
  videos: PlaylistVideo[];
  primaryRtmp: string;
  backupRtmp?: string;
  videoBitrate: number;
  audioBitrate: number;
  resolution: string;
  fps: number;
  preset: string;
  loop: boolean;
  backupVideoPath: string;
  cookiesPath?: string;
}

interface FFmpegStats {
  frame: number;
  fps: number;
  bitrate: number; // kbps
  time: number; // seconds
  speed: number; // speed ratio
  size: number; // bytes
  cpuPercent: number;
  memoryMB: number;
}

interface FFmpegProcess {
  taskId: string;
  type: "stream" | "relay" | "playlist";
  process: ChildProcess;
  pid: number;
  startTime: Date;
  status: "running" | "stopping" | "stopped" | "error" | "crashed";
  stats: FFmpegStats;
  config: Record<string, unknown>;
  retryCount: number;
  lastOutput: string;
  bytesWritten: number;
  /** Rolling log buffer (stderr + stdout lines) */
  logs: string[];
  /** Total lines ever pushed (monotonically increasing sequence) */
  logSeq: number;
}

interface SystemStats {
  cpuUsage: number;
  cpuCores: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  diskUsed: number;
  diskTotal: number;
  diskPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptime: number;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const FFMPEG_PATH = process.env.FFMPEG_PATH || "/usr/bin/ffmpeg";
const PROJECT_DIR = process.env.PROJECT_DIR || "/home/z/my-project";
const DATA_DIR = process.env.DATA_DIR || `${PROJECT_DIR}/download`;
const VIDEOS_DIR = process.env.VIDEOS_DIR || `${DATA_DIR}/videos`;
const STANDBY_DIR = process.env.STANDBY_DIR || `${DATA_DIR}/standby`;
const FALLBACK_VIDEO_PATH = process.env.FALLBACK_VIDEO_PATH || `${STANDBY_DIR}/fallback.mp4`;
const MAX_RELAY_RETRIES = 3;
const RELAY_RETRY_DELAY_MS = 5000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;
const WS_BROADCAST_INTERVAL_MS = 2000;
const CPU_SAMPLE_INTERVAL_MS = 100;
const PORT = 3001;

// ──────────────────────────────────────────────
// FFmpeg Output Parser
// ──────────────────────────────────────────────

/**
 * Parses FFmpeg progress lines from stderr like:
 * frame=  120 fps= 30 q=28.0 size=    1024kB time=00:00:04.00 bitrate=2097.15kbits/s speed=1.00x
 */
function parseFFmpegLine(line: string): Partial<FFmpegStats> {
  const regex =
    /frame=\s*(\d+)\s*fps=\s*([\d.]+)\s*.*size=\s*(\S+)\s*time=(\S+)\s*bitrate=\s*([\d.]+)\S*\s*speed=\s*([\d.]+)x/;
  const match = line.match(regex);
  if (!match) return {};

  return {
    frame: parseInt(match[1], 10),
    fps: parseFloat(match[2]),
    size: parseSizeToBytes(match[3]),
    time: parseTimeToSeconds(match[4]),
    bitrate: parseFloat(match[5]),
    speed: parseFloat(match[6]),
  };
}

function parseSizeToBytes(sizeStr: string): number {
  const num = parseFloat(sizeStr);
  if (sizeStr.endsWith("kB")) return num * 1024;
  if (sizeStr.endsWith("MB")) return num * 1024 * 1024;
  if (sizeStr.endsWith("GB")) return num * 1024 * 1024 * 1024;
  if (sizeStr.endsWith("TB")) return num * 1024 * 1024 * 1024 * 1024;
  return num;
}

function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(":");
  if (parts.length !== 3) return 0;
  const h = parseFloat(parts[0]);
  const m = parseFloat(parts[1]);
  const s = parseFloat(parts[2]);
  return h * 3600 + m * 60 + s;
}

// ──────────────────────────────────────────────
// Process Stats (from /proc)
// ──────────────────────────────────────────────

function getProcessStats(pid: number): { cpuPercent: number; memoryMB: number } {
  try {
    // Read /proc/<pid>/statm for memory (in pages, typically 4096 bytes per page)
    const statmPath = `/proc/${pid}/statm`;
    if (existsSync(statmPath)) {
      const statmData = readFileSync(statmPath, "utf-8").trim().split(/\s+/);
      const residentPages = parseInt(statmData[1], 10);
      const pageSize = 4096;
      const memoryMB = (residentPages * pageSize) / (1024 * 1024);
      return { cpuPercent: 0, memoryMB };
    }
  } catch {
    // Process might have exited
  }
  return { cpuPercent: 0, memoryMB: 0 };
}

// ──────────────────────────────────────────────
// System Stats Reader
// ──────────────────────────────────────────────

let lastCpuSample: { idle: number; total: number } | null = null;

function sampleCpu(): { idle: number; total: number } {
  try {
    const statData = readFileSync("/proc/stat", "utf-8");
    const cpuLine = statData.split("\n")[0]; // "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
    const values = cpuLine
      .replace(/^cpu\s+/, "")
      .split(/\s+/)
      .map(Number);
    const idle = values[3] + values[4]; // idle + iowait
    const total = values.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return { idle: 0, total: 0 };
  }
}

function calculateCpuUsage(): number {
  const current = sampleCpu();
  if (!lastCpuSample) {
    lastCpuSample = current;
    return 0;
  }
  const idleDiff = current.idle - lastCpuSample.idle;
  const totalDiff = current.total - lastCpuSample.total;
  lastCpuSample = current;
  if (totalDiff === 0) return 0;
  return Math.max(0, ((totalDiff - idleDiff) / totalDiff) * 100);
}

function getCpuCores(): number {
  try {
    const cpuInfo = readFileSync("/proc/cpuinfo", "utf-8");
    const matches = cpuInfo.match(/processor/g);
    return matches ? matches.length : 1;
  } catch {
    return 1;
  }
}

function getMemoryStats(): { used: number; total: number } {
  try {
    const memInfo = readFileSync("/proc/meminfo", "utf-8");
    const lines = memInfo.split("\n");
    let total = 0;
    let available = 0;
    for (const line of lines) {
      if (line.startsWith("MemTotal:")) {
        total = parseInt(line.split(/\s+/)[1], 10) * 1024;
      }
      if (line.startsWith("MemAvailable:")) {
        available = parseInt(line.split(/\s+/)[1], 10) * 1024;
      }
    }
    return { used: total - available, total };
  } catch {
    return { used: 0, total: 0 };
  }
}

function getDiskStats(): { used: number; total: number } {
  try {
    const output = execSync(`df -h --output=used,size ${PROJECT_DIR} 2>/dev/null || df -h --output=used,size / 2>/dev/null`, {
      encoding: "utf-8",
    });
    const lines = output.trim().split("\n");
    if (lines.length < 2) return { used: 0, total: 0 };
    const parts = lines[1].trim().split(/\s+/);
    const usedStr = parts[0];
    const totalStr = parts[1];
    return {
      used: parseSizeToBytes(usedStr.replace(/[A-Z]/i, "M")),
      total: parseSizeToBytes(totalStr.replace(/[A-Z]/i, "M")),
    };
  } catch {
    return { used: 0, total: 0 };
  }
}

function getNetworkStats(): { rxBytes: number; txBytes: number } {
  try {
    const netDev = readFileSync("/proc/net/dev", "utf-8");
    const lines = netDev.trim().split("\n");
    // Find the first real network interface (skip lo)
    for (const line of lines.slice(2)) {
      const parts = line.trim().split(/[:\s]+/);
      if (parts[0] === "lo") continue;
      const rxBytes = parseInt(parts[1], 10);
      const txBytes = parseInt(parts[9], 10);
      return { rxBytes, txBytes };
    }
  } catch {
    // ignore
  }
  return { rxBytes: 0, txBytes: 0 };
}

async function getSystemStats(): Promise<SystemStats> {
  // First CPU sample to warm up
  sampleCpu();
  await sleep(CPU_SAMPLE_INTERVAL_MS);
  const cpuUsage = calculateCpuUsage();
  const cpuCores = getCpuCores();
  const mem = getMemoryStats();
  const disk = getDiskStats();
  const net = getNetworkStats();

  return {
    cpuUsage: Math.round(cpuUsage * 100) / 100,
    cpuCores,
    memoryUsed: mem.used,
    memoryTotal: mem.total,
    memoryPercent: mem.total > 0 ? Math.round((mem.used / mem.total) * 10000) / 100 : 0,
    diskUsed: disk.used,
    diskTotal: disk.total,
    diskPercent: disk.total > 0 ? Math.round((disk.used / disk.total) * 10000) / 100 : 0,
    networkRxBytes: net.rxBytes,
    networkTxBytes: net.txBytes,
    uptime: process.uptime(),
  };
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyStats(): FFmpegStats {
  return {
    frame: 0,
    fps: 0,
    bitrate: 0,
    time: 0,
    speed: 0,
    size: 0,
    cpuPercent: 0,
    memoryMB: 0,
  };
}

function parseResolution(resolution: string): { width: number; height: number } {
  const [width, height] = resolution.split("x").map(Number);
  return { width: width || 1920, height: height || 1080 };
}

// ──────────────────────────────────────────────
// Playlist Runner
// ──────────────────────────────────────────────

class PlaylistRunner {
  private taskId: string;
  private videos: PlaylistVideo[];
  private primaryRtmp: string;
  private backupRtmp: string | undefined;
  private videoBitrate: number;
  private audioBitrate: number;
  private resolution: string;
  private fps: number;
  private preset: string;
  private loop: boolean;
  private backupVideoPath: string;
  private cookiesPath: string | undefined;
  private manager: ProcessManager;

  private _stopped = false;
  private _currentIndex = 0;
  private _currentVideoId: string | null = null;
  private _currentProcess: ChildProcess | null = null;
  private _currentPid = 0;

  constructor(config: PlaylistStartRequest, manager: ProcessManager) {
    this.taskId = config.taskId;
    this.videos = config.videos;
    this.primaryRtmp = config.primaryRtmp;
    this.backupRtmp = config.backupRtmp;
    this.videoBitrate = config.videoBitrate;
    this.audioBitrate = config.audioBitrate;
    this.resolution = config.resolution;
    this.fps = config.fps;
    this.preset = config.preset;
    this.loop = config.loop;
    this.backupVideoPath = config.backupVideoPath;
    this.cookiesPath = config.cookiesPath;
    this.manager = manager;
  }

  get stopped(): boolean {
    return this._stopped;
  }

  get currentIndex(): number {
    return this._currentIndex;
  }

  get currentVideoId(): string | null {
    return this._currentVideoId;
  }

  /** Signal the runner to stop. Kills the current FFmpeg process. */
  stop(): void {
    this._stopped = true;
    if (this._currentProcess && this._currentProcess.pid) {
      try {
        this._currentProcess.kill("SIGTERM");
      } catch {
        // Process might already be dead
      }
    }
  }

  /** Main run loop — iterates through videos sequentially. */
  async run(): Promise<void> {
    console.log(
      `[playlist] Task ${this.taskId}: Starting playlist runner with ${this.videos.length} video(s), loop=${this.loop}`
    );

    try {
      if (this.videos.length === 0) {
        console.log(`[playlist] Task ${this.taskId}: Empty playlist, falling back to backup video`);
        await this.streamBackup();
        return;
      }

      // Track consecutive failures — if every video in the playlist fails in a row, use backup
      let consecutiveFailures = 0;

      while (!this._stopped) {
        const video = this.videos[this._currentIndex];
        console.log(
          `[playlist] Task ${this.taskId}: Processing video ${this._currentIndex + 1}/${this.videos.length} (id=${video.id})`
        );

        // ── Resolve video file path ──
        let filePath = this.resolveVideoPath(video);
        console.log(`[playlist] Task ${this.taskId}: Resolved path: ${filePath || 'null'} (localPath=${video.localPath || 'none'}, youtubeId=${video.youtubeId || 'none'})`);

        if (!filePath || !existsSync(filePath)) {
          if (video.youtubeId || video.sourceUrl) {
            console.log(`[playlist] Task ${this.taskId}: Video ${video.id} not cached locally, downloading...`);
            const downloadStart = Date.now();
            filePath = this.downloadVideo(video);
            const downloadTime = ((Date.now() - downloadStart) / 1000).toFixed(1);
            console.log(`[playlist] Task ${this.taskId}: Download attempt took ${downloadTime}s, result: ${filePath ? 'SUCCESS' : 'FAILED'}`);
          } else {
            console.warn(`[playlist] Task ${this.taskId}: Video ${video.id} has no localPath, youtubeId, or sourceUrl — cannot download`);
          }
        }

        if (!filePath || !existsSync(filePath)) {
          console.warn(`[playlist] Task ${this.taskId}: Video ${video.id} unavailable after all attempts, skipping (consecutiveFailures: ${consecutiveFailures + 1}/${this.videos.length})`);
          consecutiveFailures++;

          if (consecutiveFailures >= this.videos.length) {
            console.warn(
              `[playlist] Task ${this.taskId}: All ${this.videos.length} video(s) failed consecutively, falling back to backup`
            );
            await this.streamBackup();
            this._stopped = true;
            break;
          }

          // Advance to next video
          this._currentIndex = (this._currentIndex + 1) % this.videos.length;
          continue;
        }

        // Video resolved successfully — stream it
        consecutiveFailures = 0;
        this._currentVideoId = video.id;

        this.manager.updatePlaylistState(this.taskId, {
          currentVideoIndex: this._currentIndex,
          currentVideoId: video.id,
          currentFilePath: filePath,
        });

        console.log(`[playlist] Task ${this.taskId}: Streaming video ${video.id} from ${filePath}`);
        // Log file size for diagnostics
        try {
          const fstat = statSync(filePath);
          console.log(`[playlist] Task ${this.taskId}:   File size: ${(fstat.size / 1024 / 1024).toFixed(1)}MB`);
        } catch { /* ignore */ }
        const exitCode = await this.streamFile(filePath);

        if (this._stopped) {
          console.log(`[playlist] Task ${this.taskId}: Runner stopped by request`);
          break;
        }

        console.log(`[playlist] Task ${this.taskId}: Video ${video.id} exited with code ${exitCode}`);

        // ── Decide next action ──
        if (exitCode === 0) {
          // Normal completion — video finished playing
          consecutiveFailures = 0;
          const isLast = this._currentIndex >= this.videos.length - 1;
          if (isLast) {
            if (this.loop) {
              console.log(`[playlist] Task ${this.taskId}: End of playlist, looping back to start`);
              this._currentIndex = 0;
            } else {
              console.log(`[playlist] Task ${this.taskId}: Playlist completed (no loop)`);
              this._stopped = true;
            }
          } else {
            this._currentIndex++;
          }
        } else {
          // Crash or error — try next video
          console.warn(`[playlist] Task ${this.taskId}: Video ${video.id} crashed (code ${exitCode})`);
          consecutiveFailures++;

          if (consecutiveFailures >= this.videos.length) {
            console.warn(
              `[playlist] Task ${this.taskId}: All ${this.videos.length} video(s) failed consecutively, falling back to backup`
            );
            await this.streamBackup();
            this._stopped = true;
            break;
          }

          const isLast = this._currentIndex >= this.videos.length - 1;
          if (isLast) {
            if (this.loop) {
              this._currentIndex = 0;
            } else {
              console.warn(
                `[playlist] Task ${this.taskId}: Last video crashed and no loop, falling back to backup`
              );
              await this.streamBackup();
              this._stopped = true;
            }
          } else {
            this._currentIndex++;
          }
        }
      }
    } catch (err: any) {
      console.error(`[playlist] Task ${this.taskId}: Unexpected error:`, err.message);
    } finally {
      this.cleanup();
    }
  }

  // ── Private Helpers ──────────────────────────

  /** Try to find an existing local file for the video. */
  private resolveVideoPath(video: PlaylistVideo): string | null {
    // Check 1: localPath from DB
    if (video.localPath) {
      if (existsSync(video.localPath)) {
        return video.localPath;
      }
      console.log(`[playlist] Task ${this.taskId}: localPath exists in DB but file missing: ${video.localPath}`);
    }
    // Check 2: cached download path based on youtubeId
    if (video.youtubeId) {
      const cached = `${VIDEOS_DIR}/${video.youtubeId}.mp4`;
      if (existsSync(cached)) {
        console.log(`[playlist] Task ${this.taskId}: Found cached file: ${cached}`);
        return cached;
      }
      console.log(`[playlist] Task ${this.taskId}: No cached file for youtubeId=${video.youtubeId} at ${cached}`);
    }
    return null;
  }

  /** Download a video using yt-dlp. Returns the file path on success, null on failure. */
  private downloadVideo(video: PlaylistVideo): string | null {
    const url =
      video.sourceUrl || (video.youtubeId ? `https://www.youtube.com/watch?v=${video.youtubeId}` : null);
    if (!url) {
      console.error(`[playlist] Task ${this.taskId}: Cannot download video ${video.id} — no URL and no youtubeId`);
      return null;
    }

    const filename = video.youtubeId || video.id;
    const outputPath = `${VIDEOS_DIR}/${filename}.mp4`;
    const downloadDir = VIDEOS_DIR;

    if (!existsSync(downloadDir)) {
      mkdirSync(downloadDir, { recursive: true });
    }

    // Skip if file already exists from a previous download
    if (existsSync(outputPath)) {
      console.log(`[playlist] Task ${this.taskId}: File already exists, skipping download: ${outputPath}`);
      return outputPath;
    }

    // Check cookies
    const hasCookies = this.cookiesPath && existsSync(this.cookiesPath);
    console.log(`[playlist] Task ${this.taskId}: Starting yt-dlp download...`);
    console.log(`[playlist]   Video ID: ${video.id}, Filename: ${filename}`);
    console.log(`[playlist]   URL: ${url}`);
    console.log(`[playlist]   Output: ${outputPath}`);
    console.log(`[playlist]   Cookies: ${hasCookies ? 'YES (' + this.cookiesPath + ')' : 'NO'}`);

    // Use unified yt-dlp module (auto-injects --js-runtimes node, cookies, etc.)
    const result = downloadSync(url, { outputPath });

    console.log(`[playlist] Task ${this.taskId}: yt-dlp exited with code ${result.exitCode}`);
    console.log(`[playlist]   Signal: ${result.error?.includes('SIG') ? result.error : 'none'}`);
    console.log(`[playlist]   Stdout length: ${result.stdout?.length || 0} chars`);
    console.log(`[playlist]   Stderr length: ${result.stderr?.length || 0} chars`);

    if (result.error) {
      console.error(`[playlist] Task ${this.taskId}: Spawn error: ${result.error}`);
      if (result.error.includes('ETIMEOUT') || result.error.includes('timed out')) {
        console.error(`[playlist] Task ${this.taskId}: ⚠️  DOWNLOAD TIMED OUT (5 min) — video may be too large`);
      }
    }

    // Log stdout tail (last 5 lines of progress)
    if (result.stdout) {
      const stdoutLines = result.stdout.trim().split('\n');
      const tailLines = stdoutLines.slice(-5);
      console.log(`[playlist] Task ${this.taskId}: yt-dlp stdout tail:`);
      for (const line of tailLines) {
        console.log(`[playlist]   > ${line}`);
      }
    }

    // Log stderr (errors/warnings)
    if (result.stderr) {
      const stderrLines = result.stderr.trim().split('\n');
      // Filter ERROR lines for concise logging
      const errorLines = stderrLines.filter(l => l.includes('ERROR:') || l.includes('WARNING:') || l.includes('error'));
      if (errorLines.length > 0) {
        console.error(`[playlist] Task ${this.taskId}: yt-dlp errors/warnings:`);
        for (const line of errorLines) {
          console.error(`[playlist]   > ${line}`);
        }
      }
      // Always log the last 3 lines of stderr regardless
      const stderrTail = stderrLines.slice(-3);
      console.log(`[playlist] Task ${this.taskId}: yt-dlp stderr tail:`);
      for (const line of stderrTail) {
        console.log(`[playlist]   > ${line}`);
      }
    }

    // Check exit code
    if (!result.success) {
      console.error(
        `[playlist] Task ${this.taskId}: ❌ DOWNLOAD FAILED for video ${video.id} (youtubeId=${video.youtubeId || 'none'})`
      );
      console.error(`[playlist]   Exit code: ${result.exitCode}`);

      // Parse common error types
      const stderr = result.stderr || '';
      if (stderr.includes('Sign in to confirm') || stderr.includes('sign in to confirm')) {
        console.error(`[playlist]   Reason: YouTube bot detection — requires cookies`);
      } else if (stderr.includes('age') && stderr.includes('sign in')) {
        console.error(`[playlist]   Reason: Age-restricted video — requires cookies`);
      } else if (stderr.includes('Video unavailable')) {
        console.error(`[playlist]   Reason: Video unavailable (deleted/private)`);
      } else if (stderr.includes('HTTP Error 429')) {
        console.error(`[playlist]   Reason: Rate limited (429) — try again later`);
      } else if (stderr.includes('HTTP Error 403')) {
        console.error(`[playlist]   Reason: Access denied (403) — may need cookies`);
      } else if (result.error?.includes('timed out')) {
        console.error(`[playlist]   Reason: Download timed out (5 min limit)`);
      } else {
        console.error(`[playlist]   Reason: Unknown — check stderr above`);
      }

      return null;
    }

    // Check if file was actually created
    if (existsSync(outputPath)) {
      const fileStat = statSync(outputPath);
      const sizeMB = (fileStat.size / 1024 / 1024).toFixed(1);
      console.log(
        `[playlist] Task ${this.taskId}: ✅ Download SUCCESS: ${outputPath} (${sizeMB}MB)`
      );
      return outputPath;
    }

    // Exit code 0 but no file — yt-dlp may have saved with different name
    console.error(`[playlist] Task ${this.taskId}: ❌ yt-dlp exited 0 but file not found at ${outputPath}`);
    console.error(`[playlist]   Expected path: ${outputPath}`);

    // Check if a similar file exists (yt-dlp may use different extension)
    try {
      const dirFiles = readdirSync(downloadDir);
      const similarFiles = dirFiles.filter(f => f.startsWith(filename));
      if (similarFiles.length > 0) {
        console.error(`[playlist]   Found similar files in download dir: ${similarFiles.join(', ')}`);
        // Try to use the first matching file
        const actualPath = join(downloadDir, similarFiles[0]);
        console.log(`[playlist]   Using: ${actualPath}`);
        return actualPath;
      }
    } catch {
      // ignore
    }

    return null;
  }

  /** Stream a single video file using FFmpeg. Returns the exit code. */
  private streamFile(filePath: string): Promise<number> {
    return new Promise<number>((resolve) => {
      const { width, height } = parseResolution(this.resolution);
      const args: string[] = [
        "-hide_banner",
        "-loglevel",
        "info",
        "-re",
        "-stream_loop",
        "-1",
        "-i",
        filePath,
        "-c:v",
        "libx264",
        "-preset",
        this.preset,
        "-b:v",
        `${this.videoBitrate}k`,
        "-maxrate",
        `${Math.round(this.videoBitrate * 1.5)}k`,
        "-bufsize",
        `${this.videoBitrate * 2}k`,
        "-pix_fmt",
        "yuv420p",
        "-g",
        `${this.fps * 2}`,
        "-r",
        `${this.fps}`,
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
        "-c:a",
        "aac",
        "-b:a",
        `${this.audioBitrate}k`,
        "-ar",
        "44100",
        "-ac",
        "2",
      ];

      // Output
      if (this.backupRtmp) {
        args.push("-f", "tee", `[f=flv]${this.primaryRtmp}|[f=flv]${this.backupRtmp}`);
      } else {
        args.push("-f", "flv", this.primaryRtmp);
      }

      // Spawn FFmpeg
      let proc: ChildProcess;
      try {
        proc = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (err: any) {
        console.error(`[playlist] Task ${this.taskId}: Failed to spawn FFmpeg: ${err.message}`);
        resolve(-1);
        return;
      }

      if (!proc.pid) {
        console.error(`[playlist] Task ${this.taskId}: FFmpeg did not start (no PID)`);
        resolve(-1);
        return;
      }

      this._currentProcess = proc;
      this._currentPid = proc.pid;

      // Update the process entry with the new FFmpeg process
      this.manager.updatePlaylistProcess(this.taskId, proc);

      // ── Wire up stderr parsing for stats ──
      if (proc.stderr) {
        let buffer = "";
        proc.stderr.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const entry = this.manager.getProcessEntry(this.taskId);
            if (!entry) continue;
            entry.lastOutput = trimmed;

            // Store in rolling log buffer
            entry.logs.push(trimmed);
            if (entry.logs.length > 2000) entry.logs.shift();
            entry.logSeq++;

            const parsed = parseFFmpegLine(trimmed);
            if (parsed.frame !== undefined) {
              entry.stats.frame = parsed.frame || entry.stats.frame;
              entry.stats.fps = parsed.fps || entry.stats.fps;
              entry.stats.bitrate = parsed.bitrate || entry.stats.bitrate;
              entry.stats.time = parsed.time || entry.stats.time;
              entry.stats.speed = parsed.speed || entry.stats.speed;
              entry.stats.size = parsed.size || entry.stats.size;
            }
          }
        });

        // Keep last 10 stderr lines for crash diagnostics
        const stderrHistory: string[] = [];
        proc.stderr.on("data", (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n')) {
            const trimmed = line.trim();
            if (trimmed) {
              stderrHistory.push(trimmed);
              if (stderrHistory.length > 10) stderrHistory.shift();
            }
          }
        });

        proc.on("exit", (code) => {
          if (code !== 0 && code !== null) {
            console.error(`[playlist] Task ${this.taskId}: FFmpeg crash diagnostics (exit code ${code}):`);
            console.error(`[playlist]   Input file: ${filePath}`);
            console.error(`[playlist]   Resolution: ${this.resolution}, FPS: ${this.fps}, Preset: ${this.preset}`);
            console.error(`[playlist]   Bitrate: v=${this.videoBitrate}k, a=${this.audioBitrate}k`);
            console.error(`[playlist]   RTMP: ${this.primaryRtmp}${this.backupRtmp ? ' + ' + this.backupRtmp : ''}`);
            console.error(`[playlist]   Last stderr lines:`);
            for (const line of stderrHistory) {
              console.error(`[playlist]     ${line}`);
            }
          }
        });
      }

      // ── Track stdout for byte count ──
      if (proc.stdout) {
        proc.stdout.on("data", (chunk: Buffer) => {
          const entry = this.manager.getProcessEntry(this.taskId);
          if (entry) entry.bytesWritten += chunk.length;
        });
      }

      proc.on("exit", (code) => {
        console.log(`[playlist] Task ${this.taskId}: FFmpeg (PID ${proc.pid}) exited with code ${code}`);
        this._currentProcess = null;
        this._currentPid = 0;
        resolve(code || 0);
      });

      proc.on("error", (err) => {
        console.error(`[playlist] Task ${this.taskId}: FFmpeg process error: ${err.message}`);
        this._currentProcess = null;
        this._currentPid = 0;
        resolve(-1);
      });
    });
  }

  /** Stream the backup video in infinite loop. */
  private async streamBackup(): Promise<void> {
    if (!existsSync(this.backupVideoPath)) {
      console.error(`[playlist] Task ${this.taskId}: Backup video not found at ${this.backupVideoPath}`);
      console.error(
        `[playlist] Task ${this.taskId}: Cannot stream backup — all videos failed and no backup available`
      );
      return;
    }

    console.log(`[playlist] Task ${this.taskId}: Streaming backup video: ${this.backupVideoPath}`);
    this._currentVideoId = "__backup__";
    this._currentIndex = -1;

    this.manager.updatePlaylistState(this.taskId, {
      currentVideoIndex: -1,
      currentVideoId: "__backup__",
      currentFilePath: this.backupVideoPath,
    });

    // Stream the backup in infinite loop (streamFile already uses -stream_loop -1)
    await this.streamFile(this.backupVideoPath);
  }

  /** Clean up the process entry and runner from the manager. */
  private cleanup(): void {
    this._currentProcess = null;
    this._currentPid = 0;
    this.manager.removePlaylistRunner(this.taskId);
    this.manager.removeProcessEntry(this.taskId);
    console.log(`[playlist] Task ${this.taskId}: Runner cleaned up`);
  }
}

// ──────────────────────────────────────────────
// Process Manager
// ──────────────────────────────────────────────

class ProcessManager {
  private processes: Map<string, FFmpegProcess> = new Map();
  private playlistRunners: Map<string, PlaylistRunner> = new Map();
  private wsClients: Set<{ send: (data: string) => void; subscriptions: Set<string> }> = new Set();

  // ── Stream Management ──────────────────────────

  startStream(req: StreamStartRequest): { success: boolean; pid?: number; taskId: string; error?: string } {
    if (this.processes.has(req.taskId)) {
      return { success: false, taskId: req.taskId, error: "Task already running" };
    }

    const { width, height } = parseResolution(req.resolution);
    const args: string[] = [
      "-hide_banner",
      "-loglevel",
      "info",
      "-re",
    ];

    if (req.loopVideo) {
      args.push("-stream_loop", "-1");
    }

    args.push("-i", req.inputPath);

    // Video encoding
    args.push(
      "-c:v", "libx264",
      "-preset", req.preset,
      "-b:v", `${req.videoBitrate}k`,
      "-maxrate", `${Math.round(req.videoBitrate * 1.5)}k`,
      "-bufsize", `${req.videoBitrate * 2}k`,
      "-pix_fmt", "yuv420p",
      "-g", `${req.fps * 2}`,
      "-r", `${req.fps}`,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
    );

    // Audio encoding
    args.push(
      "-c:a", "aac",
      "-b:a", `${req.audioBitrate}k`,
      "-ar", "44100",
      "-ac", "2"
    );

    // Output
    if (req.backupRtmp) {
      args.push("-f", "tee", `[f=flv]${req.primaryRtmp}|[f=flv]${req.backupRtmp}`);
    } else {
      args.push("-f", "flv", req.primaryRtmp);
    }

    return this.spawnProcess(req.taskId, "stream", args, {
      taskId: req.taskId,
      inputPath: req.inputPath,
      primaryRtmp: req.primaryRtmp,
      backupRtmp: req.backupRtmp,
      videoBitrate: req.videoBitrate,
      audioBitrate: req.audioBitrate,
      resolution: req.resolution,
      fps: req.fps,
      preset: req.preset,
      loopVideo: req.loopVideo,
    });
  }

  // ── Relay Management ───────────────────────────

  async startRelay(req: RelayStartRequest): Promise<{ success: boolean; pid?: number; taskId: string; error?: string }> {
    if (this.processes.has(req.taskId)) {
      return { success: false, taskId: req.taskId, error: "Task already running" };
    }

    // Step 1: Get the real YouTube stream URL via yt-dlp (unified module)
    let streamUrl: string;
    try {
      streamUrl = getStreamUrl(req.sourceUrl, req.sourceQuality || "best");
      if (!streamUrl) {
        return { success: false, taskId: req.taskId, error: "Failed to get stream URL from yt-dlp" };
      }
      console.log(`[relay] Got stream URL: ${streamUrl.substring(0, 80)}...`);
    } catch (err: any) {
      const errMsg = err?.stderr || err?.message || String(err);
      console.error(`[relay] yt-dlp failed:`, errMsg);
      return { success: false, taskId: req.taskId, error: `yt-dlp failed: ${errMsg.substring(0, 200)}` };
    }

    // Step 2: Build FFmpeg relay args
    const teeParts = req.targets.map((t) => `[f=flv]${t.rtmpUrl}${t.streamKey}`).join("|");

    const args = [
      "-hide_banner",
      "-loglevel", "info",
      "-re",
      "-i", streamUrl,
      "-c", "copy",
      "-f", "tee", teeParts,
    ];

    return this.spawnProcess(req.taskId, "relay", args, {
      taskId: req.taskId,
      sourceUrl: req.sourceUrl,
      sourceQuality: req.sourceQuality,
      targets: req.targets,
      streamUrl,
    });
  }

  // ── Playlist Management ────────────────────────

  /**
   * Start a playlist rotation runner.
   * Creates a process entry and fires off the async PlaylistRunner.
   */
  startPlaylist(req: PlaylistStartRequest): { success: boolean; pid?: number; taskId: string; error?: string } {
    if (this.processes.has(req.taskId)) {
      return { success: false, taskId: req.taskId, error: "Task already running" };
    }

    if (!req.taskId || !req.primaryRtmp || !req.videoBitrate || !req.audioBitrate || !req.resolution || !req.fps || !req.preset || !req.backupVideoPath) {
      return { success: false, taskId: req.taskId, error: "Missing required fields: taskId, primaryRtmp, videoBitrate, audioBitrate, resolution, fps, preset, backupVideoPath" };
    }

    // Create the runner
    const runner = new PlaylistRunner(req, this);
    this.playlistRunners.set(req.taskId, runner);

    // Create a placeholder process entry (the runner will update process/pid when it spawns FFmpeg)
    const entry: FFmpegProcess = {
      taskId: req.taskId,
      type: "playlist",
      process: null as unknown as ChildProcess,
      pid: 0,
      startTime: new Date(),
      status: "running",
      stats: emptyStats(),
      config: {
        taskId: req.taskId,
        videos: req.videos,
        primaryRtmp: req.primaryRtmp,
        backupRtmp: req.backupRtmp,
        videoBitrate: req.videoBitrate,
        audioBitrate: req.audioBitrate,
        resolution: req.resolution,
        fps: req.fps,
        preset: req.preset,
        loop: req.loop,
        backupVideoPath: req.backupVideoPath,
        cookiesPath: req.cookiesPath,
        currentVideoIndex: 0,
        currentVideoId: null as string | null,
        currentFilePath: null as string | null,
      },
      retryCount: 0,
      lastOutput: "",
      bytesWritten: 0,
    };

    this.processes.set(req.taskId, entry);

    // Start the runner (fire and forget — errors are caught internally)
    runner.run().catch((err) => {
      console.error(`[playlist] Task ${req.taskId}: Runner fatal error:`, err.message);
    });

    console.log(`[playlist] Task ${req.taskId}: Playlist runner started with ${req.videos.length} video(s)`);

    return { success: true, taskId: req.taskId };
  }

  // ── Internal Playlist Helpers ─────────────────

  /** Get a mutable reference to a process entry (used by PlaylistRunner for stats updates). */
  getProcessEntry(taskId: string): FFmpegProcess | undefined {
    return this.processes.get(taskId);
  }

  /** Update the FFmpeg process reference in a playlist entry (called when switching videos). */
  updatePlaylistProcess(taskId: string, proc: ChildProcess): void {
    const entry = this.processes.get(taskId);
    if (entry) {
      entry.process = proc;
      entry.pid = proc.pid || 0;
      entry.startTime = new Date();
      entry.stats = emptyStats();
      entry.bytesWritten = 0;
      entry.status = "running";
    }
  }

  /** Update the playlist state in the config (current video index, id, file path). */
  updatePlaylistState(taskId: string, state: { currentVideoIndex: number; currentVideoId: string; currentFilePath: string }): void {
    const entry = this.processes.get(taskId);
    if (entry) {
      entry.config = { ...entry.config, ...state };
    }
  }

  /** Remove a process entry from the map (called by PlaylistRunner on cleanup). */
  removeProcessEntry(taskId: string): void {
    this.processes.delete(taskId);
  }

  /** Remove a playlist runner from the tracking map. */
  removePlaylistRunner(taskId: string): void {
    this.playlistRunners.delete(taskId);
  }

  // ── Process Spawning ───────────────────────────

  private spawnProcess(
    taskId: string,
    type: "stream" | "relay",
    args: string[],
    config: Record<string, unknown>
  ): { success: boolean; pid?: number; taskId: string; error?: string } {
    console.log(`[${type}] Spawning FFmpeg for task ${taskId}`);
    console.log(`[${type}] Args: ${args.join(" ")}`);

    const spawnOptions: SpawnOptions = {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false, // We manage process groups ourselves
    };

    let proc: ChildProcess;
    try {
      proc = spawn(FFMPEG_PATH, args, spawnOptions);
    } catch (err: any) {
      console.error(`[${type}] Failed to spawn FFmpeg:`, err.message);
      return { success: false, taskId, error: `Failed to spawn FFmpeg: ${err.message}` };
    }

    if (!proc.pid) {
      return { success: false, taskId, error: "FFmpeg process did not start (no PID)" };
    }

    const entry: FFmpegProcess = {
      taskId,
      type,
      process: proc,
      pid: proc.pid,
      startTime: new Date(),
      status: "running",
      stats: emptyStats(),
      config,
      retryCount: 0,
      lastOutput: "",
      bytesWritten: 0,
      logs: [],
      logSeq: 0,
    };

    const MAX_LOG_LINES = 2000;

    this.processes.set(taskId, entry);
    console.log(`[${type}] Task ${taskId} started with PID ${proc.pid}`);

    // ── Wire up stderr parsing ──
    if (proc.stderr) {
      let buffer = "";
      proc.stderr.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          entry.lastOutput = trimmed;

          // Store in rolling log buffer
          entry.logs.push(trimmed);
          if (entry.logs.length > MAX_LOG_LINES) entry.logs.shift();
          entry.logSeq++;

          // Parse FFmpeg stats
          const parsed = parseFFmpegLine(trimmed);
          if (parsed.frame !== undefined) {
            entry.stats.frame = parsed.frame || entry.stats.frame;
            entry.stats.fps = parsed.fps || entry.stats.fps;
            entry.stats.bitrate = parsed.bitrate || entry.stats.bitrate;
            entry.stats.time = parsed.time || entry.stats.time;
            entry.stats.speed = parsed.speed || entry.stats.speed;
            entry.stats.size = parsed.size || entry.stats.size;
          }
        }
      });
    }

    // ── Track stdout (byte count) ──
    if (proc.stdout) {
      proc.stdout.on("data", (chunk: Buffer) => {
        entry.bytesWritten += chunk.length;
      });
    }

    // ── Handle process exit ──
    proc.on("exit", (code, signal) => {
      const exitInfo = `code=${code} signal=${signal}`;
      console.log(`[${type}] Task ${taskId} (PID ${entry.pid}) exited: ${exitInfo}`);

      if (entry.status === "stopping") {
        entry.status = "stopped";
        return;
      }

      // Process crashed
      entry.status = code === 0 ? "stopped" : "crashed";
      if (code !== 0) {
        console.error(`[${type}] Task ${taskId} crashed: ${exitInfo}`);
        console.error(`[${type}] Last output: ${entry.lastOutput}`);
      }

      // Auto-restart relay tasks
      if (type === "relay" && code !== 0 && entry.retryCount < MAX_RELAY_RETRIES) {
        entry.retryCount++;
        console.log(`[relay] Auto-restarting task ${taskId} (attempt ${entry.retryCount}/${MAX_RELAY_RETRIES}) in ${RELAY_RETRY_DELAY_MS}ms...`);
        setTimeout(() => {
          this.processes.delete(taskId);
          const req = config as unknown as RelayStartRequest;
          this.startRelay(req);
        }, RELAY_RETRY_DELAY_MS);
      }
    });

    proc.on("error", (err) => {
      console.error(`[${type}] Task ${taskId} process error:`, err.message);
      entry.status = "error";
      entry.lastOutput = err.message;
    });

    return { success: true, pid: proc.pid, taskId };
  }

  // ── Stop Process ───────────────────────────────

  async stopProcess(taskId: string): Promise<{
    success: boolean;
    taskId: string;
    duration?: number;
    framesPushed?: number;
    error?: string;
  }> {
    const entry = this.processes.get(taskId);
    if (!entry) {
      return { success: false, taskId, error: "Task not found" };
    }

    // Handle playlist type: signal the runner to stop
    if (entry.type === "playlist") {
      const runner = this.playlistRunners.get(taskId);
      if (runner) {
        runner.stop();
      }

      // Wait briefly for runner to clean up
      await sleep(1500);

      // Force cleanup if runner hasn't cleaned up yet
      if (this.processes.has(taskId)) {
        const duration = (Date.now() - entry.startTime.getTime()) / 1000;
        this.processes.delete(taskId);
        this.playlistRunners.delete(taskId);
        return {
          success: true,
          taskId,
          duration: Math.round(duration * 100) / 100,
          framesPushed: entry.stats.frame,
        };
      }

      this.playlistRunners.delete(taskId);
      return {
        success: true,
        taskId,
        duration: Math.round(((Date.now() - entry.startTime.getTime()) / 1000) * 100) / 100,
        framesPushed: entry.stats.frame,
      };
    }

    // If already stopped/crashed/error, clean up from map and return final stats
    if (entry.status === "stopped" || entry.status === "crashed" || entry.status === "error") {
      const duration = (Date.now() - entry.startTime.getTime()) / 1000;
      this.processes.delete(taskId);
      return {
        success: true,
        taskId,
        duration: Math.round(duration * 100) / 100,
        framesPushed: entry.stats.frame,
      };
    }

    entry.status = "stopping";
    const duration = (Date.now() - entry.startTime.getTime()) / 1000;

    try {
      // Try SIGTERM first
      entry.process.kill("SIGTERM");
      console.log(`[engine] Sent SIGTERM to PID ${entry.pid} (task ${taskId})`);

      // Wait for graceful exit
      const exited = await Promise.race([
        new Promise<boolean>((resolve) => {
          entry.process.on("exit", () => resolve(true));
        }),
        sleep(GRACEFUL_SHUTDOWN_TIMEOUT_MS).then(() => false),
      ]);

      if (!exited) {
        // Force SIGKILL
        try {
          entry.process.kill("SIGKILL");
          console.log(`[engine] Sent SIGKILL to PID ${entry.pid} (task ${taskId})`);
        } catch {
          // Process might already be dead
        }
      }
    } catch (err: any) {
      console.error(`[engine] Error stopping task ${taskId}:`, err.message);
    }

    entry.status = "stopped";
    this.processes.delete(taskId);

    return {
      success: true,
      taskId,
      duration: Math.round(duration * 100) / 100,
      framesPushed: entry.stats.frame,
    };
  }

  // ── List / Get ─────────────────────────────────

  listProcesses(): Array<{
    taskId: string;
    pid: number;
    type: string;
    status: string;
    uptime: number;
    currentFps: number;
    currentBitrate: number;
    framesPushed: number;
    bytesWritten: number;
    cpuPercent: number;
    memoryMB: number;
  }> {
    const result: Array<{
      taskId: string;
      pid: number;
      type: string;
      status: string;
      uptime: number;
      currentFps: number;
      currentBitrate: number;
      framesPushed: number;
      bytesWritten: number;
      cpuPercent: number;
      memoryMB: number;
    }> = [];

    for (const [_, entry] of this.processes) {
      // Get fresh process stats
      const procStats = getProcessStats(entry.pid);
      entry.stats.cpuPercent = procStats.cpuPercent;
      entry.stats.memoryMB = procStats.memoryMB;

      result.push({
        taskId: entry.taskId,
        pid: entry.pid,
        type: entry.type,
        status: entry.status,
        uptime: Math.round(((Date.now() - entry.startTime.getTime()) / 1000) * 100) / 100,
        currentFps: entry.stats.fps,
        currentBitrate: entry.stats.bitrate,
        framesPushed: entry.stats.frame,
        bytesWritten: entry.bytesWritten,
        cpuPercent: entry.stats.cpuPercent,
        memoryMB: entry.stats.memoryMB,
      });
    }

    return result;
  }

  getProcess(taskId: string): (ReturnType<typeof this.listProcesses>[0] & { config: Record<string, unknown>; lastOutput: string; retryCount: number }) | null {
    const entry = this.processes.get(taskId);
    if (!entry) return null;

    const procStats = getProcessStats(entry.pid);
    entry.stats.cpuPercent = procStats.cpuPercent;
    entry.stats.memoryMB = procStats.memoryMB;

    return {
      taskId: entry.taskId,
      pid: entry.pid,
      type: entry.type,
      status: entry.status,
      uptime: Math.round(((Date.now() - entry.startTime.getTime()) / 1000) * 100) / 100,
      currentFps: entry.stats.fps,
      currentBitrate: entry.stats.bitrate,
      framesPushed: entry.stats.frame,
      bytesWritten: entry.bytesWritten,
      cpuPercent: entry.stats.cpuPercent,
      memoryMB: entry.stats.memoryMB,
      config: entry.config,
      lastOutput: entry.lastOutput,
      retryCount: entry.retryCount,
    };
  }

  // ── WebSocket Management ───────────────────────

  addWsClient(ws: { send: (data: string) => void }) {
    const client = { send: ws.send.bind(ws), subscriptions: new Set<string>() };
    this.wsClients.add(client);
    return client;
  }

  removeWsClient(client: { send: (data: string) => void }) {
    this.wsClients.delete(client);
  }

  async broadcastStatus() {
    try {
      const processes = this.listProcesses();
      const systemStats = await getSystemStats();
      const payload = JSON.stringify({ processes, system: systemStats, timestamp: Date.now() });

      for (const client of this.wsClients) {
        try {
          client.send(payload);
        } catch {
          // Client disconnected
          this.wsClients.delete(client);
        }
      }
    } catch (err) {
      // Don't let broadcast errors crash the engine
      console.error("[engine] broadcastStatus error:", err instanceof Error ? err.message : String(err));
    }
  }

  // ── Graceful Shutdown ──────────────────────────

  async shutdownAll(): Promise<void> {
    console.log(`[engine] Shutting down ${this.processes.size} process(es) and ${this.playlistRunners.size} playlist runner(s)...`);

    // Stop playlist runners first
    for (const [, runner] of this.playlistRunners) {
      runner.stop();
    }
    if (this.playlistRunners.size > 0) {
      await sleep(1500);
      // Clean up any remaining playlist entries
      for (const [taskId] of this.playlistRunners) {
        this.processes.delete(taskId);
      }
      this.playlistRunners.clear();
    }

    const tasks = Array.from(this.processes.keys());
    for (const taskId of tasks) {
      await this.stopProcess(taskId);
    }
    console.log("[engine] All processes stopped.");
  }
}

// ──────────────────────────────────────────────
// Standby Fallback Video
// ──────────────────────────────────────────────

async function ensureFallbackVideo(): Promise<void> {
  if (existsSync(FALLBACK_VIDEO_PATH)) {
    console.log(`[init] Fallback video exists: ${FALLBACK_VIDEO_PATH}`);
    return;
  }

  const dir = STANDBY_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  console.log(`[init] Generating fallback video: ${FALLBACK_VIDEO_PATH}`);
  try {
    const args = [
      "-f", "lavfi", "-i", "testsrc=duration=10:size=1920x1080:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
      "-c:v", "libx264", "-preset", "ultrafast",
      "-c:a", "aac",
      "-pix_fmt", "yuv420p",
      "-y",
      FALLBACK_VIDEO_PATH,
    ];
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG_PATH, args, { stdio: "pipe" });
      proc.on("exit", (code) => {
        if (code === 0) {
          console.log(`[init] Fallback video generated successfully`);
          resolve();
        } else {
          console.error(`[init] Failed to generate fallback video (exit code ${code})`);
          resolve(); // Don't block startup
        }
      });
      proc.on("error", (err) => {
        console.error(`[init] FFmpeg spawn error for fallback:`, err.message);
        resolve(); // Don't block startup
      });
      // Drain stdout/stderr
      proc.stdout?.on("data", () => {});
      proc.stderr?.on("data", () => {});
    });
  } catch (err: any) {
    console.error(`[init] Error generating fallback video:`, err.message);
  }
}

// ──────────────────────────────────────────────
// HTTP JSON Response Helpers
// ──────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function parseBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

// ──────────────────────────────────────────────
// Main Server
// ──────────────────────────────────────────────

const manager = new ProcessManager();

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // ── Health Check ──────────────────────────────
  if (path === "/health" && req.method === "GET") {
    return jsonResponse({
      status: "ok",
      service: "stream-engine",
      version: "1.0.0",
      uptime: Math.round(process.uptime() * 100) / 100,
      processes: manager.listProcesses().length,
      timestamp: Date.now(),
    });
  }

  // ── Stream: Start ────────────────────────────
  if (path === "/api/stream/start" && req.method === "POST") {
    try {
      const body = await parseBody<StreamStartRequest>(req);

      // Validate required fields
      if (!body.taskId || !body.inputPath || !body.primaryRtmp || !body.videoBitrate || !body.audioBitrate || !body.resolution || !body.fps || !body.preset) {
        return jsonResponse({ success: false, error: "Missing required fields: taskId, inputPath, primaryRtmp, videoBitrate, audioBitrate, resolution, fps, preset" }, 400);
      }

      // Validate input file exists
      if (!existsSync(body.inputPath)) {
        return jsonResponse({ success: false, error: `Input file not found: ${body.inputPath}` }, 400);
      }

      const result = manager.startStream(body);
      return jsonResponse(result, result.success ? 200 : 409);
    } catch (err: any) {
      return jsonResponse({ success: false, error: `Invalid request: ${err.message}` }, 400);
    }
  }

  // ── Stream: Stop ─────────────────────────────
  if (path === "/api/stream/stop" && req.method === "POST") {
    try {
      const body = await parseBody<StopRequest>(req);
      if (!body.taskId) {
        return jsonResponse({ success: false, error: "Missing required field: taskId" }, 400);
      }
      const result = await manager.stopProcess(body.taskId);
      return jsonResponse(result, result.success ? 200 : 404);
    } catch (err: any) {
      return jsonResponse({ success: false, error: `Invalid request: ${err.message}` }, 400);
    }
  }

  // ── Relay: Start ─────────────────────────────
  if (path === "/api/relay/start" && req.method === "POST") {
    try {
      const body = await parseBody<RelayStartRequest>(req);

      if (!body.taskId || !body.sourceUrl || !body.targets || body.targets.length === 0) {
        return jsonResponse({ success: false, error: "Missing required fields: taskId, sourceUrl, targets (at least one)" }, 400);
      }

      const result = await manager.startRelay(body);
      return jsonResponse(result, result.success ? 200 : 409);
    } catch (err: any) {
      return jsonResponse({ success: false, error: `Invalid request: ${err.message}` }, 400);
    }
  }

  // ── Relay: Stop ──────────────────────────────
  if (path === "/api/relay/stop" && req.method === "POST") {
    try {
      const body = await parseBody<StopRequest>(req);
      if (!body.taskId) {
        return jsonResponse({ success: false, error: "Missing required field: taskId" }, 400);
      }
      const result = await manager.stopProcess(body.taskId);
      return jsonResponse(result, result.success ? 200 : 404);
    } catch (err: any) {
      return jsonResponse({ success: false, error: `Invalid request: ${err.message}` }, 400);
    }
  }

  // ── Playlist: Start ───────────────────────────
  if (path === "/api/playlist/start" && req.method === "POST") {
    try {
      const body = await parseBody<PlaylistStartRequest>(req);
      const result = manager.startPlaylist(body);
      return jsonResponse(result, result.success ? 200 : 409);
    } catch (err: any) {
      return jsonResponse({ success: false, error: `Invalid request: ${err.message}` }, 400);
    }
  }

  // ── Playlist: Stop ────────────────────────────
  if (path === "/api/playlist/stop" && req.method === "POST") {
    try {
      const body = await parseBody<StopRequest>(req);
      if (!body.taskId) {
        return jsonResponse({ success: false, error: "Missing required field: taskId" }, 400);
      }
      const result = await manager.stopProcess(body.taskId);
      return jsonResponse(result, result.success ? 200 : 404);
    } catch (err: any) {
      return jsonResponse({ success: false, error: `Invalid request: ${err.message}` }, 400);
    }
  }

  // ── Processes: List ──────────────────────────
  if (path === "/api/processes" && req.method === "GET") {
    return jsonResponse({ processes: manager.listProcesses() });
  }

  // ── Processes: Get Single ────────────────────
  const processMatch = path.match(/^\/api\/processes\/([a-zA-Z0-9_-]+)$/);
  if (processMatch && req.method === "GET") {
    const taskId = processMatch[1];
    const proc = manager.getProcess(taskId);
    if (!proc) {
      return jsonResponse({ error: "Process not found", taskId }, 404);
    }
    return jsonResponse(proc);
  }

  // ── Processes: Get Output Logs ─────────────────
  const outputMatch = path.match(/^\/api\/processes\/([a-zA-Z0-9_-]+)\/output$/);
  if (outputMatch && req.method === "GET") {
    const taskId = outputMatch[1];
    // Use getProcessEntry() which returns the raw FFmpegProcess with logs/logSeq fields
    const entry = manager.getProcessEntry(taskId);
    if (!entry) {
      return jsonResponse({ error: "Process not found", taskId, data: [] }, 404);
    }
    const sp = new URL(req.url).searchParams;
    const since = parseInt(sp.get("since") || "0", 10);
    const limit = parseInt(sp.get("limit") || "200", 10);
    const logs = (entry.logs || []).slice(since, since + limit);
    return jsonResponse({ data: logs, seq: entry.logSeq || 0 });
  }

  // ── System Stats ─────────────────────────────
  if (path === "/api/system" && req.method === "GET") {
    const stats = await getSystemStats();
    return jsonResponse(stats);
  }

  // ── CORS preflight ───────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // ── 404 ──────────────────────────────────────
  return jsonResponse({ error: "Not found", path }, 404);
}

// ──────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────

async function main() {
  console.log("=== FFmpeg Stream Engine v1.0.0 ===");
  console.log(`FFmpeg: ${FFMPEG_PATH}`);
  console.log(`yt-dlp: ${YTDL_PATH}`);

  // Verify tools
  try {
    const ffmpegVersion = execSync(`"${FFMPEG_PATH}" -version 2>&1 | head -1`, { encoding: "utf-8" }).trim();
    console.log(`FFmpeg version: ${ffmpegVersion}`);
  } catch {
    console.warn(`WARNING: FFmpeg not found at ${FFMPEG_PATH}`);
  }

  try {
    execSync(`"${YTDL_PATH}" --version`, { encoding: "utf-8" });
    console.log("yt-dlp: available");
  } catch {
    console.warn(`WARNING: yt-dlp not found at ${YTDL_PATH}`);
  }

  // Ensure fallback video exists
  await ensureFallbackVideo();

  // Start WebSocket broadcast interval
  const broadcastInterval = setInterval(() => {
    manager.broadcastStatus().catch(() => {});
  }, WS_BROADCAST_INTERVAL_MS);

  // Keep process alive — prevent Bun from exiting when stdin closes (nohup/daemon mode)
  process.stdin?.resume();
  process.stdin?.on("error", () => {}); // Ignore stdin errors in daemon mode

  // Catch unhandled rejections to prevent silent crashes
  process.on("unhandledRejection", (reason) => {
    console.error("[engine] Unhandled promise rejection:", reason);
  });

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[engine] Received ${signal}, shutting down...`);
    clearInterval(broadcastInterval);
    await manager.shutdownAll();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Start server using Bun.serve
  const server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    fetch: async (req, server) => {
      // Handle WebSocket upgrade on /ws
      const url = new URL(req.url);
      if (url.pathname === "/ws" && server.upgrade(req)) {
        return; // Upgrade handled
      }

      return handleRequest(req);
    },
    websocket: {
      open(ws) {
        const client = manager.addWsClient(ws);
        console.log(`[ws] Client connected (${manager["wsClients"].size} total)`);
      },
      message(ws, message) {
        // Handle subscription messages
        try {
          const data = JSON.parse(message as string);
          if (data.action === "subscribe" && data.taskId) {
            console.log(`[ws] Client subscribed to task: ${data.taskId}`);
          } else if (data.action === "unsubscribe" && data.taskId) {
            console.log(`[ws] Client unsubscribed from task: ${data.taskId}`);
          }
        } catch {
          // Ignore non-JSON messages
        }
      },
      close(ws) {
        // Note: Bun WebSocket close doesn't give us the same reference
        console.log(`[ws] Client disconnected`);
      },
      drain(ws) {
        // Handle backpressure
      },
    },
  });

  console.log(`\n🚀 Stream Engine running on http://0.0.0.0:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   Fallback video: ${existsSync(FALLBACK_VIDEO_PATH) ? "✓ ready" : "✗ not generated"}`);
  console.log("");
}

main().catch((err) => {
  console.error("Failed to start stream engine:", err);
  process.exit(1);
});
