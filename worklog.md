---
Task ID: 1
Agent: Main
Task: Design and implement Prisma schema for all data models

Work Log:
- Analyzed the YouTube Live Automation system requirements
- Designed complete Prisma schema with 7 models: Video, StreamTask, RelayTarget, RelayTask, SystemConfig, AlertLog, StreamLog
- Pushed schema to SQLite database with `bun run db:push`
- Generated Prisma Client

Stage Summary:
- Complete database schema established
- All relationships and indexes defined
- Database seeded with demo data

---
Task ID: 2
Agent: full-stack-developer (subagent)
Task: Create API routes for all modules

Work Log:
- Created 14 API route files covering all modules
- Created seed utility with demo data (10 videos, 3 streams, 2 relays, 8 configs, 6 alerts, 6 logs)
- All routes include proper error handling and JSON responses

Stage Summary:
- API routes: videos (CRUD), streams (CRUD + start/stop), relays (CRUD + start/stop), monitor, config, alerts, logs
- Seed data auto-populates on first API request
- All routes return 200 OK

---
Task ID: 3
Agent: full-stack-developer (subagent)
Task: Build complete frontend application

Work Log:
- Created Zustand store for navigation state management
- Built dark sidebar with responsive design (Sheet for mobile, collapsible for desktop)
- Built 6 panel components: Dashboard, Video Library, Stream Tasks, Relay Tasks, Monitor, Settings
- Dashboard: 4 stat cards, area chart, pie chart, recent activity log, stream/relay summaries
- Video Library: Table (desktop) + card (mobile) views, search/filter, import dialog, delete confirmation
- Stream Tasks: Task cards with status badges, start/stop controls, create dialog with encoding params
- Relay Tasks: Task cards with platform icons, dynamic target management, create dialog
- Monitor: Resource gauges, active stream/relay health, alerts table
- Settings: System info, FFmpeg status, inline-editable config table
- Used framer-motion for panel transitions, recharts for charts, sonner for toasts
- Emerald/teal accent colors with zinc neutrals

Stage Summary:
- Complete single-page application with 6 panels
- Responsive design (mobile + desktop)
- Zero ESLint errors
- All API integrations working
- Smooth animations and transitions

---
## Task ID: 2 - stream-engine
### Work Task
Create a real FFmpeg Stream Engine mini-service at `mini-services/stream-engine/` — an independent Bun project that manages FFmpeg processes for live streaming via HTTP API + WebSocket.

### Work Summary
Created 2 files:

**`mini-services/stream-engine/package.json`** — Bun project config with `dev` script using `--hot`.

**`mini-services/stream-engine/index.ts`** (1038 lines) — Complete stream engine with:

- **HTTP API (port 3001):** 8 endpoints — health check, stream start/stop, relay start/stop, process list/detail, system stats
- **WebSocket `/ws`:** Broadcasts all process statuses + system stats every 2s; supports per-task subscriptions
- **ProcessManager class:** Manages FFmpeg child processes in `Map<string, FFmpegProcess>` with real-time stats
- **FFmpeg Output Parser:** Regex-based line-by-line stderr parsing (frame, fps, size, time, bitrate, speed)
- **System Stats Reader:** Reads `/proc/cpuinfo`, `/proc/meminfo`, `/proc/net/dev`, `df -h`, dual-sample CPU calculation
- **Process Stats:** Reads `/proc/<pid>/statm` for per-process RSS memory
- **Stream Start:** Spawns FFmpeg with libx264/AAC encoding, configurable resolution/fps/bitrate/preset, scale+pad+setsar filter, optional backup RTMP via tee
- **Relay Start:** Uses yt-dlp to resolve YouTube stream URL, then FFmpeg with `-c copy` + tee to multiple RTMP targets
- **Auto-recovery:** Relay tasks auto-restart up to 3x with 5s delay; stream tasks require manual restart
- **Graceful shutdown:** SIGTERM → 5s wait → SIGKILL; cleanup on SIGTERM/SIGINT
- **Standby fallback:** Auto-generates 10s 1080p30 test pattern video on first startup
- **CORS:** Full preflight support for cross-origin requests
- **Validation:** Input file existence checks, required field validation, duplicate task prevention

All endpoints verified working. FFmpeg 7.1.3 and yt-dlp both detected. Zero ESLint errors.

---
## Task ID: 5 - api-rewriter
### Work Task
Rewrite all Next.js API routes to integrate with the real stream engine (port 3001) via Caddy gateway proxy. Replace mock/demo data with real engine calls, yt-dlp integration, and actual FFmpeg process management.

