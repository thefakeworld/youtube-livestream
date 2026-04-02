/**
 * DownloadQueueManager — 顺序下载队列
 *
 * 核心机制：
 *   1. 支持批量添加视频到队列
 *   2. 同一时间只有一个下载在执行（串行）
 *   3. 当前下载完成/失败后自动启动下一个
 *   4. 支持从队列中移除指定视频
 *   5. 支持清空队列
 *   6. 提供队列状态查询（当前/等待/已完成/失败）
 */

import { db } from '@/lib/db';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { COOKIES_PATH, VIDEOS_DIR } from '@/lib/paths';
import { spawnDownload } from '@/lib/yt-dlp';
import type { ChildProcess } from 'child_process';

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

export type QueueItemStatus = 'waiting' | 'downloading' | 'completed' | 'failed' | 'removed';

export interface QueueItem {
  videoId: string;
  youtubeId?: string | null;
  title: string;
  status: QueueItemStatus;
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  fileSize?: number;
}

export interface QueueStatus {
  /** Is there an active download right now? */
  isActive: boolean;
  /** Total items ever added */
  total: number;
  /** Still in queue (waiting + downloading) */
  remaining: number;
  /** Successfully completed */
  completedCount: number;
  /** Failed */
  failedCount: number;
  /** Currently downloading video info */
  current?: QueueItem;
  /** All items in queue (waiting + downloading) */
  queue: QueueItem[];
  /** Completed items */
  completed: QueueItem[];
  /** Failed items */
  failed: QueueItem[];
}

// ──────────────────────────────────────────────────
// Error parser (shared with download route)
// ──────────────────────────────────────────────────

function parseYtDlpError(stderr: string): string {
  if (stderr.includes('Sign in to confirm you') || stderr.includes('sign in to confirm')) {
    return 'YouTube 要求登录验证（Bot 检测）。请上传 Cookies 文件后重试。';
  }
  if (stderr.includes('age') && stderr.includes('sign in')) {
    return '视频有年龄限制，需要登录。请上传 Cookies 文件后重试。';
  }
  if (stderr.includes('Video unavailable') || stderr.includes('video is unavailable')) {
    return '视频不可用（可能已被删除或设为私密）。';
  }
  if (stderr.includes('Private video') || stderr.includes('private video')) {
    return '这是私密视频，需要登录才能访问。';
  }
  if (stderr.includes('ERROR:')) {
    const lines = stderr.split('\n').filter(l => l.includes('ERROR:'));
    if (lines.length > 0) return `yt-dlp 错误: ${lines[lines.length - 1].trim()}`;
  }
  if (stderr.includes('HTTP Error 429')) return '请求过于频繁（HTTP 429），YouTube 限流。';
  if (stderr.includes('HTTP Error 403')) return '访问被拒绝（HTTP 403），需要 Cookies。';
  if (stderr.includes('No video formats found') || stderr.includes('no formats')) return '未找到可用格式。';
  return `下载失败 (退出码非零)`;
}

// ──────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────

class DownloadQueueManager {
  /** Main ordered queue (waiting items) */
  private queue: QueueItem[] = [];
  /** Currently downloading */
  private current: QueueItem | null = null;
  /** Completed items */
  private completed: QueueItem[] = [];
  /** Failed items */
  private failed: QueueItem[] = [];
  /** Active child process */
  private activeProcess: ChildProcess | null = null;
  /** Prevent double-start */
  private processing = false;

  // ──────────── Public API ────────────

