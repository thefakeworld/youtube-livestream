#!/bin/sh

set -e

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR"

# 存储所有子进程的 PID
pids=""

# 清理函数：优雅关闭所有服务
cleanup() {
    echo ""
    echo "🛑 正在关闭所有服务..."
    
    # 发送 SIGTERM 信号给所有子进程
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            service_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
            echo "   关闭进程 $pid ($service_name)..."
            kill -TERM "$pid" 2>/dev/null
        fi
    done
    
    # 等待所有进程退出（最多等待 5 秒）
    sleep 1
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            timeout=4
            while [ $timeout -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
                sleep 1
                timeout=$((timeout - 1))
            done
            if kill -0 "$pid" 2>/dev/null; then
                echo "   强制关闭进程 $pid..."
                kill -KILL "$pid" 2>/dev/null
            fi
        fi
    done
    
    echo "✅ 所有服务已关闭"
    exit 0
}

echo "🚀 开始启动所有服务..."
echo ""

cd "$BUILD_DIR" || exit 1

# ==============================
# 环境初始化
# ==============================
echo "🔧 环境初始化..."

# 创建必要目录
# BUILD_DIR 在生产环境是部署目录（/app），本地开发时是 /tmp/build_fullstack_
# 使用相对路径，兼容两种环境
mkdir -p "$BUILD_DIR/download/videos"
mkdir -p "$BUILD_DIR/download/standby"
mkdir -p "$BUILD_DIR/download/logs"
mkdir -p "$BUILD_DIR/logs"
mkdir -p /home/z/.local/bin
echo "  ✅ 目录结构已就绪"

# 安装 yt-dlp（如果没有）
# 优先使用构建包中 tools/ 目录的版本（跟随项目持久化）
YTDLP_TOOLS="$BUILD_DIR/tools/yt-dlp"
YTDLP_LOCAL="/home/z/.local/bin/yt-dlp"

if [ -f "$YTDLP_TOOLS" ] && "$YTDLP_TOOLS" --version >/dev/null 2>&1; then
    export YT_DLP_PATH="$YTDLP_TOOLS"
    echo "  ✅ yt-dlp (tools): $($YTDLP_TOOLS --version 2>&1 | head -1)"
elif command -v yt-dlp > /dev/null 2>&1; then
    export YT_DLP_PATH="$(command -v yt-dlp)"
    echo "  ✅ yt-dlp (system): $(yt-dlp --version 2>/dev/null)"
elif [ -f "$YTDLP_TOOLS" ]; then
    mkdir -p /home/z/.local/bin
    cp "$YTDLP_TOOLS" "$YTDLP_LOCAL"
    chmod +x "$YTDLP_LOCAL"
    export YT_DLP_PATH="$YTDLP_LOCAL"
    echo "  ✅ yt-dlp 已从构建包安装: $($YTDLP_LOCAL --version 2>&1 | head -1)"
else
    echo "  ⬇  从 GitHub 下载 yt-dlp..."
    mkdir -p /home/z/.local/bin
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "$YTDLP_LOCAL" 2>/dev/null
    if [ $? -eq 0 ] && [ -f "$YTDLP_LOCAL" ]; then
        chmod +x "$YTDLP_LOCAL"
        export YT_DLP_PATH="$YTDLP_LOCAL"
        echo "  ✅ yt-dlp 已安装: $($YTDLP_LOCAL --version 2>&1 | head -1)"
    else
        echo "  ⚠️  yt-dlp 安装失败，视频下载功能将不可用"
    fi
fi

# 检查 FFmpeg
if command -v ffmpeg > /dev/null 2>&1; then
    echo "  ✅ ffmpeg 已安装: $(ffmpeg -version 2>&1 | head -1)"
else
    echo "  ⚠️  ffmpeg 未安装，推流和转播功能将不可用"
fi

# 检查 Node.js（yt-dlp 签名解密需要）
if command -v node > /dev/null 2>&1; then
    echo "  ✅ node 已安装: $(node --version 2>/dev/null)"
else
    echo "  ⚠️  node 未安装，yt-dlp YouTube 签名解密可能失败"
fi

# 设置环境变量（让应用知道工具位置）
export FFMPEG_PATH="$(command -v ffmpeg 2>/dev/null | sed 's/ffmpeg$//' | xargs dirname)/ffmpeg" || true
export DOWNLOAD_DIR="$BUILD_DIR/download/videos"
export LOG_DIR="$BUILD_DIR/download/logs"
export COOKIES_PATH="$BUILD_DIR/download/cookies.txt"
export ENGINE_DIR="$BUILD_DIR/mini-services-dist"

# 数据库（使用 /tmp 目录避免磁盘空间不足）
# 线上容器可写层空间有限，SQLite 写入时容易报 disk full
# /tmp 通常是 tmpfs，空间充足且 IO 更快
mkdir -p /tmp/db
RUNTIME_DB_PATH="/tmp/db/custom.db"
PACKAGED_DB_PATH="$BUILD_DIR/db/custom.db"

if [ -f "$PACKAGED_DB_PATH" ]; then
    # 首次启动时复制数据库到 /tmp（保留打包的原始数据）
    if [ ! -f "$RUNTIME_DB_PATH" ]; then
        cp "$PACKAGED_DB_PATH" "$RUNTIME_DB_PATH"
        echo "  ✅ 数据库已复制到 $RUNTIME_DB_PATH ($(ls -lh "$RUNTIME_DB_PATH" | awk '{print $5}'))"
    else
        echo "  ✅ 使用已有数据库: $RUNTIME_DB_PATH ($(ls -lh "$RUNTIME_DB_PATH" | awk '{print $5}'))"
    fi
    
    # 启用 WAL 模式（减少写入放大，降低磁盘空间需求）
    sqlite3 "$RUNTIME_DB_PATH" "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;" 2>/dev/null || true
    echo "  ✅ SQLite WAL 模式已启用"
    
    # 同步 schema
    cd "$BUILD_DIR/next-service-dist" || true
    if command -v bun > /dev/null 2>&1 && [ -f "prisma/schema.prisma" ]; then
        echo "  🔧 同步数据库 schema..."
        DATABASE_URL="file:$RUNTIME_DB_PATH" npx prisma db push --skip-generate 2>/dev/null || \
        DATABASE_URL="file:$RUNTIME_DB_PATH" bunx prisma db push --skip-generate 2>/dev/null || true
        echo "  ✅ 数据库 schema 已同步"
    fi
    cd "$BUILD_DIR" > /dev/null || true
else
    echo "  ⚠️  未找到打包数据库 $PACKAGED_DB_PATH"
fi

export DATABASE_URL="file:$RUNTIME_DB_PATH"

# 告诉 paths.ts 使用 BUILD_DIR 作为项目根目录
export PROJECT_DIR="$BUILD_DIR"
export DATA_DIR="$BUILD_DIR/download"
export VIDEOS_DIR="$BUILD_DIR/download/videos"
export STANDBY_DIR="$BUILD_DIR/download/standby"
export TOOLS_DIR="$BUILD_DIR/tools"

echo ""

# ==============================
# 启动 Next.js 服务器
# ==============================
if [ -f "./next-service-dist/server.js" ]; then
    echo "🚀 启动 Next.js 服务器..."
    cd next-service-dist/ || exit 1
    
    export NODE_ENV=production
    export PORT="${PORT:-3000}"
    export HOSTNAME="${HOSTNAME:-0.0.0.0}"
    
    # 后台启动 Next.js
    bun server.js &
    NEXT_PID=$!
    pids="$NEXT_PID"
    
    sleep 1
    if ! kill -0 "$NEXT_PID" 2>/dev/null; then
        echo "❌ Next.js 服务器启动失败"
        exit 1
    else
        echo "✅ Next.js 服务器已启动 (PID: $NEXT_PID, Port: $PORT)"
    fi
    
    cd ../
else
    echo "⚠️  未找到 Next.js 服务器文件: ./next-service-dist/server.js"
fi

# ==============================
# 启动 mini-services（Stream Engine）
# ==============================
if [ -f "./mini-services-start.sh" ]; then
    echo "🚀 启动 Stream Engine..."
    
    sh ./mini-services-start.sh &
    MINI_PID=$!
    pids="$pids $MINI_PID"
    
    sleep 1
    if ! kill -0 "$MINI_PID" 2>/dev/null; then
        echo "⚠️  Stream Engine 可能启动失败，但继续运行..."
    else
        echo "✅ Stream Engine 已启动 (PID: $MINI_PID)"
    fi
elif [ -d "./mini-services-dist" ]; then
    echo "⚠️  未找到 Stream Engine 启动脚本，但目录存在"
else
    echo "ℹ️  Stream Engine 目录不存在，跳过"
fi

# ==============================
# 启动 Caddy（仅生产环境，本地沙箱不需要）
# ==============================
if [ "$BUILD_DIR" = "/app" ] || [ -w "/app" ] 2>/dev/null; then
    echo "🚀 启动 Caddy..."
    echo "✅ Caddy 已启动（前台运行）"
    echo ""
    echo "🎉 所有服务已启动！"
    echo ""
    echo "💡 按 Ctrl+C 停止所有服务"
    echo ""

    # Caddy 作为主进程运行
    exec caddy run --config Caddyfile --adapter caddyfile
else
    echo "ℹ️  本地环境，跳过 Caddy（Next.js 直接监听端口 $PORT）"
    echo ""
    echo "🎉 所有服务已启动！"
    echo ""

    # 前台等待，保持脚本不退出
    wait
fi
