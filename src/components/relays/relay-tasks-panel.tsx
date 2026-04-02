"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Share2,
  Play,
  Square,
  Plus,
  Trash2,
  MoreVertical,
  Globe,
  MonitorSpeaker,
  Gamepad2,
  Facebook,
  AlertTriangle,
  Activity,
  Cpu,
  MemoryStick,
  Clock,
  ArrowRightLeft,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { formatDistanceToNow } from "date-fns";

interface ProcessInfo {
  taskId: string;
  pid: number;
  type: string;
  isAlive: boolean;
  startedAt: string;
  stats: { fps: number; bitrate: number; speed: number; frame: number; time: string };
  downloadProgress: { percent: number; speed: string; eta: string } | null;
}

interface RelayTarget {
  id: string;
  platform: string;
  rtmpUrl: string;
  streamKey: string;
  enabled: boolean;
}

interface RelayTask {
  id: string;
  name: string;
  sourceYoutubeUrl: string;
  sourceQuality?: string;
  status: "idle" | "live" | "stopped" | "error";
  currentPid?: number;
  startedAt?: string;
  stoppedAt?: string;
  bytesTransferred?: number;
  createdAt: string;
  updatedAt: string;
  targets: RelayTarget[];
}

function formatBytesLocal(bytes: number): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatBytes(bytes: number): string {
  return formatBytesLocal(bytes);
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatNumber(n: number): string {
  return n?.toLocaleString() || "0";
}

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const config: Record<string, { icon: React.ElementType; color: string }> = {
    YouTube: { icon: Globe, color: "text-red-500" },
    Twitch: { icon: MonitorSpeaker, color: "text-purple-500" },
    Kick: { icon: Gamepad2, color: "text-emerald-500" },
    Facebook: { icon: Facebook, color: "text-blue-600" },
    Bilibili: { icon: Globe, color: "text-sky-500" },
  };
  const c = config[platform] || config.YouTube;
  const Icon = c.icon;
  return <Icon className={cn("h-4 w-4", c.color, className)} />;
}

function RelayStatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string; pulse?: boolean }> = {
    live: {
      color: "bg-emerald-50 text-emerald-700 border-emerald-200",
      label: "LIVE",
      pulse: true,
    },
    idle: {
      color: "bg-zinc-100 text-zinc-600 border-zinc-200",
      label: "Idle",
    },
    stopped: {
      color: "bg-rose-50 text-rose-700 border-rose-200",
      label: "Stopped",
    },
    error: {
      color: "bg-rose-50 text-rose-700 border-rose-200",
      label: "Error",
    },
  };
  const c = config[status] || config.idle;
  return (
    <Badge variant="outline" className={cn("gap-1.5 text-xs font-semibold", c.color)}>
      {c.pulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      {c.label}
    </Badge>
  );
}

function LiveRelayStats({ proc }: { proc: ProcessInfo }) {
  const uptimeSec = proc.startedAt
    ? (Date.now() - new Date(proc.startedAt).getTime()) / 1000
    : 0;
  return (
    <div className="mt-3 rounded-lg border border-teal-100 bg-teal-50/50 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Activity className="h-3.5 w-3.5 text-teal-600" />
        <span className="text-[11px] font-semibold text-teal-700 uppercase tracking-wide">
          Live Stats
        </span>
        <span className="text-[10px] text-teal-500 ml-auto">PID: {proc.pid}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <Clock className="h-3 w-3" />
            <p className="text-teal-800 font-bold">{formatUptime(uptimeSec)}</p>
          </div>
          <p className="text-teal-600">Uptime</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <ArrowRightLeft className="h-3 w-3" />
            <p className="text-teal-800 font-bold">{formatBytes(proc.stats?.speed || 0)}</p>
          </div>
          <p className="text-teal-600">Speed</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <Zap className="h-3 w-3" />
            <p className="text-teal-800 font-bold">
              {proc.stats?.bitrate > 0 ? `${formatNumber(Math.round(proc.stats.bitrate))} kbps` : "-"}
            </p>
          </div>
          <p className="text-teal-600">Bitrate</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <Cpu className="h-3 w-3" />
            <p className="text-teal-800 font-bold">
              {proc.stats?.fps > 0 ? `${proc.stats.fps.toFixed(1)} fps` : "-"}
            </p>
          </div>
          <p className="text-teal-600">FPS</p>
        </div>
      </div>
    </div>
  );
}

const PLATFORMS = ["YouTube", "Twitch", "Kick", "Facebook", "Bilibili"];
const QUALITIES = ["best", "1080p", "720p", "480p", "audio_only"];

interface TargetForm {
  platform: string;
  rtmpUrl: string;
  streamKey: string;
  enabled: boolean;
}