  /**
   * Add videos to the queue. Returns the items that were actually added.
   * Skips items that are already in queue, currently downloading, cached, or already completed.
   */
  async add(videoIds: string[]): Promise<{ added: QueueItem[]; skipped: { id: string; reason: string }[] }> {
    const added: QueueItem[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const vid of videoIds) {
      // Check if already in queue or processing
      if (this.current?.videoId === vid) {
        skipped.push({ id: vid, reason: '正在下载中' });
        continue;
      }
      if (this.queue.some(q => q.videoId === vid)) {
        skipped.push({ id: vid, reason: '已在队列中' });
        continue;
      }
      if (this.completed.some(c => c.videoId === vid)) {
        skipped.push({ id: vid, reason: '已下载完成' });
        continue;
      }
      if (this.failed.some(f => f.videoId === vid)) {
        skipped.push({ id: vid, reason: '之前下载失败，请先移除失败记录' });
        continue;
      }

      // Check DB
      const video = await db.video.findUnique({ where: { id: vid } });
      if (!video) {
        skipped.push({ id: vid, reason: '视频不存在' });
        continue;
      }
      if (video.status === 'cached' && video.localPath && existsSync(video.localPath)) {
        skipped.push({ id: vid, reason: '已缓存' });
        continue;
      }
      if (video.status === 'downloading') {
        skipped.push({ id: vid, reason: '正在下载中' });
        continue;
      }
      if (!video.youtubeId) {
        skipped.push({ id: vid, reason: '无 YouTube ID' });
        continue;
      }

      const item: QueueItem = {
        videoId: vid,
        youtubeId: video.youtubeId,
        title: video.title,
        status: 'waiting',
        addedAt: Date.now(),
      };
      this.queue.push(item);
      added.push(item);
    }

    console.log(`[Queue] Added ${added.length} items, skipped ${skipped.length}`);
    this._processNext();
    return { added, skipped };
  }

  /**
   * Remove a video from the queue (only works if it's still waiting).
   * If currently downloading, returns false.
   */
  remove(videoId: string): boolean {
    const idx = this.queue.findIndex(q => q.videoId === videoId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      console.log(`[Queue] Removed ${videoId} from queue`);
      return true;
    }
    return false;
  }

  /** Stop the current download and clear everything */
  clear(): void {
    // Kill current download
    if (this.activeProcess) {
      try { this.activeProcess.kill('SIGTERM'); } catch { /* ignore */ }
      this.activeProcess = null;
    }
    if (this.current) {
      // Reset status of current item
      db.video.update({
        where: { id: this.current.videoId },
        data: { status: 'pending' },
      }).catch(() => {});
      this.current = null;
    }
    this.queue = [];
    this.completed = [];
    this.failed = [];
    this.processing = false;
    console.log('[Queue] Queue cleared');
  }

  /** Get full queue status */
  getStatus(): QueueStatus {
    return {
      isActive: !!this.current,
      total: this.queue.length + (this.current ? 1 : 0) + this.completed.length + this.failed.length,
      remaining: this.queue.length + (this.current ? 1 : 0),
      completedCount: this.completed.length,
      failedCount: this.failed.length,
      current: this.current || undefined,
      queue: [...this.queue],
      completed: [...this.completed],
      failed: [...this.failed],
    };
  }

  // ──────────── Internal ────────────

