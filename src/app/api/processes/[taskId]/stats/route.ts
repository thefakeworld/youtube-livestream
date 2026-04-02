import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const proc = processManager.get(taskId);

    if (!proc) {
      return NextResponse.json({ error: '进程不存在' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        taskId: proc.taskId,
        pid: proc.pid,
        type: proc.type,
        isAlive: processManager.isAlive(taskId),
        startedAt: proc.startedAt,
        cmd: proc.cmd,
        stats: processManager.getStats(taskId),
        downloadProgress: processManager.getDownloadProgress(taskId),
      },
    });
  } catch (error) {
    console.error('Error getting process stats:', error);
    return NextResponse.json({ error: '获取进程统计失败' }, { status: 500 });
  }
}