### Work Summary

**Created 3 new files:**

1. **`src/lib/engine.ts`** — Centralized engine helper module
   - `callEngine(path, options)` function that appends `?XTransformPort=3001` to all requests
   - Typed `engine` object with methods: `health()`, `startStream()`, `stopStream()`, `startRelay()`, `stopRelay()`, `getProcesses()`, `getProcess()`, `getSystem()`
   - Proper error handling with status code and response text

2. **`src/app/api/videos/[id]/download/route.ts`** — Real yt-dlp download endpoint
   - POST handler spawns yt-dlp in detached background process
   - Downloads to `/home/z/my-project/download/videos/{youtubeId}.mp4`
   - Uses format selector: `best[height<=1080][ext=mp4]/best[height<=720]/best`
   - Updates DB status: `pending` → `downloading` → `cached` (or `error`)
   - Writes StreamLog entries for start, completion, and failure events
   - Updates fileSize and downloadedAt on success

3. **`src/app/api/engine/status/route.ts`** — Engine health proxy
   - GET handler calls engine health, processes, and system endpoints in parallel
   - Returns combined status: `{ online, health, processes, system, timestamp }`
   - Gracefully handles engine being offline

**Rewrote 7 existing files:**

4. **`src/app/api/streams/[id]/start/route.ts`** — Real FFmpeg stream start
   - Fetches stream task with video relation from DB
   - Resolves video input path (localPath → fallback.mp4)
   - Calls `engine.startStream()` with all encoding params + `loopVideo: true`
   - Updates DB: status='live', startedAt, currentPid from engine response
   - Creates StreamLog with full engine metadata
   - On error: marks task as 'error' status in DB

5. **`src/app/api/streams/[id]/stop/route.ts`** — Real FFmpeg stream stop
   - Calls `engine.stopStream()` with taskId
   - Calculates total duration (previous + current session)
   - Updates DB: status='stopped', stoppedAt, totalDuration, currentPid=null
   - Creates StreamLog with duration info

6. **`src/app/api/relays/[id]/start/route.ts`** — Real relay start
   - Fetches relay with enabled targets from DB
   - Calls `engine.startRelay()` with source URL, quality, and enabled targets
   - Updates DB: status='live', startedAt, currentPid
   - Creates StreamLog with target platforms list

7. **`src/app/api/relays/[id]/stop/route.ts`** — Real relay stop
   - Calls `engine.stopRelay()` with taskId
   - Updates DB: status='stopped', stoppedAt, currentPid=null
   - Creates StreamLog with duration and bytes transferred

8. **`src/app/api/monitor/route.ts`** — Real system + process monitoring
   - Calls `engine.getProcesses()` and `engine.getSystem()` in parallel with DB queries
   - Returns combined response with `engine` section containing real process data
   - Includes `engineOnline` boolean flag
   - Gracefully degrades if engine is offline (returns empty/null for engine data)
   - Increased recent logs to 10 entries

9. **`src/app/api/videos/route.ts`** — Real yt-dlp info extraction in POST
   - Uses `execSync` with `yt-dlp -J --no-download` to extract video metadata (title, duration, thumbnail, codec, resolution, filesize)
   - Creates DB record with real metadata, status='pending'
   - Falls back to minimal info if yt-dlp fails
   - Removed fake random duration/fileSize generation
   - Removed seedIfEmpty dependency

10. **`src/lib/seed.ts`** — Simplified seed
    - Now only seeds if SystemConfig table is empty
    - Seeds 11 system configs (added ytdlp_path, download_dir, fallback_video)
    - Creates 1 fallback video reference record
    - Removed all fake stream tasks, relay tasks, alert logs, and stream logs
    - Removed dependency on fake video data

**Key architectural decisions:**
- All engine communication goes through `?XTransformPort=3001` gateway format
- Engine errors are caught gracefully — DB status still updated on failure
- yt-dlp downloads run as detached child processes with async DB callbacks
- Monitor endpoint provides real CPU/memory/disk/network stats from `/proc`
- Zero ESLint errors, dev server compiles cleanly

---
## Task ID: 6 - frontend-real-data
### Work Task
Rewrite all frontend panel components to display REAL data from the FFmpeg stream engine instead of fake/mock data. Add real-time polling, engine status indicators, and download management.

### Work Summary

**Created 1 new file:**

