import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

const YT_DLP_PATH = '/home/z/.local/bin/yt-dlp';
const COOKIES_PATH = '/home/z/my-project/download/cookies.txt';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, maxVideos = 50 } = body;

    if (!url) {
      return NextResponse.json({ error: 'Channel URL is required' }, { status: 400 });
    }

    const cookiesFlag = existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];

    // Use tab-separated output to avoid conflict with pipe in titles
    // %(title)s can contain | so we use \t as delimiter
    const printFormat = '%(id)s\t%(title)s\t%(duration_string)s\t%(view_count)s\t%(thumbnail)s';

    const buildCmd = (extraArgs: string[] = []) =>
      `"${YT_DLP_PATH}" --flat-playlist --print "${printFormat}" --playlist-end ${maxVideos} --no-warnings ${extraArgs.join(' ')} "${url}"`;

    let stdout = '';

    // Attempt 1: Basic flat-playlist
    const attempts: { cmd: string; label: string }[] = [
      { cmd: buildCmd(cookiesFlag), label: 'basic' },
      { cmd: buildCmd([...cookiesFlag, '--extractor-args', '"youtube:player_client=web"']), label: 'web client' },
      { cmd: buildCmd([...cookiesFlag, '--extractor-args', '"youtube:player_client=mweb"']), label: 'mobile client' },
    ];

    // If no cookies file, add a retry with cookies hint
    if (!existsSync(COOKIES_PATH)) {
      attempts.push({
        cmd: buildCmd([]),
        label: 'basic (recheck)',
      });
    }

    for (const attempt of attempts) {
      try {
        stdout = execSync(attempt.cmd, {
          encoding: 'utf-8',
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024,
        });
        break;
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr || '';
        console.error(`Channel fetch [${attempt.label}] failed:`, stderr.substring(0, 500));
        // Continue to next attempt
      }
    }

    if (!stdout.trim()) {
      return NextResponse.json(
        {
          error:
            '无法获取频道视频。请检查频道地址是否正确，或上传 cookies 文件以解除限制。',
        },
        { status: 500 },
      );
    }

    // Parse tab-separated output
    const lines = stdout.split('\n').filter((line) => line.trim());
    const videos = lines
      .map((line) => {
        const parts = line.split('\t');
        if (parts.length < 2 || !parts[0] || !parts[1]) return null;
        const youtubeId = parts[0].trim();
        const title = parts[1].trim() || 'Untitled';
        const durationStr = parts[2]?.trim() || '';
        const views = parseInt(parts[3]?.trim() || '0', 10);
        const thumbnail = (parts[4]?.trim() && parts[4] !== 'NA')
          ? parts[4].trim()
          : `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;

        // Parse duration string like "10:30" or "1:02:30"
        let duration = 0;
        if (durationStr && durationStr !== 'NA' && durationStr !== 'None' && durationStr !== 'Live') {
          const dParts = durationStr.split(':').map(Number).filter((n) => !isNaN(n));
          if (dParts.length === 3) duration = dParts[0] * 3600 + dParts[1] * 60 + dParts[2];
          else if (dParts.length === 2) duration = dParts[0] * 60 + dParts[1];
          else if (dParts.length === 1) duration = dParts[0];
        }

        return {
          youtubeId,
          title,
          duration,
          views,
          thumbnailUrl: thumbnail,
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      data: videos,
      source: url,
      total: videos.length,
    });
  } catch (error) {
    console.error('Error fetching channel videos:', error);
    return NextResponse.json(
      { error: `Failed to fetch channel videos: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}
