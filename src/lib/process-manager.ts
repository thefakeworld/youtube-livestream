/**
 * ProcessManager - 真实的进程生命周期管理
 * 追踪所有 FFmpeg 子进程，支持启动/停止/健康检查
 */
import { spawn, type ChildProcess } from "child_process";
import { appendFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { kill } from "process";
import { VIDEOS_DIR, LOG_DIR, FFMPEG_PATH, COOKIES_PATH } from '@/lib/paths';
import { YT_DLP_PATH, spawnDownload as ytDlpSpawn } from '@/lib/yt-dlp';

export interface ManagedProcess {
  pid: number;
  type: "stream" | "relay" | "download";
  taskId: string;
  child: ChildProcess;
  startedAt: Date;
  cmd: string;
  // FFmpeg 实时统计（从 stderr 解析）
  stats: {
    fps: number;
    bitrate: number;
    speed: number;
    frame: number;
    time: string;
    size: number;
  };
  // yt-dlp 下载进度
  downloadProgress?: {
    percent: number;
    speed: string;
    eta: string;
    downloadedBytes: number;
    totalBytes: number;
  };
  logs: string[];
}

class ProcessManagerSingleton {
  private processes: Map<string, ManagedProcess> = new Map();
  private videoDir: string;
  private logDir: string;
  private ffmpegPath: string;
  private cookiesPath: string;

  constructor() {
    this.videoDir = VIDEOS_DIR;
    this.logDir = LOG_DIR;
    this.ffmpegPath = FFMPEG_PATH;
    this.cookiesPath = COOKIES_PATH;

    // 启动时恢复：扫描日志目录中残留的 pid 记录
    this._recoverProcesses();
  }

  get paths() {
    return {
      videoDir: this.videoDir,
      logDir: this.logDir,
      ffmpegPath: this.ffmpegPath,
    };
  }

  // ==================== 进程启动 ====================

  /**
   * 启动 FFmpeg 推流进程（视频文件 -> RTMP）
   */
  startStream(opts: {
    taskId: string;
    inputPath: string;
    primaryRtmp: string;
    backupRtmp?: string;
    videoBitrate: number;
    audioBitrate: number;
    resolution: string;
    fps: number;
    preset: string;
  }): ManagedProcess {
    const { taskId, inputPath, primaryRtmp, backupRtmp, videoBitrate, audioBitrate, resolution, fps, preset } = opts;

    // 验证输入文件
    if (!existsSync(inputPath)) {
      throw new Error(`输入文件不存在: ${inputPath}`);
    }

    // 构建双路输出 FFmpeg 命令
    const args = [
      "-hide_banner", "-loglevel", "warning",
      "-re",                                 // 按帧率读取（模拟实时流）
      "-stream_loop", "-1",                  // 无限循环播放
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", preset,
      "-b:v", `${videoBitrate}k`,
      "-maxrate", `${Math.round(videoBitrate * 1.5)}k`,
      "-bufsize", `${videoBitrate * 2}k`,
      "-pix_fmt", "yuv420p",
      "-g", String(fps * 2),                 // 关键帧间隔
      "-keyint_min", String(fps),
      "-c:a", "aac",
      "-b:a", `${audioBitrate}k`,
      "-ar", "44100",
      "-ac", "2",
      "-f", "flv",
      primaryRtmp,
    ];

    // 备用推流地址
    if (backupRtmp) {
      args.push(
        "-c:v", "copy", "-c:a", "copy",
        "-f", "flv",
        backupRtmp,
      );
    }

    return this._spawnFFmpeg(taskId, "stream", args);
  }

  /**
   * 启动 FFmpeg 转播进程（YouTube 直播 -> 多平台 RTMP）
   * 使用 copy 模式零转码
   */
  startRelay(opts: {
    taskId: string;
    streamUrl: string;
    targets: { rtmpUrl: string; streamKey: string; enabled: boolean }[];
  }): ManagedProcess {
    const { taskId, streamUrl, targets } = opts;
    const enabledTargets = targets.filter((t) => t.enabled && t.rtmpUrl);

    if (enabledTargets.length === 0) {
      throw new Error("没有启用的转播目标");
    }

    const args = [
      "-hide_banner", "-loglevel", "warning",
      "-re",
      "-i", streamUrl,
    ];

    // 第一个目标：copy 模式
    const firstTarget = enabledTargets[0];
    const firstUrl = firstTarget.streamKey
      ? `${firstTarget.rtmpUrl}/${firstTarget.streamKey}`
      : firstTarget.rtmpUrl;

    args.push("-c:v", "copy", "-c:a", "copy", "-f", "flv", firstUrl);

    // 后续目标：同样 copy 模式
    for (let i = 1; i < enabledTargets.length; i++) {
      const t = enabledTargets[i];
      const url = t.streamKey
        ? `${t.rtmpUrl}/${t.streamKey}`
        : t.rtmpUrl;
      args.push("-c:v", "copy", "-c:a", "copy", "-f", "flv", url);
    }

    return this._spawnFFmpeg(taskId, "relay", args);
  }

  /**
   * 使用 yt-dlp 下载视频
   * 通过统一 yt-dlp 模块 spawn（自动注入 --js-runtimes node, cookies 等）
   */
  startDownload(opts: {
    taskId: string;
    url: string;
    quality?: string;
  }): ManagedProcess {
    const { taskId, url, quality } = opts;

    if (!existsSync(this.videoDir)) {
      mkdirSync(this.videoDir, { recursive: true });
      console.log(`[ProcessManager] Created download directory: ${this.videoDir}`);
    }

    const hasCookies = existsSync(this.cookiesPath);
    console.log(`[ProcessManager] Starting download: task=${taskId}, url=${url}`);
    console.log(`[ProcessManager]   Output dir: ${this.videoDir}`);
    console.log(`[ProcessManager]   Cookies: ${hasCookies ? 'YES' : 'NO — YouTube may block without cookies!'}`);

    // Use unified yt-dlp module — args are built with --js-runtimes node, cookies, etc.
    const outputPath = join(this.videoDir, "%(id)s.%(ext)s");
    const { child, cmd } = ytDlpSpawn(url, {
      outputPath,
      format: quality || "best[height<=1080][ext=mp4]/best[height<=720]/best",
    });

    console.log(`[ProcessManager]   Command: ${cmd}`);

    // Build managed process with download progress tracking
    const managed: ManagedProcess = {
      pid: child.pid!,
      type: "download",
      taskId,
      child,
      startedAt: new Date(),
      cmd,
      stats: { fps: 0, bitrate: 0, speed: 0, frame: 0, time: "00:00:00", size: 0 },
      downloadProgress: { percent: 0, speed: "", eta: "", downloadedBytes: 0, totalBytes: 0 },
      logs: [],
    };

    // Parse yt-dlp progress from stdout
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      managed.logs.push(text);

      const percentMatch = text.match(/(\d{1,3}\.\d)% of/i);
      const speedMatch = text.match(/at\s+([\d.]+\w+\/s)/i);
      const etaMatch = text.match(/ETA\s+([\d:]+)/i);

      if (percentMatch) managed.downloadProgress!.percent = parseFloat(percentMatch[1]);
      if (speedMatch) managed.downloadProgress!.speed = speedMatch[1];
      if (etaMatch) managed.downloadProgress!.eta = etaMatch[1];
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      managed.logs.push(text);
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) console.log(`[yt-dlp] [${taskId}] ${trimmed}`);
      }
    });

    child.on("exit", (code) => {
      const logMsg = `下载完成: code=${code}, task=${taskId}`;
      managed.logs.push(logMsg);
      console.log(`[yt-dlp] ${logMsg}`);
      if (code !== 0) {
        const stderr = managed.logs.filter(l => l.includes('ERROR:')).join('\n');
        console.error(`[yt-dlp] ERRORS:\n${stderr || managed.logs.slice(-10).join('\n')}`);
      }
      try {
        appendFileSync(join(this.logDir, "process.log"), `[${new Date().toISOString()}] ${logMsg}\n`);
      } catch { /* ignore */ }
      this._cleanupProcess(taskId);
    });

    child.on("error", (err) => {
      const logMsg = `下载错误: ${err.message}`;
      managed.logs.push(logMsg);
      console.error(`[yt-dlp] ${logMsg}`);
      try {
        appendFileSync(join(this.logDir, "process.log"), `[${new Date().toISOString()}] ${logMsg}\n`);
      } catch { /* ignore */ }
    });

    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
    this.processes.set(taskId, managed);
    appendFileSync(
      join(this.logDir, "process.log"),
      `[${new Date().toISOString()}] 启动 download: pid=${child.pid}, task=${taskId}\n`,
    );

    return managed;
  }

  // ==================== 进程停止 ====================

  stop(taskId: string): boolean {
    const proc = this.processes.get(taskId);
    if (!proc) return false;

    try {
      // 发送 SIGTERM
      kill(proc.pid, "SIGTERM");

      // 3秒后强制 SIGKILL
      const forceKillTimer = setTimeout(() => {
        try {
          kill(proc.pid, "SIGKILL");
        } catch {
          // 进程可能已退出
        }
      }, 3000);

      // 清理
      proc.child.on("exit", () => {
        clearTimeout(forceKillTimer);
        this._cleanupProcess(taskId);
      });

      // 如果进程已退出
      if (proc.child.exitCode !== null) {
        clearTimeout(forceKillTimer);
        this._cleanupProcess(taskId);
      }

      return true;
    } catch {
      return false;
    }
  }

  stopAll(): void {
    for (const taskId of this.processes.keys()) {
      this.stop(taskId);
    }
  }

  // ==================== 进程查询 ====================

  get(taskId: string): ManagedProcess | undefined {
    return this.processes.get(taskId);
  }

  list(): ManagedProcess[] {
    return Array.from(this.processes.values());
  }

  listByType(type: "stream" | "relay" | "download"): ManagedProcess[] {
    return this.list().filter((p) => p.type === type);
  }

  isAlive(taskId: string): boolean {
    const proc = this.processes.get(taskId);
    if (!proc) return false;
    return proc.child.exitCode === null;
  }

  getStats(taskId: string): ManagedProcess["stats"] | null {
    const proc = this.processes.get(taskId);
    if (!proc) return null;
    return proc.stats;
  }

  getDownloadProgress(taskId: string): ManagedProcess["downloadProgress"] | null {
    const proc = this.processes.get(taskId);
    if (!proc) return null;
    return proc.downloadProgress ?? null;
  }

  // ==================== 内部方法 ====================

  private _spawnFFmpeg(taskId: string, type: "stream" | "relay", args: string[]): ManagedProcess {
    const child = spawn(this.ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const managed: ManagedProcess = {
      pid: child.pid!,
      type,
      taskId,
      child,
      startedAt: new Date(),
      cmd: `${this.ffmpegPath} ${args.join(" ")}`,
      stats: { fps: 0, bitrate: 0, speed: 0, frame: 0, time: "00:00:00", size: 0 },
      logs: [],
    };

    // 解析 FFmpeg stderr 输出的统计信息
    // 格式: frame=  120 fps= 30 q=28.0 size=    1536kB time=00:00:04.00 bitrate=3151.2kbits/s speed=1.23x
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      managed.logs.push(text);

      // FFmpeg 进度统计
      const frameMatch = text.match(/frame=\s*(\d+)/);
      const fpsMatch = text.match(/fps=\s*([\d.]+)/);
      const bitrateMatch = text.match(/bitrate=\s*([\d.]+)/);
      const speedMatch = text.match(/speed=\s*([\d.x]+)/);
      const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
      const sizeMatch = text.match(/size=\s*(\d+)/);

      if (frameMatch) managed.stats.frame = parseInt(frameMatch[1]);
      if (fpsMatch) managed.stats.fps = parseFloat(fpsMatch[1]);
      if (bitrateMatch) managed.stats.bitrate = parseFloat(bitrateMatch[1]);
      if (speedMatch) managed.stats.speed = parseFloat(speedMatch[1].replace("x", "")) || 0;
      if (timeMatch) managed.stats.time = timeMatch[1];
      if (sizeMatch) managed.stats.size = parseInt(sizeMatch[1]);
    });

    // 退出处理
    child.on("exit", (code, signal) => {
      const logMsg = `进程退出: code=${code}, signal=${signal}, cmd=${managed.cmd.substring(0, 100)}`;
      managed.logs.push(logMsg);
      try {
        if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
        appendFileSync(join(this.logDir, "process.log"), `[${new Date().toISOString()}] ${logMsg}\n`);
      } catch { /* ignore */ }
      this._cleanupProcess(taskId);
    });

    child.on("error", (err) => {
      const logMsg = `进程错误: ${err.message}`;
      managed.logs.push(logMsg);
      try {
        if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
        appendFileSync(join(this.logDir, "process.log"), `[${new Date().toISOString()}] ${logMsg}\n`);
      } catch { /* ignore */ }
    });

    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
    this.processes.set(taskId, managed);
    appendFileSync(
      join(this.logDir, "process.log"),
      `[${new Date().toISOString()}] 启动 ${type}: pid=${child.pid}, task=${taskId}\n`,
    );

    return managed;
  }

  private _cleanupProcess(taskId: string): void {
    const proc = this.processes.get(taskId);
    if (proc) {
      try {
        proc.child.kill("SIGKILL");
      } catch {
        // already dead
      }
      this.processes.delete(taskId);
    }
  }

  private _recoverProcesses(): void {
    try {
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }
      const logFile = join(this.logDir, "process.log");
      if (existsSync(logFile)) {
        appendFileSync(logFile, `\n[${new Date().toISOString()}] ProcessManager 启动，清理旧进程\n`);
      } else {
        appendFileSync(logFile, `[${new Date().toISOString()}] ProcessManager 首次启动\n`);
      }
    } catch {
      // ignore
    }
  }
}

// 单例
export const processManager = new ProcessManagerSingleton();
