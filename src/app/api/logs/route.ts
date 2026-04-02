import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskType = searchParams.get('taskType');
    const taskId = searchParams.get('taskId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);

    const where: Record<string, unknown> = {};

    if (taskType) {
      where.taskType = taskType;
    }
    if (taskId) {
      where.taskId = taskId;
    }

    const [logs, total] = await Promise.all([
      db.streamLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.streamLog.count({ where }),
    ]);

    return NextResponse.json({
      data: logs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('Error listing stream logs:', error);
    return NextResponse.json({ error: 'Failed to list stream logs' }, { status: 500 });
  }
}
