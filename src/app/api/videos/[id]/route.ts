import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processManager } from '@/lib/process-manager';
import { existsSync, unlinkSync } from 'fs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const video = await db.video.findUnique({
      where: { id },
      include: {
        streamTasks: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!video) {
      return NextResponse.json({ error: '视频不存在' }, { status: 404 });
    }

    // Enrich with real-time download progress if downloading
    const enriched = { ...video };
    if (video.status === 'downloading') {
      const downloadProgress = processManager.getDownloadProgress(`download_${id}`);
      if (downloadProgress) {
        (enriched as Record<string, unknown>)._downloadProgress = downloadProgress;
      }
    }

    return NextResponse.json({ data: enriched });
  } catch (error) {
    console.error('Error fetching video:', error);
    return NextResponse.json({ error: '获取视频失败' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.video.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '视频不存在' }, { status: 404 });
    }

    // Handle download action
    if (body.action === 'download') {
      if (!existing.youtubeId) {
        return NextResponse.json(
          { error: '该视频没有 YouTube ID，无法下载' },
          { status: 400 }
        );
      }

      if (existing.status === 'downloading') {
        return NextResponse.json(
          { error: '视频正在下载中' },
          { status: 400 }
        );
      }

      if (existing.status === 'cached' && existing.localPath && existsSync(existing.localPath)) {
        return NextResponse.json(
          { error: '视频已缓存，无需重新下载' },
          { status: 400 }
        );
      }

      const sourceUrl = `https://www.youtube.com/watch?v=${existing.youtubeId}`;

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
          message: `视频下载已启动: "${existing.title}"`,
          metadata: JSON.stringify({ youtubeId: existing.youtubeId, sourceUrl }),
        },
      });

      // Start real yt-dlp download via processManager
      const proc = processManager.startDownload({
        taskId: `download_${id}`,
        url: sourceUrl,
        quality: 'best[height<=1080][ext=mp4]/best[height<=720]/best',
      });

      // Monitor download completion and update DB
      proc.child.on('exit', async (code) => {
        try {
          const paths = processManager.paths;
          // Try to find the downloaded file
          const { readdirSync, statSync } = await import('fs');
          const { join } = await import('path');

          let downloadedFile = '';
          try {
            const files = readdirSync(paths.videoDir);
            const match = files.find((f) => f.startsWith(existing.youtubeId!) && f.endsWith('.mp4'));
            if (match) {
              downloadedFile = join(paths.videoDir, match);
            }
          } catch {
            // videoDir might not exist
          }

          if (code === 0 && downloadedFile && existsSync(downloadedFile)) {
            const stats = statSync(downloadedFile);
            console.log(`[download] ✅ SUCCESS: ${existing.title} -> ${downloadedFile} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

            await db.video.update({
              where: { id },
              data: {
                status: 'cached',
                localPath: downloadedFile,
                fileSize: stats.size,
                downloadedAt: new Date(),
              },
            });
            await db.streamLog.create({
              data: {
                taskId: id,
                taskType: 'stream',
                action: 'start',
                message: `✅ 视频下载完成: "${existing.title}" (${(stats.size / 1024 / 1024).toFixed(1)}MB)`,
                metadata: JSON.stringify({ fileSize: stats.size, path: downloadedFile }),
              },
            });
          } else {
            const lastLogs = proc.logs.slice(-10);
            const errorLines = proc.logs.filter(l => l.includes('ERROR:')).join('\n');
            console.error(`[download] ❌ FAILED: ${existing.title} (exitCode=${code})`);
            console.error(`[download]   Cookies used: ${existsSync('/home/z/my-project/download/cookies.txt')}`);
            console.error(`[download]   Last logs:\n${lastLogs.join('\n')}`);

            await db.video.update({
              where: { id },
              data: { status: 'error' },
            });
            await db.streamLog.create({
              data: {
                taskId: id,
                taskType: 'stream',
                action: 'error',
                message: `❌ 视频下载失败: ${errorLines || `退出码: ${code}`}`,
                metadata: JSON.stringify({
                  exitCode: code,
                  cookiesUsed: existsSync('/home/z/my-project/download/cookies.txt'),
                  lastLogs: lastLogs,
                  allLogs: proc.logs.join('\n').substring(0, 3000),
                }),
              },
            });
          }
        } catch (dbErr) {
          console.error('Failed to update video status after download:', dbErr);
        }
      });

      proc.child.on('error', async (err) => {
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
              message: `视频下载进程错误: ${err.message}`,
            },
          });
        } catch {
          // ignore
        }
      });

      return NextResponse.json({
        data: {
          id,
          status: 'downloading',
          pid: proc.pid,
          message: '下载已在后台启动',
        },
      });
    }

    // Handle metadata update
    const { status, title, description, localPath, useCount } = body;
    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (localPath !== undefined) updateData.localPath = localPath;
    if (useCount !== undefined) updateData.useCount = useCount;

    if (status === 'cached') {
      updateData.downloadedAt = new Date();
    }

    const video = await db.video.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ data: video });
  } catch (error) {
    console.error('Error updating video:', error);
    return NextResponse.json(
      { error: `更新视频失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.video.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '视频不存在' }, { status: 404 });
    }

    // Check if any stream task is currently using this video
    const activeStreams = await db.streamTask.count({
      where: {
        videoId: id,
        status: { in: ['live', 'preparing', 'failover'] },
      },
    });
    if (activeStreams > 0) {
      return NextResponse.json(
        { error: `无法删除：有 ${activeStreams} 个活跃的推流任务正在使用此视频` },
        { status: 400 }
      );
    }

    // Delete file from disk if it exists
    let fileDeleted = false;
    if (existing.localPath) {
      try {
        if (existsSync(existing.localPath)) {
          unlinkSync(existing.localPath);
          fileDeleted = true;
        }
      } catch (err) {
        console.warn(`Failed to delete file ${existing.localPath}:`, err);
      }
    }

    await db.video.delete({ where: { id } });

    await db.streamLog.create({
      data: {
        taskId: id,
        taskType: 'stream',
        action: 'stop',
        message: `视频已删除: "${existing.title}"${fileDeleted ? '（文件已从磁盘移除）' : ''}`,
        metadata: JSON.stringify({ localPath: existing.localPath, fileDeleted }),
      },
    });

    return NextResponse.json({
      message: `视频已删除${fileDeleted ? '，文件已从磁盘移除' : ''}`,
      data: { id, fileDeleted },
    });
  } catch (error) {
    console.error('Error deleting video:', error);
    return NextResponse.json(
      { error: `删除视频失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
