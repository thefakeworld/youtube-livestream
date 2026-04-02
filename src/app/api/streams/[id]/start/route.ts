import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processManager } from '@/lib/process-manager';
import { existsSync } from 'fs';
import { engine } from '@/lib/engine';
import process from 'process';
import { FALLBACK_VIDEO_PATH, COOKIES_PATH } from '@/lib/paths';

const BACKUP_VIDEO_PATH = FALLBACK_VIDEO_PATH;

/**
 * Check if a process is truly alive by system PID (kill signal 0).
 * Does not rely on processManager's in-memory Map.
 */
function isPidAlive(pid: number | null): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Force-stop all processes for a task regardless of which manager owns them.
 * Used before starting to ensure clean state.
 */
async function forceKillTask(taskId: string): Promise<void> {
  const processKey = `stream_${taskId}`;

  // 1. Local processManager
  if (processManager.isAlive(processKey)) {
    processManager.stop(processKey);
  }

  // 2. Engine (playlist and single stream)
  try { await engine.stopPlaylist({ taskId: processKey }); } catch { /* ignore */ }
  try { await engine.stopStream({ taskId: processKey }); } catch { /* ignore */ }

  // 3. System-level kill by PID from DB
  const task = await db.streamTask.findUnique({ where: { id: taskId }, select: { currentPid: true } });
  if (task?.currentPid) {
    try {
      process.kill(task.currentPid, 'SIGTERM');
      // Wait then SIGKILL
      await new Promise(r => setTimeout(r, 2000));
      try { process.kill(task.currentPid, 'SIGKILL'); } catch { /* already dead */ }
    } catch { /* pid not found, already dead */ }
  }

  // 4. Reset DB status
  await db.streamTask.update({
    where: { id: taskId },
    data: { status: 'stopped', stoppedAt: new Date(), currentPid: null, isFailoverActive: false },
  });
}

