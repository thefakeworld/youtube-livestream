import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processManager } from '@/lib/process-manager';
import { engine } from '@/lib/engine';
import process from 'process';

/**
 * Check if a stream task's process is actually alive.
 * Checks: processManager Map + engine API + system PID (kill signal 0)
 */
async function isProcessTrulyAlive(task: { currentPid: number | null; id: string }): Promise<boolean> {
  const processKey = `stream_${task.id}`;
  if (processManager.isAlive(processKey)) return true;

  try {
    const engineRes = await engine.getProcesses();
    const raw = engineRes.data || engineRes.processes || [];
    if (raw.some((p: { taskId: string; status: string }) => p.taskId === processKey && p.status === 'running')) {
      return true;
    }
  } catch { /* engine not running */ }

  if (task.currentPid) {
    try { process.kill(task.currentPid, 0); return true; } catch { /* dead */ }
  }
  return false;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stream = await db.streamTask.findUnique({
      where: { id },
      include: {
        video: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            duration: true,
            status: true,
            localPath: true,
          },
        },
        playlist: {
          select: {
            id: true,
            name: true,
            loop: true,
            _count: { select: { items: true } },
            backupVideo: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (!stream) {
      return NextResponse.json({ error: 'Stream task not found' }, { status: 404 });
    }

    // Calculate stats
    const recentLogs = await db.streamLog.findMany({
      where: { taskId: id, taskType: 'stream' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const stats = {
      recentLogs,
      currentDuration: stream.startedAt
        ? Math.floor((Date.now() - stream.startedAt.getTime()) / 1000)
        : 0,
      isFailoverActive: stream.isFailoverActive,
      failoverCount: stream.failoverCount,
    };

    return NextResponse.json({ data: { ...stream, stats } });
  } catch (error) {
    console.error('Error fetching stream task:', error);
    return NextResponse.json({ error: 'Failed to fetch stream task' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.streamTask.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Stream task not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'name', 'videoId', 'playlistId', 'primaryRtmpUrl', 'backupRtmpUrl',
      'videoBitrate', 'audioBitrate', 'resolution', 'fps', 'preset',
      'status', 'isFailoverActive',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const stream = await db.streamTask.update({
      where: { id },
      data: updateData,
      include: {
        video: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            duration: true,
            status: true,
          },
        },
        playlist: {
          select: {
            id: true,
            name: true,
            loop: true,
            _count: { select: { items: true } },
            backupVideo: { select: { id: true, title: true } },
          },
        },
      },
    });

    return NextResponse.json({ data: stream });
  } catch (error) {
    console.error('Error updating stream task:', error);
    return NextResponse.json({ error: 'Failed to update stream task' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.streamTask.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Stream task not found' }, { status: 404 });
    }

    if (existing.status === 'live') {
      // Verify the process is actually running — don't trust stale DB state
      const trulyAlive = await isProcessTrulyAlive(existing);
      if (trulyAlive) {
        return NextResponse.json(
          { error: '推流任务正在运行中，请先停止后再删除' },
          { status: 400 }
        );
      }
      // Process is dead but DB says live — auto-fix status then proceed with delete
      console.log(`[delete] Task ${id} has status=live but process is dead — auto-resetting before delete`);
      await db.streamTask.update({
        where: { id },
        data: { status: 'error', stoppedAt: new Date(), currentPid: null },
      });
    }

    await db.streamTask.delete({ where: { id } });

    return NextResponse.json({ message: 'Stream task deleted successfully' });
  } catch (error) {
    console.error('Error deleting stream task:', error);
    return NextResponse.json({ error: 'Failed to delete stream task' }, { status: 500 });
  }
}