1. **`src/hooks/use-engine-status.ts`** — Real-time engine status polling hook
   - `useEngineStatus(intervalMs)` hook that polls `GET /api/engine/status` every N ms
   - Returns `{ status, loading, refetch }` with typed `EngineStatus` interface
   - Gracefully handles engine offline (returns `online: false` with empty data)
   - Exports helper functions: `formatBytes()`, `formatUptime()`, `formatNumber()`
   - Uses `useRef` for interval cleanup to prevent memory leaks

**Rewrote 5 existing files:**

2. **`src/components/dashboard/dashboard-panel.tsx`** — Dashboard with real engine data
   - **Engine Status Badge**: Green "Engine Online" / Red "Engine Offline" badge in header
   - **System Resources Card**: Real CPU%, Memory%, Disk%, Network (Rx/Tx bytes) from `data.engine.system`
   - **Live Stream Performance Chart**: Replaced fake hourly AreaChart with real-time LineChart showing FPS and bitrate over time (rolling 30-point window from engine process data)
   - **Active Processes Card**: Shows all running engine processes with real PID, uptime, FPS, bitrate, frames pushed, CPU%, RAM
   - **Storage Pie Chart**: Uses real video file sizes from DB
   - **Stream/Relay Summary Cards**: Show real process stats (FPS, bitrate, frames, bytes transferred) for live streams and relays
   - **Auto-polling**: Polls `/api/monitor` every 5 seconds
   - Removed all fake/random data generation

3. **`src/components/monitor/monitor-panel.tsx`** — Monitor with real system data
   - **Auto-refresh with countdown**: Visible 3-second countdown timer, polls every 3 seconds
   - **Engine Online/Offline Badge**: Prominent status indicator in header
   - **Engine Offline Banner**: Warning banner with startup instructions when engine is offline
   - **System Resources**: 4 gauges showing real CPU (with core count), Memory (with used/total), Disk (with used/total), Network (Rx/Tx bytes) — all from engine
   - **Running Processes Detail**: For each engine process, shows full detail: PID, uptime, current FPS, bitrate, frames pushed, bytes written, CPU%, memory MB
   - **Stream/Relay Process Cards**: Separate cards for stream and relay processes with type-specific styling
   - **Alerts Table**: Kept from original (DB-sourced data)
   - Removed all `Math.random()` mock data

4. **`src/components/videos/video-library-panel.tsx`** — Video library with download management
   - **Improved Status Badges**: "Ready to stream" (cached), "Ready to download" (pending), "Downloading..." with spinner (downloading), "Download failed" (error)
   - **Download Button**: For `pending` and `error` videos — calls `POST /api/videos/[id]/download`
   - **Retry Button**: For `error` status videos
   - **Animated Download Indicator**: Disabled button with spinning icon while downloading
   - **Auto-polling for downloads**: Polls `GET /api/videos/[id]` every 3 seconds for videos in 'downloading' state, auto-updates UI when status changes
   - **Import toast**: Shows real video title extracted by yt-dlp: "Video info extracted: 'title'"
   - **Download completion toasts**: Success/failure toasts when polling detects status change

5. **`src/components/streams/stream-tasks-panel.tsx`** — Stream tasks with real-time process data
   - **Engine Status Warning Banner**: Amber warning when engine is offline with startup instructions
   - **Start button disabled when engine offline**: `canStart` condition includes `engineOnline`
   - **Real-time process matching**: Matches engine processes to tasks by `taskId` pattern (`stream_${id}`)
   - **LiveProcessStats component**: For live streams with matching engine process, shows real-time grid: FPS, bitrate (kbps), frames pushed, uptime, CPU%, RAM (MB) — all with green accent styling
   - **Missing process indicator**: Amber warning when stream is live but engine data unavailable
   - **Uses `useEngineStatus(5000)`**: Polls every 5 seconds for real-time updates

6. **`src/components/relays/relay-tasks-panel.tsx`** — Relay tasks with real-time process data
   - **Engine Status Warning Banner**: Same as streams panel
   - **Start button disabled when engine offline**
   - **Real-time process matching**: Matches engine processes to relay tasks by `taskId` pattern (`relay_${id}`)
   - **LiveRelayStats component**: For live relays with matching engine process, shows: uptime, bytes transferred, bitrate, CPU/RAM — teal accent styling
   - **Missing process indicator**: Amber warning when relay is live but engine data unavailable
   - **Uses `useEngineStatus(5000)`**: Polls every 5 seconds for real-time updates
   - **Graceful degradation**: Shows basic stats (data transferred, status) when relay is not live

**Zero ESLint errors. Dev server compiles cleanly.**

