// media/lib/ahash.mjs — a 64-bit look of a picture, to tell near copies apart from different pictures.
import { spawnSync } from 'node:child_process';
import { FFMPEG } from './ff.mjs';

/** @returns {string|null} 64 characters of 0/1; `crop` is an ffmpeg filter applied first */
export function ahashOf(file, crop = '') {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `${crop ? `${crop},` : ''}scale=8:8:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
  const px = r.stdout;
  if (r.status !== 0 || !px || px.length < 64) return null;
  const mean = px.subarray(0, 64).reduce((a, b) => a + b, 0) / 64;
  return [...px.subarray(0, 64)].map((v) => (v > mean ? '1' : '0')).join('');
}

export const nearCopy = (a, b, limit = 8) => Boolean(a && b) && [...a].filter((c, i) => c !== b[i]).length <= limit;
