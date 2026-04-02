/**
 * yt-dlp 统一工具模块
 *
 * 所有 yt-dlp 调用必须通过此模块，禁止在其它文件中直接拼 yt-dlp 命令。
 * 核心保障：
 *   1. 所有调用自动注入 --js-runtimes node（YouTube JS 解密必需）
 *   2. 自动注入 --no-check-certificates
 *   3. 自动附加 cookies（如果存在）
 *   4. 统一的错误处理，不静默吞错
 *   5. 统一的日志前缀 [yt-dlp]
 */

import { execSync, spawnSync, spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { YT_DLP_PATH, COOKIES_PATH } from '@/lib/paths';

// ──────────────────────────────────────────────────
// 公共基础参数 — 所有调用自动注入
// ──────────────────────────────────────────────────

/** 每个调用都会自动带上的参数，不再需要各处手动加 */
const BASE_ARGS: string[] = [
  '--js-runtimes', 'node',        // YouTube JS 签名解密（必需）
  '--no-check-certificates',       // SSL 兼容
];

/** 自动注入 cookies（如果文件存在） */
function withCookies(args: string[]): string[] {
  if (existsSync(COOKIES_PATH)) {
    return [...args, '--cookies', COOKIES_PATH];
  }
  return args;
}

/** 组装完整命令数组并打印日志 */
function buildArgs(extra: string[]): string[] {
  const args = withCookies([...BASE_ARGS, ...extra]);
  console.log(`[yt-dlp] ${YT_DLP_PATH} ${args.join(' ')}`);
  return args;
}

// ──────────────────────────────────────────────────
// 返回值类型
// ──────────────────────────────────────────────────

export interface YtDlpVideoInfo {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  format?: string;
  width?: number;
  height?: number;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  filesize_approx?: number;
}

export interface YtDlpSpawnResult {
  child: ChildProcess;
  cmd: string;
}

// ──────────────────────────────────────────────────
// 同步方法（用于 info/元数据获取）
// ──────────────────────────────────────────────────

/**
 * 获取视频元信息（JSON）。
 * 用途：导入视频、解析标题/时长等。
 */
export function getVideoInfo(url: string, timeout = 60000): YtDlpVideoInfo | null {
  const args = buildArgs([
    '-J', '--no-download', '--no-warnings',
    url,
  ]);

  try {
    const json = execSync(`"${YT_DLP_PATH}" ${args.join(' ')}`, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(json) as YtDlpVideoInfo;
    if (!parsed || !parsed.id) return null;
    return parsed;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr || '';
    console.error(`[yt-dlp] getVideoInfo FAILED for ${url}: ${stderr.substring(0, 500)}`);
    return null;
  }
}

/**
 * 获取频道/播放列表视频列表（用 --flat-playlist，速度极快）。
 * 用途：频道视频批量导入。
 *
 * 返回 tab 分隔文本，每行：id\ttitle\tduration_string\tview_count\tthumbnail
 */
export function getChannelVideos(url: string, maxVideos = 50, timeout = 60000): string | null {
  const printFormat = '%(id)s\t%(title)s\t%(duration_string)s\t%(view_count)s\t%(thumbnail)s';

  // flat-playlist 不需要 js-runtimes，但加上也无害
  const attempts: { label: string; extra: string[] }[] = [
    { label: 'basic', extra: [] },
    { label: 'web', extra: ['--extractor-args', 'youtube:player_client=web'] },
    { label: 'mweb', extra: ['--extractor-args', 'youtube:player_client=mweb'] },
  ];

  for (const attempt of attempts) {
    const args = buildArgs([
      '--flat-playlist',
      '--print', printFormat,
      '--playlist-end', String(maxVideos),
      '--no-warnings',
      ...attempt.extra,
      url,
    ]);

    try {
      const stdout = execSync(`"${YT_DLP_PATH}" ${args.join(' ')}`, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (stdout.trim()) return stdout;
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr || '';
      console.error(`[yt-dlp] getChannelVideos [${attempt.label}] FAILED: ${stderr.substring(0, 500)}`);
    }
  }

  return null;
}

/**
 * 获取直播流 URL（用于转播模式）。
 * 用途：YouTube 直播转播。
 */
export function getStreamUrl(url: string, quality = 'best', timeout = 30000): string | null {
  const args = buildArgs([
    '-f', quality,
    '--print', 'url',
    '--no-warnings',
    url,
  ]);

  try {
    const stdout = execSync(`"${YT_DLP_PATH}" ${args.join(' ')}`, {
      encoding: 'utf-8',
      timeout,
    }).trim();
    return stdout || null;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr || '';
    console.error(`[yt-dlp] getStreamUrl FAILED for ${url}: ${stderr.substring(0, 500)}`);
    return null;
  }
}

// ──────────────────────────────────────────────────
// 异步方法（spawn，用于下载等长时间任务）
// ──────────────────────────────────────────────────

export interface DownloadOptions {
  /** 输出文件路径 */
  outputPath: string;
  /** 格式选择，默认 best[height<=1080][ext=mp4]/best[height<=720]/best */
  format?: string;
  /** 是否同时下载缩略图 */
  writeThumbnail?: boolean;
}

/**
 * spawn yt-dlp 下载视频（异步，不阻塞）。
 * 用途：后台下载视频。
 *
 * 调用方负责监听 child 的 close/error 事件处理结果。
 */
export function spawnDownload(url: string, options: DownloadOptions): YtDlpSpawnResult {
  const args = buildArgs([
    '--no-playlist',
    '-f', options.format || 'best[height<=1080][ext=mp4]/best[height<=720]/best',
    '-o', options.outputPath,
    '--newline',
    '--progress',
    '--no-warnings',
    ...(options.writeThumbnail ? ['--write-thumbnail'] : []),
    url,
  ]);

  const child = spawn(YT_DLP_PATH, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    child,
    cmd: `${YT_DLP_PATH} ${args.join(' ')}`,
  };
}

/**
 * spawnSync yt-dlp 下载（同步，会阻塞直到完成或超时）。
 * 用途：引擎播放列表模式中顺序下载。
 */
export function downloadSync(
  url: string,
  options: DownloadOptions,
  timeout = 300000,
): { success: boolean; exitCode: number | null; stdout: string; stderr: string; error?: string } {
  const args = buildArgs([
    '--no-playlist',
    '-f', options.format || 'best[height<=1080][ext=mp4]/best[height<=720]/best',
    '-o', options.outputPath,
    '--no-warnings',
    '--newline',
    '--progress',
    ...(options.writeThumbnail ? ['--write-thumbnail'] : []),
    url,
  ]);

  try {
    const result = spawnSync(YT_DLP_PATH, args, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      success: result.status === 0 && !result.error,
      exitCode: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error?.message,
    };
  } catch (err) {
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: (err as Error).message,
      error: (err as Error).message,
    };
  }
}
