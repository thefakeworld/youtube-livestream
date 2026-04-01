import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const DOWNLOAD_DIR = '/home/z/my-project/download/videos';

export async function POST() {
  try {
    // Get all videos from the database
    const dbVideos = await db.video.findMany({
      select: { id: true, youtubeId: true, localPath: true, status: true },
    });

    // Build a map of youtubeId -> db record
    const videoMap = new Map<string, (typeof dbVideos)[0]>();
    for (const v of dbVideos) {
      if (v.youtubeId) videoMap.set(v.youtubeId, v);
    }

    let updated = 0;

    // Read files from download directory
    try {
      const files = readdirSync(DOWNLOAD_DIR);
      for (const file of files) {
        if (!file.endsWith('.mp4') && !file.endsWith('.mkv') && !file.endsWith('.webm')) continue;

        const filePath = join(DOWNLOAD_DIR, file);
        const stat = statSync(filePath);

        // Try to extract youtube ID from filename (format: youtubeId.mp4)
        const baseName = file.replace(/\.[^.]+$/, '');
        const dbVideo = videoMap.get(baseName);

        if (dbVideo) {
          if (dbVideo.status !== 'cached' || !dbVideo.localPath) {
            await db.video.update({
              where: { id: dbVideo.id },
              data: {
                status: 'cached',
                localPath: filePath,
                fileSize: stat.size,
                downloadedAt: new Date(),
              },
            });
            updated++;
          }
        }
      }
    } catch {
      // Download directory may not exist yet, that's ok
    }

    // Check for missing files (cached videos whose files no longer exist)
    for (const v of dbVideos) {
      if (v.status === 'cached' && v.localPath) {
        try {
          statSync(v.localPath);
        } catch {
          // File no longer exists
          await db.video.update({
            where: { id: v.id },
            data: {
              status: 'missing',
              localPath: null,
            },
          });
          updated++;
        }
      }
    }

    return NextResponse.json({ count: updated });
  } catch (error) {
    console.error('Error syncing videos:', error);
    return NextResponse.json(
      { error: `Failed to sync videos: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
