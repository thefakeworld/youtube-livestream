/**
 * paths.ts — 统一路径配置
 *
 * 所有路径和环境相关的硬编码值集中在此文件。
 * 优先读取 process.env，提供合理的默认值。
 * 新代码只允许从这里导入路径，禁止在其它文件中硬编码。
 */

import { join } from 'path';

// ---------------------------------------------------------------------------
// 基础目录
// ---------------------------------------------------------------------------
/** 项目根目录 */
export const PROJECT_DIR = process.env.PROJECT_DIR || '/home/z/my-project';

/** 数据存储根目录（本地: /home/z/my-project/download，线上: /app/download） */
export const DATA_DIR = process.env.DATA_DIR || join(PROJECT_DIR, 'download');

// ---------------------------------------------------------------------------
// 子目录
// ---------------------------------------------------------------------------
/** 视频下载目录 */
export const VIDEOS_DIR = process.env.VIDEOS_DIR || join(DATA_DIR, 'videos');

/** 备播视频目录 */
export const STANDBY_DIR = process.env.STANDBY_DIR || join(DATA_DIR, 'standby');

/** 日志目录 */
export const LOG_DIR = process.env.LOG_DIR || join(DATA_DIR, 'logs');

/** Cookies 文件路径 */
export const COOKIES_PATH = process.env.COOKIES_PATH || join(DATA_DIR, 'cookies.txt');

/** 备播视频路径 */
export const FALLBACK_VIDEO_PATH =
  process.env.FALLBACK_VIDEO_PATH || join(STANDBY_DIR, 'fallback.mp4');

/** Keepalive 日志目录 */
export const KEEPALIVE_LOG_DIR =
  process.env.KEEPALIVE_LOG_DIR || join(PROJECT_DIR, 'logs');

// ---------------------------------------------------------------------------
// 工具路径
// ---------------------------------------------------------------------------
/** 工具目录（yt-dlp 等外部工具存放在项目内，避免沙箱重建后丢失） */
export const TOOLS_DIR = process.env.TOOLS_DIR || join(DATA_DIR, 'tools');

export const YT_DLP_PATH =
  process.env.YT_DLP_PATH || join(TOOLS_DIR, 'yt-dlp');

export const FFMPEG_PATH =
  process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';

// ---------------------------------------------------------------------------
// 端口
// ---------------------------------------------------------------------------
export const NEXT_PORT = parseInt(process.env.PORT || '3000', 10);
export const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '3001', 10);
export const CADDY_PORT = parseInt(process.env.CADDY_PORT || '81', 10);

// ---------------------------------------------------------------------------
// 引擎地址
// ---------------------------------------------------------------------------
export const ENGINE_BASE_URL = `http://127.0.0.1:${ENGINE_PORT}`;
export const CADDY_BASE_URL = `http://localhost:${CADDY_PORT}`;

// ---------------------------------------------------------------------------
// 引擎目录（本地开发用源码，生产用打包产物）
// ---------------------------------------------------------------------------
export const ENGINE_DIR =
  process.env.ENGINE_DIR || join(PROJECT_DIR, 'mini-services', 'stream-engine');

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------
/** 获取视频本地路径 */
export function getVideoLocalPath(youtubeId: string): string {
  return join(VIDEOS_DIR, `${youtubeId}.mp4`);
}

/** 获取进程日志路径 */
export function getProcessLogPath(filename?: string): string {
  return join(LOG_DIR, filename || 'process.log');
}
