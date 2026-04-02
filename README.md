# YouTube Livestream Automation

<p align="center">
  <strong>YouTube 直播自动化推流平台</strong><br/>
  一键管理视频库、直播推流、多平台转播
</p>

---

## 功能概览

### 📹 视频库管理
- **导入视频** — 粘贴 YouTube URL 自动解析元信息（标题、时长、封面、分辨率）
- **频道批量导入** — 浏览 YouTube 频道，勾选多个视频一次性导入
- **下载队列** — 选中多个视频批量加入队列，逐个顺序下载，一个完成自动下一个
- **批量删除** — 多选视频一键删除，自动清理磁盘文件和数据库记录
- **文件同步** — 一键扫描本地文件与数据库对账，修复 missing 状态
- **视频播放** — 缓存视频可直接在浏览器中预览播放

### 🎬 直播推流
- **单视频推流** — 选择缓存视频推送到 RTMP 地址（B站、斗鱼、虎牙等）
- **播放列表推流** — 创建播放列表，引擎自动按顺序循环推流，视频结束无缝切换
- **编码控制** — 自定义码率、分辨率、帧率、preset
- **双路推流** — 主推流 + 备用推流同时输出
- **实时监控** — FPS、码率、帧数、速度、已编码时长、数据量实时显示
- **进程日志** — FFmpeg 输出和事件日志实时查看
- **故障转移** — 进程异常自动检测并提示

### 📡 多平台转播
- **YouTube 直播转播** — 抓取 YouTube 直播流 URL，零转码 copy 模式转发
- **多目标推送** — 一个 YouTube 源同时推送到多个 RTMP 目标
- **实时统计** — 转播码率、帧率、数据传输量监控

### 📊 系统监控
- **Dashboard** — 推流任务总览、系统资源使用情况
- **进程管理** — 查看所有活跃进程，支持强制停止
- **日志系统** — 操作日志、错误日志统一记录和查询
- **告警管理** — 异常告警记录与状态追踪

### ⚙️ 设置
- **Cookies 管理** — 上传 YouTube cookies 文件，绕过 Bot 检测
- **系统配置** — 全局参数配置

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Next.js 16 (App Router) + React 19 + TypeScript 5 |
| **UI 框架** | Tailwind CSS 4 + shadcn/ui (New York) + Lucide Icons |
| **状态管理** | Zustand + TanStack Query |
| **数据库** | SQLite + Prisma ORM |
| **推流引擎** | FFmpeg (libx264 + AAC) |
| **视频下载** | yt-dlp (自动注入 JS 运行时 + Cookies) |
| **实时通信** | Socket.IO (进程状态广播) |
| **API 网关** | Caddy (反向代理 + 自动 HTTPS) |

---

## 项目结构

```
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # 单页应用入口
│   │   └── api/
│   │       ├── videos/         # 视频管理 API
│   │       ├── streams/        # 推流任务 API
│   │       ├── relays/         # 转播任务 API
│   │       ├── playlists/      # 播放列表 API
│   │       ├── processes/      # 进程管理 API
│   │       ├── monitor/        # 系统监控 API
│   │       └── ...
│   ├── components/
│   │   ├── videos/             # 视频库面板
│   │   ├── streams/            # 推流任务面板 + 日志对话框
│   │   ├── relays/             # 转播任务面板
│   │   ├── playlists/          # 播放列表面板
│   │   ├── dashboard/          # 仪表盘
│   │   ├── monitor/            # 系统监控
│   │   ├── settings/           # 设置页面
│   │   └── ui/                 # shadcn/ui 组件
│   └── lib/
│       ├── db.ts               # Prisma 客户端
│       ├── yt-dlp.ts           # yt-dlp 统一工具模块
│       ├── process-manager.ts  # 进程生命周期管理
│       ├── engine-keeper.ts    # 引擎守护进程
│       ├── download-queue.ts   # 顺序下载队列
│       └── paths.ts            # 路径配置
├── mini-services/
│   ├── stream-engine/          # 独立推流引擎 (Bun + FFmpeg + Socket.IO)
│   └── proxy/                  # 代理服务
├── prisma/
│   └── schema.prisma           # 数据库 Schema
├── download/
│   ├── videos/                 # 视频缓存目录
│   ├── standby/                # 备播视频
│   └── logs/                   # 进程日志
├── Caddyfile                   # Caddy 反向代理配置
└── .zscripts/                  # 启动/构建脚本
    ├── start.sh                # 生产环境启动
    ├── dev.sh                  # 本地开发启动
    └── build.sh                # 项目构建
```

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **Bun** >= 1.0
- **FFmpeg** (系统安装)
- **yt-dlp** (自动下载或手动安装到 `download/tools/`)

### 本地开发

```bash
# 安装依赖
bun install

# 初始化数据库
bun run db:push

# 启动开发服务器 (端口 3000)
bun run dev
```

### 生产部署

```bash
# 构建
bash .zscripts/build.sh

# 启动
bash .zscripts/start.sh
```

启动脚本会自动：
1. 创建必要目录结构
2. 安装/检测 yt-dlp
3. 检测 FFmpeg
4. 初始化数据库 (SQLite + WAL 模式)
5. 启动 Next.js 服务器
6. 启动 Stream Engine
7. 启动 Caddy 网关

---

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Next.js | 3000 | Web 服务 + API |
| Stream Engine | 3001 | 推流引擎 + WebSocket |
| Caddy | 81 | 反向代理 (仅生产) |

---

## 数据模型

| 模型 | 说明 |
|------|------|
| `Video` | 视频库 (元信息、缓存状态、文件路径) |
| `PlayList` / `PlayListItem` | 播放列表 |
| `StreamTask` | 推流任务 (视频/列表推流) |
| `RelayTask` / `RelayTarget` | 转播任务 (多目标) |
| `StreamLog` | 操作日志 |
| `AlertLog` | 告警记录 |
| `SystemConfig` | 系统配置 |

---

## 注意事项

- YouTube 视频下载需要 **Cookies 文件**，建议在 Settings 页面上传 `cookies.txt`
- yt-dlp 使用 `--js-runtimes node` 自动处理 YouTube 签名解密
- 推流目标地址格式：`rtmp://live.example.com/app/stream-key`
- SQLite 数据库运行时位于 `/tmp/db/custom.db`，持久化需重启时重新复制
