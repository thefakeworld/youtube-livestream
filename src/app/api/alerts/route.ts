import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level');
    const resolved = searchParams.get('resolved');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);

    const where: Record<string, unknown> = {};

    if (level) {
      where.level = level;
    }
    if (resolved !== null && resolved !== undefined && resolved !== '') {
      where.resolved = resolved === 'true';
    }

    const [alerts, total] = await Promise.all([
      db.alertLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.alertLog.count({ where }),
    ]);

    return NextResponse.json({
      data: alerts,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('Error listing alerts:', error);
    return NextResponse.json({ error: 'Failed to list alerts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level, type, message, taskId, resolved } = body;

    if (!type || !message) {
      return NextResponse.json(
        { error: 'type and message are required' },
        { status: 400 }
      );
    }

    const validLevels = ['info', 'warning', 'critical'];
    const finalLevel = validLevels.includes(level) ? level : 'info';

    const alert = await db.alertLog.create({
      data: {
        level: finalLevel,
        type,
        message,
        taskId: taskId || null,
        resolved: resolved || false,
      },
    });

    return NextResponse.json({ data: alert }, { status: 201 });
  } catch (error) {
    console.error('Error creating alert:', error);
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}
