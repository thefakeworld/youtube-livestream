import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';
import { engine } from '@/lib/engine';
import { db } from '@/lib/db';
import process from 'process';

/**
 * Check if a PID is alive via kill signal 0.
 */
function isPidAlive(pid: number | null): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function GET() {
  try {
    const allTaskIds = new Set<string>();

    // 1. Local processes from processManager
    const localProcesses = processManager.list().map((p) => {
      allTaskIds.add(p.taskId);
      return {
        taskId: p.taskId,
        pid: p.pid,
        type: p.type,
        cmd: p.cmd.substring(0, 200),
        isAlive: processManager.isAlive(p.taskId),
        source: 'local' as const,
        startedAt: p.startedAt.toISOString(),
        stats: {
          fps: p.stats.fps,
          bitrate: p.stats.bitrate,
          speed: p.stats.speed,
          frame: p.stats.frame,
          time: p.stats.time,
          size: p.stats.size,
        },
        downloadProgress: p.downloadProgress || null,
      };
    });

    // 2. Engine processes (port 3001)
    let engineProcesses: typeof localProcesses extends (infer U)[] ? U[] : never = [];
    try {
      const engineRes = await engine.getProcesses();
      const raw = engineRes.data || engineRes.processes || [];
      engineProcesses = raw.map((p: {
        taskId: string; pid: number; type: string; status: string;
        uptime: number; currentFps: number; currentBitrate: number;
        framesPushed: number; bytesWritten: number;
      }) => {
        allTaskIds.add(p.taskId);
        return {
          taskId: p.taskId,
          pid: p.pid,
          type: p.type,
          isAlive: p.status === 'running',
          source: 'engine' as const,
          startedAt: new Date(Date.now() - (p.uptime || 0) * 1000).toISOString(),
          stats: {
            fps: p.currentFps || 0,
            bitrate: p.currentBitrate || 0,
            speed: 0, frame: p.framesPushed || 0, time: '', size: p.bytesWritten || 0,
          },
          downloadProgress: null,
        };
      });
    } catch { /* engine not running */ }

    // 3. DB orphan check: tasks with status=live but not in any manager
    //    Verify PID still alive before including
    const liveTasks = await db.streamTask.findMany({
      where: { status: 'live' },
      select: { id: true, currentPid: true, startedAt: true },
    });

    const dbOrphans: typeof localProcesses extends (infer U)[] ? U[] : never = [];
    for (const task of liveTasks) {
      const key = `stream_${task.id}`;
      if (allTaskIds.has(key)) continue;
      if (!isPidAlive(task.currentPid)) continue;
      dbOrphans.push({
        taskId: key,
        pid: task.currentPid!,
        type: 'stream',
        isAlive: true,
        source: 'db-orphan' as const,
        startedAt: (task.startedAt || new Date()).toISOString(),
        stats: { fps: 0, bitrate: 0, speed: 0, frame: 0, time: '', size: 0 },
        downloadProgress: null,
      });
    }

    const all = [...localProcesses, ...engineProcesses, ...dbOrphans];
    return NextResponse.json({ data: all });
  } catch (error) {
    console.error('Error listing processes:', error);
    return NextResponse.json({ error: '获取进程列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, taskId } = body;

    if (action !== 'stop' || !taskId) {
      return NextResponse.json({ error: 'Missing action=stop or taskId' }, { status: 400 });
    }

    // 1. Try local processManager
    let stopped = false;
    if (processManager.isAlive(taskId)) {
      stopped = processManager.stop(taskId);
    }

    // 2. Try engine
    if (!stopped) {
      try { await engine.stopStream({ taskId }); stopped = true; } catch { /* ignore */ }
    }
    if (!stopped) {
      try { await engine.stopPlaylist({ taskId }); stopped = true; } catch { /* ignore */ }
    }

    // 3. Try system PID kill from DB
    if (!stopped) {
      const prefix = taskId.replace(/^stream_/, '');
      const task = await db.streamTask.findUnique({ where: { id: prefix } });
      if (task?.currentPid) {
        try { process.kill(task.currentPid, 'SIGTERM'); stopped = true; } catch { /* dead */ }
      }
    }

    return NextResponse.json({ success: stopped, taskId });
  } catch (error) {
    console.error('Error in processes POST:', error);
    return NextResponse.json({ error: '操作失败' }, { status: 500 });
  }
}
