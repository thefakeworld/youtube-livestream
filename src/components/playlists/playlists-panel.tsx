"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  ListVideo,
  Plus,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Search,
  ImageIcon,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  ShieldCheck,
  Film,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
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

interface VideoItem {
  id: string;
  title: string;
  duration: number;
  status: string;
  thumbnailUrl?: string;
  localPath?: string;
}

interface PlaylistVideoItem {
  id: string;
  videoId: string;
  sortOrder: number;
  video: VideoItem;
}

interface PlaylistItem {
  id: string;
  name: string;
  description?: string;
  loop: boolean;
  backupVideoId?: string;
  backupVideo?: { id: string; title: string };
  createdAt: string;
  updatedAt: string;
  items: PlaylistVideoItem[];
  _count?: { items: number };
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function VideoStatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { color: string; label: string; icon: React.ElementType }
  > = {
    cached: {
      color: "bg-emerald-50 text-emerald-700 border-emerald-200",
      label: "Cached",
      icon: CheckCircle2,
    },
    pending: {
      color: "bg-amber-50 text-amber-700 border-amber-200",
      label: "Pending",
      icon: Clock,
    },
    downloading: {
      color: "bg-sky-50 text-sky-700 border-sky-200",
      label: "Downloading",
      icon: RefreshCw,
    },
    missing: {
      color: "bg-zinc-100 text-zinc-500 border-zinc-200",
      label: "Missing",
      icon: AlertCircle,
    },
    error: {
      color: "bg-rose-50 text-rose-700 border-rose-200",
      label: "Error",
      icon: AlertCircle,
    },
  };
  const c = config[status] || config.pending;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", c.color)}>
      <Icon className="h-2.5 w-2.5" />
      {c.label}
    </Badge>
  );
}

