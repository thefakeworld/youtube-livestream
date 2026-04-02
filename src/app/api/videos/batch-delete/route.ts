import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { existsSync, unlinkSync } from 'fs';

/**
 * Batch delete videos — deletes DB records and their files.
 * Rejects if any video is currently used by an active stream.
 */
export async function POST(request: NextRequest) {
  try {
    const { ids } = await request.json() as { ids: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    if (ids.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 items per batch' }, { status: 400 });
    }

    // Check for active streams first
    const activeStreams = await db.streamTask.count({
      where: {
        videoId: { in: ids },
        status: { in: ['live', 'preparing', 'failover'] },
      },
    });
    if (activeStreams > 0) {
      return NextResponse.json(
        { error: `${activeStreams} 个活跃的推流任务正在使用选中的视频，请先停止推流` },
        { status: 400 },
      );
    }

    // Fetch all videos to get their local paths
    const videos = await db.video.findMany({
      where: { id: { in: ids } },
      select: { id: true, localPath: true, title: true },
    });

    if (videos.length === 0) {
      return NextResponse.json({ error: '未找到指定的视频' }, { status: 404 });
    }

    // Delete files from disk
    let filesDeleted = 0;
    for (const video of videos) {
      if (video.localPath) {
        try {
          if (existsSync(video.localPath)) {
            unlinkSync(video.localPath);
            filesDeleted++;
          }
        } catch (err) {
          console.warn(`[batch-delete] Failed to delete file ${video.localPath}:`, err);
        }
      }
    }

    // Delete from DB (cascade deletes playlist items)
    const result = await db.video.deleteMany({
      where: { id: { in: ids } },
    });

    // Log
    for (const video of videos) {
      try {
        await db.streamLog.create({
          data: {
            taskId: video.id,
            taskType: 'stream',
            action: 'stop',
            message: `[批量删除] 视频已删除: "${video.title}"`,
          },
        });
      } catch { /* ignore */ }
    }

    console.log(`[batch-delete] Deleted ${result.count} videos (${filesDeleted} files removed)`);

    return NextResponse.json({
      message: `已删除 ${result.count} 个视频${filesDeleted > 0 ? `，${filesDeleted} 个文件已从磁盘移除` : ''}`,
      data: {
        deletedCount: result.count,
        filesDeleted,
      },
    });
  } catch (error) {
    console.error('[batch-delete] Error:', error);
    return NextResponse.json(
      { error: `批量删除失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 },
    );
  }
}
