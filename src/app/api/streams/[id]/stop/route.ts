import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processManager } from '@/lib/process-manager';
import { engine } from '@/lib/engine';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const stream = await db.streamTask.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, startedAt: true, totalDuration: true, currentPid: true, playlistId: true },
    });
    if (!stream) {
      return NextResponse.json({ error: '推流任务不存在' }, { status: 404 });
    }

    if (stream.status !== 'live' && stream.status !== 'failover' && stream.status !== 'error') {
      return NextResponse.json(
        { error: '推流任务当前未在运行' },
        { status: 400 }
      );
    }

    const processKey = `stream_${id}`;
    let engineStopped = false;
    let localStopped = false;

    // ── 1. Stop the engine process (port 3001) ──
    // This handles BOTH single-video and playlist tasks started via engine.
    try {
      if (stream.playlistId) {
        // Playlist mode: use the playlist stop endpoint
        console.log(`[stop] Stopping playlist task ${processKey} via engine...`);
        const result = await engine.stopPlaylist({ taskId: processKey });
        engineStopped = result.success;
        console.log(`[stop] Engine playlist stop: success=${result.success}, duration=${result.duration}`);
      } else {
        // Single video mode: use the stream stop endpoint
        console.log(`[stop] Stopping stream task ${processKey} via engine...`);
        const result = await engine.stopStream({ taskId: processKey });
        engineStopped = result.success;
        console.log(`[stop] Engine stream stop: success=${result.success}, duration=${result.duration}`);
      }
    } catch (engineErr: unknown) {
      const msg = engineErr instanceof Error ? engineErr.message : String(engineErr);
      console.warn(`[stop] Engine stop failed (may not have been running): ${msg}`);
    }

    // ── 2. Also try stopping via local process manager (fallback) ──
    const wasRunningLocally = processManager.isAlive(processKey);
    if (wasRunningLocally) {
      console.log(`[stop] Stopping ${processKey} via local processManager...`);
      localStopped = processManager.stop(processKey);
      console.log(`[stop] Local stop: success=${localStopped}`);
    }

    const actuallyStopped = engineStopped || localStopped || !wasRunningLocally;

    // ── 3. Update database ──
    const now = new Date();
    let totalDuration = stream.totalDuration || 0;
    if (stream.startedAt) {
      const elapsed = Math.floor((now.getTime() - stream.startedAt.getTime()) / 1000);
      totalDuration += elapsed;
    }

    const updatedStream = await db.streamTask.update({
      where: { id },
      data: {
        status: 'stopped',
        stoppedAt: now,
        totalDuration,
        currentPid: null,
        isFailoverActive: false,
      },
    });

    // ── 4. Log the stop action ──
    await db.streamLog.create({
      data: {
        taskId: id,
        taskType: 'stream',
        action: 'stop',
        message: `推流 "${stream.name}" 已手动停止。累计时长: ${Math.floor(totalDuration / 60)}分${totalDuration % 60}秒`,
        metadata: JSON.stringify({
          totalDuration,
          previousStatus: stream.status,
          processWasRunning: wasRunningLocally,
          previousPid: stream.currentPid,
          engineStopped,
          localStopped,
          actuallyStopped,
          mode: stream.playlistId ? 'playlist' : 'single',
        }),
      },
    });

    if (!actuallyStopped && !engineStopped) {
      console.warn(`[stop] Task ${processKey} was not running anywhere — DB was out of sync with engine`);
    }

    return NextResponse.json({ data: updatedStream });
  } catch (error) {
    console.error('Error stopping stream:', error);
    return NextResponse.json(
      { error: `停止推流失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
