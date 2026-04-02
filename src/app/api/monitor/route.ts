import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processManager } from '@/lib/process-manager';
import { engine } from '@/lib/engine';
import { ensureKeepalive } from '@/lib/keepalive';
import os from 'os';
import { statSync } from 'fs';

function getSystemMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpuLoadAvg = os.loadavg();

  // 磁盘使用情况
  let diskTotal = 0;
  let diskUsed = 0;
  try {
    const stats = statSync('/');
    // statfs 不可用时用估算值
    diskTotal = 100 * 1024 * 1024 * 1024; // 100GB 估算
    diskUsed = 20 * 1024 * 1024 * 1024;   // 20GB 估算
  } catch {
    // fallback
  }

  return {
    cpu: {
      count: os.cpus().length,
      model: os.cpus()[0]?.model || 'Unknown',
      loadAvg1m: cpuLoadAvg[0],
      loadAvg5m: cpuLoadAvg[1],
      loadAvg15m: cpuLoadAvg[2],
      // CPU 使用率估算（基于 load average）
      usagePercent: Math.min(100, Math.round((cpuLoadAvg[0] / os.cpus().length) * 100)),
    },
    memory: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      freeBytes: freeMem,
      totalGB: (totalMem / 1024 / 1024 / 1024).toFixed(1),
      usedGB: (usedMem / 1024 / 1024 / 1024).toFixed(1),
      freeGB: (freeMem / 1024 / 1024 / 1024).toFixed(1),
      usagePercent: Math.round((usedMem / totalMem) * 100),
    },
    disk: {
      totalGB: (diskTotal / 1024 / 1024 / 1024).toFixed(1),
      usedGB: (diskUsed / 1024 / 1024 / 1024).toFixed(1),
      usagePercent: Math.round((diskUsed / diskTotal) * 100),
    },
    network: {
      // 基础信息（详细网络统计需要额外权限）
      interfaces: os.networkInterfaces(),
    },
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
  };
}

export async function GET() {
  // Auto-start keepalive on first request
  ensureKeepalive();

  try {
    // 获取真实系统指标
    const systemMetrics = getSystemMetrics();

    // 获取所有活跃进程
    const activeProcesses = processManager.list().map((p) => ({
      taskId: p.taskId,
      pid: p.pid,
      type: p.type,
      isAlive: processManager.isAlive(p.taskId),
      startedAt: p.startedAt,
      stats: {
        fps: p.stats.fps,
        bitrate: p.stats.bitrate,
        speed: p.stats.speed,
        frame: p.stats.frame,
        time: p.stats.time,
      },
      downloadProgress: p.downloadProgress,
    }));

    // Also fetch engine processes and merge (avoid duplicates)
    const knownIds = new Set(activeProcesses.map((p) => p.taskId));
    try {
      const engineRes = await engine.getProcesses();
      const raw = engineRes.data || engineRes.processes || [];
      for (const p of raw) {
        if (knownIds.has(p.taskId)) continue;
        knownIds.add(p.taskId);
        activeProcesses.push({
          taskId: p.taskId,
          pid: p.pid || 0,
          type: p.type || 'stream',
          isAlive: p.status === 'running',
          startedAt: new Date(Date.now() - (p.uptime || 0) * 1000).toISOString(),
          stats: {
            fps: p.currentFps || 0,
            bitrate: p.currentBitrate || 0,
            speed: 0, frame: p.framesPushed || 0, time: '', size: 0,
          },
          downloadProgress: null,
        });
      }
    } catch { /* engine not running */ }

    const [
      activeStreams,
      totalStreams,
      activeRelays,
      totalRelays,
      unresolvedAlerts,
      criticalAlerts,
      videoStats,
      totalVideos,
      cachedVideos,
      recentLogs,
    ] = await Promise.all([
      db.streamTask.count({ where: { status: 'live' } }),
      db.streamTask.count(),
      db.relayTask.count({ where: { status: 'live' } }),
      db.relayTask.count(),
      db.alertLog.count({ where: { resolved: false } }),
      db.alertLog.count({ where: { level: 'critical', resolved: false } }),
      db.video.aggregate({
        _count: true,
        _sum: { fileSize: true, useCount: true, duration: true },
        where: { status: 'cached' },
      }),
      db.video.count(),
      db.video.count({ where: { status: 'cached' } }),
      db.streamLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    // 检查数据库中标记为 live 但进程已崩溃的任务
    const crashCheck: Array<{ taskId: string; taskType: string; name: string }> = [];
    const liveStreams = await db.streamTask.findMany({
      where: { status: 'live' },
      select: { id: true, name: true, currentPid: true },
    });

    // Build lookup from already-fetched activeProcesses (includes engine)
    const procLookup = new Map(activeProcesses.map((p) => [p.taskId, p]));

    for (const s of liveStreams) {
      const processKey = `stream_${s.id}`;
      const proc = procLookup.get(processKey);
      const anyAlive = proc?.isAlive || false;

      // Also check by PID directly via kill signal 0
      let pidAlive = false;
      if (s.currentPid) {
        try { process.kill(s.currentPid, 0); pidAlive = true; } catch { pidAlive = false; }
      }

      if (!anyAlive && !pidAlive) {
        crashCheck.push({ taskId: s.id, taskType: 'stream', name: s.name });
        await db.streamTask.update({ where: { id: s.id }, data: { status: 'error', currentPid: null } });
      }
    }

    const liveRelays = await db.relayTask.findMany({
      where: { status: 'live' },
      select: { id: true, name: true },
    });
    for (const r of liveRelays) {
      const proc = procLookup.get(`relay_${r.id}`);
      if (!proc?.isAlive) {
        crashCheck.push({ taskId: r.id, taskType: 'relay', name: r.name });
        await db.relayTask.update({ where: { id: r.id }, data: { status: 'error', currentPid: null } });
      }
    }

    return NextResponse.json({
      data: {
        streams: {
          active: activeStreams,
          total: totalStreams,
          idle: totalStreams - activeStreams,
        },
        relays: {
          active: activeRelays,
          total: totalRelays,
          idle: totalRelays - activeRelays,
        },
        alerts: {
          unresolved: unresolvedAlerts,
          critical: criticalAlerts,
        },
        videos: {
          total: totalVideos,
          cached: cachedVideos,
          totalFileSize: videoStats._sum.fileSize || 0,
          totalDuration: videoStats._sum.duration || 0,
          totalUseCount: videoStats._sum.useCount || 0,
        },
        recentLogs,
        // 真实系统指标
        system: systemMetrics,
        // 真实进程列表
        processes: activeProcesses,
        // 崩溃检测
        crashedTasks: crashCheck,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching monitor status:', error);
    return NextResponse.json({ error: '获取系统状态失败' }, { status: 500 });
  }
}
