/**
 * Stream Engine Client
 * 
 * Calls the FFmpeg stream engine running on port 3001 via localhost.
 * Used by server-side API routes (direct localhost connection).
 * 
 * Auto-starts the engine if it's not running (sandbox environment compatibility).
 */

import { ensureEngineRunning } from './engine-keeper';

const ENGINE_BASE = 'http://127.0.0.1:3001';

async function callEngine(path: string, options?: RequestInit): Promise<any> {
  // Ensure engine is running before every call
  const running = await ensureEngineRunning();
  if (!running) {
    throw new Error('引擎服务启动失败，请稍后重试');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${ENGINE_BASE}${normalizedPath}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Engine error ${res.status}: ${text}`);
  }

  return res.json();
}

export const engine = {
  health: () => callEngine('/health'),

  startStream: (data: {
    taskId: string;
    inputPath: string;
    primaryRtmp: string;
    backupRtmp?: string;
    videoBitrate?: number;
    audioBitrate?: number;
    resolution?: string;
    fps?: number;
    preset?: string;
    loopVideo?: boolean;
  }) =>
    callEngine('/api/stream/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  stopStream: (data: { taskId: string }) =>
    callEngine('/api/stream/stop', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  startRelay: (data: {
    taskId: string;
    sourceUrl: string;
    sourceQuality?: string;
    targets: { platform: string; rtmpUrl: string; streamKey: string }[];
  }) =>
    callEngine('/api/relay/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  stopRelay: (data: { taskId: string }) =>
    callEngine('/api/relay/stop', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  startPlaylist: (data: {
    taskId: string;
    videos: Array<{
      id: string;
      localPath: string | null;
      youtubeId?: string | null;
      sourceUrl?: string;
    }>;
    primaryRtmp: string;
    backupRtmp?: string;
    videoBitrate?: number;
    audioBitrate?: number;
    resolution?: string;
    fps?: number;
    preset?: string;
    loop?: boolean;
    backupVideoPath: string;
    cookiesPath?: string;
  }) =>
    callEngine('/api/playlist/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  stopPlaylist: (data: { taskId: string }) =>
    callEngine('/api/playlist/stop', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getProcesses: () => callEngine('/api/processes'),

  getProcess: (taskId: string) => callEngine(`/api/processes/${taskId}`),

  getSystem: () => callEngine('/api/system'),
};
