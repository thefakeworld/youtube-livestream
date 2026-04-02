"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Terminal,
  Activity,
  Clock,
  Download,
  ArrowDown,
  MonitorPlay,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

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
}

interface LogEntry {
  id: string;
  action: string;
  message: string;
  metadata?: string;
  createdAt: string;
}

interface StreamLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskName: string;
  isLive: boolean;
  isDead?: boolean;
  processInfo?: ProcessInfo;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function StatItem({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center py-1.5">
      <div className="flex items-center gap-1">
        {icon}
        <span className="text-sm font-bold text-zinc-800">{value}</span>
      </div>
      <span className="text-[10px] text-zinc-400">{label}</span>
    </div>
  );
}

function EventBadge({ action }: { action: string }) {
  const config: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    start:    { color: "bg-emerald-100 text-emerald-700", label: "启动", icon: <CheckCircle2 className="h-3 w-3" /> },
    stop:     { color: "bg-zinc-100 text-zinc-600", label: "停止", icon: <Info className="h-3 w-3" /> },
    error:    { color: "bg-rose-100 text-rose-700", label: "错误", icon: <XCircle className="h-3 w-3" /> },
    failover: { color: "bg-amber-100 text-amber-700", label: "故障转移", icon: <AlertTriangle className="h-3 w-3" /> },
    complete: { color: "bg-emerald-100 text-emerald-700", label: "完成", icon: <CheckCircle2 className="h-3 w-3" /> },
  };
  const c = config[action] || { color: "bg-zinc-100 text-zinc-500", label: action, icon: <Info className="h-3 w-3" /> };
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md", c.color)}>
      {c.icon}
      {c.label}
    </span>
  );
}