  private async _processNext(): Promise<void> {
    if (this.processing) return;
    if (this.queue.length === 0) {
      if (this.current) {
        console.log('[Queue] Queue empty, all done');
      }
      return;
    }

    this.processing = true;

    const item = this.queue.shift()!;
    item.status = 'downloading';
    item.startedAt = Date.now();
    this.current = item;

    console.log(`[Queue] Starting download ${this.completed.length + this.failed.length + 1}/${this.totalRemaining()}: "${item.title}" (${item.videoId})`);

    try {
      // Update DB status
      await db.video.update({
        where: { id: item.videoId },
        data: { status: 'downloading' },
      });

      await db.streamLog.create({
        data: {
          taskId: item.videoId,
          taskType: 'stream',
          action: 'start',
          message: `[队列] 下载开始: "${item.title}"`,
          metadata: JSON.stringify({ queueIndex: this.completed.length + this.failed.length + 1, youtubeId: item.youtubeId }),
        },
      });

      // Ensure download directory exists
      if (!existsSync(VIDEOS_DIR)) mkdirSync(VIDEOS_DIR, { recursive: true });
      const cookiesDir = dirname(COOKIES_PATH);
      if (!existsSync(cookiesDir)) mkdirSync(cookiesDir, { recursive: true });

      const sourceUrl = `https://www.youtube.com/watch?v=${item.youtubeId}`;
      const outputPath = join(VIDEOS_DIR, `${item.youtubeId}.mp4`);

      const { child, cmd } = spawnDownload(sourceUrl, { outputPath, writeThumbnail: true });
      this.activeProcess = child;

      console.log(`[Queue] yt-dlp PID=${child.pid} for "${item.title}"`);

      let stdoutOutput = '';
      let stderrOutput = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdoutOutput += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderrOutput += text;
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) console.log(`[Queue] [${item.youtubeId}] ${trimmed}`);
        }
      });

      await new Promise<void>((resolve) => {
        child.on('close', async (code) => {
          this.activeProcess = null;

          try {
            if (code === 0 && existsSync(outputPath)) {
              const stats = statSync(outputPath);
              item.status = 'completed';
              item.finishedAt = Date.now();
              item.fileSize = stats.size;

              await db.video.update({
                where: { id: item.videoId },
                data: {
                  status: 'cached',
                  localPath: outputPath,
                  fileSize: stats.size,
                  downloadedAt: new Date(),
                },
              });

              await db.streamLog.create({
                data: {
                  taskId: item.videoId,
                  taskType: 'stream',
                  action: 'complete',
                  message: `[队列] ✅ 下载完成: "${item.title}" (${(stats.size / 1024 / 1024).toFixed(1)}MB)`,
                  metadata: JSON.stringify({ fileSize: stats.size }),
                },
              });

              this.completed.push(item);
              console.log(`[Queue] ✅ "${item.title}" done (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
            } else {
              const friendlyError = parseYtDlpError(stderrOutput);
              item.status = 'failed';
              item.finishedAt = Date.now();
              item.error = friendlyError;

              await db.video.update({
                where: { id: item.videoId },
                data: { status: 'error' },
              });

              await db.streamLog.create({
                data: {
                  taskId: item.videoId,
                  taskType: 'stream',
                  action: 'error',
                  message: `[队列] ❌ 下载失败: "${item.title}" — ${friendlyError}`,
                  metadata: JSON.stringify({ exitCode: code, stderr: stderrOutput.substring(0, 2000) }),
                },
              });

              this.failed.push(item);
              console.error(`[Queue] ❌ "${item.title}" failed: ${friendlyError}`);
            }
          } catch (dbErr) {
            console.error(`[Queue] DB error after download:`, dbErr);
            item.status = 'failed';
            item.finishedAt = Date.now();
            item.error = 'DB update failed';
            this.failed.push(item);
          }

          this.current = null;
          this.processing = false;
          resolve();

          // Auto-advance to next item
          setTimeout(() => this._processNext(), 500);
        });

        child.on('error', async (err) => {
          this.activeProcess = null;
          item.status = 'failed';
          item.finishedAt = Date.now();
          item.error = err.message;

          try {
            await db.video.update({
              where: { id: item.videoId },
              data: { status: 'error' },
            });
          } catch { /* ignore */ }

          this.failed.push(item);
          this.current = null;
          this.processing = false;
          resolve();

          setTimeout(() => this._processNext(), 500);
        });
      });
    } catch (err) {
      console.error(`[Queue] Error downloading "${item.title}":`, err);
      item.status = 'failed';
      item.finishedAt = Date.now();
      item.error = (err as Error).message;
      this.failed.push(item);
      this.current = null;
      this.processing = false;

      // Auto-advance
      setTimeout(() => this._processNext(), 500);
    }
  }

  private totalRemaining(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }
}

export const downloadQueue = new DownloadQueueManager();
