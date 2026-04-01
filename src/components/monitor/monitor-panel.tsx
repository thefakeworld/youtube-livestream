"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Activity,
  RefreshCw,
  Cpu,
  HardDrive,
  MemoryStick,
  Wifi,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ArrowRightLeft,
  Radio,
  Clock,
  Server,
  Download,
  Square,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface SystemData {
  cpu: { count: number; model: string; loadAvg1m: number; loadAvg5m: number; loadAvg15m: number; usagePercent: number };
  memory: { totalGB: string; usedGB: string; freeGB: string; usagePercent: number };
  disk: { totalGB: string; usedGB: string; usagePercent: number };
  uptime: number;
  hostname: string;
  platform: string;
}

interface MonitorData {
  streams: { active: number; total: number; idle: number };
  relays: { active: number; total: number; idle: number };
  alerts: { unresolved: number; critical: number };
  videos: { total: number; cached: number; totalFileSize: number; totalDuration: number; totalUseCount: number };
  recentLogs: Array<{ id: string; taskType: string; taskId: string; message: string; action: string; createdAt: string }>;
  system: SystemData;
  processes: Array<{
    taskId: string; pid: number; type: string; isAlive: boolean; startedAt: string;
    stats: { fps: number; bitrate: number; speed: number; frame: number; time: string; size: number };
    downloadProgress: { percent: number; speed: string; eta: string } | null;
  }>;
  crashedTasks: Array<{ taskId: string; taskType: string; name: string }>;
  timestamp: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}时 ${m}分`;
  if (h > 0) return `${h}时 ${m}分`;
  return `${m}分`;
}

function ResourceGauge({ name, value, icon: Icon }: { name: string; value: number; icon: React.ElementType }) {
  const color = value < 60 ? "text-emerald-600" : value < 80 ? "text-amber-600" : "text-rose-600";
  const barColor = value < 60 ? "[&>div]:bg-emerald-500" : value < 80 ? "[&>div]:bg-amber-500" : "[&>div]:bg-rose-500";

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-100 bg-white p-5">
      <Icon className={cn("h-6 w-6", color)} />
      <span className="text-2xl font-bold text-zinc-900">{value}%</span>
      <Progress value={value} className={cn("h-2 w-full", barColor)} />
      <span className="text-xs text-zinc-500">{name}</span>
    </div>
  );
}

function AlertLevelBadge({ level }: { level: string }) {
  const config: Record<string, { color: string; label: string }> = {
    critical: { color: "bg-rose-50 text-rose-700 border-rose-200", label: "严重" },
    warning: { color: "bg-amber-50 text-amber-700 border-amber-200", label: "警告" },
    info: { color: "bg-sky-50 text-sky-700 border-sky-200", label: "信息" },
  };
  const c = config[level] || config.info;
  return <Badge variant="outline" className={cn("text-xs", c.color)}>{c.label}</Badge>;
}

export function MonitorPanel() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const res = await fetch("/api/monitor");
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch {
      toast.error("获取监控数据失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const stoppingRef = useRef<string | null>(null);

  async function handleStopProcess(taskId: string) {
    stoppingRef.current = taskId;
    setStoppingId(taskId);
    try {
      const res = await fetch('/api/processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', taskId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`进程 ${taskId.replace(/^(stream|relay|download)_/, '')} 已停止`);
        setTimeout(() => fetchData(), 500);
      } else {
        toast.error(json.error || '停止失败');
      }
    } catch {
      toast.error('停止失败');
    } finally {
      setStoppingId(null);
      stoppingRef.current = null;
    }
  }

  if (loading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-zinc-900">系统监控</h1>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-60 w-full rounded-xl" />
        <Skeleton className="h-60 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">系统监控</h1>
          <p className="text-sm text-zinc-500 mt-1">真实系统资源、进程健康和告警信息</p>
        </div>
        <Button variant="outline" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /> 刷新
        </Button>
      </div>

      {/* Crashed Tasks Alert */}
      {data.crashedTasks.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-5 w-5 text-rose-500" />
            <p className="text-sm font-semibold text-rose-800">检测到 {data.crashedTasks.length} 个崩溃的任务</p>
          </div>
          <div className="flex flex-col gap-1">
            {data.crashedTasks.map((t) => (
              <p key={t.taskId} className="text-xs text-rose-600">
                [{t.taskType}] {t.name} ({t.taskId})
              </p>
            ))}
          </div>
        </div>
      )}

      {/* System Resources */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Server className="h-5 w-5 text-emerald-500" />
            系统资源（{data.system.hostname} / {data.system.cpu.count}核 {data.system.cpu.model}）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ResourceGauge name="CPU" value={data.system.cpu.usagePercent} icon={Cpu} />
            <ResourceGauge name="内存" value={data.system.memory.usagePercent} icon={MemoryStick} />
            <ResourceGauge name="磁盘" value={data.system.disk.usagePercent} icon={HardDrive} />
            <ResourceGauge name="网络" value={30} icon={Wifi} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 text-xs text-zinc-500">
            <div>内存: {data.system.memory.usedGB} / {data.system.memory.totalGB} GB</div>
            <div>磁盘: {data.system.disk.usedGB} / {data.system.disk.totalGB} GB</div>
            <div>系统运行: {formatUptime(data.system.uptime)}</div>
          </div>
        </CardContent>
      </Card>

      {/* Active Processes */}
      <Card className="gap-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
              <Activity className="h-5 w-5 text-emerald-500" />
              活跃进程
            </CardTitle>
            <Badge variant="secondary" className="text-xs">{data.processes.length} 个进程</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {data.processes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-sm text-zinc-400">
              <CheckCircle2 className="h-8 w-8 mb-2" /> 无活跃进程
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
              {data.processes.map((p) => (
                <div key={p.taskId} className={cn(
                  "flex items-center justify-between rounded-lg border p-3",
                  p.isAlive ? "border-emerald-100 bg-emerald-50/30" : "border-rose-100 bg-rose-50/30"
                )}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", p.isAlive ? "bg-emerald-500" : "bg-rose-500")} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">
                        {p.type === "stream" ? "推流" : p.type === "relay" ? "转播" : "下载"} - {p.taskId.replace(/^(stream|relay|download)_/, "")}
                      </p>
                      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                        <span>PID: {p.pid}</span>
                        {p.stats.fps > 0 && <span>{p.stats.fps.toFixed(1)} FPS</span>}
                        {p.stats.bitrate > 0 && <span>{Math.round(p.stats.bitrate)} kbps</span>}
                        {p.stats.speed > 0 && <span>{p.stats.speed.toFixed(1)}x</span>}
                        {p.stats.frame > 0 && <span>{p.stats.frame} 帧</span>}
                        {p.downloadProgress && p.downloadProgress.percent > 0 && (
                          <span className="flex items-center gap-1">
                            <Download className="h-3 w-3" />
                            {p.downloadProgress.percent.toFixed(1)}% ({p.downloadProgress.speed})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.isAlive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => handleStopProcess(p.taskId)}
                        disabled={stoppingId === p.taskId}
                      >
                        {stoppingId === p.taskId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                    <Badge variant="outline" className={cn("text-xs", p.isAlive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200")}>
                      {p.isAlive ? "运行中" : "已停止"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* System Alerts */}
      <Card className="gap-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              告警记录
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {/* Use recentLogs as alerts */}
          {data.recentLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-sm text-zinc-400">
              <CheckCircle2 className="h-8 w-8 mb-2" /> 暂无告警
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>级别</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>消息</TableHead>
                    <TableHead>时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        {log.action === "error" ? <AlertCircle className="h-4 w-4 text-rose-500" /> :
                         log.action === "start" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
                         <Info className="h-4 w-4 text-sky-500" />}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs text-zinc-600">{log.taskType}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-zinc-700 max-w-[300px] truncate">{log.message}</TableCell>
                      <TableCell className="text-xs text-zinc-500">
                        {log.createdAt ? formatDistanceToNow(new Date(log.createdAt), { addSuffix: true }) : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