export function StreamLogDialog({
  open,
  onOpenChange,
  taskId,
  taskName,
  isLive,
  isDead,
  processInfo,
}: StreamLogDialogProps) {
  const [activeTab, setActiveTab] = useState<"events" | "output">("events");
  const [eventLogs, setEventLogs] = useState<LogEntry[]>([]);
  const [ffLines, setFfLines] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dbLogsRef = useRef<LogEntry[]>([]);
  const lastIdRef = useRef("");

  // State reset handled by parent via key={logDialogKey} remount — no effect needed

  // Fetch event logs (DB)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const fetchLogs = async () => {
      if (cancelled) return;
      try {
        const params = new URLSearchParams();
        params.set("limit", "50");
        const res = await fetch(`/api/streams/${taskId}/logs?${params}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const logs: LogEntry[] = json.data || [];
        if (!cancelled) {
          dbLogsRef.current = logs;
          setEventLogs(logs);
          if (logs.length > 0) lastIdRef.current = logs[logs.length - 1].id;
        }
      } catch { /* silent */ }
    };

    fetchLogs();
    if (isLive || isDead) {
      const iv = setInterval(async () => {
        if (cancelled || !lastIdRef.current) return;
        try {
          const params = new URLSearchParams();
          params.set("sinceId", lastIdRef.current);
          params.set("limit", "20");
          const res = await fetch(`/api/streams/${taskId}/logs?${params}`);
          if (!res.ok || cancelled) return;
          const json = await res.json();
          const newLogs: LogEntry[] = json.data || [];
          if (newLogs.length > 0 && !cancelled) {
            // Deduplicate by id before merging
            const existingIds = new Set(dbLogsRef.current.map(l => l.id));
            const unique = newLogs.filter(l => !existingIds.has(l.id));
            if (unique.length > 0) {
              dbLogsRef.current = [...unique, ...dbLogsRef.current].slice(-100);
              setEventLogs([...dbLogsRef.current]);
            }
            lastIdRef.current = newLogs[newLogs.length - 1].id;
          }
        } catch { /* silent */ }
      }, 5000);
      return () => { cancelled = true; clearInterval(iv); };
    }
  }, [open, taskId, isLive, isDead]);

  // Fetch FFmpeg output
  const outputSeqRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const fetchOutput = async () => {
      if (cancelled) return;
      try {
        const params = new URLSearchParams();
        if (outputSeqRef.current > 0) params.set("since", String(outputSeqRef.current));
        params.set("limit", "200");
        const res = await fetch(`/api/streams/${taskId}/output?${params}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (json.seq > outputSeqRef.current) {
          outputSeqRef.current = json.seq;
          const lines: string[] = json.data || [];
          // Deduplicate consecutive stat lines
          const deduped: string[] = [];
          for (const line of lines) {
            if (/^frame=/.test(line) && deduped.length > 0 && /^frame=/.test(deduped[deduped.length - 1])) {
              deduped[deduped.length - 1] = line;
            } else {
              deduped.push(line);
            }
          }
          if (deduped.length > 0 && !cancelled) {
            setFfLines((prev) => [...prev, ...deduped].slice(-300));
          }
        }
      } catch { /* silent */ }
    };

    fetchOutput();
    const iv = setInterval(fetchOutput, 2000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [open, taskId]);

  // Auto-scroll
  useEffect(() => {
    if (open && autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [ffLines, eventLogs, open, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 80);
  }, []);

  const hasEvents = eventLogs.length > 0;
  const hasOutput = ffLines.length > 0;

  const isStatLine = (line: string) => /^frame=/.test(line);
  const isInfoLine = (line: string) =>
    /^(info|Input #|Output #|Stream |configuration|At least|Built with|youtube|Extracting|Downloading|\[download\]|\[info\])/i.test(line);
  const isWarnLine = (line: string) =>
    /^(warn|WARNING|Error|error|failed|Failed|\[error\])/i.test(line);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[82vh] flex flex-col gap-0 overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              isLive && "bg-emerald-100",
              isDead && "bg-rose-100",
              !isLive && !isDead && "bg-zinc-100",
            )}>
              <MonitorPlay className={cn(
                "h-4 w-4",
                isLive && "text-emerald-600",
                isDead && "text-rose-600",
                !isLive && !isDead && "text-zinc-500",
              )} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold text-zinc-900 truncate">{taskName}</DialogTitle>
              <div className="flex items-center gap-2 mt-0.5">
                {isLive && (
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    推流中
                  </Badge>
                )}
                {isDead && (
                  <Badge className="bg-rose-100 text-rose-700 border-rose-200 gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    进程异常
                  </Badge>
                )}
                {!isLive && !isDead && (
                  <Badge variant="outline" className="text-zinc-500">待机</Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            {processInfo?.pid && <span className="font-mono">PID {processInfo.pid}</span>}
            {processInfo?.startedAt && (
              <span>{formatDistanceToNow(new Date(processInfo.startedAt), { addSuffix: false })}</span>
            )}
          </div>
        </div>

        {/* ── Live Stats (only when live) ── */}
        {isLive && processInfo && processInfo.isAlive && (
          <div className="flex items-center justify-center gap-6 px-5 py-2 bg-zinc-50 border-b">
            <StatItem label="FPS" value={processInfo.stats.fps > 0 ? processInfo.stats.fps.toFixed(1) : "-"} icon={<Activity className="h-3.5 w-3.5 text-zinc-400" />} />
            <StatItem label="码率" value={processInfo.stats.bitrate > 0 ? `${Math.round(processInfo.stats.bitrate)}k` : "-"} />
            <StatItem label="帧数" value={processInfo.stats.frame > 0 ? String(processInfo.stats.frame) : "-"} />
            <StatItem label="速度" value={processInfo.stats.speed > 0 ? `${processInfo.stats.speed.toFixed(1)}x` : "-"} icon={<Zap className="h-3.5 w-3.5 text-zinc-400" />} />
            <StatItem label="已编码" value={processInfo.stats.time || "-"} icon={<Clock className="h-3.5 w-3.5 text-zinc-400" />} />
            <StatItem label="数据量" value={formatBytes(processInfo.stats.size)} icon={<Download className="h-3.5 w-3.5 text-zinc-400" />} />
          </div>
        )}

        {/* ── Tab Bar ── */}
        <div className="flex items-center border-b px-5 bg-white">
          <button
            type="button"
            className={cn(
              "px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px",
              activeTab === "events"
                ? "border-emerald-500 text-emerald-600"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            )}
            onClick={() => setActiveTab("events")}
          >
            事件日志
            {hasEvents && (
              <Badge variant="secondary" className="ml-1.5 h-5 min-w-[18px] px-1.5 text-[10px]">
                {eventLogs.length}
              </Badge>
            )}
          </button>
          <button
            type="button"
            className={cn(
              "px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px",
              activeTab === "output"
                ? "border-emerald-500 text-emerald-600"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            )}
            onClick={() => setActiveTab("output")}
          >
            进程输出
            {hasOutput && (
              <Badge variant="secondary" className="ml-1.5 h-5 min-w-[18px] px-1.5 text-[10px]">
                {ffLines.length}
              </Badge>
            )}
          </button>
          {hasOutput && activeTab === "output" && (
            <button
              type="button"
              className={cn(
                "ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors",
                autoScroll ? "text-emerald-600 bg-emerald-50 hover:bg-emerald-100" : "text-zinc-400 hover:text-zinc-600"
              )}
              onClick={() => setAutoScroll(!autoScroll)}
            >
              <ArrowDown className="h-3 w-3" />
              {autoScroll ? "自动滚动" : "已暂停"}
            </button>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "events" ? (
            <div className="h-full max-h-[52vh] overflow-y-auto bg-white">
              {!hasEvents ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[180px] text-zinc-300 gap-2">
                  <Terminal className="h-8 w-8 opacity-20" />
                  <span className="text-sm">暂无事件日志</span>
                  <span className="text-xs text-zinc-400">启动推流后，操作记录将在此显示</span>
                </div>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {eventLogs.map((log) => {
                    let meta: Record<string, unknown> | null = null;
                    try { meta = log.metadata ? JSON.parse(log.metadata) : null; } catch { /* ignore */ }
                    return (
                      <div key={log.id} className="px-5 py-3 hover:bg-zinc-50/50 transition-colors">
                        <div className="flex items-center gap-2 mb-1">
                          <EventBadge action={log.action} />
                          <span className="text-[11px] text-zinc-400 font-mono">
                            {new Date(log.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-700 leading-relaxed mt-1">{log.message}</p>
                        {meta && Object.keys(meta).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                            {Object.entries(meta).map(([k, v]) => (
                              <span key={k} className="text-[11px] text-zinc-400">
                                <span className="text-zinc-500 font-medium">{k}:</span> {String(v)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div
              ref={containerRef}
              onScroll={handleScroll}
              className="h-full max-h-[52vh] overflow-y-auto bg-zinc-50 font-mono text-[11px] leading-relaxed"
            >
              {!hasOutput ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[180px] text-zinc-300 gap-2">
                  <Terminal className="h-8 w-8 opacity-20" />
                  <span className="text-sm">暂无进程输出</span>
                  <span className="text-xs text-zinc-400">
                    {isLive || isDead ? "进程启动后 FFmpeg 输出将实时显示" : "启动推流后可查看编码日志"}
                  </span>
                </div>
              ) : (
                <>
                  {ffLines.map((line, i) => {
                    const isStat = isStatLine(line);
                    const isInfo = isInfoLine(line);
                    const isWarn = isWarnLine(line);
                    return (
                      <div
                        key={`ff-${i}`}
                        className={cn(
                          "px-4 py-[1px] transition-colors border-b border-zinc-200/60",
                          isStat && "bg-emerald-50 border-emerald-100/50",
                          isInfo && "bg-sky-50 border-sky-100/50",
                          isWarn && "bg-rose-50 border-rose-100/50",
                        )}
                      >
                        <span
                          className={cn(
                            "break-all",
                            isStat && "text-emerald-800 font-medium",
                            isInfo && "text-sky-700",
                            isWarn && "text-rose-700 font-medium",
                            !isStat && !isInfo && !isWarn && "text-zinc-500"
                          )}
                        >
                          {line || " "}
                        </span>
                      </div>
                    );
                  })}
                  <div ref={logEndRef} />
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
