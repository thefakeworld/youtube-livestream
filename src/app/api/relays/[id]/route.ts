import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const relay = await db.relayTask.findUnique({
      where: { id },
      include: {
        targets: true,
      },
    });

    if (!relay) {
      return NextResponse.json({ error: 'Relay task not found' }, { status: 404 });
    }

    return NextResponse.json({ data: relay });
  } catch (error) {
    console.error('Error fetching relay task:', error);
    return NextResponse.json({ error: 'Failed to fetch relay task' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.relayTask.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Relay task not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    const allowedFields = ['name', 'sourceYoutubeUrl', 'sourceQuality', 'status'];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Handle target updates if provided
    if (body.targets && Array.isArray(body.targets)) {
      await db.relayTarget.deleteMany({ where: { relayTaskId: id } });
      updateData.targets = {
        create: body.targets.map(
          (t: { platform: string; rtmpUrl: string; streamKey?: string; enabled?: boolean }) => ({
            platform: t.platform,
            rtmpUrl: t.rtmpUrl,
            streamKey: t.streamKey || null,
            enabled: t.enabled !== false,
          })
        ),
      };
    }

    const relay = await db.relayTask.update({
      where: { id },
      data: updateData,
      include: {
        targets: true,
      },
    });

    return NextResponse.json({ data: relay });
  } catch (error) {
    console.error('Error updating relay task:', error);
    return NextResponse.json({ error: 'Failed to update relay task' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.relayTask.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Relay task not found' }, { status: 404 });
    }

    if (existing.status === 'live') {
      return NextResponse.json(
        { error: 'Cannot delete a live relay. Stop it first.' },
        { status: 400 }
      );
    }

    // Targets are deleted via cascade
    await db.relayTask.delete({ where: { id } });

    return NextResponse.json({ message: 'Relay task deleted successfully' });
  } catch (error) {
    console.error('Error deleting relay task:', error);
    return NextResponse.json({ error: 'Failed to delete relay task' }, { status: 500 });
  }
}