---
## Task ID: 8 - playlist-rotation-streaming
### Work Task
Add playlist rotation streaming to the FFmpeg Stream Engine mini-service at `mini-services/stream-engine/index.ts`. Implement `POST /api/playlist/start` and `POST /api/playlist/stop` endpoints with sequential video rotation, yt-dlp download fallback, and backup video failover.

### Work Summary

Added ~600 lines of new code to `mini-services/stream-engine/index.ts` (grew from 1038 to 1636 lines). All existing endpoints remain intact.

**New interfaces (lines 59-79):**
- `PlaylistVideo` — individual video entry with id, localPath, youtubeId, sourceUrl
- `PlaylistStartRequest` — full request with videos array, encoding params, loop flag, backupVideoPath, cookiesPath

**New `PlaylistRunner` class (lines 354-750):**
- Sequential video iteration with configurable loop
- Video resolution: checks localPath → cached download path → yt-dlp download with 60s timeout
- yt-dlp download with cookies support (`--cookies` flag only when cookiesPath provided and file exists)
- FFmpeg streaming per video with `-re -stream_loop -1` (same encoding args as regular stream)
- Consecutive failure tracking — if all videos fail in a row, falls back to `backupVideoPath`
- Exit code handling: code 0 (normal) advances playlist; non-zero (crash) skips to next
- Loop mode: wraps back to first video on completion; no-loop mode: stops or uses backup
- Backup video streamed in infinite loop when all videos fail
- Stats parsing via `parseFFmpegLine` (same as stream/relay processes)
- Real-time stderr/stdout monitoring wired to ProcessManager entries

**New ProcessManager methods:**
- `startPlaylist(req)` — validates input, creates `PlaylistRunner`, creates process entry, fires async run loop
- `getProcessEntry(taskId)` — returns mutable entry reference for PlaylistRunner stats updates
- `updatePlaylistProcess(taskId, proc)` — swaps FFmpeg process when switching videos
- `updatePlaylistState(taskId, state)` — updates currentVideoIndex/Id/FilePath in config
- `removeProcessEntry(taskId)` / `removePlaylistRunner(taskId)` — cleanup helpers
- `playlistRunners` Map for tracking active runners
- Modified `stopProcess()` — playlist type signals runner to stop, waits 1.5s, force-cleans if needed
- Modified `shutdownAll()` — stops playlist runners first, then existing stream/relay processes

**New HTTP routes (lines 1480-1503):**
- `POST /api/playlist/start` — parses PlaylistStartRequest, calls manager.startPlaylist()
- `POST /api/playlist/stop` — parses StopRequest, calls manager.stopProcess()

**Edge cases handled:**
- Empty video list → immediate backup fallback
- Download failures → skip to next video with warning
- All videos fail consecutively → backup video in infinite loop
- Backup video missing → logs error, doesn't crash
- Runner stopped during video playback → SIGTERM → clean cleanup
- Concurrent stop + runner cleanup → no race conditions (force cleanup after timeout)

**File verified:** Bun transpiles cleanly, all existing endpoints preserved.
### Work Task
Create 6 new API route files and update 1 existing file for YouTube Live Automation backend: cookie management, channel video listing, batch import, file sync, playlist CRUD, and download cookies support.

### Work Summary

**Created 6 new files:**

1. **`src/app/api/cookies/route.ts`** — Cookie Management (GET/POST/DELETE)
   - GET: Checks if `cookies.txt` exists, returns `{ hasCookies, filename, size, uploadedAt }` using `statSync`
   - POST: Accepts multipart form with `cookies` field, validates Netscape `.txt` (must start with `# Netscape`) or Chrome `.json` (valid JSON) format, saves to `/download/cookies/cookies.txt`
   - DELETE: Removes cookies file, returns success even if file doesn't exist

2. **`src/app/api/videos/channel/route.ts`** — Channel Video Listing (POST)
   - Accepts `{ url, maxVideos }` for YouTube channel/playlist URLs
   - Uses `execSync` with yt-dlp `--flat-playlist --print "%(id)s|%(title)s|%(duration_string)s|%(view_count)s|%(thumbnail)s"`
   - Parses pipe-delimited output into structured `{ youtubeId, title, duration, views, thumbnail }` array
   - Auto-retry with `--cookies` flag if first attempt fails and cookies file exists
   - Returns `{ data, source, cookiesUsed }` — clearly documented as listing only, NOT importing

