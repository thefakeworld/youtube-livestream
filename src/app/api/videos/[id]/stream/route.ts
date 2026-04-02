import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { statSync, createReadStream, existsSync } from 'fs';
import { join, extname } from 'path';
import { VIDEOS_DIR } from '@/lib/paths';

const VIDEO_DIR = VIDEOS_DIR;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const video = await db.video.findUnique({
      where: { id },
      select: { id: true, localPath: true, status: true },
    });

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Determine file path
    let filePath = video.localPath;
    if (!filePath || !existsSync(filePath)) {
      // Try by youtubeId or id as filename
      const candidates = [
        join(VIDEO_DIR, `${video.id}.mp4`),
        join(VIDEO_DIR, `${video.id}.mkv`),
        join(VIDEO_DIR, `${video.id}.webm`),
      ];
      const fallback = candidates.find(existsSync);
      if (!fallback) {
        return NextResponse.json({ error: 'Video file not found on disk' }, { status: 404 });
      }
      filePath = fallback;
    }

    const stat = statSync(filePath);
    const fileSize = stat.size;
    const ext = extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.flv': 'video/x-flv',
    };
    const contentType = mimeTypes[ext] || 'video/mp4';

    // Range request support for seeking
    const rangeHeader = _request.headers.get('range');

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = createReadStream(filePath, { start, end });

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': contentType,
        },
      });
    }

    // Full file response
    const stream = createReadStream(filePath);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error) {
    console.error('Error streaming video:', error);
    return NextResponse.json({ error: 'Failed to stream video' }, { status: 500 });
  }
}
