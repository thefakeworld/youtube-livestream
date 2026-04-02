import { NextRequest, NextResponse } from 'next/server';
import { existsSync, statSync, unlinkSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { DATA_DIR, COOKIES_PATH } from '@/lib/paths';

// Ensure download directory exists
try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch {
  // ignore
}

export async function GET() {
  try {
    if (existsSync(COOKIES_PATH)) {
      const stat = statSync(COOKIES_PATH);
      return NextResponse.json({
        data: {
          exists: true,
          size: stat.size,
          uploadedAt: stat.mtime.toISOString(),
        },
      });
    }

    return NextResponse.json({
      data: {
        exists: false,
      },
    });
  } catch (error) {
    console.error('Error checking cookies:', error);
    return NextResponse.json({ data: { exists: false } });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    await writeFile(COOKIES_PATH, buffer);

    return NextResponse.json({
      success: true,
      data: {
        exists: true,
        size: buffer.length,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error uploading cookies:', error);
    return NextResponse.json(
      { error: `Failed to upload cookies: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    if (existsSync(COOKIES_PATH)) {
      unlinkSync(COOKIES_PATH);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing cookies:', error);
    return NextResponse.json({ error: 'Failed to remove cookies' }, { status: 500 });
  }
}