3. **`src/app/api/videos/import-batch/route.ts`** — Batch Import (POST)
   - Accepts `{ videos: Array<{ youtubeId, title, channelId? }> }` (max 50 per batch)
   - Checks for duplicates by `youtubeId` in DB, skips existing
   - For each new video, fetches real metadata via `yt-dlp -J --no-download` (with cookies if available)
   - Creates DB records with full metadata (duration, thumbnail, resolution, codec) or minimal fallback
   - Returns `{ imported, skipped, total, videos: [...] }` with per-video status

4. **`src/app/api/videos/sync/route.ts`** — Video File Sync (POST)
   - Scans all videos in DB, checks `localPath` file existence with `existsSync`
   - Status transition logic: cached+file→keep (update fileSize), missing+file→cached, cached+nofile→missing, downloading+nofile→error
   - Returns `{ checked, updated, results: [{ videoId, oldStatus, newStatus }] }`

5. **`src/app/api/playlists/route.ts`** — Playlist CRUD (GET/POST)
   - GET: Lists all playlists with items (ordered by sortOrder) including video info (id, title, thumbnail, duration, status, localPath) and backup video info
   - POST: Creates playlist with optional `{ name, description, loop, backupVideoId, items }`; validates backup video and item video IDs exist

6. **`src/app/api/playlists/[id]/route.ts`** — Single Playlist (GET/PUT/DELETE)
   - GET: Single playlist with full item/video details
   - PUT: Updates playlist fields; if `items` array provided, replaces all items (delete existing + create new); supports setting backupVideoId to null
   - DELETE: Cascade deletes playlist and its items

**Updated 1 existing file:**

7. **`src/app/api/videos/[id]/download/route.ts`** — Added cookies support
   - Added `COOKIES_PATH` constant and `existsSync` check before spawning yt-dlp
   - Inserts `--cookies /path/to/cookies.txt` into args array before sourceUrl when cookies file exists
   - Returns `cookiesUsed: boolean` in response
   - Enhanced error message: detects age-restriction/sign-in keywords in stderr and suggests uploading cookies

**Zero ESLint errors. All 7 route files compile cleanly.**

---
## Task ID: 9 - fix-channel-import-auto-title
Agent: Main
Task: Fix channel import pipe delimiter conflict and single video import auto-title resolution

Work Log:
- Diagnosed channel import failure: yt-dlp `--print "%(id)s|%(title)s"` uses `|` delimiter but video titles contain `|` (e.g. "CLAP 4 ME | MANGO Choreography")
- Fixed: Changed delimiter from `|` to `\t` (tab) in yt-dlp --print format
- Increased timeout from 30s to 60s for large channels
- Added multiple retry strategies: basic, web client (`player_client=web`), mobile client (`player_client=mweb`)
- Fixed thumbnailUrl: "NA" values now fall back to `i.ytimg.com/vi/{id}/hqdefault.jpg`
- Added cookies support to single video import (`getVideoInfo` uses `--cookies` if cookies file exists)
- Fixed null JSON parse error from yt-dlp (prints "null" after stderr error) — added `if (!parsed || !parsed.id) return null` guard
- Simplified Import Video dialog: removed manual Title/Description fields, only URL + Source Type
- Added `resolved` flag and `hint` field to import API response
- Frontend shows appropriate toast: resolved = "Imported: title", unresolved = "Video added" + delayed warning about uploading cookies
- Fixed download button: changed from `PUT /api/videos/[id]` (non-existent route) to `POST /api/videos/[id]/download` (correct route)

Stage Summary:
- Channel import works: https://www.youtube.com/@feedbackdancestudio5306 → correctly lists all videos with full titles and durations
- Single video import auto-resolves title: "https://youtube.com/watch?v=dQw4w9WgXcQ" → "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)" with resolved=true
- Bot verification errors trigger hint to upload cookies in Settings
- Zero ESLint errors

---
## Task ID: 10 - fix-409-and-download-logging
Agent: Main
Task: Fix 409 "Task already running" error and improve video download logging

Work Log:
- Investigated root cause of 409 error: stop route only called local processManager, not the remote engine (port 3001)
- For playlist tasks started via engine.startPlaylist(), the engine held the process but stop route never told it to stop
- Result: DB marked as 'stopped' but engine still running, causing 409 on restart attempt

- Fixed stop route (src/app/api/streams/[id]/stop/route.ts):
  - Now calls engine.stopPlaylist() for playlist tasks AND engine.stopStream() for single video tasks
  - Falls back to local processManager.stop() for backward compatibility
  - Added detailed logging for all stop attempts
  - Records engineStopped/localStopped/actuallyStopped in StreamLog metadata

