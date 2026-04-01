import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';

const YT_DLP_PATH = process.env.YT_DLP_PATH || '/home/z/.local/bin/yt-dlp';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/home/z/my-project/download/videos';
const COOKIES_PATH = process.env.COOKIES_PATH || '/home/z/my-project/download/cookies.txt';

// Track active downloads to prevent duplicates
const activeDownloads = new Map<string, ChildProcess>();

/**
 * Extract a user-friendly error description from yt-dlp stderr output.
 */
function parseYtDlpError(stderr: string): string {
  if (stderr.includes('Sign in to confirm you') || stderr.includes('sign in to confirm')) {
    return 'YouTube 要求登录验证（Bot 检测）。请上传 Cookies 文件（Settings > Cookies）后重试。';
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
    if (lines.length > 0) {
      return `yt-dlp 错误: ${lines[lines.length - 1].trim()}`;
    }
  }
  if (stderr.includes('HTTP Error 429')) {
    return '请求过于频繁（HTTP 429），YouTube 限流。请稍后重试。';
  }
  if (stderr.includes('HTTP Error 403')) {
    return '访问被拒绝（HTTP 403），可能需要 Cookies 或视频所在地区受限。';
  }
  if (stderr.includes('No video formats found') || stderr.includes('no formats')) {
    return '未找到可用的视频格式。';
  }
  if (stderr.includes('certificate verify failed')) {
    return 'SSL 证书验证失败，请检查系统时间。';
  }
  return `yt-dlp 退出码非零，完整输出:\n${stderr.substring(0, 500)}`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const video = await db.video.findUnique({ where: { id } });
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    if (activeDownloads.has(id)) {
      console.warn(`[download] Video ${id} (${video.youtubeId}) is already downloading, skipping`);
      return NextResponse.json({ error: '视频正在下载中' }, { status: 400 });
    }

    if (video.status === 'cached' && video.localPath && existsSync(video.localPath)) {
      console.log(`[download] Video ${id} (${video.youtubeId}) already cached at ${video.localPath}`);
      return NextResponse.json({ error: '视频已缓存', cached: true }, { status: 400 });
    }

    // Determine the source URL
    let sourceUrl = '';
    if (video.youtubeId) {
      sourceUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
    } else if (video.sourceType === 'local_upload') {
      return NextResponse.json({ error: '本地上传的视频无法通过 yt-dlp 下载' }, { status: 400 });
    } else {
      return NextResponse.json({ error: '未找到 YouTube ID，无法下载' }, { status: 400 });
    }

    // Ensure download directory exists
    if (!existsSync(DOWNLOAD_DIR)) {
      mkdirSync(DOWNLOAD_DIR, { recursive: true });
      console.log(`[download] Created download directory: ${DOWNLOAD_DIR}`);
    }
    // Also ensure parent directory exists for cookies
    const cookiesDir = join(path.dirname(COOKIES_PATH));
    if (!existsSync(cookiesDir)) {
      mkdirSync(cookiesDir, { recursive: true });
    }

    // Check cookies
    const hasCookies = existsSync(COOKIES_PATH);
    console.log(`[download] Starting download for video ${id} (${video.youtubeId || 'no ytId'}): "${video.title}"`);
    console.log(`[download]   Source URL: ${sourceUrl}`);
    console.log(`[download]   Cookies: ${hasCookies ? 'YES (' + COOKIES_PATH + ')' : 'NO — YouTube may block downloads without cookies!'}`);

    // Update status to downloading
    await db.video.update({
      where: { id },
      data: { status: 'downloading' },
    });

    await db.streamLog.create({
      data: {
        taskId: id,
        taskType: 'stream',
        action: 'start',
        message: `视频下载已启动: "${video.title}"`,
        metadata: JSON.stringify({
          youtubeId: video.youtubeId,
          sourceUrl,
          cookiesUsed: hasCookies,
        }),
      },
    });

    // Output path
    const safeFilename = video.youtubeId || id;
    const outputPath = join(DOWNLOAD_DIR, `${safeFilename}.mp4`);

    // Build yt-dlp arguments
    // --js-runtimes node: required for YouTube signature decryption
    const args: string[] = [
      '--js-runtimes', 'node',
      '-f', 'best[height<=1080][ext=mp4]/best[height<=720]/best',
      '-o', outputPath,
      '--write-thumbnail',
      '--newline',
      '--no-warnings',
      '--progress',
      '--no-check-certificates',
    ];

    if (hasCookies) {
      args.push('--cookies', COOKIES_PATH);
    }

    args.push(sourceUrl);

    console.log(`[download]   Command: ${YT_DLP_PATH} ${args.join(' ')}`);

    // Spawn yt-dlp (NOT detached — keep attached so close event fires reliably)
    const child = spawn(YT_DLP_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeDownloads.set(id, child);

    // Collect stdout and stderr
    let stdoutOutput = '';
    let stderrOutput = '';
    let lastStdoutLine = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdoutOutput += data.toString();
      lastStdoutLine = data.toString().trim().split('\n').pop() || '';
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrOutput += text;
      // Log each line in real-time for debugging
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          console.log(`[download] yt-dlp [${video.youtubeId}] ${trimmed}`);
        }
      }
    });

    // Handle download completion
    child.on('close', async (code) => {
      activeDownloads.delete(id);

      const duration = Date.now(); // approximate
      console.log(`[download] Process exited for ${id} (${video.youtubeId}): code=${code}`);
      console.log(`[download]   stderr length: ${stderrOutput.length} chars`);
      console.log(`[download]   stdout length: ${stdoutOutput.length} chars`);

      try {
        if (code === 0) {
          if (existsSync(outputPath)) {
            const stats = statSync(outputPath);
            console.log(`[download] ✅ SUCCESS: ${video.title} -> ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

            await db.video.update({
              where: { id },
              data: {
                status: 'cached',
                localPath: outputPath,
                fileSize: stats.size,
                downloadedAt: new Date(),
              },
            });

            await db.streamLog.create({
              data: {
                taskId: id,
                taskType: 'stream',
                action: 'start',
                message: `✅ 视频下载完成: "${video.title}" (${(stats.size / 1024 / 1024).toFixed(1)}MB)`,
                metadata: JSON.stringify({ fileSize: stats.size, path: outputPath }),
              },
            });
          } else {
            // yt-dlp exited 0 but file not at expected path — check if it downloaded with a different name
            console.error(`[download] ❌ yt-dlp exit code 0 but file not found at ${outputPath}`);
            console.error(`[download]   stdout tail: ${stdoutOutput.slice(-500)}`);
            console.error(`[download]   stderr tail: ${stderrOutput.slice(-500)}`);

            await db.video.update({
              where: { id },
              data: { status: 'error' },
            });
            await db.streamLog.create({
              data: {
                taskId: id,
                taskType: 'stream',
                action: 'error',
                message: `❌ yt-dlp 退出码为 0 但文件未找到: ${outputPath}`,
                metadata: JSON.stringify({
                  exitCode: code,
                  expectedPath: outputPath,
                  stdout: stdoutOutput.substring(0, 2000),
                  stderr: stderrOutput.substring(0, 2000),
                }),
              },
            });
          }
        } else {
          // Non-zero exit code
          const friendlyError = parseYtDlpError(stderrOutput);
          console.error(`[download] ❌ FAILED: ${video.title}`);
          console.error(`[download]   Exit code: ${code}`);
          console.error(`[download]   Error: ${friendlyError}`);
          console.error(`[download]   Cookies used: ${hasCookies}`);
          console.error(`[download]   stderr: ${stderrOutput.substring(0, 1000)}`);

          await db.video.update({
            where: { id },
            data: { status: 'error' },
          });
          await db.streamLog.create({
            data: {
              taskId: id,
              taskType: 'stream',
              action: 'error',
              message: `❌ 视频下载失败: ${friendlyError}`,
              metadata: JSON.stringify({
                exitCode: code,
                cookiesUsed: hasCookies,
                cookiesPath: hasCookies ? COOKIES_PATH : null,
                stderr: stderrOutput.substring(0, 2000),
                stdout: stdoutOutput.substring(0, 500),
                ytDlpPath: YT_DLP_PATH,
                sourceUrl,
                outputPath,
              }),
            },
          });
        }
      } catch (dbErr) {
        console.error(`[download] Failed to update video status after download:`, dbErr);
      }
    });

    child.on('error', async (err) => {
      activeDownloads.delete(id);
      console.error(`[download] ❌ Process spawn error for ${id} (${video.youtubeId}): ${err.message}`);

      try {
        await db.video.update({
          where: { id },
          data: { status: 'error' },
        });
        await db.streamLog.create({
          data: {
            taskId: id,
            taskType: 'stream',
            action: 'error',
            message: `❌ 视频下载进程启动失败: ${err.message}`,
            metadata: JSON.stringify({ error: err.message, code: err.name }),
          },
        });
      } catch {
        // ignore
      }
    });

    // If parent process exits, also kill downloads
    const cleanup = () => {
      if (activeDownloads.has(id)) {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        activeDownloads.delete(id);
      }
    };
    process.on('exit', cleanup);

    return NextResponse.json({
      data: {
        id: video.id,
        youtubeId: video.youtubeId,
        status: 'downloading',
        title: video.title,
        message: '下载已在后台启动',
        outputPath,
        cookiesUsed: hasCookies,
      },
    });
  } catch (error) {
    console.error('[download] Error starting video download:', error);
    return NextResponse.json(
      { error: `启动下载失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
