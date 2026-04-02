import { db } from '@/lib/db';
import { YT_DLP_PATH, VIDEOS_DIR, FALLBACK_VIDEO_PATH, FFMPEG_PATH } from '@/lib/paths';

export async function seedIfEmpty() {
  const configCount = await db.systemConfig.count();
  if (configCount > 0) return false;

  // Seed system configs only
  await db.systemConfig.createMany({
    data: [
      { key: 'max_concurrent_streams', value: '5', description: 'Maximum number of concurrent stream tasks' },
      { key: 'default_video_bitrate', value: '4500', description: 'Default video bitrate in kbps' },
      { key: 'default_audio_bitrate', value: '128', description: 'Default audio bitrate in kbps' },
      { key: 'auto_restart_on_error', value: 'true', description: 'Automatically restart failed streams' },
      { key: 'max_retries', value: '3', description: 'Maximum retry attempts for failed tasks' },
      { key: 'log_retention_days', value: '30', description: 'Number of days to retain stream logs' },
      { key: 'alert_email', value: 'admin@example.com', description: 'Email for critical alerts' },
      { key: 'ffmpeg_path', value: FFMPEG_PATH, description: 'Path to ffmpeg binary' },
      { key: 'ytdlp_path', value: YT_DLP_PATH, description: 'Path to yt-dlp binary' },
      { key: 'download_dir', value: VIDEOS_DIR, description: 'Directory for downloaded videos' },
      { key: 'fallback_video', value: FALLBACK_VIDEO_PATH, description: 'Fallback video for streams without a video' },
    ],
  });

  // Create fallback video reference
  await db.video.create({
    data: {
      sourceType: 'local_upload',
      title: 'Standby Fallback Video',
      description: 'Auto-generated fallback video used when no video is assigned to a stream task',
      duration: 10,
      localPath: FALLBACK_VIDEO_PATH,
      status: 'cached',
      fileSize: 0,
      resolution: '1920x1080',
      codecVideo: 'h264',
      codecAudio: 'aac',
    },
  });

  return true;
}