- Fixed start route (src/app/api/streams/[id]/start/route.ts):
  - Added startEngineWithAutoRecovery() helper that catches 409 errors
  - On 409: automatically stops the stale task via engine, waits 500ms, then retries start
  - Returns clear error message if stale task cannot be stopped
  - Single video mode: tries local processManager first, falls back to engine on failure

- Fixed stream engine downloadVideo (mini-services/stream-engine/index.ts):
  - Changed from execSync (60s timeout, poor error capture) to spawnSync (300s timeout, 10MB buffer)
  - Added comprehensive structured logging: URL, cookies status, command, file size result
  - Logs stdout tail (last 5 lines) and stderr errors/warnings
  - Parses common yt-dlp error types (bot detection, age restriction, 403, 429, unavailable)
  - Handles case where yt-dlp saves with different filename (checks similar files in dir)
  - Added download timing measurement in the playlist runner

- Enhanced playlist runner logging:
  - resolveVideoPath: logs each check (localPath, cached download path) with reasons
  - Run loop: logs download start/end time, consecutive failure count
  - streamFile: logs file size before streaming, FFmpeg crash diagnostics with last 10 stderr lines

- Fixed missing imports: mkdirSync in process-manager.ts, spawnSync/statSync/readdirSync/join in engine

Stage Summary:
- 409 error fixed: stop route now properly communicates with engine for both playlist and single video tasks
- Start route auto-recovers from stale engine state (stop + retry)
- Download timeout increased from 60s to 300s (5 min) for large videos
- Detailed download diagnostics: full stderr, error type classification, timing
- FFmpeg crash diagnostics: last 10 stderr lines, encoding params, input file info
- Zero ESLint errors, dev server compiles cleanly, engine running on port 3001

---
## Task ID: 1 - fix-keepalive-40s-interval
Agent: general-purpose (subagent)
Task: Fix keepalive service to use 40 second interval

### Work Summary

**Created 2 new files, modified 1 existing file:**

1. **`src/lib/keepalive.ts`** — Keepalive service module (new file)
   - Interval: **40 seconds** (via `setInterval` with `.unref()`)
   - Every tick fetches 3 targets in parallel: `http://localhost:81` (Caddy gateway), `/api/monitor`, `/api/processes`
   - 10-second per-request timeout via `AbortSignal.timeout`
   - Tracks `successCount`, `failCount`, `uptime`, `lastRunAt`, `lastResults` (per-target status/ms)
   - Logs every tick and result to `/home/z/my-project/logs/keepalive.log` using `appendFileSync`
   - Writes lightweight status JSON to `/home/z/my-project/logs/keepalive-status.json` using `writeFileSync`
   - Auto-creates logs directory with `mkdirSync({ recursive: true })`
   - Exports: `startKeepalive()`, `stopKeepalive()`, `getKeepaliveStatus()`, `ensureKeepalive()`
   - No browser APIs — server-side Node.js only

2. **`src/app/api/keepalive/route.ts`** — Keepalive status GET API (new file)
   - Returns in-memory status from `getKeepaliveStatus()` plus last 30 lines of `keepalive.log`
   - Response shape: `{ data: { running, intervalMs, startedAt, lastRunAt, successCount, failCount, uptime, lastResults, targets, recentLogLines } }`

3. **`src/app/api/monitor/route.ts`** — Added keepalive auto-start (modified)
   - Added `import { ensureKeepalive } from '@/lib/keepalive'`
   - Added `ensureKeepalive()` call at top of GET handler — auto-starts keepalive loop on first monitor request

### Key Design Decisions
- `setInterval(...).unref()` prevents the keepalive timer from blocking Node.js process exit
- Status file uses `writeFileSync` (not append) to stay small — the log file is the append-only audit trail
- `ensureKeepalive()` is idempotent — safe to call from every GET request
- All fetches use `Promise.allSettled` — one target failure doesn't abort others

---
## Task ID: 2 - fix-stream-start-stop-consistency
Agent: general-purpose (subagent)
Task: Fix stream start/stop buttons to properly show loading states and guarantee process consistency

Work Summary

Modified 1 file: `src/components/streams/stream-tasks-panel.tsx`

**New imports added:** `RefreshCw`, `Terminal`, `AlertCircle`, `X`, `ChevronRight` from lucide-react

