import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const playlists = await db.playList.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            video: {
              select: {
                id: true,
                title: true,
                duration: true,
                status: true,
                thumbnailUrl: true,
                localPath: true,
              },
            },
          },
        },
        backupVideo: {
          select: { id: true, title: true },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    return NextResponse.json({ data: playlists });
  } catch (error) {
    console.error('Error listing playlists:', error);
    return NextResponse.json({ error: 'Failed to list playlists' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, loop, backupVideoId, videoIds } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const playlist = await db.playList.create({
      data: {
        name,
        description: description || null,
        loop: loop !== false,
        backupVideoId: backupVideoId || null,
        items: {
          create: (videoIds || []).map((videoId: string, index: number) => ({
            videoId,
            sortOrder: index,
          })),
        },
      },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            video: {
              select: {
                id: true,
                title: true,
                duration: true,
                status: true,
                thumbnailUrl: true,
                localPath: true,
              },
            },
          },
        },
        backupVideo: {
          select: { id: true, title: true },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    return NextResponse.json({ data: playlist }, { status: 201 });
  } catch (error) {
    console.error('Error creating playlist:', error);
    return NextResponse.json(
      { error: `Failed to create playlist: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
