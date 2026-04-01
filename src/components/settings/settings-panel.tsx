"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Settings,
  Save,
  RefreshCw,
  Info,
  Pencil,
  Check,
  X,
  Cookie,
  Upload,
  Trash2,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
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
import { format } from "date-fns";

interface ConfigItem {
  key: string;
  value: string;
  description: string;
}

export function SettingsPanel() {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const json = await res.json();
        setConfigs(json.data || []);
      }
    } catch {
      toast.error("Failed to fetch configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  function startEdit(config: ConfigItem) {
    setEditing(config.key);
    setEditValue(config.value);
  }

  function cancelEdit() {
    setEditing(null);
    setEditValue("");
  }

  async function saveAll() {
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configs),
      });
      if (res.ok) {
        toast.success("Configuration saved successfully");
        setEditing(null);
        fetchConfigs();
      } else {
        toast.error("Failed to save configuration");
      }
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }

  // Cookies state
  const [cookieStatus, setCookieStatus] = useState<{
    exists: boolean;
    size?: number;
    uploadedAt?: string;
  } | null>(null);
  const [cookieLoading, setCookieLoading] = useState(true);
  const [cookieUploading, setCookieUploading] = useState(false);

  const fetchCookieStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cookies");
      if (res.ok) {
        const json = await res.json();
        setCookieStatus(json.data || null);
      } else {
        setCookieStatus(null);
      }
    } catch {
      setCookieStatus(null);
    } finally {
      setCookieLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCookieStatus();
  }, [fetchCookieStatus]);

  async function handleCookieUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCookieUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/cookies", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        toast.success("Cookies uploaded successfully");
        fetchCookieStatus();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to upload cookies");
      }
    } catch {
      toast.error("Failed to upload cookies");
    } finally {
      setCookieUploading(false);
      // Reset file input
      e.target.value = "";
    }
  }

  async function handleCookieRemove() {
    try {
      const res = await fetch("/api/cookies", { method: "DELETE" });
      if (res.ok) {
        toast.success("Cookies removed");
        setCookieStatus(null);
      } else {
        toast.error("Failed to remove cookies");
      }
    } catch {
      toast.error("Failed to remove cookies");
    }
  }

  function formatFileSize(bytes: number): string {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  function updateConfigValue(key: string, value: string) {
    setConfigs((prev) =>
      prev.map((c) => (c.key === key ? { ...c, value } : c))
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Settings</h1>
          <p className="text-sm text-zinc-500 mt-1">
            System configuration and preferences
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={fetchConfigs}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            onClick={saveAll}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save All"}
          </Button>
        </div>
      </div>

      {/* System Information */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Info className="h-5 w-5 text-emerald-500" />
            System Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg bg-zinc-50 p-4">
              <p className="text-xs text-zinc-500">Version</p>
              <p className="text-sm font-semibold text-zinc-900 mt-1">1.0.0</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-4">
              <p className="text-xs text-zinc-500">Runtime</p>
              <p className="text-sm font-semibold text-zinc-900 mt-1">Node.js 20</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-4">
              <p className="text-xs text-zinc-500">Framework</p>
              <p className="text-sm font-semibold text-zinc-900 mt-1">Next.js 16</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-4">
              <p className="text-xs text-zinc-500">Encoder</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm font-semibold text-zinc-900">FFmpeg</p>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"
                >
                  Available
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FFmpeg Status */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900">
            FFmpeg Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="text-sm text-emerald-700 font-medium">
                FFmpeg is available
              </span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-xs text-zinc-500">
              Hardware acceleration: auto-detected
            </span>
          </div>
        </CardContent>
      </Card>

      {/* YouTube Cookies */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Cookie className="h-5 w-5 text-amber-500" />
            YouTube Cookies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-zinc-600">
              Upload cookies.txt for age-restricted or private videos. Export from
              browser using an extension like &quot;Get cookies.txt LOCALLY&quot;.
            </p>

            {/* Status */}
            {cookieLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : cookieStatus?.exists ? (
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">
                      Cookies file active
                    </p>
                    <p className="text-xs text-emerald-600">
                      {formatFileSize(cookieStatus.size || 0)}
                      {cookieStatus.uploadedAt &&
                        ` · Uploaded ${format(new Date(cookieStatus.uploadedAt), "MMM d, yyyy HH:mm")}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-rose-600 border-rose-200 hover:bg-rose-50"
                  onClick={handleCookieRemove}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg bg-zinc-50 border border-dashed border-zinc-200 px-4 py-3">
                <FileText className="h-5 w-5 text-zinc-400" />
                <p className="text-sm text-zinc-500">
                  No cookies file uploaded
                </p>
              </div>
            )}

            {/* Upload area */}
            <label
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors",
                cookieUploading
                  ? "border-zinc-300 bg-zinc-50 cursor-wait"
                  : "border-zinc-200 hover:border-emerald-300 hover:bg-emerald-50/30"
              )}
            >
              <input
                type="file"
                accept=".txt,.json"
                className="sr-only"
                onChange={handleCookieUpload}
                disabled={cookieUploading}
              />
              {cookieUploading ? (
                <RefreshCw className="h-8 w-8 text-zinc-400 animate-spin" />
              ) : (
                <Upload className="h-8 w-8 text-zinc-400" />
              )}
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-700">
                  {cookieUploading
                    ? "Uploading..."
                    : "Click to upload or drag and drop"}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Accepts .txt and .json files
                </p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Table */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Settings className="h-5 w-5 text-zinc-500" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : configs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-sm text-zinc-400">
              No configuration entries
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Key</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="hidden sm:table-cell">Description</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((config) => (
                  <TableRow key={config.key}>
                    <TableCell>
                      <code className="text-xs font-mono bg-zinc-100 px-2 py-1 rounded text-zinc-700">
                        {config.key}
                      </code>
                    </TableCell>
                    <TableCell>
                      {editing === config.key ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="h-8 text-sm"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                updateConfigValue(config.key, editValue);
                                setEditing(null);
                              }
                              if (e.key === "Escape") {
                                cancelEdit();
                              }
                            }}
                            autoFocus
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-emerald-600"
                            onClick={() => {
                              updateConfigValue(config.key, editValue);
                              setEditing(null);
                            }}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-zinc-400"
                            onClick={cancelEdit}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-sm text-zinc-700">{config.value}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-zinc-500">
                      {config.description}
                    </TableCell>
                    <TableCell className="text-right">
                      {editing !== config.key && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => startEdit(config)}
                        >
                          <Pencil className="h-3.5 w-3.5 text-zinc-400" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
