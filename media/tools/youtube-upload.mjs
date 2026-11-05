#!/usr/bin/env node
// Uploads a finished video to YouTube through the official API, on the server.
// Usage: node media/tools/youtube-upload.mjs <publish dir> <episode id> <main|R1|R2|R3> [--privacy private|unlisted|public] [--publish-at ISO] [--thumbnail file]
// Default is private: nothing becomes public unless it is asked for by name.
import fs from 'node:fs';
import path from 'node:path';

const { YOUTUBE_CLIENT_ID: clientId, YOUTUBE_CLIENT_SECRET: clientSecret, YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
if (!clientId || !clientSecret || !refresh) throw new Error('The YouTube secrets are missing');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const privacy = opt('--privacy', 'private');
const publishAt = opt('--publish-at', '');
const thumbName = opt('--thumbnail', '');
const [dir, id, which] = argv;
if (!dir || !id || !which) throw new Error('usage: <publish dir> <episode id> <main|R1|R2|R3>');
if (!['private', 'unlisted', 'public'].includes(privacy)) throw new Error(`Unknown privacy: ${privacy}`);

const pkg = JSON.parse(fs.readFileSync(path.join(dir, `${id}.youtube.json`), 'utf8'));
const API = 'https://www.googleapis.com';

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`Google refused the token: ${d.error} ${d.error_description || ''}`);
  return d.access_token;
}
const token = await accessToken();
const auth = { Authorization: `Bearer ${token}` };

const isMain = which === 'main';
const reel = isMain ? null : pkg.reels.find((r) => r.id === `${id}-${which}`);
if (!isMain && !reel) throw new Error(`No reel ${which} in the package`);
const file = path.join(dir, isMain ? pkg.file : reel.file);
const site = (medium) => `https://www.zalavip.com/?utm_source=youtube&utm_medium=${medium}&utm_campaign=${isMain ? id : reel.id}`;
const title = String(isMain ? pkg.title : `${reel.title} #shorts`).slice(0, 100);
const credits = pkg.description.includes('\n\nMusic:') ? pkg.description.slice(pkg.description.indexOf('\n\nMusic:')) : '';
const description = (isMain ? pkg.description : `The full story: ${pkg.title}\nPlan your Egypt trip with ZALA VIP: ${site('short')}${credits}`).slice(0, 4900);

const size = fs.statSync(file).size;
const body = {
  snippet: { title, description, tags: pkg.tags, categoryId: '27', defaultLanguage: 'en', defaultAudioLanguage: 'en' },
  status: {
    privacyStatus: publishAt ? 'private' : privacy, selfDeclaredMadeForKids: false, embeddable: true,
    // the narration is an AI voice, and reconstructed shots are marked on screen
    containsSyntheticMedia: true,
    ...(publishAt ? { publishAt } : {}),
  },
};
const open = await fetch(`${API}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
  body: JSON.stringify(body),
});
if (!open.ok) throw new Error(`YouTube refused the upload: ${open.status} ${(await open.text()).slice(0, 600)}`);
const where = open.headers.get('location');

const CHUNK = 32 * 1024 * 1024;
const fd = fs.openSync(file, 'r');
let sent = 0, video = null;
while (!video) {
  const len = Math.min(CHUNK, size - sent);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, sent);
  let res = null;
  for (let attempt = 1; attempt <= 6 && !res; attempt++) {
    try {
      const r = await fetch(where, { method: 'PUT', headers: { 'Content-Length': String(len), 'Content-Range': `bytes ${sent}-${sent + len - 1}/${size}` }, body: buf, signal: AbortSignal.timeout(600000) });
      if (r.status >= 500) throw new Error(`server ${r.status}`);
      res = r;
    } catch (e) { console.log(`  retry ${attempt}: ${e.message}`); await new Promise((d) => setTimeout(d, 5000 * attempt)); }
  }
  if (!res) throw new Error('The upload kept failing');
  if (res.status === 308) { sent = Number(res.headers.get('range')?.split('-')[1] ?? sent + len - 1) + 1; console.log(`  ${Math.round((sent / size) * 100)}%`); continue; }
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${(await res.text()).slice(0, 600)}`);
  video = await res.json();
}
fs.closeSync(fd);
console.log(`Uploaded: ${video.id} as ${video.status?.privacyStatus}`);

const notes = [];
if (isMain) {
  const thumb = path.join(dir, thumbName || pkg.thumbnail);
  const t = await fetch(`${API}/upload/youtube/v3/thumbnails/set?videoId=${video.id}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(thumb) });
  notes.push(t.ok ? 'thumbnail set' : `thumbnail refused: ${t.status} ${(await t.text()).slice(0, 300)}`);
  const srt = path.join(dir, pkg.captions?.en || `${id}.en.srt`);
  if (fs.existsSync(srt)) {
    const boundary = 'zala-caption-part';
    const meta = JSON.stringify({ snippet: { videoId: video.id, language: 'en', name: 'English' } });
    const form = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), fs.readFileSync(srt), Buffer.from(`\r\n--${boundary}--`)]);
    const c = await fetch(`${API}/upload/youtube/v3/captions?uploadType=multipart&part=snippet`, { method: 'POST', headers: { ...auth, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: form });
    notes.push(c.ok ? 'captions added' : `captions refused: ${c.status} ${(await c.text()).slice(0, 300)}`);
  }
}
notes.forEach((n) => console.log(n));
console.log(`RESULT:${JSON.stringify({ id: video.id, title, privacy: video.status?.privacyStatus, publishAt: video.status?.publishAt || null, url: `https://youtu.be/${video.id}`, notes })}`);