async function startEngineWithAutoRecovery(
  startFn: () => Promise<unknown>,
  stopFn: () => Promise<unknown>,
  taskId: string
): Promise<unknown> {
  try {
    return await startFn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('409') || msg.includes('already running')) {
      console.warn(`[start] Engine reports task ${taskId} already running — stopping stale task first...`);
      try {
        await stopFn();
        console.log(`[start] Stale task ${taskId} stopped, retrying start...`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        return await startFn();
      } catch (stopErr: unknown) {
        const stopMsg = stopErr instanceof Error ? stopErr.message : String(stopErr);
        console.error(`[start] Failed to stop stale task ${taskId}: ${stopMsg}`);
        throw new Error(`引擎状态异常: 任务 ${taskId} 已在引擎中运行但无法停止。请稍后重试或重启引擎服务。`);
      }
    }
    throw err;
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const stream = await db.streamTask.findUnique({
      where: { id },
      include: {
        video: true,
        playlist: {
          include: {
            items: {
              include: {
                video: {
                  select: {
                    id: true,
                    title: true,
                    youtubeId: true,
                    localPath: true,
                    status: true,
                    duration: true,
                  },
                },
              },
              orderBy: { sortOrder: 'asc' },
            },
            backupVideo: {
              select: {
                id: true,
                title: true,
                localPath: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!stream) {
      return NextResponse.json({ error: '推流任务不存在' }, { status: 404 });
    }

    // If task is live, force-kill all processes first to ensure clean start
    // This handles stale DB state where process died but DB still says live
    if (stream.status === 'live' || stream.status === 'error') {
      const pidAlive = isPidAlive(stream.currentPid);
      if (pidAlive) {
        console.log(`[start] Task ${id} has a living PID ${stream.currentPid} — force-killing before start`);
        await forceKillTask(id);
      } else if (stream.status === 'live') {
        console.log(`[start] Task ${id} has status=live but PID dead — just resetting DB`);
        await db.streamTask.update({
          where: { id },
          data: { status: 'stopped', stoppedAt: new Date(), currentPid: null, isFailoverActive: false },
        });
      }
    }

    if (!stream.primaryRtmpUrl) {
      return NextResponse.json({ error: '未设置主推流 RTMP 地址' }, { status: 400 });
    }

    if (!stream.primaryRtmpUrl.startsWith('rtmp://') && !stream.primaryRtmpUrl.startsWith('rtmps://')) {
      return NextResponse.json(
        { error: `主推流地址格式无效，必须以 rtmp:// 或 rtmps:// 开头: ${stream.primaryRtmpUrl}` },
        { status: 400 }
      );
    }

    const now = new Date();
    const taskId = `stream_${id}`;
    let pid: number | undefined;
    let logMetadata: Record<string, unknown> = {};

    // ── Playlist mode ──
    if (stream.playlistId && stream.playlist) {
      const playlist = stream.playlist;
      const videos = playlist.items.map((item) => ({
        id: item.video.id,
        localPath: item.video.localPath,
        youtubeId: item.video.youtubeId,
        sourceUrl: item.video.youtubeId
          ? `https://www.youtube.com/watch?v=${item.video.youtubeId}`
          : undefined,
      }));

      if (videos.length === 0) {
        return NextResponse.json({ error: '播放列表为空，请先添加视频' }, { status: 400 });
      }

      const backupPath =
        playlist.backupVideo?.localPath && existsSync(playlist.backupVideo.localPath)
          ? playlist.backupVideo.localPath
          : existsSync(BACKUP_VIDEO_PATH)
            ? BACKUP_VIDEO_PATH
            : '';

      if (!backupPath) {
        return NextResponse.json(
          { error: '未找到备份视频文件，无法保证直播不中断' },
          { status: 400 }
        );
      }

      const cookiesPath = existsSync(COOKIES_PATH) ? COOKIES_PATH : undefined;

      try {
        const startFn = () =>
          engine.startPlaylist({
            taskId,
            videos,
            primaryRtmp: stream.primaryRtmpUrl,
            backupRtmp: stream.backupRtmpUrl || undefined,
            videoBitrate: stream.videoBitrate || 4000,
            audioBitrate: stream.audioBitrate || 128,
            resolution: stream.resolution || '1920x1080',
            fps: stream.fps || 30,
            preset: stream.preset || 'ultrafast',
            loop: playlist.loop,
            backupVideoPath: backupPath,
            cookiesPath,
          });

        const stopFn = () => engine.stopPlaylist({ taskId });

        const result = await startEngineWithAutoRecovery(startFn, stopFn, taskId) as { pid?: number };

        pid = result.pid;
        logMetadata = {
          mode: 'playlist',
          playlistId: playlist.id,
          playlistName: playlist.name,
          videoCount: videos.length,
          loop: playlist.loop,
          backupVideo: playlist.backupVideo?.title || 'fallback',
          cookiesUsed: !!cookiesPath,
        };
      } catch (engineErr: unknown) {
        const msg = engineErr instanceof Error ? engineErr.message : String(engineErr);
        return NextResponse.json({ error: `引擎启动播放列表失败: ${msg}` }, { status: 500 });
      }
    }
    // ── Single video mode ──
    else {
      if (!stream.video) {
        return NextResponse.json(
          { error: '推流任务未关联视频或播放列表' },
          { status: 400 }
        );
      }

      if (!stream.video.localPath || !existsSync(stream.video.localPath)) {
        return NextResponse.json(
          { error: `视频文件不存在，请先下载或同步: ${stream.video.title}` },
          { status: 400 }
        );
      }

      // Try local process manager first (single video streams use this path)
      // But also handle 409 from engine in case it was previously started there
      try {
        const proc = processManager.startStream({
          taskId,
          inputPath: stream.video.localPath,
          primaryRtmp: stream.primaryRtmpUrl,
          backupRtmp: stream.backupRtmpUrl || undefined,
          videoBitrate: stream.videoBitrate || 4000,
          audioBitrate: stream.audioBitrate || 128,
          resolution: stream.resolution || '1920x1080',
          fps: stream.fps || 30,
          preset: stream.preset || 'ultrafast',
        });

        pid = proc.pid;
        logMetadata = {
          mode: 'single',
          videoId: stream.video.id,
          videoTitle: stream.video.title,
          inputPath: stream.video.localPath,
          primaryRtmp: stream.primaryRtmpUrl,
          backupRtmp: stream.backupRtmpUrl || null,
          videoBitrate: stream.videoBitrate,
          audioBitrate: stream.audioBitrate,
        };

        // Update video useCount
        await db.video.update({
          where: { id: stream.video.id },
          data: { useCount: { increment: 1 }, lastUsedAt: now },
        });

        // Monitor process exit for automatic status update
        // IMPORTANT: verify the process actually died before changing DB status,
        // to avoid false positives from event timing issues
        proc.child.on('exit', async (code, signal) => {
          // Wait briefly then verify the process is truly gone
          await new Promise(resolve => setTimeout(resolve, 500));
          const stillAlive = processManager.isAlive(taskId);
          if (stillAlive) {
            console.log(`[start] Exit event received for ${taskId} but process still alive — ignoring false exit`);
            return;
          }
          try {
            const task = await db.streamTask.findUnique({ where: { id } });
            if (task && task.status === 'live') {
              const stoppedAt = new Date();
              let totalDuration = task.totalDuration || 0;
              if (task.startedAt) {
                const elapsed = Math.floor((stoppedAt.getTime() - task.startedAt.getTime()) / 1000);
                totalDuration += elapsed;
              }
              const newStatus = code === 0 ? 'stopped' : 'error';
              await db.streamTask.update({
                where: { id },
                data: {
                  status: newStatus,
                  stoppedAt,
                  totalDuration,
                  currentPid: null,
                },
              });
              await db.streamLog.create({
                data: {
                  taskId: id,
                  taskType: 'stream',
                  action: code === 0 ? 'stop' : 'error',
                  message: `单视频推流进程退出: code=${code}, signal=${signal}`,
                  metadata: JSON.stringify({ exitCode: code, signal, totalDuration }),
                },
              });
              console.log(`[start] Process ${taskId} exited (code=${code}), DB updated to ${newStatus}`);
            }
          } catch { /* ignore */ }
        });
      } catch (procErr: unknown) {
        const msg = procErr instanceof Error ? procErr.message : String(procErr);
        // If local spawn fails, try via engine as fallback
        console.warn(`[start] Local processManager failed (${msg}), trying engine...`);
        try {
          const videoLocalPath = stream.video?.localPath;
          if (!videoLocalPath) {
            throw new Error('Video localPath is missing');
          }
          const startFn = () =>
            engine.startStream({
              taskId,
              inputPath: videoLocalPath,
              primaryRtmp: stream.primaryRtmpUrl,
              backupRtmp: stream.backupRtmpUrl || undefined,
              videoBitrate: stream.videoBitrate || 4000,
              audioBitrate: stream.audioBitrate || 128,
              resolution: stream.resolution || '1920x1080',
              fps: stream.fps || 30,
              preset: stream.preset || 'ultrafast',
              loopVideo: true,
            });

          const stopFn = () => engine.stopStream({ taskId });
          const result = await startEngineWithAutoRecovery(startFn, stopFn, taskId) as { pid?: number };
          pid = result.pid;
          logMetadata = { mode: 'single-engine', fallback: true };
        } catch (engineErr: unknown) {
          const engineMsg = engineErr instanceof Error ? engineErr.message : String(engineErr);
          return NextResponse.json({ error: `启动推流失败: ${engineMsg}` }, { status: 500 });
        }
      }
    }

    // Update stream status
    const updatedStream = await db.streamTask.update({
      where: { id },
      data: {
        status: 'live',
        startedAt: now,
        stoppedAt: null,
        isFailoverActive: false,
        currentPid: pid || null,
      },
    });

    // Create log
    await db.streamLog.create({
      data: {
        taskId: id,
        taskType: 'stream',
        action: 'start',
        message: `推流 "${stream.name}" 已启动成功${logMetadata.mode === 'playlist' ? '（播放列表模式）' : ''}`,
        metadata: JSON.stringify({ pid, ...logMetadata }),
      },
    });

    return NextResponse.json({ data: updatedStream });
  } catch (error) {
    console.error('Error starting stream:', error);
    const id = (await params).id;
    const errorMsg = error instanceof Error ? error.message : '未知错误';

    try {
      await db.streamTask.update({
        where: { id },
        data: { status: 'error' },
      });
      await db.streamLog.create({
        data: {
          taskId: id,
          taskType: 'stream',
          action: 'error',
          message: `启动推流失败: ${errorMsg}`,
        },
      });
    } catch { /* ignore */ }

    return NextResponse.json(
      { error: `启动推流失败: ${errorMsg}` },
      { status: 500 }
    );
  }
}
