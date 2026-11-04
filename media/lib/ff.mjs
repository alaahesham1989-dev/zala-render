// media/lib/ff.mjs — thin ffmpeg / ffprobe wrappers.
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

export const FFMPEG = process.env.FFMPEG_PATH || ffmpegPath;

export function ff(args) {
  try {
    return execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (err) {
    const msg = String(err.stderr || err.message).slice(-1500);
    throw new Error(`ffmpeg failed: ${msg}`);
  }
}

export const durationOf = (file) =>
  Number(execFileSync(process.env.FFPROBE_PATH || ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()) || 0;

export const dimensionsOf = (file) => {
  try {
    const out = execFileSync(process.env.FFPROBE_PATH || ffprobe.path, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', file
    ]).toString().trim();
    const [w, h] = out.split('x').map(Number);
    return { width: w || 0, height: h || 0 };
  } catch {
    return { width: 0, height: 0 };
  }
};

/** Escape a path for use inside an ffmpeg filter argument (Windows drive colons, quotes, backslashes). */
export const filterPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

export const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
