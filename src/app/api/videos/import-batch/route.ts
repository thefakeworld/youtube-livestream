import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videos } = body;

    if (!videos || !Array.isArray(videos) || videos.length === 0) {
      return NextResponse.json({ error: 'Videos array is required' }, { status: 400 });
    }

    let created = 0;

    for (const videoData of videos) {
      // Skip duplicates by youtubeId
      if (videoData.youtubeId) {
        const existing = await db.video.findUnique({
          where: { youtubeId: videoData.youtubeId },
        });
        if (existing) continue;
      }

      await db.video.create({
        data: {
          sourceType: videoData.sourceType || 'youtube_channel',
          youtubeId: videoData.youtubeId || undefined,
          title: videoData.title || 'Untitled Video',
          status: 'pending',
          thumbnailUrl: videoData.youtubeId
            ? `https://i.ytimg.com/vi/${videoData.youtubeId}/hqdefault.jpg`
            : null,
        },
      });
      created++;
    }

    return NextResponse.json({ count: created });
  } catch (error) {
    console.error('Error batch importing videos:', error);
    return NextResponse.json(
      { error: `Failed to import videos: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
