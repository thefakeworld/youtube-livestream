"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface ProcessInfo {
  taskId: string;
  pid: number;
  type: string;
  isAlive: boolean;
  startedAt: string;
  stats: {
    fps: number;
    bitrate: number;
    speed: number;
    frame: number;
    time: string;
    size: number;
  };
  downloadProgress: { percent: number; speed: string; eta: string } | null;
}

interface SystemInfo {
  cpu: { count: number; model: string; usagePercent: number };
  memory: { totalGB: string; usedGB: string; freeGB: string; usagePercent: number };
  disk: { totalGB: string; usedGB: string; usagePercent: number };
  uptime: number;
  hostname: string;
  platform: string;
}

export interface MonitorStatus {
  streams: { active: number; total: number; idle: number };
  relays: { active: number; total: number; idle: number };
  alerts: { unresolved: number; critical: number };
  videos: { total: number; cached: number; totalFileSize: number; totalDuration: number; totalUseCount: number };
  recentLogs: Array<{ id: string; taskType: string; taskId: string; message: string; action: string; createdAt: string }>;
  system: SystemInfo;
  processes: ProcessInfo[];
  crashedTasks: Array<{ taskId: string; taskType: string; name: string }>;
  timestamp: string;
}

export function useMonitorStatus(intervalMs = 10000) {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor");
      if (res.ok) {
        const json = await res.json();
        setStatus(json.data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus, intervalMs]);

  return { status, loading, refetch: fetchStatus };
}
