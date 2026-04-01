import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processManager } from '@/lib/process-manager';
import { execSync } from 'child_process';

const YT_DLP_PATH = '/home/z/.local/bin/yt-dlp';

/**
 * 使用 yt-dlp 提取 YouTube 直播流的真实 URL
 */
function getYoutubeStreamUrl(url: string, quality: string): string | null {
  try {
    const jsonStr = execSync(
      `"${YT_DLP_PATH}" -J --no-download --no-warnings "${url}"`,
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 }
    );
    const info = JSON.parse(jsonStr);

    // 检查是否是直播
    if (!info.is_live) {
      return null;
    }

    // 从 formats 中找到合适的直播流 URL
    const formats = info.formats || [];

    // 优先找 m3u8 格式（HLS 直播流）
    const m3u8Format = formats.find(
      (f: Record<string, unknown>) =>
        (f.protocol === 'm3u8_native' || f.protocol === 'm3u8') &&
        (!quality || quality === 'best' || (f.height && f.height <= parseInt(quality)))
    );

    if (m3u8Format?.url) {
      return m3u8Format.url;
    }

    // 回退到 url 属性
    if (info.url) {
      return info.url;
    }

    // 回退到最佳格式
    const bestFormat = formats.find(
      (f: Record<string, unknown>) => f.ext === 'mp4' || f.protocol === 'https'
    );
    return bestFormat?.url || null;
  } catch (error) {
    console.error('获取 YouTube 直播流 URL 失败:', error);
    return null;
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const relay = await db.relayTask.findUnique({
      where: { id },
      include: { targets: true },
    });
    if (!relay) {
      return NextResponse.json({ error: '转播任务不存在' }, { status: 404 });
    }

    if (relay.status === 'live') {
      return NextResponse.json({ error: '转播任务已在运行中' }, { status: 400 });
    }

    // 构建启用的目标列表
    const enabledTargets = relay.targets.filter((t) => t.enabled).map((t) => ({
      rtmpUrl: t.rtmpUrl,
      streamKey: t.streamKey || '',
      enabled: true,
    }));

    if (enabledTargets.length === 0) {
      return NextResponse.json(
        { error: '没有启用的转播目标平台' },
        { status: 400 }
      );
    }

    // 使用 yt-dlp 获取真实的 YouTube 直播流 URL
    const streamUrl = getYoutubeStreamUrl(relay.sourceYoutubeUrl, relay.sourceQuality || 'best');

    if (!streamUrl) {
      return NextResponse.json(
        { error: '无法获取 YouTube 直播流地址。请确认：1) URL 是一个正在直播的 YouTube 直播链接 2) 直播源可用' },
        { status: 400 }
      );
    }

    // 启动真实的 FFmpeg 转播进程
    const proc = processManager.startRelay({
      taskId: `relay_${id}`,
      streamUrl,
      targets: enabledTargets,
    });

    // 更新数据库
    const updatedRelay = await db.relayTask.update({
      where: { id },
      data: {
        status: 'live',
        startedAt: new Date(),
        stoppedAt: null,
        currentPid: proc.pid,
        bytesTransferred: 0,
      },
    });

    // 记录日志
    await db.streamLog.create({
      data: {
        taskId: id,
        taskType: 'relay',
        action: 'start',
        message: `转播 "${relay.name}" 已启动。源: ${relay.sourceYoutubeUrl.substring(0, 60)}...`,
        metadata: JSON.stringify({
          pid: proc.pid,
          sourceStreamUrl: streamUrl.substring(0, 100) + '...',
          sourceQuality: relay.sourceQuality,
          targetCount: enabledTargets.length,
          platforms: relay.targets.filter((t) => t.enabled).map((t) => t.platform),
        }),
      },
    });

    // 监控进程退出，自动更新状态
    proc.child.on('exit', async (code, signal) => {
      try {
        const task = await db.relayTask.findUnique({ where: { id } });
        if (task && task.status === 'live') {
          await db.relayTask.update({
            where: { id },
            data: {
              status: code === 0 ? 'stopped' : 'error',
              stoppedAt: new Date(),
              currentPid: null,
            },
          });
          await db.streamLog.create({
            data: {
              taskId: id,
              taskType: 'relay',
              action: code === 0 ? 'stop' : 'error',
              message: `转播进程退出: code=${code}, signal=${signal}`,
              metadata: JSON.stringify({
                exitCode: code,
                signal,
                lastLogs: proc.logs.slice(-5),
              }),
            },
          });
        }
      } catch {
        // DB might be unavailable
      }
    });

    return NextResponse.json({
      data: updatedRelay,
      message: `转播已启动，PID: ${proc.pid}，目标: ${enabledTargets.length} 个平台`,
    });
  } catch (error) {
    console.error('Error starting relay:', error);
    const id = (await params).id;
    const errorMsg = error instanceof Error ? error.message : '未知错误';

    try {
      await db.relayTask.update({
        where: { id },
        data: { status: 'error' },
      });
      await db.streamLog.create({
        data: {
          taskId: id,
          taskType: 'relay',
          action: 'error',
          message: `启动转播失败: ${errorMsg}`,
        },
      });
    } catch {
      // ignore
    }

    return NextResponse.json(
      { error: `启动转播失败: ${errorMsg}` },
      { status: 500 }
    );
  }
}