**StreamCard component changes:**
- Added 3 new props: `isStarting?: boolean`, `isStopping?: boolean`, `onLogOpen?: (id: string) => void`
- Added amber loading banner at top of card when `isStarting` or `isStopping` is true (spinning RefreshCw + status text)
- Start button: shows spinning RefreshCw icon + "启动中..." text when `isStarting`, button disabled
- Stop button: shows spinning RefreshCw icon + "停止中..." text when `isStopping`, button disabled
- Edit button hidden during loading state
- Dropdown menu trigger and items disabled during loading state
- Replaced Activity icon with AlertCircle on the "process abnormal" warning
- Added "任务日志" button (Terminal icon + ChevronRight) at bottom of card, calls `onLogOpen` prop
- Live indicator bar hidden while start/stop is in progress

**StreamTasksPanel component changes:**
- Added `startingIds: Set<string>` and `stoppingIds: Set<string>` state to track per-task loading
- `handleStart(id)`: Adds id to startingIds → calls API → on success: toast + wait 2s + poll tasks+processes → checks if task went live, shows error toast "推流启动可能失败，请检查日志" if not → on API error: shows `toast.error(err.error || "启动失败")` with full message → finally removes id from startingIds
- `handleStop(id)`: Adds id to stoppingIds → calls API → on success: toast + wait 2s + poll tasks+processes → checks if task still live, shows `toast.warning("推流可能未完全停止")` if so → on API error: shows `toast.error(err.error || "停止失败")` with full message → finally removes id from stoppingIds
- StreamCard render now passes `isStarting={startingIds.has(task.id)}`, `isStopping={stoppingIds.has(task.id)}`, and `onLogOpen` placeholder

Stage Summary:
- Start/Stop buttons now show spinners and disabled state during operation
- Post-action verification polling ensures process consistency
- Error/warning toasts provide actionable feedback on failures
- "任务日志" button stub added (dialog to be implemented separately)
- Zero ESLint errors

---
## Task ID: 3-a - stream-log-dialog-api-routes
### Work Task
Create two API routes for the stream log dialog: FFmpeg output logs endpoint and DB event logs endpoint.

### Work Summary

**Created 2 new files:**

1. **`src/app/api/streams/[id]/output/route.ts`** — GET endpoint for FFmpeg output logs
   - Query params: `since` (sequence number, default 0) and `limit` (max lines, default 200)
   - Three-tier fallback strategy:
     1. **Engine (port 3001):** Fetches from `http://127.0.0.1:3001/api/processes/stream_{id}/output?since=X&limit=Y` with 3s timeout
     2. **Local processManager:** Reads in-memory `logs[]` from `processManager.get(stream_{id})`, splits chunks into lines
     3. **Log file:** Reads from `/home/z/my-project/download/logs/stream_{id}.log` if it exists
   - Returns `{ data: string[], seq: number, from: "engine" | "local" | "file" }`
   - Returns empty array if no logs available from any source

2. **`src/app/api/streams/[id]/logs/route.ts`** — GET endpoint for DB event logs
   - Query params: `limit` (default 50) and `sinceId` (for incremental polling)
   - Queries `StreamLog` table via Prisma: `WHERE taskId = id ORDER BY createdAt DESC LIMIT limit`
   - If `sinceId` provided, looks up that log's `createdAt` and filters to only newer entries
   - Returns `{ data: LogEntry[] }` using typed `Prisma.StreamLogWhereInput`
   - Uses `import { db } from '@/lib/db'` for database access

**Zero ESLint errors. Both routes pass linting cleanly.**

---
Task ID: 1
Agent: Main Agent
Task: 修复推流启动失败无 toast 的问题

Work Log:
- 诊断问题：layout.tsx 使用 shadcn/ui 的 `Toaster`（配合 useToast hook），但所有组件都用 `import { toast } from "sonner"` 调用 toast
- 两个 toast 系统不兼容，sonner 的 toast 调用不会在 shadcn/ui Toaster 中渲染
- 修复 1：layout.tsx 从 `@/components/ui/toaster` 改为 `@/components/ui/sonner`
- 修复 2：sonner.tsx 移除 next-themes 依赖（app 无 ThemeProvider），直接用 `theme="light"`
- 修复 3：pollUntilConsistent 中 `processes` 读取的是陈旧闭包值 → 添加 `processesRef` 同步最新状态
- 修复 4：pollUntilConsistent 不再依赖 `setTasks` 回调读取状态，改为直接 fetch 单个任务 API
- 修复 5：start route 中 `status=live` 阻断问题 → 添加进程存活检测，进程已死则自动重置状态
- 修复 6：`useDisplayStatus` hook 在 IIFE 回调中调用 → 改为内联计算 displayStatus

