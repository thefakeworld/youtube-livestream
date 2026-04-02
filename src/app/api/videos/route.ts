import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getVideoInfo as ytDlpGetInfo } from '@/lib/yt-dlp';

function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const sourceType = searchParams.get('sourceType');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);

    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }
    if (sourceType) {
      where.sourceType = sourceType;
    }
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { youtubeId: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [videos, total] = await Promise.all([
      db.video.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { streamTasks: true } },
        },
      }),
      db.video.count({ where }),
    ]);

    return NextResponse.json({
      data: videos,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('Error listing videos:', error);
    return NextResponse.json({ error: 'Failed to list videos' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, sourceType } = body;

    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const youtubeId = extractYoutubeId(url);
    const finalSourceType = sourceType || 'youtube_single';

    // Always try to get real video info from yt-dlp
    const info = ytDlpGetInfo(url);

    if (info) {
      const video = await db.video.create({
        data: {
          sourceType: finalSourceType,
          youtubeId: info.id || youtubeId || undefined,
          title: info.title || 'Untitled Video',
          description: info.description?.substring(0, 2000) || null,
          duration: info.duration || 0,
          localPath: null,
          thumbnailUrl: info.thumbnail || (youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null),
          status: 'pending',
          fileSize: info.filesize_approx || 0,
          resolution: info.width && info.height ? `${info.width}x${info.height}` : null,
          codecVideo: info.vcodec || null,
          codecAudio: info.acodec || null,
        },
      });

      return NextResponse.json({
        data: video,
        resolved: true,
        title: video.title,
      }, { status: 201 });
    }

    // Fallback: could not resolve, create minimal record
    const video = await db.video.create({
      data: {
        sourceType: finalSourceType,
        youtubeId: youtubeId || undefined,
        title: youtubeId ? `YouTube Video (${youtubeId})` : 'Pending Info',
        status: 'pending',
        thumbnailUrl: youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null,
      },
    });

    return NextResponse.json({
      data: video,
      resolved: false,
      title: video.title,
      hint: info ? null : 'yt-dlp could not fetch video info. Upload a cookies file in Settings if you encounter bot verification errors.',
    }, { status: 201 });
  } catch (error) {
    console.error('Error importing video:', error);
    return NextResponse.json(
      { error: `Failed to import video: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}