export function PlaylistsPanel() {
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<PlaylistItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Form state for create/edit
  const [form, setForm] = useState({
    name: "",
    description: "",
    loop: true,
    backupVideoId: "",
    selectedVideoIds: [] as string[],
  });
  const [allVideos, setAllVideos] = useState<VideoItem[]>([]);
  const [videoSearch, setVideoSearch] = useState("");
  const [videosLoading, setVideosLoading] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch("/api/playlists");
      if (res.ok) {
        const json = await res.json();
        setPlaylists(json.data || []);
      }
    } catch {
      toast.error("Failed to fetch playlists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  // Poll for downloading videos
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
      for (const id of downloadingIds) {
        try {
          const res = await fetch(`/api/videos/${id}`);
          if (res.ok) {
            const json = await res.json();
            const video = json.data;
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
      if (allDone) {
        setDownloadingIds(new Set());
        fetchPlaylists();
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
  }, [downloadingIds, fetchPlaylists]);

  function resetForm() {
    setForm({
      name: "",
      description: "",
      loop: true,
      backupVideoId: "",
      selectedVideoIds: [],
    });
    setVideoSearch("");
  }

  function openCreate() {
    resetForm();
    setCreateOpen(true);
    fetchVideosForPicker();
  }

  function openEdit(playlist: PlaylistItem) {
    setForm({
      name: playlist.name,
      description: playlist.description || "",
      loop: playlist.loop,
      backupVideoId: playlist.backupVideoId || "",
      selectedVideoIds: playlist.items
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => item.videoId),
    });
    setEditItem(playlist);
    fetchVideosForPicker();
  }

  async function fetchVideosForPicker() {
    setVideosLoading(true);
    try {
      const allRes = await fetch("/api/videos?pageSize=200");
      if (allRes.ok) {
        const json = await allRes.json();
        setAllVideos(json.data || []);
      }
    } catch {
      // silent
    } finally {
      setVideosLoading(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Playlist name is required");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        loop: form.loop,
        backupVideoId: form.backupVideoId || null,
        videoIds: form.selectedVideoIds,
      };

      const isEdit = !!editItem;
      const url = isEdit ? `/api/playlists/${editItem.id}` : "/api/playlists";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success(isEdit ? "Playlist updated" : "Playlist created");
        setCreateOpen(false);
        setEditItem(null);
        resetForm();
        fetchPlaylists();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to save playlist");
      }
    } catch {
      toast.error("Failed to save playlist");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/playlists/${deleteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Playlist deleted");
        setPlaylists((p) => p.filter((pl) => pl.id !== deleteId));
        if (expandedId === deleteId) setExpandedId(null);
      } else {
        toast.error("Failed to delete playlist");
      }
    } catch {
      toast.error("Failed to delete playlist");
    } finally {
      setDeleteId(null);
    }
  }

  async function handleDownloadVideo(videoId: string) {
    try {
      const res = await fetch(`/api/videos/${videoId}/download`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Download started");
        setDownloadingIds((prev) => new Set(prev).add(videoId));
        fetchPlaylists();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to start download");
      }
    } catch {
      toast.error("Failed to start download");
    }
  }

  function moveVideo(videoId: string, direction: "up" | "down") {
    const ids = [...form.selectedVideoIds];
    const idx = ids.indexOf(videoId);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    setForm((f) => ({ ...f, selectedVideoIds: ids }));
  }

  const filteredVideos = allVideos.filter((v) =>
    v.title.toLowerCase().includes(videoSearch.toLowerCase())
  );

  const totalDuration = (items: PlaylistVideoItem[]) =>
    items.reduce((sum, item) => sum + (item.video?.duration || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Playlists</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Organize videos into playlists for sequential streaming
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Create Playlist
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <Card className="gap-4">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 mb-4">
              <ListVideo className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="text-lg font-medium text-zinc-700">
              No playlists yet
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              Create a playlist to organize your videos
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {playlists.map((playlist) => {
            const isExpanded = expandedId === playlist.id;
            const sortedItems = [...playlist.items].sort(
              (a, b) => a.sortOrder - b.sortOrder
            );
            const dur = totalDuration(sortedItems);

            return (
              <Card
                key={playlist.id}
                className={cn(
                  "gap-0 py-0 overflow-hidden transition-shadow",
                  isExpanded && "ring-1 ring-emerald-200 shadow-emerald-50"
                )}
              >
                <CardContent className="p-5">
                  <div className="flex flex-col gap-3">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                          <ListVideo className="h-4.5 w-4.5 text-emerald-600" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-zinc-900 truncate">
                            {playlist.name}
                          </h3>
                          {playlist.description && (
                            <p className="text-xs text-zinc-500 truncate mt-0.5">
                              {playlist.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-400"
                          onClick={() => openEdit(playlist)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-400"
                          onClick={() => setDeleteId(playlist.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className="text-[11px] bg-zinc-50 text-zinc-600 border-zinc-200"
                      >
                        <Film className="h-3 w-3 mr-1" />
                        {sortedItems.length} video{sortedItems.length !== 1 ? "s" : ""}
                      </Badge>
                      {dur > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[11px] bg-zinc-50 text-zinc-600 border-zinc-200"
                        >
                          <Clock className="h-3 w-3 mr-1" />
                          {formatDuration(dur)}
                        </Badge>
                      )}
                      {playlist.loop && (
                        <Badge
                          variant="outline"
                          className="text-[11px] bg-teal-50 text-teal-700 border-teal-200"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Loop
                        </Badge>
                      )}
                      {playlist.backupVideo && (
                        <Badge
                          variant="outline"
                          className="text-[11px] bg-blue-50 text-blue-700 border-blue-200"
                        >
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          Backup
                        </Badge>
                      )}
                    </div>

                    {/* Expand toggle */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center text-xs text-zinc-500 hover:text-zinc-700 h-8"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : playlist.id)
                      }
                    >
                      {isExpanded ? (
                        <>
                          <ChevronDown className="h-3.5 w-3.5 mr-1" />
                          Hide videos
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-3.5 w-3.5 mr-1" />
                          Show videos ({sortedItems.length})
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Expanded video list */}
                  {isExpanded && sortedItems.length > 0 && (
                    <div className="mt-3 border-t border-zinc-100 pt-3">
                      <ScrollArea className="max-h-72">
                        <div className="flex flex-col gap-2">
                          {sortedItems.map((item, idx) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2.5 rounded-lg bg-zinc-50 px-3 py-2"
                            >
                              <span className="text-[10px] font-mono text-zinc-400 w-4 text-center shrink-0">
                                {idx + 1}
                              </span>
                              <div className="flex h-8 w-12 items-center justify-center overflow-hidden rounded bg-zinc-200 shrink-0">
                                {item.video.thumbnailUrl ? (
                                  <img
                                    src={item.video.thumbnailUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <ImageIcon className="h-3.5 w-3.5 text-zinc-400" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-zinc-800 truncate">
                                  {item.video.title}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] text-zinc-500">
                                    {formatDuration(item.video.duration)}
                                  </span>
                                  <VideoStatusBadge
                                    status={item.video.status}
                                  />
                                </div>
                              </div>
                              {(item.video.status === "pending" ||
                                item.video.status === "error" ||
                                item.video.status === "missing") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-zinc-400 hover:text-emerald-600"
                                  onClick={() =>
                                    handleDownloadVideo(item.videoId)
                                  }
                                  disabled={downloadingIds.has(item.videoId)}
                                >
                                  {downloadingIds.has(item.videoId) ? (
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Download className="h-3 w-3" />
                                  )}
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {isExpanded && sortedItems.length === 0 && (
                    <div className="mt-3 border-t border-zinc-100 pt-3 text-center text-xs text-zinc-400">
                      No videos in this playlist
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        modal={false}
        open={createOpen || !!editItem}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditItem(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editItem ? "Edit Playlist" : "Create Playlist"}
            </DialogTitle>
            <DialogDescription>
              {editItem
                ? "Update playlist details and video order"
                : "Create a new playlist by selecting videos"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 overflow-y-auto flex-1 -mx-6 px-6">
            <div className="flex flex-col gap-2">
              <Label>Name *</Label>
              <Input
                placeholder="My Playlist"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Optional description..."
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <Label>Loop playlist</Label>
                <span className="text-[11px] text-zinc-400">
                  Restart from the beginning when all videos finish
                </span>
              </div>
              <Switch
                checked={form.loop}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, loop: checked }))
                }
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Backup Video</Label>
              <Select
                value={form.backupVideoId || undefined}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, backupVideoId: v }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a video as backup" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {allVideos.length === 0 ? (
                    <div className="py-3 px-2 text-xs text-zinc-400 text-center">
                      No videos available. Import videos first.
                    </div>
                  ) : (
                    allVideos.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate max-w-[280px]">{v.title}</span>
                          <span className="text-[10px] text-zinc-400 shrink-0">
                            {formatDuration(v.duration)}
                          </span>
                          {v.status === "cached" && (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-zinc-400">
                This video plays when all playlist videos are unavailable
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>
                  Videos ({form.selectedVideoIds.length} selected)
                </Label>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <Input
                  placeholder="Search videos..."
                  className="pl-8 h-8 text-sm"
                  value={videoSearch}
                  onChange={(e) => setVideoSearch(e.target.value)}
                />
              </div>

              {/* Selected videos (reorderable) */}
              {form.selectedVideoIds.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-1">
                  <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                    Selected order
                  </p>
                  <ScrollArea className="max-h-48">
                    <div className="flex flex-col gap-1">
                      {form.selectedVideoIds.map((vid, idx) => {
                        const vidData = allVideos.find((v) => v.id === vid);
                        if (!vidData) return null;
                        return (
                          <div
                            key={vid}
                            className="flex items-center gap-2 rounded-md bg-emerald-50/60 border border-emerald-100 px-2.5 py-1.5"
                          >
                            <span className="text-[10px] font-mono text-zinc-500 w-4 text-center">
                              {idx + 1}
                            </span>
                            <p className="flex-1 text-xs text-zinc-700 truncate">
                              {vidData.title}
                            </p>
                            <VideoStatusBadge status={vidData.status} />
                            <div className="flex items-center gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-zinc-400 hover:text-zinc-700"
                                disabled={idx === 0}
                                onClick={() => moveVideo(vid, "up")}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-zinc-400 hover:text-zinc-700"
                                disabled={idx === form.selectedVideoIds.length - 1}
                                onClick={() => moveVideo(vid, "down")}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-zinc-400 hover:text-rose-600"
                                onClick={() =>
                                  setForm((f) => ({
                                    ...f,
                                    selectedVideoIds: f.selectedVideoIds.filter(
                                      (id) => id !== vid
                                    ),
                                  }))
                                }
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Video picker list */}
              <ScrollArea className="max-h-56 border rounded-md mt-1">
                {videosLoading ? (
                  <div className="flex flex-col gap-2 p-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col p-1">
                    {filteredVideos.length === 0 ? (
                      <p className="text-xs text-zinc-400 text-center py-4">
                        No videos found
                      </p>
                    ) : (
                      filteredVideos.map((video) => {
                        const isSelected =
                          form.selectedVideoIds.includes(video.id);
                        return (
                          <label
                            key={video.id}
                            className={cn(
                              "flex items-center gap-2.5 rounded-md px-2.5 py-2 cursor-pointer transition-colors",
                              isSelected
                                ? "bg-emerald-50"
                                : "hover:bg-zinc-50"
                            )}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                setForm((f) => ({
                                  ...f,
                                  selectedVideoIds: checked
                                    ? [...f.selectedVideoIds, video.id]
                                    : f.selectedVideoIds.filter(
                                        (id) => id !== video.id
                                      ),
                                }));
                              }}
                              className="h-4 w-4"
                            />
                            <div className="flex h-7 w-10 items-center justify-center overflow-hidden rounded bg-zinc-200 shrink-0">
                              {video.thumbnailUrl ? (
                                <img
                                  src={video.thumbnailUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-3 w-3 text-zinc-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-zinc-700 truncate">
                                {video.title}
                              </p>
                              <p className="text-[10px] text-zinc-500">
                                {formatDuration(video.duration)}
                              </p>
                            </div>
                            <VideoStatusBadge status={video.status} />
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setEditItem(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting
                ? "Saving..."
                : editItem
                  ? "Update Playlist"
                  : "Create Playlist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this playlist? This action cannot
              be undone.
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