export function RelayTasksPanel() {
  const [tasks, setTasks] = useState<RelayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    sourceYoutubeUrl: "",
    sourceQuality: "best",
  });
  const [targets, setTargets] = useState<TargetForm[]>([
    { platform: "YouTube", rtmpUrl: "", streamKey: "", enabled: true },
  ]);

  const [processes, setProcesses] = useState<ProcessInfo[]>([]);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/relays?${params}`);
      if (res.ok) {
        const json = await res.json();
        setTasks(json.data || []);
      }
    } catch {
      toast.error("Failed to fetch relay tasks");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/processes');
        if (res.ok) {
          const json = await res.json();
          setProcesses(json.data || []);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(poll);
  }, []);

  const getProcessForTask = (task: RelayTask): ProcessInfo | undefined =>
    processes.find((p) => p.taskId === `relay_${task.id}`);

  function addTarget() {
    setTargets([
      ...targets,
      { platform: "YouTube", rtmpUrl: "", streamKey: "", enabled: true },
    ]);
  }

  function removeTarget(idx: number) {
    if (targets.length <= 1) return;
    setTargets(targets.filter((_, i) => i !== idx));
  }

  function updateTarget(idx: number, field: keyof TargetForm, value: string | boolean) {
    const updated = [...targets];
    updated[idx] = { ...updated[idx], [field]: value };
    setTargets(updated);
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.sourceYoutubeUrl.trim()) {
      toast.error("Name and source URL are required");
      return;
    }
    const validTargets = targets.filter((t) => t.rtmpUrl.trim() && t.streamKey.trim());
    if (validTargets.length === 0) {
      toast.error("At least one target with RTMP URL and stream key is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/relays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          targets: validTargets.map((t) => ({
            platform: t.platform,
            rtmpUrl: t.rtmpUrl,
            streamKey: t.streamKey,
            enabled: t.enabled,
          })),
        }),
      });
      if (res.ok) {
        toast.success("Relay task created");
        setCreateOpen(false);
        setForm({ name: "", sourceYoutubeUrl: "", sourceQuality: "best" });
        setTargets([{ platform: "YouTube", rtmpUrl: "", streamKey: "", enabled: true }]);
        fetchTasks();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create relay task");
      }
    } catch {
      toast.error("Failed to create relay task");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStart(id: string) {
    try {
      const res = await fetch(`/api/relays/${id}/start`, { method: "POST" });
      if (res.ok) {
        toast.success("Relay started");
        fetchTasks();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to start relay");
      }
    } catch {
      toast.error("Failed to start relay");
    }
  }

  async function handleStop(id: string) {
    try {
      const res = await fetch(`/api/relays/${id}/stop`, { method: "POST" });
      if (res.ok) {
        toast.success("Relay stopped");
        fetchTasks();
      } else {
        toast.error("Failed to stop relay");
      }
    } catch {
      toast.error("Failed to stop relay");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/relays/${deleteId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Relay task deleted");
        setTasks((t) => t.filter((t) => t.id !== deleteId));
      } else {
        toast.error("Failed to delete relay task");
      }
    } catch {
      toast.error("Failed to delete relay task");
    } finally {
      setDeleteId(null);
    }
  }

  // Poll engine status
  const [engineOnline, setEngineOnline] = useState(false);
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/engine/status');
        if (res.ok) {
          const json = await res.json();
          setEngineOnline(json.online === true);
        } else {
          setEngineOnline(false);
        }
      } catch {
        setEngineOnline(false);
      }
    }, 5000);
    // Initial check
    fetch('/api/engine/status').then(r => r.json()).then(j => setEngineOnline(j.online === true)).catch(() => {});
    return () => clearInterval(poll);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Relay Tasks</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Multi-platform stream relaying
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="idle">Idle</SelectItem>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="stopped">Stopped</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4" />
            Create Relay
          </Button>
        </div>
      </div>

      {/* Engine Offline Banner */}
      {!engineOnline && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Stream engine is offline</p>
            <p className="text-xs text-amber-600">
              Streaming features are unavailable. Start the engine with: cd mini-services/stream-engine && bun run dev
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card className="gap-4">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 mb-4">
              <Share2 className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="text-lg font-medium text-zinc-700">No relay tasks</p>
            <p className="text-sm text-zinc-500 mt-1">
              Create a relay to broadcast to multiple platforms
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {tasks.map((task) => {
            const isLive = task.status === "live";
            const canStart = (task.status === "idle" || task.status === "stopped" || task.status === "error") && engineOnline;
            const canStop = isLive;
            const proc = getProcessForTask(task);
            return (
              <Card key={task.id} className="gap-0 py-0 overflow-hidden">
                {isLive && (
                  <div className="h-1 bg-gradient-to-r from-teal-500 to-emerald-500" />
                )}
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-zinc-900 truncate">
                          {task.name}
                        </h3>
                        <RelayStatusBadge status={task.status} />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {canStart && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                            onClick={() => handleStart(task.id)}
                          >
                            <Play className="h-3.5 w-3.5" />
                            Start
                          </Button>
                        )}
                        {canStop && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-rose-700 border-rose-200 hover:bg-rose-50"
                            onClick={() => handleStop(task.id)}
                          >
                            <Square className="h-3.5 w-3.5" />
                            Stop
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-rose-600"
                              onClick={() => setDeleteId(task.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {/* Source URL */}
                    <div className="rounded-lg bg-zinc-50 p-3">
                      <p className="text-[11px] text-zinc-500 uppercase font-medium mb-1">Source</p>
                      <p className="text-xs font-mono text-zinc-700 truncate">
                        {task.sourceYoutubeUrl}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                        <span>Quality: {task.sourceQuality || "best"}</span>
                        {task.currentPid && <span>PID: {task.currentPid}</span>}
                      </div>
                    </div>

                    {/* Targets */}
                    {task.targets && task.targets.length > 0 && (
                      <div>
                        <p className="text-[11px] text-zinc-500 uppercase font-medium mb-2">
                          Targets ({task.targets.filter((t) => t.enabled).length} active)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {task.targets.map((target) => (
                            <div
                              key={target.id}
                              className={cn(
                                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
                                target.enabled
                                  ? "bg-white border-zinc-200 text-zinc-700"
                                  : "bg-zinc-50 border-zinc-100 text-zinc-400"
                              )}
                            >
                              <PlatformIcon platform={target.platform} />
                              <span>{target.platform}</span>
                              {!target.enabled && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 text-zinc-400">
                                  OFF
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Real-time process stats from engine */}
                    {isLive && proc && proc.isAlive && (
                      <LiveRelayStats proc={proc} />
                    )}

                    {isLive && !proc && (
                      <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 flex items-center gap-2">
                        <Activity className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-xs text-amber-700">
                          Relay is live but engine process data not available
                        </span>
                      </div>
                    )}

                    {/* Fallback stats when not live or no engine data */}
                    {!isLive && (
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-zinc-500">Data Transferred</p>
                          <p className="font-medium text-zinc-700 mt-0.5">
                            {formatBytesLocal(task.bytesTransferred || 0)}
                          </p>
                        </div>
                        <div>
                          <p className="text-zinc-500">Status</p>
                          <p className="font-medium text-zinc-700 mt-0.5">
                            {task.status === "idle" ? "Not started" : task.status === "stopped" ? "Stopped" : task.status === "error" ? "Error" : "-"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Relay Task</DialogTitle>
            <DialogDescription>
              Relay a YouTube live stream to multiple platforms
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Task Name *</Label>
              <Input
                placeholder="My Multi-Platform Relay"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Source YouTube URL *</Label>
              <Input
                placeholder="https://youtube.com/watch?v=..."
                value={form.sourceYoutubeUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sourceYoutubeUrl: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Source Quality</Label>
              <Select
                value={form.sourceQuality}
                onValueChange={(v) => setForm((f) => ({ ...f, sourceQuality: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITIES.map((q) => (
                    <SelectItem key={q} value={q}>
                      {q === "best" ? "Best Available" : q === "audio_only" ? "Audio Only" : q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-700">Target Platforms</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTarget}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Target
              </Button>
            </div>

            <div className="flex flex-col gap-4">
              {targets.map((target, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <PlatformIcon platform={target.platform} />
                      <span className="text-sm font-medium text-zinc-700">
                        Target {idx + 1}
                      </span>
                    </div>
                    {targets.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-zinc-400 hover:text-rose-600"
                        onClick={() => removeTarget(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Platform</Label>
                      <Select
                        value={target.platform}
                        onValueChange={(v) => updateTarget(idx, "platform", v)}
                      >
                        <SelectTrigger size="sm" className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PLATFORMS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">RTMP URL</Label>
                      <Input
                        placeholder="rtmp://..."
                        value={target.rtmpUrl}
                        onChange={(e) =>
                          updateTarget(idx, "rtmpUrl", e.target.value)
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">Stream Key</Label>
                      <Input
                        placeholder="xxxx-xxxx-xxxx"
                        type="password"
                        value={target.streamKey}
                        onChange={(e) =>
                          updateTarget(idx, "streamKey", e.target.value)
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Enabled</Label>
                      <Switch
                        checked={target.enabled}
                        onCheckedChange={(v) =>
                          updateTarget(idx, "enabled", v)
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting ? "Creating..." : "Create Relay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Relay Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this relay task? Active relays cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
