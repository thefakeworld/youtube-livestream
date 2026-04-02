"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  Plus,
  Trash2,
  Download,
  AlertCircle,
  Film,
  MoreVertical,
  ImageIcon,
  RefreshCw,
  CheckCircle2,
  LayoutGrid,
  Eye,
  Play,
  X,
  ListOrdered,
  CheckSquare,
  StopCircle,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

interface VideoItem {
  id: string;
  sourceType: string;
  youtubeId?: string;
  title: string;
  description?: string;
  duration: number;
  localPath?: string;
  thumbnailUrl?: string;
  status: "pending" | "downloading" | "cached" | "error";
  fileSize: number;
  resolution?: string;
  createdAt: string;
  _count?: { streamTasks: number };
}

interface QueueItemInfo {
  videoId: string;
  youtubeId?: string | null;
  title: string;
  status: string;
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  fileSize?: number;
}

interface QueueStatus {
  isActive: boolean;
  total: number;
  remaining: number;
  completedCount: number;
  failedCount: number;
  current?: QueueItemInfo;
  queue: QueueItemInfo[];
  completed: QueueItemInfo[];
  failed: QueueItemInfo[];
}

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string; icon: React.ElementType; animated?: boolean }> = {
    cached: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Ready to stream", icon: CheckCircle2 },
    pending: { color: "bg-amber-50 text-amber-700 border-amber-200", label: "Ready to download", icon: Download },
    downloading: { color: "bg-sky-50 text-sky-700 border-sky-200", label: "Downloading...", icon: RefreshCw, animated: true },
    error: { color: "bg-rose-50 text-rose-700 border-rose-200", label: "Download failed", icon: AlertCircle },
  };
  const c = config[status] || config.pending;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-xs", c.color)}>
      <Icon className={cn("h-3 w-3", c.animated && "animate-spin")} />
      {c.label}
    </Badge>
  );
}

// ──────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────

