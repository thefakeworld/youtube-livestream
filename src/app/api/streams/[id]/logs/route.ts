import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(_request.url);

    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const sinceId = searchParams.get('sinceId');

    // Build WHERE clause
    const where: Prisma.StreamLogWhereInput = {
      taskId: id,
    };

    // If sinceId is provided, only return logs created after that log's timestamp
    if (sinceId) {
      const sinceLog = await db.streamLog.findUnique({
        where: { id: sinceId },
        select: { createdAt: true },
      });

      if (sinceLog) {
        where.createdAt = { gt: sinceLog.createdAt };
      }
    }

    const logs = await db.streamLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ data: logs });
  } catch (error) {
    console.error('Error fetching stream logs:', error);
    return NextResponse.json(
      { error: `Failed to fetch stream logs: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
