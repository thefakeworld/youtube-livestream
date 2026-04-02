#!/bin/bash

# 将 stderr 重定向到 stdout，避免 execute_command 因为 stderr 输出而报错
exec 2>&1

set -e

# 获取脚本所在目录（.zscripts 目录，即 workspace-agent/.zscripts）
# 使用 $0 获取脚本路径（兼容 sh 和 bash）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Next.js 项目路径
NEXTJS_PROJECT_DIR="/home/z/my-project"

# 检查 Next.js 项目目录是否存在
if [ ! -d "$NEXTJS_PROJECT_DIR" ]; then
    echo "❌ 错误: Next.js 项目目录不存在: $NEXTJS_PROJECT_DIR"
    exit 1
fi

echo "🚀 开始构建 Next.js 应用和 mini-services..."
echo "📁 Next.js 项目路径: $NEXTJS_PROJECT_DIR"

# 切换到 Next.js 项目目录
cd "$NEXTJS_PROJECT_DIR" || exit 1

# 设置环境变量
export NEXT_TELEMETRY_DISABLED=1

BUILD_DIR="/tmp/build_fullstack_$BUILD_ID"
echo "📁 清理并创建构建目录: $BUILD_DIR"
mkdir -p "$BUILD_DIR"

# 安装依赖
echo "📦 安装依赖..."
bun install

# 构建 Next.js 应用
echo "🔨 构建 Next.js 应用..."
bun run build

# 构建 mini-services
# 检查 Next.js 项目目录下是否有 mini-services 目录
if [ -d "$NEXTJS_PROJECT_DIR/mini-services" ]; then
    echo "🔨 构建 mini-services..."
    # 使用 workspace-agent 目录下的 mini-services 脚本
    sh "$SCRIPT_DIR/mini-services-install.sh"
    sh "$SCRIPT_DIR/mini-services-build.sh"

    # 复制 mini-services-start.sh 到 mini-services-dist 目录
    echo "  - 复制 mini-services-start.sh 到 $BUILD_DIR"
    cp "$SCRIPT_DIR/mini-services-start.sh" "$BUILD_DIR/mini-services-start.sh"
    chmod +x "$BUILD_DIR/mini-services-start.sh"
else
    echo "ℹ️  mini-services 目录不存在，跳过"
fi

# ==============================
# 将所有构建产物复制到临时构建目录
# ==============================
echo "📦 收集构建产物到 $BUILD_DIR..."