export function VideoLibraryPanel() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importForm, setImportForm] = useState({
    url: "",
    title: "",
    description: "",
    sourceType: "youtube",
  });
  const [submitting, setSubmitting] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Selection state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Queue state ──
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Channel import state
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelUrl, setChannelUrl] = useState("");
  const [channelVideos, setChannelVideos] = useState<{
    youtubeId: string;
    title: string;
    thumbnailUrl?: string;
    duration: number;
    views: number;
  }[]>([]);
  const [channelSelected, setChannelSelected] = useState<Set<string>>(new Set());
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelImporting, setChannelImporting] = useState(false);

  // Sync files state
  const [syncing, setSyncing] = useState(false);

  // Video playback state
  const [playingVideo, setPlayingVideo] = useState<VideoItem | null>(null);

  // ── Selection helpers ──
  const isAllSelected = videos.length > 0 && videos.every((v) => selectedIds.has(v.id));
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(videos.map((v) => v.id)));
    }
  }

  const selectedCount = selectedIds.size;

  // ── Fetch videos ──
  const fetchVideos = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sourceFilter !== "all") params.set("sourceType", sourceFilter);
      if (search) params.set("search", search);
      params.set("pageSize", "50");

      const res = await fetch(`/api/videos?${params}`);
      if (res.ok) {
        const json = await res.json();
        setVideos(json.data || []);
      }
    } catch {
      toast.error("Failed to fetch videos");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, search]);

  useEffect(() => {
    setLoading(true);
    setSelectedIds(new Set());
    fetchVideos();
  }, [fetchVideos]);

  // ── Poll queue status ──
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/videos/queue");
        if (res.ok) {
          const json = await res.json();
          const status = json.data as QueueStatus;
          setQueueStatus(status);

          // Auto-refresh video list when queue state changes
          if (status.isActive || status.remaining > 0) {
            fetchVideos();
          }

          // Toast notifications
          if (status.completedCount > 0 && status.current?.status !== "downloading") {
            // Queue just finished
          }
        }
      } catch { /* silent */ }
    };

    poll(); // Initial
    queuePollRef.current = setInterval(poll, 3000);
    return () => {
      if (queuePollRef.current) clearInterval(queuePollRef.current);
    };
  }, []);

  // Track previous queue state for toasts
  const prevCompletedRef = useRef(0);
  const prevFailedRef = useRef(0);

  useEffect(() => {
    if (!queueStatus) return;
    if (queueStatus.completedCount > prevCompletedRef.current) {
      const diff = queueStatus.completedCount - prevCompletedRef.current;
      if (diff <= 3) {
        // Show individual toasts for small batches
        const recent = queueStatus.completed.slice(-diff);
        for (const item of recent) {
          toast.success(`Downloaded: "${item.title}"`);
        }
      } else {
        toast.success(`${diff} videos downloaded`);
      }
    }
    if (queueStatus.failedCount > prevFailedRef.current) {
      const diff = queueStatus.failedCount - prevFailedRef.current;
      const recent = queueStatus.failed.slice(-diff);
      for (const item of recent) {
        toast.error(`Failed: "${item.title}" — ${item.error || 'Unknown error'}`);
      }
    }
    prevCompletedRef.current = queueStatus.completedCount;
    prevFailedRef.current = queueStatus.failedCount;
  }, [queueStatus?.completedCount, queueStatus?.failedCount]);

  // ── Poll for individual downloads (non-queue) ──
  useEffect(() => {
    if (downloadingIds.size === 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(async () => {
      let allDone = true;
      const updatedVideos = [...videos];
      for (const id of downloadingIds) {
        try {
          const res = await fetch(`/api/videos/${id}`);
          if (res.ok) {
            const json = await res.json();
            const video = json.data;
            const idx = updatedVideos.findIndex((v) => v.id === id);
            if (idx >= 0) updatedVideos[idx] = video;
            if (video.status !== "downloading") {
              downloadingIds.delete(id);
              if (video.status === "cached") {
                toast.success(`"${video.title}" downloaded successfully`);
              } else if (video.status === "error") {
                toast.error(`Download failed: "${video.title}"`);
              }
            } else {
              allDone = false;
            }
          }
        } catch {
          // ignore
        }
      }
      setVideos(updatedVideos);
      if (allDone) {
        setDownloadingIds(new Set());
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [downloadingIds, videos]);

  // ── Handlers ──

  async function handleImport() {
    if (!importForm.url.trim()) {
      toast.error("URL is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importForm.url, sourceType: importForm.sourceType }),
      });
      if (res.ok) {
        const json = await res.json();
        const video = json.data;
        if (json.resolved) {
          toast.success(`Imported: "${video.title}"`);
        } else {
          toast.success(`Video added: "${video.title}" (metadata pending)`);
          if (json.hint) {
            setTimeout(() => toast.warning(json.hint), 1500);
          }
        }
        setImportOpen(false);
        setImportForm({ url: "", title: "", description: "", sourceType: "youtube" });
        fetchVideos();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to import video");
      }
    } catch {
      toast.error("Failed to import video");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload(id: string) {
    try {
      const res = await fetch(`/api/videos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download" }),
      });
      if (res.ok) {
        toast.success("Download started");
        setDownloadingIds((prev) => new Set(prev).add(id));
        setVideos((prev) =>
          prev.map((v) => (v.id === id ? { ...v, status: "downloading" as const } : v)),
        );
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to start download");
      }
    } catch {
      toast.error("Failed to start download");
    }
  }

  async function handleBatchDownload() {
    if (selectedCount === 0) return;
    const ids = Array.from(selectedIds);
    try {
      const res = await fetch("/api/videos/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: ids }),
      });
      if (res.ok) {
        const json = await res.json();
        const { added, skipped, skippedDetails } = json.data;
        if (added > 0) {
          toast.success(`${added} videos added to download queue`);
        }
        if (skipped > 0) {
          const reasons = skippedDetails.slice(0, 3).map((s: { reason: string }) => s.reason);
          const unique = [...new Set(reasons)];
          toast.info(`${skipped} skipped: ${unique.join(", ")}`);
        }
        setSelectedIds(new Set());
        fetchVideos();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to add to queue");
      }
    } catch {
      toast.error("Failed to add to queue");
    }
  }

  async function handleBatchDelete() {
    if (selectedCount === 0) return;
    const ids = Array.from(selectedIds);
    try {
      const res = await fetch("/api/videos/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        const json = await res.json();
        toast.success(json.message);
        setVideos((prev) => prev.filter((v) => !ids.includes(v.id)));
        setSelectedIds(new Set());
        setBatchDeleteOpen(false);
      } else {
        const err = await res.json();
        toast.error(err.error || "Batch delete failed");
      }
    } catch {
      toast.error("Failed to delete videos");
    }
  }

  async function handleClearQueue() {
    try {
      const res = await fetch("/api/videos/queue", { method: "DELETE" });
      if (res.ok) {
        toast.success("Queue cleared");
        setQueueDialogOpen(false);
        fetchVideos();
      }
    } catch {
      toast.error("Failed to clear queue");
    }
  }

  async function handleChannelBrowse() {
    if (!channelUrl.trim()) {
      toast.error("Channel URL is required");
      return;
    }
    setChannelLoading(true);
    setChannelVideos([]);
    setChannelSelected(new Set());
    try {
      const res = await fetch("/api/videos/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: channelUrl }),
      });
      if (res.ok) {
        const json = await res.json();
        setChannelVideos(json.data || []);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to fetch channel videos");
      }
    } catch {
      toast.error("Failed to fetch channel videos");
    } finally {
      setChannelLoading(false);
    }
  }

  async function handleChannelImport() {
    if (channelSelected.size === 0) {
      toast.error("Select at least one video");
      return;
    }
    setChannelImporting(true);
    try {
      const selectedVideos = channelVideos
        .filter((v) => channelSelected.has(v.youtubeId))
        .map((v) => ({
          youtubeId: v.youtubeId,
          title: v.title,
          sourceType: "youtube_channel",
        }));
      const res = await fetch("/api/videos/import-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos: selectedVideos }),
      });
      if (res.ok) {
        const json = await res.json();
        const count = json.count || selectedVideos.length;
        toast.success(`${count} videos imported successfully`);
        setChannelOpen(false);
        setChannelVideos([]);
        setChannelSelected(new Set());
        setChannelUrl("");
        fetchVideos();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to import videos");
      }
    } catch {
      toast.error("Failed to import videos");
    } finally {
      setChannelImporting(false);
    }
  }

  async function handleSyncFiles() {
    setSyncing(true);
    try {
      const res = await fetch("/api/videos/sync", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        toast.success(`${json.count || 0} videos updated`);
        fetchVideos();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Sync failed");
      }
    } catch {
      toast.error("Failed to sync files");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/videos/${deleteId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Video deleted");
        setVideos((v) => v.filter((vid) => vid.id !== deleteId));
      } else {
        toast.error("Failed to delete video");
      }
    } catch {
      toast.error("Failed to delete video");
    } finally {
      setDeleteId(null);
    }
  }

  // ── Queue progress calc ──
  const queueProgress = queueStatus && queueStatus.total > 0
    ? ((queueStatus.completedCount + queueStatus.failedCount) / queueStatus.total) * 100
    : 0;

  // ──────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Video Library</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage your imported and cached videos
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Queue status indicator */}
          {queueStatus && (queueStatus.isActive || queueStatus.remaining > 0) && (
            <Button
              variant="outline"
              className="border-sky-200 text-sky-700 bg-sky-50 gap-2"
              onClick={() => setQueueDialogOpen(true)}
            >
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="hidden sm:inline">
                {queueStatus.current
                  ? `${queueStatus.completedCount + 1}/${queueStatus.total}`
                  : `${queueStatus.remaining} left`}
              </span>
              <span className="sm:hidden">{queueStatus.remaining}</span>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setQueueDialogOpen(true)}
          >
            <ListOrdered className="h-4 w-4" />
            <span className="hidden sm:inline">Queue</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setChannelUrl("");
              setChannelVideos([]);
              setChannelSelected(new Set());
              setChannelOpen(true);
            }}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Import from Channel</span>
            <span className="sm:hidden">Channel</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleSyncFiles}
            disabled={syncing}
          >
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            <span className="hidden sm:inline">Sync Files</span>
            <span className="sm:hidden">Sync</span>
          </Button>
          <Button onClick={() => setImportOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4" />
            Import Video
          </Button>
        </div>
      </div>

      {/* Batch action toolbar — shows when items are selected */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-sky-50 border border-sky-200">
          <div className="flex items-center gap-2 text-sm font-medium text-sky-800">
            <CheckSquare className="h-4 w-4" />
            <span>{selectedCount} selected</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs gap-1.5"
              onClick={handleBatchDownload}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download Selected</span>
              <span className="sm:hidden">Download</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-rose-200 text-rose-700 hover:bg-rose-50 h-8 text-xs gap-1.5"
              onClick={() => setBatchDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Delete Selected</span>
              <span className="sm:hidden">Delete</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search videos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="cached">Cached</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="downloading">Downloading</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
            <SelectItem value="youtube_single">YouTube Single</SelectItem>
            <SelectItem value="youtube_channel">YouTube Channel</SelectItem>
            <SelectItem value="local">Local</SelectItem>
            <SelectItem value="url">URL</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <Card className="gap-4">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 mb-4">
              <Film className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="text-lg font-medium text-zinc-700">No videos found</p>
            <p className="text-sm text-zinc-500 mt-1">
              Import a video to get started
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block">
            <Card className="gap-0 py-0">
              <Table className="w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-6 pr-0">
                      <Checkbox
                        checked={isAllSelected ? true : isSomeSelected ? "indeterminate" : false}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Video</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[70px]">Duration</TableHead>
                    <TableHead className="w-[72px]">Size</TableHead>
                    <TableHead className="w-[76px]">Resolution</TableHead>
                    <TableHead className="w-[44px] text-center">Uses</TableHead>
                    <TableHead className="pr-6 text-right w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {videos.map((video) => {
                    const canPlay = video.status === "cached" || (video.localPath);
                    const isSelected = selectedIds.has(video.id);
                    return (
                      <TableRow
                        key={video.id}
                        className={cn(isSelected && "bg-sky-50/50")}
                      >
                        <TableCell className="pl-6 pr-0">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(video.id)}
                          />
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-11 w-[72px] items-center justify-center overflow-hidden rounded-md bg-zinc-100 shrink-0 relative group cursor-pointer"
                              onClick={() => canPlay && setPlayingVideo(video)}
                            >
                              {video.thumbnailUrl ? (
                                <img
                                  src={video.thumbnailUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-5 w-5 text-zinc-400" />
                              )}
                              {canPlay && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Play className="h-4 w-4 text-white fill-white" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-zinc-900 truncate" title={video.title}>
                                {video.title}
                              </p>
                              <p className="text-xs text-zinc-500 uppercase">
                                {video.sourceType}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={video.status} />
                        </TableCell>
                        <TableCell className="text-sm text-zinc-600 whitespace-nowrap">
                          {video.duration > 0 ? formatDuration(video.duration) : "-"}
                        </TableCell>
                        <TableCell className="text-sm text-zinc-600 whitespace-nowrap">
                          {formatFileSize(video.fileSize)}
                        </TableCell>
                        <TableCell className="text-sm text-zinc-600 whitespace-nowrap">
                          {video.resolution || "-"}
                        </TableCell>
                        <TableCell className="text-sm text-zinc-600 text-center">
                          {video._count?.streamTasks ?? 0}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            {video.status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 h-8 text-xs"
                                onClick={() => handleDownload(video.id)}
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                            )}
                            {video.status === "error" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-amber-700 border-amber-200 hover:bg-amber-50 h-8 text-xs"
                                onClick={() => handleDownload(video.id)}
                              >
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                            )}
                            {video.status === "downloading" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-sky-700 border-sky-200 bg-sky-50 h-8 text-xs cursor-default"
                                disabled
                              >
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canPlay && (
                                  <DropdownMenuItem onClick={() => setPlayingVideo(video)}>
                                    <Play className="h-4 w-4 mr-2" />
                                    Play
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-rose-600"
                                  onClick={() => setDeleteId(video.id)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* Mobile Cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {/* Mobile select-all */}
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                checked={isAllSelected ? true : isSomeSelected ? "indeterminate" : false}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-xs text-zinc-500">Select all ({videos.length})</span>
            </div>
            {videos.map((video) => {
              const canPlay = video.status === "cached" || !!video.localPath;
              const isSelected = selectedIds.has(video.id);
              return (
                <Card key={video.id} className={cn("gap-0 py-0 transition-colors", isSelected && "ring-2 ring-sky-300")}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(video.id)}
                        className="mt-1"
                      />
                      <div
                        className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 shrink-0 relative cursor-pointer"
                        onClick={() => canPlay && setPlayingVideo(video)}
                      >
                        {video.thumbnailUrl ? (
                          <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-zinc-400" />
                        )}
                        {canPlay && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <Play className="h-5 w-5 text-white fill-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 truncate">{video.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <StatusBadge status={video.status} />
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                          <span>{video.duration > 0 ? formatDuration(video.duration) : "-"}</span>
                          <span>{formatFileSize(video.fileSize)}</span>
                          {video.resolution && <span>{video.resolution}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          {video.status === "pending" && (
                            <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 h-7 text-xs" onClick={() => handleDownload(video.id)}>
                              <Download className="h-3 w-3 mr-1" /> Download
                            </Button>
                          )}
                          {video.status === "error" && (
                            <Button size="sm" variant="outline" className="text-amber-700 border-amber-200 hover:bg-amber-50 h-7 text-xs" onClick={() => handleDownload(video.id)}>
                              <RefreshCw className="h-3 w-3 mr-1" /> Retry
                            </Button>
                          )}
                          {video.status === "downloading" && (
                            <Button size="sm" variant="outline" className="text-sky-700 border-sky-200 bg-sky-50 h-7 text-xs cursor-default" disabled>
                              <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Downloading...
                            </Button>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400" onClick={() => setDeleteId(video.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* ──────────── Dialogs ──────────── */}

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import Video</DialogTitle>
            <DialogDescription>
              Paste a YouTube video URL. Title and metadata are resolved automatically via yt-dlp.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Video URL *</Label>
              <Input
                placeholder="https://youtube.com/watch?v=dQw4w9WgXcQ"
                value={importForm.url}
                onChange={(e) =>
                  setImportForm((f) => ({ ...f, url: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && !submitting && handleImport()}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Source Type</Label>
              <Select
                value={importForm.sourceType}
                onValueChange={(v) =>
                  setImportForm((f) => ({ ...f, sourceType: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="youtube_single">YouTube Video</SelectItem>
                  <SelectItem value="youtube_channel">YouTube Channel</SelectItem>
                  <SelectItem value="local_upload">Local Upload</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={submitting || !importForm.url.trim()}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Resolving...
                </>
              ) : (
                "Import"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Channel Import Dialog */}
      <Dialog modal={false} open={channelOpen} onOpenChange={setChannelOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import from Channel</DialogTitle>
            <DialogDescription>
              Browse and import videos from a YouTube channel
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 overflow-y-auto flex-1 -mx-6 px-6">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="https://www.youtube.com/@channelName"
                  value={channelUrl}
                  onChange={(e) => setChannelUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleChannelBrowse()}
                />
              </div>
              <Button
                variant="outline"
                onClick={handleChannelBrowse}
                disabled={channelLoading}
              >
                {channelLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                Browse
              </Button>
            </div>

            {channelLoading && (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            )}

            {!channelLoading && channelVideos.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-zinc-600">
                    Found {channelVideos.length} videos
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      if (channelSelected.size === channelVideos.length) {
                        setChannelSelected(new Set());
                      } else {
                        setChannelSelected(new Set(channelVideos.map((v) => v.youtubeId)));
                      }
                    }}
                  >
                    {channelSelected.size === channelVideos.length
                      ? "Deselect all"
                      : "Select all"}
                  </Button>
                </div>
                <ScrollArea className="max-h-96">
                  <div className="flex flex-col gap-2 pr-3">
                    {channelVideos.map((video) => {
                      const isSelected = channelSelected.has(video.youtubeId);
                      return (
                        <label
                          key={video.youtubeId}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                            isSelected
                              ? "bg-emerald-50 border-emerald-200"
                              : "border-zinc-100 hover:bg-zinc-50"
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              setChannelSelected((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(video.youtubeId);
                                else next.delete(video.youtubeId);
                                return next;
                              });
                            }}
                          />
                          <div className="flex h-12 w-20 items-center justify-center overflow-hidden rounded-md bg-zinc-100 shrink-0">
                            {video.thumbnailUrl ? (
                              <img
                                src={video.thumbnailUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <ImageIcon className="h-5 w-5 text-zinc-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-900 truncate">
                              {video.title}
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                              <span>{formatDuration(video.duration)}</span>
                              {video.views > 0 && (
                                <span>{video.views.toLocaleString()} views</span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            )}

            {!channelLoading && channelUrl && channelVideos.length === 0 && !channelSelected.size && (
              <p className="text-sm text-zinc-400 text-center py-6">
                No videos found for this channel. Try a different URL.
              </p>
            )}
          </div>

          {channelSelected.size > 0 && (
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setChannelOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleChannelImport}
                disabled={channelImporting}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {channelImporting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Import Selected ({channelSelected.size})
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Video Playback Dialog */}
      <Dialog open={!!playingVideo} onOpenChange={(open) => { if (!open) setPlayingVideo(null); }}>
        <DialogContent className="sm:max-w-4xl lg:max-w-6xl p-0 gap-0 overflow-hidden max-h-[95vh] flex flex-col">
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{playingVideo?.title}</DialogTitle>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
                <span>{playingVideo?.resolution || "-"}</span>
                <span>{playingVideo?.duration > 0 ? formatDuration(playingVideo.duration) : "-"}</span>
                <span>{playingVideo ? formatFileSize(playingVideo.fileSize) : ""}</span>
              </div>
            </div>
          </DialogHeader>
          <div className="bg-black flex-1 min-h-0">
            {playingVideo && (
              <video
                key={playingVideo.id}
                className="w-full max-h-[80vh] object-contain"
                controls
                autoPlay
                preload="metadata"
                playsInline
              >
                <source src={`/api/videos/${playingVideo.id}/stream`} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation (single) */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Video</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this video? This action cannot be
              undone. Active streams using this video will be affected.
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

      {/* Batch Delete Confirmation */}
      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} Videos</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedCount} selected videos?
              This will remove both the database records and the downloaded files.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBatchDelete}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Delete {selectedCount} Videos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Queue Status Dialog */}
      <Dialog open={queueDialogOpen} onOpenChange={setQueueDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5" />
              Download Queue
            </DialogTitle>
            <DialogDescription>
              Videos download sequentially — one at a time, auto-advancing to the next.
            </DialogDescription>
          </DialogHeader>

          {!queueStatus || (queueStatus.total === 0 && !queueStatus.isActive) ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-400 gap-3">
              <ListOrdered className="h-10 w-10 opacity-30" />
              <p className="text-sm">Queue is empty</p>
              <p className="text-xs">Select videos and click &quot;Download Selected&quot; to add them to the queue</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 overflow-y-auto flex-1 -mx-6 px-6">
              {/* Progress bar */}
              {queueStatus.total > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-600">
                      {queueStatus.completedCount}/{queueStatus.total} completed
                      {queueStatus.failedCount > 0 && (
                        <span className="text-rose-500 ml-2">({queueStatus.failedCount} failed)</span>
                      )}
                    </span>
                    <span className="text-zinc-500">{Math.round(queueProgress)}%</span>
                  </div>
                  <Progress value={queueProgress} className="h-2" />
                </div>
              )}

              {/* Currently downloading */}
              {queueStatus.current && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <RefreshCw className="h-3.5 w-3.5 text-sky-600 animate-spin" />
                    <span className="text-xs font-medium text-sky-700">Currently downloading</span>
                  </div>
                  <p className="text-sm font-medium text-zinc-800 truncate">
                    {queueStatus.current.title}
                  </p>
                  {queueStatus.current.startedAt && (
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      Started {new Date(queueStatus.current.startedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              )}

              {/* Waiting queue */}
              {queueStatus.queue.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Waiting ({queueStatus.queue.length})
                  </p>
                  <div className="max-h-48 overflow-y-auto">
                    {queueStatus.queue.map((item, i) => (
                      <div key={item.videoId} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-zinc-50 text-sm">
                        <span className="text-[11px] text-zinc-400 w-5 text-right">{i + 1}</span>
                        <span className="text-zinc-700 truncate flex-1">{item.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Completed */}
              {queueStatus.completed.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider">
                    Completed ({queueStatus.completedCount})
                  </p>
                  <div className="max-h-32 overflow-y-auto">
                    {queueStatus.completed.slice().reverse().slice(0, 10).map((item) => (
                      <div key={item.videoId} className="flex items-center gap-2 py-1.5 px-2 rounded-md text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span className="text-zinc-700 truncate flex-1">{item.title}</span>
                        {item.fileSize && (
                          <span className="text-[11px] text-zinc-400">{formatFileSize(item.fileSize)}</span>
                        )}
                      </div>
                    ))}
                    {queueStatus.completed.length > 10 && (
                      <p className="text-[11px] text-zinc-400 px-2">...and {queueStatus.completed.length - 10} more</p>
                    )}
                  </div>
                </div>
              )}

              {/* Failed */}
              {queueStatus.failed.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-rose-600 uppercase tracking-wider">
                    Failed ({queueStatus.failedCount})
                  </p>
                  <div className="max-h-32 overflow-y-auto">
                    {queueStatus.failed.slice().reverse().slice(0, 10).map((item) => (
                      <div key={item.videoId} className="flex items-center gap-2 py-1.5 px-2 rounded-md text-sm">
                        <XCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-700 truncate">{item.title}</p>
                          {item.error && (
                            <p className="text-[11px] text-rose-500 truncate">{item.error}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Queue actions */}
          {queueStatus && (queueStatus.isActive || queueStatus.remaining > 0) && (
            <DialogFooter>
              <Button
                variant="outline"
                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                onClick={handleClearQueue}
              >
                <StopCircle className="h-4 w-4 mr-1.5" />
                Stop &amp; Clear Queue
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
