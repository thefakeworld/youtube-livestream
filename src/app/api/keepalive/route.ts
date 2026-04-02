import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getKeepaliveStatus } from '@/lib/keepalive';
import { KEEPALIVE_LOG_DIR } from '@/lib/paths';

const LOG_FILE = join(KEEPALIVE_LOG_DIR, 'keepalive.log');

export async function GET() {
  try {
    // Get in-memory status
    const status = getKeepaliveStatus();

    // Read last 30 lines of the log file
    let recentLogLines: string[] = [];
    if (existsSync(LOG_FILE)) {
      const fullLog = readFileSync(LOG_FILE, 'utf-8');
      const allLines = fullLog.split('\n').filter((line) => line.trim().length > 0);
      recentLogLines = allLines.slice(-30);
    }

    return NextResponse.json({
      data: {
        ...status,
        recentLogLines,
      },
    });
  } catch (error) {
    console.error('Error fetching keepalive status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch keepalive status' },
      { status: 500 },
    );
  }
}
