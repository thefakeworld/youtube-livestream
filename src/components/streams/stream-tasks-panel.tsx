"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Radio,
  Play,
  Square,
  Trash2,
  Plus,
  Edit2,
  ImageIcon,
  ArrowRightLeft,
  MonitorPlay,
  MoreVertical,
  AlertCircle,
  ListVideo,
  Film,
  RotateCcw,
  ShieldCheck,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { StreamLogDialog } from "./stream-log-dialog";

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

interface VideoRef {
  id: string;
  title: string;
  thumbnailUrl?: string;
  duration: number;
  status: string;
}

interface StreamTask {
  id: string;
  name: string;
  videoId: string;
  video?: VideoRef;
  playlistId?: string;
  playlist?: {
    id: string;
    name: string;
    loop: boolean;
    _count?: { items: number };
    backupVideo?: { id: string; title: string };
  };
  primaryRtmpUrl: string;
  backupRtmpUrl?: string;
  videoBitrate?: number;
  audioBitrate?: number;
  resolution?: string;
  fps?: number;
  preset?: string;
  status: "idle" | "preparing" | "live" | "failover" | "stopped" | "error";
  isFailoverActive?: boolean;
  startedAt?: string;
  stoppedAt?: string;
  totalDuration?: number;
  failoverCount?: number;
  currentPid?: number;
  createdAt: string;
  updatedAt: string;
}

interface VideoItem {
  id: string;
  title: string;
  status: string;
  duration: number;
  thumbnailUrl?: string;
}

