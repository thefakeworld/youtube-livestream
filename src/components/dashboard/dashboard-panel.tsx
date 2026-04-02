"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Radio,
  Share2,
  Video,
  AlertTriangle,
  TrendingUp,
  Clock,
  Cpu,
  HardDrive,
 MemoryStick,
  Wifi,
  Activity,
  Zap,
  Square,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface MonitorData {
  streams: { active: number; total: number; idle: number };
  relays: { active: number; total: number; idle: number };
  alerts: { unresolved: number; critical: number };
  videos: {
    total: number;
    cached: number;
    totalFileSize: number;
    totalDuration: number;
    totalUseCount: number;
  };
  recentLogs: {
    id: string;
    taskType: string;
    taskId: string;
    message: string;
    createdAt: string;
    action: string;
  }[];
  system: {
    cpu: { count: number; model: string; usagePercent: number };
    memory: { totalGB: string; usedGB: string; usagePercent: number };
    disk: { totalGB: string; usedGB: string; usagePercent: number };
    uptime: number;
    hostname: string;
    platform: string;
  } | null;
  processes: Array<{
    taskId: string; pid: number; type: string; isAlive: boolean; startedAt: string;
    stats: { fps: number; bitrate: number; speed: number; frame: number; time: string };
  }> | null;
  crashedTasks: Array<{ taskId: string; taskType: string; name: string }> | null;
  timestamp: string;
}

// Live FPS/Bitrate history for the mini chart (rolling window)
interface ChartDataPoint {
  time: string;
  fps: number;
  bitrate: number;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytesLocal(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatNumberLocal(n: number): string {
  return n?.toLocaleString() || "0";
}

function formatUptimeLocal(seconds: number): string {
  if (!seconds || seconds < 0) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  dotColor,
  loading,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: string;
  dotColor?: string;
  loading?: boolean;
}) {
  return (
    <Card className="gap-4">
      <CardContent className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-zinc-500">{title}</p>
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-bold text-zinc-900">{value}</p>
          )}
          {trend && !loading && (
            <div className="flex items-center gap-1 text-xs text-zinc-400">
              <TrendingUp className="h-3 w-3 text-emerald-500" />
              <span>{trend}</span>
            </div>
          )}
        </div>
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100",
          )}
        >
          <Icon className="h-5 w-5 text-zinc-600" />
        </div>
      </CardContent>
    </Card>
  );
}

function ResourceBar({
  label,
  icon: Icon,
  value,
  max,
  unit,
  colorFn,
}: {
  label: string;
  icon: React.ElementType;
  value: number;
  max: number;
  unit?: string;
  colorFn: (v: number) => string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const barColor = colorFn(pct);
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 w-28 shrink-0">
        <Icon className="h-4 w-4 text-zinc-500" />
        <span className="text-xs text-zinc-600 font-medium">{label}</span>
      </div>
      <Progress
        value={pct}
        className={cn("h-2 flex-1", barColor)}
      />
      <span className="text-xs text-zinc-600 font-mono w-16 text-right">
        {unit
          ? `${formatBytesLocal(value)}`
          : `${value.toFixed(1)}%`}
      </span>
    </div>
  );
}