# 复制 Next.js standalone 构建输出
if [ -d ".next/standalone" ]; then
    echo "  - 复制 .next/standalone"
    cp -r .next/standalone "$BUILD_DIR/next-service-dist/"

    # 删除 .next/node_modules/@prisma 目录（Next.js 文件追踪产生的冗余符号链接）
    # 真正的 @prisma/client 已在 standalone/node_modules/@prisma/client（真实目录，非符号链接）
    # 保留它会导致 tar 打包时 "Directory renamed" 竞争报错
    rm -rf "$BUILD_DIR/next-service-dist/.next/node_modules/@prisma" 2>/dev/null
    echo "  - 已清理 .next/node_modules/@prisma（冗余追踪产物）"

    # ==============================
    # 修复 Prisma standalone 输出（三步修复）
    #
    # 问题 1: standalone 的 @prisma/client 只是 stub（仅 default.js + package.json），
    #          缺少 runtime/ 目录（81个文件），导致 require('@prisma/client/runtime/library') 失败
    #
    # 问题 2: Next.js 在 chunk 中将 @prisma/client 重命名为 @prisma/client-<HASH>，
    #          但 standalone node_modules 中没有这个 hashed 目录，导致 require 失败
    # ==============================
    echo "  - 修复 Prisma standalone 输出..."

    # 1. 用完整的 @prisma/client 包替换 standalone 中的 stub
    if [ -d "node_modules/@prisma/client" ]; then
        rm -rf "$BUILD_DIR/next-service-dist/node_modules/@prisma/client"
        cp -r node_modules/@prisma/client "$BUILD_DIR/next-service-dist/node_modules/@prisma/client"
        echo "    ✅ 已复制完整 @prisma/client 包 ($(ls node_modules/@prisma/client/runtime/ 2>/dev/null | wc -l) 个 runtime 文件)"
    else
        echo "    ❌ 未找到 node_modules/@prisma/client"
    fi

    # 2. 创建 Next.js hashed 别名（从 NFT 文件中提取 hash）
    PRISMA_HASH=$(rg -o "client-[a-f0-9]{12,}" .next/standalone/.next/server/app/api/config/route.js.nft.json 2>/dev/null | head -1 | sed 's/client-//')
    if [ -n "$PRISMA_HASH" ]; then
        HASHED_DIR="$BUILD_DIR/next-service-dist/node_modules/@prisma/client-${PRISMA_HASH}"
        if [ ! -e "$HASHED_DIR" ]; then
            ln -s client "$HASHED_DIR"
            echo "    ✅ 已创建 hashed 别名 @prisma/client-${PRISMA_HASH} → client"
        else
            echo "    ✅ hashed 别名已存在 @prisma/client-${PRISMA_HASH}"
        fi
    else
        echo "    ⚠️  未找到 Prisma hash 别名（可能不需要）"
    fi

    # 3. 复制 Prisma 生成客户端（.prisma/client 包含 query engine binary 和 schema）
    if [ -d "node_modules/.prisma/client" ]; then
        mkdir -p "$BUILD_DIR/next-service-dist/node_modules/.prisma/client"
        cp -r node_modules/.prisma/client/* "$BUILD_DIR/next-service-dist/node_modules/.prisma/client/"
        echo "    ✅ 已复制 .prisma/client 生成客户端（含 query engine）"
    else
        echo "    ⚠️  未找到 node_modules/.prisma/client，尝试重新生成..."
        bun run db:generate
        if [ -d "node_modules/.prisma/client" ]; then
            mkdir -p "$BUILD_DIR/next-service-dist/node_modules/.prisma/client"
            cp -r node_modules/.prisma/client/* "$BUILD_DIR/next-service-dist/node_modules/.prisma/client/"
            echo "    ✅ Prisma 客户端已重新生成并复制"
        else
            echo "    ❌ Prisma 客户端生成失败，数据库操作将不可用！"
        fi
    fi

    # 4. 复制 prisma schema 文件（用于生产环境 db:push）
    if [ -f "prisma/schema.prisma" ]; then
        mkdir -p "$BUILD_DIR/next-service-dist/prisma"
        cp prisma/schema.prisma "$BUILD_DIR/next-service-dist/prisma/"
        echo "    ✅ 已复制 prisma/schema.prisma"
    fi

    # 清理 standalone 中不需要的大目录（Next.js trace 机制会追踪到这些目录）
    echo "  - 清理 standalone 中不需要的目录..."
    rm -rf "$BUILD_DIR/next-service-dist/download" 2>/dev/null && echo "    ✅ 已清理 download/ (视频等大文件)"
    rm -rf "$BUILD_DIR/next-service-dist/logs" 2>/dev/null && echo "    ✅ 已清理 logs/"
    rm -rf "$BUILD_DIR/next-service-dist/upload" 2>/dev/null && echo "    ✅ 已清理 upload/"
    rm -rf "$BUILD_DIR/next-service-dist/skills" 2>/dev/null && echo "    ✅ 已清理 skills/"
    rm -rf "$BUILD_DIR/next-service-dist/examples" 2>/dev/null && echo "    ✅ 已清理 examples/"
    rm -rf "$BUILD_DIR/next-service-dist/agent-ctx" 2>/dev/null && echo "    ✅ 已清理 agent-ctx/"
    rm -rf "$BUILD_DIR/next-service-dist/mini-services" 2>/dev/null && echo "    ✅ 已清理 mini-services/ (已单独构建)"
    rm -rf "$BUILD_DIR/next-service-dist/src" 2>/dev/null && echo "    ✅ 已清理 src/ (源码)"
    rm -rf "$BUILD_DIR/next-service-dist/db" 2>/dev/null && echo "    ✅ 已清理 db/ (已单独复制)"
fi

# 复制 Next.js 静态文件
if [ -d ".next/static" ]; then
    echo "  - 复制 .next/static"
    mkdir -p "$BUILD_DIR/next-service-dist/.next"
    cp -r .next/static "$BUILD_DIR/next-service-dist/.next/"
fi

# 复制 public 目录
if [ -d "public" ]; then
    echo "  - 复制 public"
    cp -r public "$BUILD_DIR/next-service-dist/"
fi

# ==============================
# 打包数据库（含完整数据）
# ==============================
if [ -f "./db/custom.db" ]; then
    echo "🗄️  复制数据库到构建产物..."
    mkdir -p "$BUILD_DIR/db"
    cp ./db/custom.db "$BUILD_DIR/db/custom.db"

    echo "🗄️  压缩数据库（VACUUM 减少空间占用）..."
    sqlite3 "$BUILD_DIR/db/custom.db" "VACUUM;" 2>/dev/null || true
    sqlite3 "$BUILD_DIR/db/custom.db" "PRAGMA journal_mode=DELETE;" 2>/dev/null || true

    echo "🗄️  同步构建产物中的数据库结构..."
    DATABASE_URL="file:$BUILD_DIR/db/custom.db" bun run db:push
    echo "✅ 构建产物数据库已准备完成"
    echo "  压缩前: $(ls -lh ./db/custom.db | awk '{print $5}')"
    echo "  压缩后: $(ls -lh "$BUILD_DIR/db/custom.db" | awk '{print $5}')"
else
    echo "❌ 未找到测试环境数据库文件 ./db/custom.db，无法继续构建生产包"
    exit 1
fi

# ==============================
# 打包 yt-dlp 二进制
# ==============================
# 优先从项目 tools 目录取，其次从系统路径取
YT_DLP_BIN="/home/z/my-project/download/tools/yt-dlp"
if [ ! -f "$YT_DLP_BIN" ]; then
    YT_DLP_BIN="/home/z/.local/bin/yt-dlp"
fi
if [ -f "$YT_DLP_BIN" ]; then
    echo "📦 打包 yt-dlp..."
    mkdir -p "$BUILD_DIR/tools"
    cp "$YT_DLP_BIN" "$BUILD_DIR/tools/yt-dlp"
    chmod +x "$BUILD_DIR/tools/yt-dlp"
    echo "  $(ls -lh "$BUILD_DIR/tools/yt-dlp")"
    echo "  版本: $("$YT_DLP_BIN" --version 2>/dev/null)"
else
    echo "⚠️  未找到 yt-dlp ($YT_DLP_BIN)，生产环境将无法下载视频"
fi

# ==============================
# 打包 cookies（如存在）
# ==============================
COOKIES_FILE="/home/z/my-project/download/cookies.txt"
if [ -f "$COOKIES_FILE" ]; then
    echo "📦 打包 cookies 文件..."
    mkdir -p "$BUILD_DIR/download"
    cp "$COOKIES_FILE" "$BUILD_DIR/download/cookies.txt"
    echo "  $(ls -lh "$BUILD_DIR/download/cookies.txt")"
else
    echo "ℹ️  未找到 cookies 文件，生产环境将无法下载受限视频（可稍后通过设置页面上传）"
fi

# ==============================
# 视频文件不打包（太大，可能导致 tar 失败）
# 视频可通过线上 UI 重新下载
# 只创建空目录占位
# ==============================
echo "ℹ️  视频文件不打包到部署包（可在线上通过 UI 重新下载）"
mkdir -p "$BUILD_DIR/download/videos"
mkdir -p "$BUILD_DIR/download/standby"

# 复制 Caddyfile（如果存在）
if [ -f "Caddyfile" ]; then
    echo "  - 复制 Caddyfile"
    cp Caddyfile "$BUILD_DIR/"
else
    echo "ℹ️  Caddyfile 不存在，跳过"
fi

# 复制 start.sh 脚本
echo "  - 复制 start.sh 到 $BUILD_DIR"
cp "$SCRIPT_DIR/start.sh" "$BUILD_DIR/start.sh"
chmod +x "$BUILD_DIR/start.sh"

# ==============================
# 打包
# ==============================
PACKAGE_FILE="${BUILD_DIR}.tar.gz"
echo ""
echo "📦 打包构建产物到 $PACKAGE_FILE..."
cd "$BUILD_DIR" || exit 1
tar -czhf "$PACKAGE_FILE" . || { echo "❌ tar 打包失败"; exit 1; }
cd - > /dev/null || exit 1

# # 清理临时目录
# rm -rf "$BUILD_DIR"

echo ""
echo "✅ 构建完成！所有产物已打包到 $PACKAGE_FILE"
echo "📊 打包文件大小:"
ls -lh "$PACKAGE_FILE"
