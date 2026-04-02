import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ENGINE_BASE_URL, LOG_DIR } from '@/lib/paths';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(_request.url);

    const since = parseInt(searchParams.get('since') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '200', 10);

    const processKey = `stream_${id}`;

    // ── 1. Try engine (port 3001) first ──
    try {
      const url = `${ENGINE_BASE_URL}/api/processes/${processKey}/output?since=${since}&limit=${limit}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });

      if (res.ok) {
        const json = await res.json();
        return NextResponse.json({
          data: json.data ?? json.lines ?? [],
          seq: json.seq ?? since,
          from: 'engine',
        });
      }
    } catch {
      // Engine not reachable — fall through to local fallback
    }

    // ── 2. Fall back to local processManager ──
    const proc = processManager.get(processKey);
    if (proc) {
      const allLogs = proc.logs;
      // Split multi-line chunks into individual lines
      const lines = allLogs
        .flatMap((chunk) => chunk.split('\n'))
        .filter((line) => line.trim().length > 0);

      const sliced = lines.slice(since, since + limit);
      return NextResponse.json({
        data: sliced,
        seq: since + sliced.length,
        from: 'local',
      });
    }

    // ── 3. Fall back to log file ──
    const logFile = join(LOG_DIR, `stream_${id}.log`);
    if (existsSync(logFile)) {
      const content = readFileSync(logFile, 'utf-8');
      const lines = content
        .split('\n')
        .filter((line) => line.trim().length > 0);

      const sliced = lines.slice(since, since + limit);
      return NextResponse.json({
        data: sliced,
        seq: since + sliced.length,
        from: 'file',
      });
    }

    // ── 4. No logs available anywhere ──
    return NextResponse.json({
      data: [],
      seq: since,
      from: 'local',
    });
  } catch (error) {
    console.error('Error fetching stream output:', error);
    return NextResponse.json(
      { error: `Failed to fetch stream output: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
