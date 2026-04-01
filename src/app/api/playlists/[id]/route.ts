import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const playlist = await db.playList.findUnique({
      where: { id },
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

    if (!playlist) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    return NextResponse.json({ data: playlist });
  } catch (error) {
    console.error('Error fetching playlist:', error);
    return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, loop, backupVideoId, videoIds } = body;

    const existing = await db.playList.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    // Delete existing items and recreate with new order
    if (videoIds && Array.isArray(videoIds)) {
      await db.playListItem.deleteMany({ where: { playlistId: id } });
    }

    const playlist = await db.playList.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existing.name,
        description: description !== undefined ? description || null : existing.description,
        loop: loop !== undefined ? loop : existing.loop,
        backupVideoId: backupVideoId !== undefined ? backupVideoId || null : existing.backupVideoId,
        ...(videoIds && Array.isArray(videoIds)
          ? {
              items: {
                create: videoIds.map((videoId: string, index: number) => ({
                  videoId,
                  sortOrder: index,
                })),
              },
            }
          : {}),
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

    return NextResponse.json({ data: playlist });
  } catch (error) {
    console.error('Error updating playlist:', error);
    return NextResponse.json(
      { error: `Failed to update playlist: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await db.playList.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    await db.playList.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    return NextResponse.json({ error: 'Failed to delete playlist' }, { status: 500 });
  }
}
