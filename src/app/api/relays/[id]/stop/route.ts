import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processManager } from '@/lib/process-manager';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const relay = await db.relayTask.findUnique({ where: { id } });
    if (!relay) {
      return NextResponse.json({ error: '转播任务不存在' }, { status: 404 });
    }

    if (relay.status !== 'live' && relay.status !== 'error') {
      return NextResponse.json(
        { error: '转播任务当前未在运行' },
        { status: 400 }
      );
    }

    // 真实停止 FFmpeg 转播进程
    const processKey = `relay_${id}`;
    const wasRunning = processManager.isAlive(processKey);
    if (wasRunning) {
      processManager.stop(processKey);
    }

    const now = new Date();
    const durationSeconds = relay.startedAt
      ? Math.floor((now.getTime() - relay.startedAt.getTime()) / 1000)
      : 0;

    // 获取最后的进程统计
    const stats = processManager.getStats(processKey);

    // 更新数据库
    const updatedRelay = await db.relayTask.update({
      where: { id },
      data: {
        status: 'stopped',
        stoppedAt: now,
        currentPid: null,
      },
    });

    // 记录操作日志
    await db.streamLog.create({
      data: {
        taskId: id,
        taskType: 'relay',
        action: 'stop',
        message: `转播 "${relay.name}" 已手动停止。时长: ${Math.floor(durationSeconds / 60)}分${durationSeconds % 60}秒`,
        metadata: JSON.stringify({
          durationSeconds,
          bytesTransferred: relay.bytesTransferred,
          processWasRunning: wasRunning,
          lastStats: stats || null,
        }),
      },
    });

    return NextResponse.json({ data: updatedRelay });
  } catch (error) {
    console.error('Error stopping relay:', error);
    return NextResponse.json(
      { error: `停止转播失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
