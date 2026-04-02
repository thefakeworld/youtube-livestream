import { NextRequest, NextResponse } from 'next/server';
import { downloadQueue } from '@/lib/download-queue';

/**
 * GET  — Get queue status
 * POST — Add videos to queue
 * DELETE — Clear queue (stop current + clear all)
 */
export async function GET() {
  try {
    const status = downloadQueue.getStatus();
    return NextResponse.json({ data: status });
  } catch (error) {
    console.error('[queue] Error getting status:', error);
    return NextResponse.json({ error: '获取队列状态失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { videoIds } = await request.json() as { videoIds: string[] };

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return NextResponse.json({ error: 'videoIds array is required' }, { status: 400 });
    }

    if (videoIds.length > 200) {
      return NextResponse.json({ error: 'Maximum 200 items per batch' }, { status: 400 });
    }

    const result = await downloadQueue.add(videoIds);
    const status = downloadQueue.getStatus();

    return NextResponse.json({
      data: {
        added: result.added.length,
        skipped: result.skipped.length,
        skippedDetails: result.skipped,
        queue: status,
      },
    });
  } catch (error) {
    console.error('[queue] Error adding videos:', error);
    return NextResponse.json(
      { error: `添加到队列失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (videoId) {
      // Remove a specific video from queue
      const removed = downloadQueue.remove(videoId);
      if (!removed) {
        return NextResponse.json({ error: '视频不在队列中，或正在下载中无法移除' }, { status: 400 });
      }
      return NextResponse.json({ message: '已从队列中移除' });
    }

    // Clear entire queue
    downloadQueue.clear();
    return NextResponse.json({ message: '队列已清空' });
  } catch (error) {
    console.error('[queue] Error:', error);
    return NextResponse.json({ error: '操作失败' }, { status: 500 });
  }
}