export function DashboardPanel() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fpsHistory, setFpsHistory] = useState<ChartDataPoint[]>([]);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMonitor = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor");
      if (res.ok) {
        const json = await res.json();
        setData(json.data);

        // Build live chart data from processes
        const procs = json.data?.processes || [];
        if (procs.length > 0) {
          const now = new Date();
          const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
          const avgFps = procs.reduce((sum: number, p: Record<string, unknown>) => sum + ((p.stats as Record<string, unknown>)?.fps as number || 0), 0) / procs.length;
          const avgBitrate = procs.reduce((sum: number, p: Record<string, unknown>) => sum + ((p.stats as Record<string, unknown>)?.bitrate as number || 0), 0) / procs.length;

          setFpsHistory((prev) => {
            const next = [...prev, { time: timeStr, fps: Math.round(avgFps * 10) / 10, bitrate: Math.round(avgBitrate) }];
            return next.slice(-30); // Keep last 30 points
          });
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitor();
    intervalRef.current = setInterval(fetchMonitor, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMonitor]);

  const hasActiveStreams = (data?.streams?.active ?? 0) > 0 || (data?.relays?.active ?? 0) > 0;
  const system = data?.system;
  const processes = data?.processes || [];
  const streamProcesses = processes.filter((p: Record<string, unknown>) => p.type === "stream" && p.isAlive);
  const relayProcesses = processes.filter((p: Record<string, unknown>) => p.type === "relay" && p.isAlive);

  async function handleStopProcess(taskId: string) {
    setStoppingId(taskId);
    try {
      const res = await fetch('/api/processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', taskId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`进程 ${String(taskId).replace(/^(stream|relay|download)_/, '')} 已停止`);
        setTimeout(() => fetchMonitor(), 500);
      } else {
        toast.error(json.error || '停止失败');
      }
    } catch {
      toast.error('停止失败');
    } finally {
      setStoppingId(null);
    }
  }

  const pieData = data
    ? [
        { name: "Used", value: data.videos.totalFileSize, fill: "#10b981" },
        {
          name: "Available",
          value: Math.max(0, 50 * 1024 * 1024 * 1024 - data.videos.totalFileSize),
          fill: "#e4e4e7",
        },
      ]
    : [];

  const resourceColor = (pct: number) =>
    pct < 60
      ? "[&>div]:bg-emerald-500"
      : pct < 80
        ? "[&>div]:bg-amber-500"
        : "[&>div]:bg-rose-500";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">
            System overview and live activity
          </p>
        </div>
        {/* Engine Status Badge */}
        <Badge
          variant="outline"
          className={cn(
            "gap-1.5 px-3 py-1 text-xs font-semibold",
            data
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-zinc-50 text-zinc-600 border-zinc-200",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              data ? "bg-emerald-500" : "bg-zinc-400",
            )}
          />
          {data ? `${processes.length} Processes` : "Loading..."}
        </Badge>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Streams"
          value={data?.streams.active ?? 0}
          icon={Radio}
          dotColor="bg-emerald-500"
          trend="Live now"
          loading={loading}
        />
        <StatCard
          title="Active Relays"
          value={data?.relays.active ?? 0}
          icon={Share2}
          dotColor="bg-emerald-500"
          trend="Live now"
          loading={loading}
        />
        <StatCard
          title="Video Library"
          value={loading ? "..." : `${data?.videos.cached ?? 0}/${data?.videos.total ?? 0}`}
          icon={Video}
          trend={`Total ${formatBytesLocal(data?.videos.totalFileSize ?? 0)}`}
          loading={loading}
        />
        <StatCard
          title="Unresolved Alerts"
          value={data?.alerts.unresolved ?? 0}
          icon={AlertTriangle}
          trend={data?.alerts.critical ? `${data.alerts.critical} critical` : undefined}
          dotColor="bg-rose-500"
          loading={loading}
        />
      </div>

      {/* System Resources + Live FPS Chart */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* System Resources */}
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
              <Activity className="h-5 w-5 text-emerald-500" />
              System Resources
              {!system && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-200 bg-amber-50">
                  No Data
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : system ? (
              <div className="flex flex-col gap-4">
                <ResourceBar
                  label="CPU"
                  icon={Cpu}
                  value={system.cpu?.usagePercent || 0}
                  max={100}
                  colorFn={resourceColor}
                />
                <ResourceBar
                  label="Memory"
                  icon={MemoryStick}
                  value={system.memory?.usagePercent || 0}
                  max={100}
                  colorFn={resourceColor}
                />
                <ResourceBar
                  label="Disk"
                  icon={HardDrive}
                  value={system.disk?.usagePercent || 0}
                  max={100}
                  colorFn={resourceColor}
                />
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 w-28 shrink-0">
                    <Wifi className="h-4 w-4 text-zinc-500" />
                    <span className="text-xs text-zinc-600 font-medium">Network</span>
                  </div>
                  <div className="flex items-center gap-4 flex-1 text-xs text-zinc-600">
                    <span className="flex items-center gap-1">
                      <span className="text-emerald-500">&#x2193;</span>
                      {formatBytesLocal(parseInt(system.memory?.usedGB || "0") * 1024 * 1024 * 1024)} used
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-sky-500">&#x2191;</span>
                      {formatBytesLocal(parseInt(system.disk?.usedGB || "0") * 1024 * 1024 * 1024)} used
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-sm text-zinc-400">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Engine offline — no system data
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live FPS/Bitrate Chart */}
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
              <Zap className="h-5 w-5 text-emerald-500" />
              Live Stream Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : fpsHistory.length > 1 ? (
              <ChartContainer
                config={{
                  fps: { label: "FPS", color: "#10b981" },
                  bitrate: { label: "Bitrate (kbps)", color: "#14b8a6" },
                }}
                className="h-[240px] w-full"
              >
                <LineChart data={fpsHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis
                    dataKey="time"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="fps"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    allowDecimals={false}
                  />
                  <YAxis
                    yAxisId="bitrate"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    yAxisId="fps"
                    type="monotone"
                    dataKey="fps"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="bitrate"
                    type="monotone"
                    dataKey="bitrate"
                    stroke="#14b8a6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[240px] text-sm text-zinc-400">
                {hasActiveStreams ? (
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 animate-pulse text-emerald-500" />
                    Waiting for stream data...
                  </div>
                ) : (
                  <>
                    <Activity className="h-8 w-8 mb-2 text-zinc-300" />
                    No active streams to monitor
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Processes + Storage */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Active Processes (Real Data) */}
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
              <div className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </div>
              Active Processes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {processes.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-sm text-zinc-400">
                No running processes
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {processes.map((proc: Record<string, unknown>) => (
                  <div
                    key={proc.taskId}
                    className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50/50 p-3"
                  >
                    <div
                      className={cn(
                        "h-2.5 w-2.5 rounded-full shrink-0",
                        proc.status === "running"
                          ? proc.type === "stream"
                            ? "bg-emerald-500"
                            : "bg-teal-500"
                          : "bg-zinc-400",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-800 truncate">
                          {proc.taskId}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500">
                        <span>PID: {proc.pid}</span>
                        <span>Uptime: {formatUptimeLocal(proc.startedAt ? formatDistanceToNow(new Date(proc.startedAt)) : "-")}</span>
                        {((proc.stats as Record<string, unknown>)?.fps as number || 0) > 0 && <span>{((proc.stats as Record<string, unknown>)?.fps as number || 0).toFixed(1)} fps</span>}
                        {((proc.stats as Record<string, unknown>)?.bitrate as number || 0) > 0 && <span>{formatNumberLocal(Math.round((proc.stats as Record<string, unknown>)?.bitrate as number || 0))} kbps</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {proc.isAlive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => handleStopProcess(String(proc.taskId))}
                          disabled={stoppingId === proc.taskId}
                        >
                          {stoppingId === proc.taskId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Square className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 text-zinc-500"
                      >
                        {proc.type}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Storage Usage Pie Chart */}
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-zinc-900">
              Video Storage Usage
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {loading ? (
              <Skeleton className="h-[260px] w-[260px] rounded-full" />
            ) : (
              <div className="flex flex-col items-center gap-4">
                <ChartContainer
                  config={{
                    Used: { label: "Used", color: "#10b981" },
                    Available: { label: "Available", color: "#e4e4e7" },
                  }}
                  className="h-[220px] w-[220px]"
                >
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
                <div className="text-center">
                  <p className="text-lg font-bold text-zinc-900">
                    {formatBytesLocal(data?.videos.totalFileSize ?? 0)}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {data?.videos.cached ?? 0} cached videos
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="gap-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold text-zinc-900">
              Recent Activity
            </CardTitle>
            <Clock className="h-4 w-4 text-zinc-400" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : data?.recentLogs && data.recentLogs.length > 0 ? (
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {data.recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded-lg border border-zinc-100 bg-zinc-50/50 p-3"
                >
                  <div
                    className={cn(
                      "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                      log.action === "error" || log.message?.toLowerCase().includes("error")
                        ? "bg-rose-500"
                        : log.action === "stop" || log.message?.toLowerCase().includes("warn")
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-700 truncate">{log.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 text-zinc-500"
                      >
                        {log.taskType}
                      </Badge>
                      <span className="text-[11px] text-zinc-400">
                        {log.createdAt
                          ? formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })
                          : ""}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-sm text-zinc-400">
              No recent activity
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Row */}
      {!loading && data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
                <div className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                Stream Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold text-zinc-900">{data.streams.total}</p>
                  <p className="text-xs text-zinc-500">Total Tasks</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-600">{data.streams.active}</p>
                  <p className="text-xs text-zinc-500">Currently Live</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-900">{data.streams.idle}</p>
                  <p className="text-xs text-zinc-500">Idle</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-900">
                    {formatDuration(data.videos.totalDuration)}
                  </p>
                  <p className="text-xs text-zinc-500">Total Duration</p>
                </div>
              </div>
              {/* Real stream process stats */}
              {streamProcesses.length > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-100">
                  <p className="text-xs text-zinc-500 mb-2 font-medium">Live Stream Stats</p>
                  <div className="grid grid-cols-3 gap-2">
                    {streamProcesses.map((proc: Record<string, unknown>) => (
                      <div key={proc.taskId} className="rounded-md bg-emerald-50 p-2 text-center">
                        <p className="text-xs text-emerald-700 font-medium">{((proc.stats as Record<string, unknown>)?.fps as number || 0).toFixed(1)} fps</p>
                        <p className="text-[10px] text-emerald-600">{formatNumberLocal(Math.round((proc.stats as Record<string, unknown>)?.bitrate as number || 0))} kbps</p>
                        <p className="text-[10px] text-emerald-500">{formatNumberLocal((proc.stats as Record<string, unknown>)?.frame as number || 0)} frames</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
                <div className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500" />
                </div>
                Relay Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold text-zinc-900">{data.relays.total}</p>
                  <p className="text-xs text-zinc-500">Total Tasks</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-teal-600">{data.relays.active}</p>
                  <p className="text-xs text-zinc-500">Currently Active</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-900">{data.relays.idle}</p>
                  <p className="text-xs text-zinc-500">Idle</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-900">{data.videos.totalUseCount}</p>
                  <p className="text-xs text-zinc-500">Total Uses</p>
                </div>
              </div>
              {/* Real relay process stats */}
              {relayProcesses.length > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-100">
                  <p className="text-xs text-zinc-500 mb-2 font-medium">Live Relay Stats</p>
                  <div className="grid grid-cols-3 gap-2">
                    {relayProcesses.map((proc: Record<string, unknown>) => (
                      <div key={proc.taskId} className="rounded-md bg-teal-50 p-2 text-center">
                        <p className="text-xs text-teal-700 font-medium">{formatBytesLocal(0)}</p>
                        <p className="text-[10px] text-teal-600">transferred</p>
                        <p className="text-[10px] text-teal-500">{formatUptimeLocal(proc.startedAt ? formatDistanceToNow(new Date(proc.startedAt)) : "-")}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
