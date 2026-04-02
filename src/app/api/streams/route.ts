import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }

    const streams = await db.streamTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        video: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            duration: true,
            status: true,
          },
        },
        playlist: {
          select: {
            id: true,
            name: true,
            loop: true,
            _count: { select: { items: true } },
            backupVideo: { select: { id: true, title: true } },
          },
        },
      },
    });

    return NextResponse.json({ data: streams });
  } catch (error) {
    console.error('Error listing stream tasks:', error);
    return NextResponse.json({ error: 'Failed to list stream tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      videoId,
      playlistId,
      primaryRtmpUrl,
      backupRtmpUrl,
      videoBitrate,
      audioBitrate,
      resolution,
      fps,
      preset,
    } = body;

    if (!name || !primaryRtmpUrl) {
      return NextResponse.json(
        { error: 'name and primaryRtmpUrl are required' },
        { status: 400 }
      );
    }

    const stream = await db.streamTask.create({
      data: {
        name,
        videoId: videoId || null,
        playlistId: playlistId || null,
        primaryRtmpUrl,
        backupRtmpUrl: backupRtmpUrl || null,
        videoBitrate: videoBitrate || 4500,
        audioBitrate: audioBitrate || 128,
        resolution: resolution || '1920x1080',
        fps: fps || 30,
        preset: preset || 'ultrafast',
      },
      include: {
        video: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            duration: true,
            status: true,
          },
        },
        playlist: {
          select: {
            id: true,
            name: true,
            loop: true,
            _count: { select: { items: true } },
            backupVideo: { select: { id: true, title: true } },
          },
        },
      },
    });

    return NextResponse.json({ data: stream }, { status: 201 });
  } catch (error) {
    console.error('Error creating stream task:', error);
    return NextResponse.json({ error: 'Failed to create stream task' }, { status: 500 });
  }
}
