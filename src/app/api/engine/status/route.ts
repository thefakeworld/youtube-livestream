import { NextResponse } from 'next/server';
import { engine } from '@/lib/engine';
import { isEngineHealthy } from '@/lib/engine-keeper';

export async function GET() {
  try {
    // Check health directly without auto-starting
    const online = await isEngineHealthy();

    if (!online) {
      return NextResponse.json({
        online: false,
        processes: [],
        system: null,
        timestamp: new Date().toISOString(),
      });
    }

    const [healthRes, processesRes, systemRes] = await Promise.all([
      engine.health().catch(() => null),
      engine.getProcesses().catch(() => null),
      engine.getSystem().catch(() => null),
    ]);

    return NextResponse.json({
      online: true,
      health: healthRes,
      processes: processesRes || [],
      system: systemRes || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      online: false,
      processes: [],
      system: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
}