interface PlaylistOption {
  id: string;
  name: string;
  loop: boolean;
  _count?: { items: number };
  backupVideo?: { id: string; title: string };
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function maskUrl(url: string): string {
  if (!url) return "未配置";
  try {
    const u = new URL(url);
    return `${u.protocol}//***@${u.host}${u.pathname}`;
  } catch {
    return "***";
  }
}

/**
 * 显示状态 — 以进程实际存活为真相源
 * DB 说 live 但进程死了 → 显示「异常」
 */
function useDisplayStatus(task: StreamTask, process?: ProcessInfo) {
  const procAlive = !!process?.isAlive;
  const dbLive = task.status === "live" || task.status === "failover";
  // 进程真正存活才算 live
  if (dbLive && procAlive) return "live";
  // DB 说 live 但进程已死 → 异常
  if (dbLive && !procAlive) return "dead";
  // 正在启动/停止中
  return task.status;
}

function StatusBadge({ displayStatus }: { displayStatus: string }) {
 if (displayStatus === "live") {
    return (
      <Badge variant="outline" className="gap-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        LIVE
      </Badge>
    );
  }
  if (displayStatus === "dead") {
    return (
      <Badge variant="outline" className="gap-1.5 text-xs font-semibold bg-rose-50 text-rose-700 border-rose-200">
        <AlertCircle className="h-3 w-3" />
        进程异常
      </Badge>
    );
  }
  const config: Record<string, { color: string; label: string }> = {
    idle: { color: "bg-zinc-100 text-zinc-600 border-zinc-200", label: "待机" },
    preparing: { color: "bg-amber-50 text-amber-700 border-amber-200", label: "准备中" },
    stopped: { color: "bg-zinc-100 text-zinc-600 border-zinc-200", label: "已停止" },
    error: { color: "bg-rose-50 text-rose-700 border-rose-200", label: "错误" },
  };
  const c = config[displayStatus] || config.idle;
  return <Badge variant="outline" className={cn("gap-1 text-xs font-medium", c.color)}>{c.label}</Badge>;
}

function PlaylistSummaryBadge({ task }: { task: StreamTask }) {
  if (!task.playlistId || !task.playlist) return null;
  const pl = task.playlist;
  return (
    <Badge
      variant="outline"
      className="gap-1 text-[11px] bg-teal-50 text-teal-700 border-teal-200"
    >
      <ListVideo className="h-3 w-3" />
      Playlist: {pl.name}
      {pl._count && <span>({pl._count.items} videos)</span>}
      {pl.loop && <RotateCcw className="h-2.5 w-2.5 ml-0.5" />}
    </Badge>
  );
}

function StreamCard({
  task,
  process,
  onStart,
  onStop,
  onEdit,
  onDelete,
  onLogOpen,
  isStarting,
  isStopping,
}: {
  task: StreamTask;
  process?: ProcessInfo;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onLogOpen?: (id: string) => void;
  isStarting?: boolean;
  isStopping?: boolean;
}) {
  // 以进程实际存活为真相源
  const displayStatus = useDisplayStatus(task, process);
  const procAlive = !!process?.isAlive;
  const isLoading = isStarting || isStopping;
  const isLive = displayStatus === "live";
  const isDead = displayStatus === "dead";
  const canStart = !isLoading && (displayStatus === "idle" || displayStatus === "stopped" || displayStatus === "error");
  const canStop = !isLoading && (isLive || task.status === "preparing");
  const canRestart = !isLoading && isDead;

  return (
    <Card className={cn("gap-0 py-0 overflow-hidden", isLive && "ring-1 ring-emerald-200")}>
      {/* 顶部状态条 — 只在真正 live 时显示绿色 */}
      {isLive && <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />}
      {isDead && <div className="h-1 bg-gradient-to-r from-rose-400 to-rose-500" />}
      <CardContent className="p-4">
        <div className="flex flex-col gap-3">
          {/* 标题行 */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                isLive && "bg-emerald-50",
                isDead && "bg-rose-50",
                !isLive && !isDead && "bg-zinc-100"
              )}>
                <MonitorPlay className={cn("h-4 w-4", isLive && "text-emerald-600", isDead && "text-rose-500", !isLive && !isDead && "text-zinc-500")} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-900 truncate">{task.name}</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <StatusBadge displayStatus={displayStatus} />
                  <PlaylistSummaryBadge task={task} />
                </div>
              </div>
            </div>
            {/* 操作按钮 — 右侧 */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isStarting && (
                <Button size="sm" variant="outline" className="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100" disabled>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  启动中
                </Button>
              )}
              {isStopping && (
                <Button size="sm" variant="outline" className="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100" disabled>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  停止中
                </Button>
              )}
              {canStart && (
                <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => onStart(task.id)}>
                  <Play className="h-3.5 w-3.5" /> 启动推流
                </Button>
              )}
              {canStop && (
                <Button size="sm" variant="outline" className="text-rose-700 border-rose-200 hover:bg-rose-50" onClick={() => onStop(task.id)}>
                  <Square className="h-3.5 w-3.5" /> 停止推流
                </Button>
              )}
              {canRestart && (
                <Button size="sm" variant="outline" className="text-amber-700 border-amber-200 hover:bg-amber-50" onClick={() => onStart(task.id)}>
                  <RefreshCw className="h-3.5 w-3.5" /> 重启
                </Button>
              )}
              {!isLoading && !isLive && !isDead && (
                <Button size="sm" variant="ghost" className="text-zinc-500 hover:text-zinc-700" onClick={() => onEdit(task.id)}>
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-zinc-600" onClick={() => onLogOpen?.(task.id)}>
                <Terminal className="h-3.5 w-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isLoading}><MoreVertical className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!isLive && !isDead && <DropdownMenuItem onClick={() => onEdit(task.id)}><Edit2 className="h-4 w-4 mr-2" /> 编辑</DropdownMenuItem>}
                  <DropdownMenuItem className="text-rose-600" onClick={() => onDelete(task.id)}><Trash2 className="h-4 w-4 mr-2" /> 删除</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* 视频缩略图 */}
          {task.video && (
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-2.5">
              <div className="flex h-9 w-12 items-center justify-center overflow-hidden rounded bg-zinc-200 shrink-0">
                {task.video.thumbnailUrl ? (
                  <img src={task.video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5 text-zinc-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-700 truncate">{task.video.title}</p>
                <p className="text-[11px] text-zinc-400">{formatDuration(task.video.duration)}</p>
              </div>
            </div>
          )}

          {/* 配置信息 — 紧凑两行 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div>
              <span className="text-zinc-400">主推流 </span>
              <span className="font-mono text-zinc-600 truncate ml-1">{maskUrl(task.primaryRtmpUrl)}</span>
            </div>
            <div>
              <span className="text-zinc-400">备用 </span>
              <span className="font-mono text-zinc-600 truncate ml-1">{maskUrl(task.backupRtmpUrl || "未配置")}</span>
            </div>
            <div>
              <span className="text-zinc-400">分辨率 </span>
              <span className="text-zinc-600 ml-1">{task.resolution || "-"} @ {task.fps || 30}fps</span>
            </div>
            <div>
              <span className="text-zinc-400">码率 </span>
              <span className="text-zinc-600 ml-1">V {task.videoBitrate || "-"} / A {task.audioBitrate || "-"} kbps</span>
            </div>
          </div>

          {/* 实时统计 — 仅进程真正存活时显示 */}
          {isLive && process && procAlive && (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2.5">
              <div className="grid grid-cols-4 gap-3 text-xs">
                <div className="text-center">
                  <p className="text-emerald-800 font-bold font-mono">{process.stats.fps > 0 ? process.stats.fps.toFixed(1) : "-"}</p>
                  <p className="text-emerald-600 text-[10px]">FPS</p>
                </div>
                <div className="text-center">
                  <p className="text-emerald-800 font-bold font-mono">{process.stats.bitrate > 0 ? `${Math.round(process.stats.bitrate)}k` : "-"}</p>
                  <p className="text-emerald-600 text-[10px]">码率</p>
                </div>
                <div className="text-center">
                  <p className="text-emerald-800 font-bold font-mono">{process.stats.frame > 0 ? process.stats.frame : "-"}</p>
                  <p className="text-emerald-600 text-[10px]">帧数</p>
                </div>
                <div className="text-center">
                  <p className="text-emerald-800 font-bold font-mono">{process.stats.speed > 0 ? `${process.stats.speed.toFixed(1)}x` : "-"}</p>
                  <p className="text-emerald-600 text-[10px]">速度</p>
                </div>
              </div>
            </div>
          )}

          {/* 进程异常提示 — 一句话带操作入口 */}
          {isDead && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2.5">
              <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
              <span className="text-xs text-rose-700">进程已退出，点击「重启」或「日志」排查问题</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function StreamTasksPanel() {
  const [tasks, setTasks] = useState<StreamTask[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<StreamTask | null>(null);
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set());
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const processesRef = useRef<ProcessInfo[]>([]);
  const verifyingRef = useRef<Map<string, "start" | "stop">>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "", videoId: "", playlistId: "", sourceMode: "video" as "video" | "playlist",
    primaryRtmpUrl: "", backupRtmpUrl: "",
    videoBitrate: "4500", audioBitrate: "128", resolution: "1920x1080", fps: "30", preset: "veryfast",
  });
  const [editForm, setEditForm] = useState({
    name: "", videoId: "", playlistId: "", sourceMode: "video" as "video" | "playlist",
    primaryRtmpUrl: "", backupRtmpUrl: "",
    videoBitrate: "4500", audioBitrate: "128", resolution: "1920x1080", fps: "30", preset: "veryfast",
  });
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/streams?${params}`);
      if (res.ok) {
        const json = await res.json();
        setTasks(json.data || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch("/api/processes");
      if (res.ok) {
        const json = await res.json();
        setProcesses(json.data || []);
      }
    } catch {
      // silent
    }
  }, []);

  // Keep processesRef in sync with processes state
  useEffect(() => {
    processesRef.current = processes;
  }, [processes]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
    fetchProcesses();
    pollRef.current = setInterval(fetchProcesses, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchTasks, fetchProcesses]);

  useEffect(() => {
    fetch("/api/videos?pageSize=100&status=cached")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setVideos(j.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/playlists")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setPlaylists(j.data || []))
      .catch(() => {});
  }, []);

  const getProcessForTask = (task: StreamTask): ProcessInfo | undefined =>
    processes.find((p) => p.taskId === `stream_${task.id}`);

  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error("任务名称不能为空");
      return;
    }
    if (form.sourceMode === "video" && !form.videoId) {
      toast.error("请选择视频");
      return;
    }
    if (form.sourceMode === "playlist" && !form.playlistId) {
      toast.error("请选择播放列表");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          videoId: form.sourceMode === "video" ? form.videoId : null,
          playlistId: form.sourceMode === "playlist" ? form.playlistId : null,
          primaryRtmpUrl: form.primaryRtmpUrl,
          backupRtmpUrl: form.backupRtmpUrl,
          videoBitrate: parseInt(form.videoBitrate) || 4500,
          audioBitrate: parseInt(form.audioBitrate) || 128,
          fps: parseInt(form.fps) || 30,
          preset: form.preset,
        }),
      });
      if (res.ok) {
        toast.success("推流任务已创建");
        setCreateOpen(false);
        setForm({ name: "", videoId: "", playlistId: "", sourceMode: "video", primaryRtmpUrl: "", backupRtmpUrl: "", videoBitrate: "4500", audioBitrate: "128", resolution: "1920x1080", fps: "30", preset: "veryfast" });
        fetchTasks();
      } else {
        const err = await res.json();
        toast.error(err.error || "创建失败");
      }
    } catch {
      toast.error("创建推流任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 持续轮询直到 DB 状态与进程状态一致
   * 使用 processesRef 保证读取到最新进程数据
   */
  function pollUntilConsistent(id: string, mode: "start" | "stop"): void {
    verifyingRef.current.set(id, mode);
    const maxAttempts = 30;
    let attempts = 0;

    const clearVerifying = () => {
      verifyingRef.current.delete(id);
      if (mode === "start") {
        setStartingIds((p) => { const n = new Set(p); n.delete(id); return n; });
      } else {
        setStoppingIds((p) => { const n = new Set(p); n.delete(id); return n; });
      }
    };

    const tick = async () => {
      attempts++;
      await Promise.all([fetchTasks(), fetchProcesses()]);

      // Small delay to let React state updates settle
      await new Promise((r) => setTimeout(r, 200));

      // Read fresh data from ref
      const currentProcesses = processesRef.current;
      const taskProcess = currentProcesses.find((p) => p.taskId === `stream_${id}`);
      const procAlive = !!taskProcess?.isAlive;

      // Find task from latest tasks state via fetchTasks
      // We need to read it from the DB since fetchTasks already updated state
      const taskRes = await fetch(`/api/streams/${id}`).catch(() => null);
      const taskData = taskRes?.ok ? await taskRes.json().catch(() => null) : null;
      const task = taskData?.data;

      if (!task) {
        clearVerifying();
        toast.error("任务不存在或查询失败");
        return;
      }

      if (mode === "start") {
        if (task.status === "live" && procAlive) {
          clearVerifying();
          toast.success("推流启动成功");
          return;
        }
        if (task.status === "error") {
          clearVerifying();
          toast.error("推流启动失败，请查看日志了解详情");
          return;
        }
        if (attempts >= maxAttempts) {
          clearVerifying();
          if (!procAlive) toast.error("推流启动超时，进程未响应");
          else toast.warning("推流进程已启动但状态确认超时");
          return;
        }
      }

      if (mode === "stop") {
        if ((task.status === "stopped" || task.status === "idle") && !procAlive) {
          clearVerifying();
          toast.success("推流已完全停止");
          return;
        }
        if (attempts >= maxAttempts) {
          clearVerifying();
          if (procAlive) toast.warning("推流停止超时，进程可能仍在运行");
          else toast.success("推流已停止");
          return;
        }
      }

      if (verifyingRef.current.has(id)) {
        setTimeout(tick, 1000);
      }
    };

    setTimeout(tick, 1500);
  }

  async function handleStart(id: string) {
    setStartingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/streams/${id}/start`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "未知错误" }));
        toast.error(err.error || "启动失败");
        setStartingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        return;
      }
      // API returned OK — poll until process state confirms
      pollUntilConsistent(id, "start");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "网络错误，启动推流失败";
      toast.error(msg);
      setStartingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function handleStop(id: string) {
    setStoppingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/streams/${id}/stop`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "未知错误" }));
        toast.error(err.error || "停止失败");
        setStoppingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        return;
      }
      // API returned OK — poll until process state confirms
      pollUntilConsistent(id, "stop");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "网络错误，停止推流失败";
      toast.error(msg);
      setStoppingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/streams/${deleteId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("推流任务已删除");
        setTasks((t) => t.filter((t) => t.id !== deleteId));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "删除失败");
      }
    } catch {
      toast.error("删除推流任务失败");
    } finally {
      setDeleteId(null);
    }
  }

  function handleOpenEdit(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const mode = task.playlistId ? "playlist" : "video";
    setEditForm({
      name: task.name,
      videoId: task.videoId || "",
      playlistId: task.playlistId || "",
      sourceMode: mode,
      primaryRtmpUrl: task.primaryRtmpUrl || "",
      backupRtmpUrl: task.backupRtmpUrl || "",
      videoBitrate: String(task.videoBitrate || 4500),
      audioBitrate: String(task.audioBitrate || 128),
      resolution: task.resolution || "1920x1080",
      fps: String(task.fps || 30),
      preset: task.preset || "veryfast",
    });
    setEditTask(task);
  }

  async function handleEditSave() {
    if (!editTask) return;
    if (!editForm.name.trim()) {
      toast.error("任务名称不能为空");
      return;
    }
    if (editForm.sourceMode === "video" && !editForm.videoId) {
      toast.error("请选择视频");
      return;
    }
    if (editForm.sourceMode === "playlist" && !editForm.playlistId) {
      toast.error("请选择播放列表");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/streams/${editTask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          videoId: editForm.sourceMode === "video" ? editForm.videoId : null,
          playlistId: editForm.sourceMode === "playlist" ? editForm.playlistId : null,
          primaryRtmpUrl: editForm.primaryRtmpUrl,
          backupRtmpUrl: editForm.backupRtmpUrl,
          videoBitrate: parseInt(editForm.videoBitrate) || 4500,
          audioBitrate: parseInt(editForm.audioBitrate) || 128,
          resolution: editForm.resolution,
          fps: parseInt(editForm.fps) || 30,
          preset: editForm.preset,
        }),
      });
      if (res.ok) {
        toast.success("推流任务已更新");
        setEditTask(null);
        fetchTasks();
      } else {
        const err = await res.json();
        toast.error(err.error || "更新失败");
      }
    } catch {
      toast.error("更新推流任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">推流任务</h1>
          <p className="text-sm text-zinc-500 mt-1">管理视频到 RTMP 的推流任务，真实 FFmpeg 推流</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="筛选" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="idle">待机</SelectItem>
              <SelectItem value="live">直播中</SelectItem>
              <SelectItem value="stopped">已停止</SelectItem>
              <SelectItem value="error">错误</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> 创建任务
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-60 w-full rounded-xl" />)}
        </div>
      ) : tasks.length === 0 ? (
        <Card className="gap-4">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 mb-4">
              <Radio className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="text-lg font-medium text-zinc-700">暂无推流任务</p>
            <p className="text-sm text-zinc-500 mt-1">创建推流任务开始直播</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {tasks.map((task) => (
            <StreamCard key={task.id} task={task} process={getProcessForTask(task)} onStart={handleStart} onStop={handleStop} onEdit={handleOpenEdit} onDelete={setDeleteId} isStarting={startingIds.has(task.id)} isStopping={stoppingIds.has(task.id)} onLogOpen={() => setLogTaskId(task.id)} />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>创建推流任务</DialogTitle>
            <DialogDescription>配置新的视频到 RTMP 推流任务，将真实启动 FFmpeg 进程</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>任务名称 *</Label>
              <Input placeholder="我的推流任务" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Source Mode</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={form.sourceMode === "video" ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "flex-1",
                    form.sourceMode === "video" && "bg-emerald-600 hover:bg-emerald-700"
                  )}
                  onClick={() => setForm((f) => ({ ...f, sourceMode: "video" }))}
                >
                  <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                  Single Video
                </Button>
                <Button
                  type="button"
                  variant={form.sourceMode === "playlist" ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "flex-1",
                    form.sourceMode === "playlist" && "bg-emerald-600 hover:bg-emerald-700"
                  )}
                  onClick={() => setForm((f) => ({ ...f, sourceMode: "playlist" }))}
                >
                  <ListVideo className="h-3.5 w-3.5 mr-1.5" />
                  Playlist
                </Button>
              </div>
            </div>
            {form.sourceMode === "video" ? (
              <div className="flex flex-col gap-2">
                <Label>Select Video *</Label>
                <Select value={form.videoId} onValueChange={(v) => setForm((f) => ({ ...f, videoId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select a cached video" /></SelectTrigger>
                  <SelectContent>
                    {videos.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.title} ({formatDuration(v.duration)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label>Select Playlist *</Label>
                <Select value={form.playlistId} onValueChange={(v) => setForm((f) => ({ ...f, playlistId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select a playlist" /></SelectTrigger>
                  <SelectContent>
                    {playlists.map((pl) => (
                      <SelectItem key={pl.id} value={pl.id}>
                        <span className="flex items-center gap-2">
                          {pl.name}
                          <span className="text-zinc-400 text-xs">
                            ({pl._count?.items || 0} videos)
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.playlistId && (() => {
                  const pl = playlists.find((p) => p.id === form.playlistId);
                  if (!pl) return null;
                  return (
                    <div className="rounded-lg bg-teal-50 border border-teal-100 px-3 py-2 text-xs text-teal-800">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{pl._count?.items || 0} videos</span>
                        {pl.loop && (
                          <Badge variant="outline" className="h-5 text-[10px] bg-teal-100 text-teal-700 border-teal-200">
                            <RotateCcw className="h-2.5 w-2.5 mr-0.5" /> Loop enabled
                          </Badge>
                        )}
                      </div>
                      {pl.backupVideo && (
                        <p className="text-teal-600 mt-1">
                          <ShieldCheck className="h-3 w-3 inline mr-1" />
                          Backup: {pl.backupVideo.title}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label>主推流 RTMP 地址 *</Label>
              <Input placeholder="rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx" value={form.primaryRtmpUrl} onChange={(e) => setForm((f) => ({ ...f, primaryRtmpUrl: e.target.value }))} />
              <p className="text-[11px] text-zinc-400">必须以 rtmp:// 或 rtmps:// 开头</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label>备用 RTMP 地址</Label>
              <Input placeholder="rtmp://b.rtmp.youtube.com/live2/xxxx-xxxx-xxxx" value={form.backupRtmpUrl} onChange={(e) => setForm((f) => ({ ...f, backupRtmpUrl: e.target.value }))} />
            </div>
            <Separator />
            <p className="text-sm font-medium text-zinc-700">编码设置</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>视频码率 (kbps)</Label>
                <Input type="number" value={form.videoBitrate} onChange={(e) => setForm((f) => ({ ...f, videoBitrate: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>音频码率 (kbps)</Label>
                <Input type="number" value={form.audioBitrate} onChange={(e) => setForm((f) => ({ ...f, audioBitrate: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>分辨率</Label>
                <Select value={form.resolution} onValueChange={(v) => setForm((f) => ({ ...f, resolution: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1920x1080">1920x1080</SelectItem>
                    <SelectItem value="1280x720">1280x720</SelectItem>
                    <SelectItem value="854x480">854x480</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>帧率</Label>
                <Select value={form.fps} onValueChange={(v) => setForm((f) => ({ ...f, fps: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 fps</SelectItem>
                    <SelectItem value="60">60 fps</SelectItem>
                    <SelectItem value="24">24 fps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>FFmpeg 编码预设</Label>
              <Select value={form.preset} onValueChange={(v) => setForm((f) => ({ ...f, preset: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ultrafast">ultrafast (最低CPU)</SelectItem>
                  <SelectItem value="veryfast">veryfast</SelectItem>
                  <SelectItem value="fast">fast</SelectItem>
                  <SelectItem value="medium">medium (更好的画质)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
              {submitting ? "创建中..." : "创建任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog modal={false} open={!!editTask} onOpenChange={(open) => { if (!open) setEditTask(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑推流任务</DialogTitle>
            <DialogDescription>修改推流任务配置（仅停止状态下可编辑）</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>任务名称 *</Label>
              <Input placeholder="我的推流任务" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Source Mode</Label>
              <div className="flex gap-2">
                <Button type="button" variant={editForm.sourceMode === "video" ? "default" : "outline"} size="sm" className={cn("flex-1", editForm.sourceMode === "video" && "bg-emerald-600 hover:bg-emerald-700")} onClick={() => setEditForm((f) => ({ ...f, sourceMode: "video" }))}>
                  <ImageIcon className="h-3.5 w-3.5 mr-1.5" /> Single Video
                </Button>
                <Button type="button" variant={editForm.sourceMode === "playlist" ? "default" : "outline"} size="sm" className={cn("flex-1", editForm.sourceMode === "playlist" && "bg-emerald-600 hover:bg-emerald-700")} onClick={() => setEditForm((f) => ({ ...f, sourceMode: "playlist" }))}>
                  <ListVideo className="h-3.5 w-3.5 mr-1.5" /> Playlist
                </Button>
              </div>
            </div>
            {editForm.sourceMode === "video" ? (
              <div className="flex flex-col gap-2">
                <Label>Select Video *</Label>
                <Select value={editForm.videoId} onValueChange={(v) => setEditForm((f) => ({ ...f, videoId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select a cached video" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {videos.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.title} ({formatDuration(v.duration)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label>Select Playlist *</Label>
                <Select value={editForm.playlistId} onValueChange={(v) => setEditForm((f) => ({ ...f, playlistId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select a playlist" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {playlists.map((pl) => (
                      <SelectItem key={pl.id} value={pl.id}>
                        <span className="flex items-center gap-2">{pl.name}<span className="text-zinc-400 text-xs">({pl._count?.items || 0} videos)</span></span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editForm.playlistId && (() => {
                  const pl = playlists.find((p) => p.id === editForm.playlistId);
                  if (!pl) return null;
                  return (
                    <div className="rounded-lg bg-teal-50 border border-teal-100 px-3 py-2 text-xs text-teal-800">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{pl._count?.items || 0} videos</span>
                        {pl.loop && <Badge variant="outline" className="h-5 text-[10px] bg-teal-100 text-teal-700 border-teal-200"><RotateCcw className="h-2.5 w-2.5 mr-0.5" /> Loop enabled</Badge>}
                      </div>
                      {pl.backupVideo && <p className="text-teal-600 mt-1"><ShieldCheck className="h-3 w-3 inline mr-1" /> Backup: {pl.backupVideo.title}</p>}
                    </div>
                  );
                })()}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label>主推流 RTMP 地址 *</Label>
              <Input placeholder="rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx" value={editForm.primaryRtmpUrl} onChange={(e) => setEditForm((f) => ({ ...f, primaryRtmpUrl: e.target.value }))} />
              <p className="text-[11px] text-zinc-400">必须以 rtmp:// 或 rtmps:// 开头</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label>备用 RTMP 地址</Label>
              <Input placeholder="rtmp://b.rtmp.youtube.com/live2/xxxx-xxxx-xxxx" value={editForm.backupRtmpUrl} onChange={(e) => setEditForm((f) => ({ ...f, backupRtmpUrl: e.target.value }))} />
            </div>
            <Separator />
            <p className="text-sm font-medium text-zinc-700">编码设置</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>视频码率 (kbps)</Label>
                <Input type="number" value={editForm.videoBitrate} onChange={(e) => setEditForm((f) => ({ ...f, videoBitrate: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>音频码率 (kbps)</Label>
                <Input type="number" value={editForm.audioBitrate} onChange={(e) => setEditForm((f) => ({ ...f, audioBitrate: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>分辨率</Label>
                <Select value={editForm.resolution} onValueChange={(v) => setEditForm((f) => ({ ...f, resolution: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="1920x1080">1920x1080</SelectItem>
                    <SelectItem value="1280x720">1280x720</SelectItem>
                    <SelectItem value="854x480">854x480</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>帧率</Label>
                <Select value={editForm.fps} onValueChange={(v) => setEditForm((f) => ({ ...f, fps: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="30">30 fps</SelectItem>
                    <SelectItem value="60">60 fps</SelectItem>
                    <SelectItem value="24">24 fps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>FFmpeg 编码预设</Label>
              <Select value={editForm.preset} onValueChange={(v) => setEditForm((f) => ({ ...f, preset: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="ultrafast">ultrafast (最低CPU)</SelectItem>
                  <SelectItem value="veryfast">veryfast</SelectItem>
                  <SelectItem value="fast">fast</SelectItem>
                  <SelectItem value="medium">medium (更好的画质)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTask(null)}>取消</Button>
            <Button onClick={handleEditSave} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
              {submitting ? "保存中..." : "保存修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除推流任务</AlertDialogTitle>
            <AlertDialogDescription>确定要删除吗？正在直播的任务请先停止。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stream Log Dialog */}
      {logTaskId && (() => {
        const logTask = tasks.find((t) => t.id === logTaskId);
        const logProcess = logTask ? getProcessForTask(logTask) : undefined;
        const logProcAlive = !!logProcess?.isAlive;
        const logDbLive = logTask?.status === "live" || logTask?.status === "failover";
        const logDisplayStatus = logDbLive && logProcAlive ? "live" : logDbLive && !logProcAlive ? "dead" : (logTask?.status || "idle");
        return (
          <StreamLogDialog
            open={!!logTaskId}
            onOpenChange={(open) => { if (!open) setLogTaskId(null); }}
            taskId={logTaskId}
            taskName={logTask?.name || ""}
            isLive={logDisplayStatus === "live"}
            isDead={logDisplayStatus === "dead"}
            processInfo={logProcess}
          />
        );
      })()}
    </div>
  );
}
