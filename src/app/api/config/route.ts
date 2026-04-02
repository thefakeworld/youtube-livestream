import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const configs = await db.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });

    return NextResponse.json({ data: configs });
  } catch (error) {
    console.error('Error fetching configs:', error);
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be an array of config entries' },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      body.map(
        async (entry: { key: string; value?: string; description?: string }) => {
          if (!entry.key) {
            return { key: entry.key, error: 'key is required' };
          }

          const config = await db.systemConfig.upsert({
            where: { key: entry.key },
            update: {
              value: entry.value !== undefined ? entry.value : undefined,
              description: entry.description !== undefined ? entry.description : undefined,
            },
            create: {
              key: entry.key,
              value: entry.value || null,
              description: entry.description || null,
            },
          });

          return { key: entry.key, success: true, data: config };
        }
      )
    );

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error('Error updating configs:', error);
    return NextResponse.json({ error: 'Failed to update configs' }, { status: 500 });
  }
}