Stage Summary:
- Toast 系统：所有组件已统一使用 sonner，toast 提示现在可以正常显示
- 状态一致性：start route 自动处理陈旧状态（DB=live 但进程已死）
- 轮询逻辑：pollUntilConsistent 使用 ref + 独立 API 调用保证数据新鲜度
- ESLint 通过，无编译错误
---
Task ID: 11 - fix-monitor-blank-and-stop-button
Agent: Main Agent
Task: 修复系统监控内容空白问题，添加活跃进程停止按钮

Work Log:
- 诊断问题：/api/monitor 路由持续返回 500 错误
- 根因：monitor route 第 85 行引用了未定义变量 `localProcs`，实际变量名是 `activeProcesses`
- 修复 1：删除 `const knownIds = new Set(localProcs.map(...))` 死代码行
- 修复 2：增强 monitor route 合并 engine 进程列表（之前只返回 processManager 进程）
- 修复 3：重构 crashCheck 逻辑，复用已获取的 activeProcesses 数据，避免重复 engine 请求
- 修复 4：Monitor 面板添加进程停止按钮（Square 图标 + Loader2 加载动画）
- 修复 5：Dashboard 面板添加进程停止按钮（同上样式）
- 两个面板都添加了 stoppingId 状态跟踪，停止时显示加载动画

Stage Summary:
- /api/monitor 从 500 恢复为 200，系统监控内容正常显示
- 进程列表现在包含 engine + processManager + DB orphan 所有来源
- Dashboard 和 Monitor 面板的活跃进程都支持一键停止
- ESLint 通过，无编译错误

---
Task ID: 12 - fix-production-500-errors
Agent: Main Agent
Task: 修复线上部署所有 API 接口返回 500 错误

Work Log:
- 诊断问题：线上部署成功但所有接口返回 500
- 根因分析：Next.js standalone 输出中的 @prisma/client 只是一个 stub（仅 default.js + package.json），缺少完整的 runtime/ 目录（81个运行时文件）
  - standalone/node_modules/@prisma/client/ 只有 2 个文件：default.js, package.json
  - node_modules/@prisma/client/ 有 22 个文件 + runtime/ 目录（81个文件）
  - node_modules/.prisma/client/ 有 18 个文件（含 query engine .so.node 二进制）
  - @prisma/client/default.js 通过 require('.prisma/client/default') 解析到生成客户端
  - 但生成客户端的 index.js 引用 @prisma/client/runtime/library 等路径，这些在 standalone 中不存在

- 修复 1：build.sh — 用完整的 @prisma/client 包替换 standalone 中的 stub
  - rm -rf + cp -r node_modules/@prisma/client 到 standalone/node_modules/@prisma/client
  - 包含 runtime/ 目录（library.js, client.js, binary.js 等 81 个文件）

- 修复 2：build.sh — 复制 Prisma 生成客户端（.prisma/client）
  - mkdir -p + cp -r node_modules/.prisma/client/* 到 standalone
  - 包含 libquery_engine-debian-openssl-3.0.x.so.node（17MB 查询引擎二进制）
  - 添加 fallback：如果 .prisma/client 不存在，自动运行 db:generate 重新生成

- 修复 3：build.sh — 复制 prisma/schema.prisma 到 standalone
  - 用于生产环境 db:push schema 同步

- 修复 4：start.sh — 修复 prisma db push 路径
  - 从 next-service-dist/ 目录运行，需要 prisma/schema.prisma 在该目录
  - 使用 npx prisma || bunx prisma 双重 fallback

- 修复 5：engine-keeper.ts — 修复生产环境引擎启动路径
  - 开发环境：ENGINE_DIR/mini-services/stream-engine + index.ts
  - 生产环境：ENGINE_DIR/mini-services-dist + mini-service-stream-engine.js
  - 添加 getEngineEntryPath() 函数自动检测

- 验证：模拟构建测试 PrismaClient 可以正常工作
  - ✅ @prisma/client/default.js 解析成功
  - ✅ runtime/library.js 存在
  - ✅ query engine .so.node 存在
  - ✅ PrismaClient 查询成功：Video count: 4, SystemConfig count: 8

Stage Summary:
- 修复了线上部署所有 API 返回 500 的根本原因：Prisma 客户端在 standalone 输出不完整
- build.sh 增加 3 步复制：完整 @prisma/client 包 + .prisma/client 生成客户端 + prisma schema
- start.sh 修复生产环境 db:push 路径
- engine-keeper.ts 兼容开发和生产环境不同入口文件名
- 模拟构建验证通过：Prisma 查询正常工作
