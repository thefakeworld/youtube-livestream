/**
 * yt-dlp 统一工具模块 (mini-services 版本)
 *
 * 与 src/lib/yt-dlp.ts 保持一致逻辑，供 stream-engine 独立使用。
 * 所有 yt-dlp 调用必须通过此模块。
 *
 * 核心保障：
 *   1. 所有调用自动注入 --js-runtimes node（YouTube JS 解密必需）
 *   2. 自动注入 --no-check-certificates
 *   3. 自动附加 cookies（如果存在）
 *   4. 统一的错误处理，不静默吞错
 *   5. 统一的日志前缀 [yt-dlp]
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";

// ──────────────────────────────────────────────────
// 配置
// ──────────────────────────────────────────────────
const PROJECT_DIR = process.env.PROJECT_DIR || "/home/z/my-project";
const DATA_DIR = process.env.DATA_DIR || `${PROJECT_DIR}/download`;
const TOOLS_DIR = process.env.TOOLS_DIR || `${DATA_DIR}/tools`;
const YTDL_PATH = process.env.YT_DLP_PATH || `${TOOLS_DIR}/yt-dlp`;
const COOKIES_PATH = process.env.COOKIES_PATH || `${DATA_DIR}/cookies.txt`;

// ──────────────────────────────────────────────────
// 公共基础参数 — 所有调用自动注入
// ──────────────────────────────────────────────────
const BASE_ARGS: string[] = [
  "--js-runtimes", "node",
  "--no-check-certificates",
];

function withCookies(args: string[]): string[] {
  if (existsSync(COOKIES_PATH)) {
    return [...args, "--cookies", COOKIES_PATH];
  }
  return args;
}

function buildArgs(extra: string[]): string[] {
  const args = withCookies([...BASE_ARGS, ...extra]);
  console.log(`[yt-dlp] ${YTDL_PATH} ${args.join(" ")}`);
  return args;
}

/**
 * 执行 yt-dlp（同步），使用 spawnSync 传数组，不经过 shell。
 */
function execYtDlp(args: string[], timeout = 60000, maxBuffer = 10 * 1024 * 1024): {
  success: boolean;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(YTDL_PATH, args, {
    encoding: "utf-8",
    timeout,
    maxBuffer,
  });
  return {
    success: result.status === 0 && !result.error,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

// ──────────────────────────────────────────────────
// 同步方法
// ──────────────────────────────────────────────────

/**
 * 获取直播流 URL（用于转播模式）
 */
export function getStreamUrl(url: string, quality = "best", timeout = 30000): string | null {
  const args = buildArgs([
    "-f", quality,
    "--print", "url",
    "--no-warnings",
    url,
  ]);

  const { success, stdout, stderr } = execYtDlp(args, timeout);
  if (success) {
    return stdout.trim() || null;
  }
  console.error(`[yt-dlp] getStreamUrl FAILED for ${url}: ${stderr.substring(0, 500)}`);
  return null;
}

// ──────────────────────────────────────────────────
// 同步下载（spawnSync，阻塞直到完成或超时）
// ──────────────────────────────────────────────────

export interface DownloadResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface DownloadOptions {
  outputPath: string;
  format?: string;
}

/**
 * 同步下载视频（用于引擎播放列表模式中顺序下载）
 */
export function downloadSync(
  url: string,
  options: DownloadOptions,
  timeout = 300000,
): DownloadResult {
  const args = buildArgs([
    "--no-playlist",
    "-f", options.format || "best[height<=1080][ext=mp4]/best[height<=720]/best",
    "-o", options.outputPath,
    "--no-warnings",
    "--newline",
    "--progress",
    url,
  ]);

  try {
    const result = spawnSync(YTDL_PATH, args, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      success: result.status === 0 && !result.error,
      exitCode: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      error: result.error?.message,
    };
  } catch (err: any) {
    return {
      success: false,
      exitCode: null,
      stdout: "",
      stderr: err?.message || String(err),
      error: err?.message || String(err),
    };
  }
}

export { YTDL_PATH, COOKIES_PATH };
