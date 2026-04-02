import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(_request: NextRequest) {
  try {
    const relays = await db.relayTask.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        targets: true,
      },
    });

    return NextResponse.json({ data: relays });
  } catch (error) {
    console.error('Error listing relay tasks:', error);
    return NextResponse.json({ error: 'Failed to list relay tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, sourceYoutubeUrl, sourceQuality, targets } = body;

    if (!name || !sourceYoutubeUrl) {
      return NextResponse.json(
        { error: 'name and sourceYoutubeUrl are required' },
        { status: 400 }
      );
    }

    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json(
        { error: 'At least one target is required' },
        { status: 400 }
      );
    }

    const relay = await db.relayTask.create({
      data: {
        name,
        sourceYoutubeUrl,
        sourceQuality: sourceQuality || 'best',
        targets: {
          create: targets.map(
            (t: { platform: string; rtmpUrl: string; streamKey?: string; enabled?: boolean }) => ({
              platform: t.platform,
              rtmpUrl: t.rtmpUrl,
              streamKey: t.streamKey || null,
              enabled: t.enabled !== false,
            })
          ),
        },
      },
      include: {
        targets: true,
      },
    });

    return NextResponse.json({ data: relay }, { status: 201 });
  } catch (error) {
    console.error('Error creating relay task:', error);
    return NextResponse.json({ error: 'Failed to create relay task' }, { status: 500 });
  }
}
