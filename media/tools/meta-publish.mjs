// Publish a finished episode or reel to the ZALA VIP Facebook page and Instagram, through the official Graph API.
// The video goes from R2 to Meta by a short-lived signed link: nothing passes through anyone's computer.
// Usage: node media/tools/meta-publish.mjs <publish dir> <episode id> <main|R1|R2|R3> [--to fb,ig]
// Queue mode: node media/tools/meta-publish.mjs --queue content/meta-queue.json  (publishes what is due, marks it done)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const G = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const PAGE = process.env.FB_PAGE_ID || '108172631323930';
const IG = process.env.IG_ACCOUNT_ID || '17841480123002919';
if (!TOKEN) throw new Error('META_SYSTEM_USER_TOKEN is missing');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(url, { method = 'GET', params = {}, headers = {}, token = TOKEN } = {}) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET'
    ? await fetch(`${url}${url.includes('?') ? '&' : '?'}${body}`, { headers })
    : await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Meta refused ${url.replace(G, '')}: ${data.error?.message || res.status}`);
  return data;
}

function signedUrl(id, file) {
  const { R2_BUCKET, R2_ACCOUNT_ID } = process.env;
  return execFileSync('aws', ['s3', 'presign', `s3://${R2_BUCKET}/renders/${id}/publish/${file}`, '--expires-in', '21600',
    '--endpoint-url', `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`], { encoding: 'utf8' }).trim();
}

function texts(pkg, id, which, source) {
  const isMain = which === 'main';
  const reel = isMain ? null : pkg.reels.find((r) => r.id === `${id}-${which}`);
  if (!isMain && !reel) throw new Error(`No reel ${which} in the package`);
  const site = `https://www.zalavip.com/?utm_source=${source}&utm_medium=${isMain ? 'video' : 'reel'}&utm_campaign=${isMain ? id : reel.id}`;
  const cut = pkg.description.indexOf('\n\nMusic:');
  const credits = cut >= 0 ? pkg.description.slice(cut) : '';
  const story = cut >= 0 ? pkg.description.slice(0, cut) : pkg.description;
  const title = isMain ? pkg.title : reel.title;
  const long = isMain ? `${title}\n\n${story}\n\nPlan your Egypt trip with ZALA VIP: ${site}${credits}` : `${title}\n\nThe full story: ${pkg.title}\nPlan your Egypt trip with ZALA VIP: ${site}${credits}`;
  // Instagram allows 2200 characters; the credits must always stay.
  const short = long.length <= 2200 ? long : `${title}\n\nPlan your Egypt trip with ZALA VIP: ${site}${credits}`.slice(0, 2200);
  return { isMain, file: isMain ? pkg.file : reel.file, title, text: long.slice(0, 5000), ig: short };
}

async function toFacebook(pkg, id, which) {
  const t = texts(pkg, id, which, 'facebook');
  const url = signedUrl(id, t.file);
  const { access_token: pageToken } = await call(`${G}/${PAGE}?fields=access_token`);
  if (t.isMain) {
    const r = await call(`https://graph-video.facebook.com/v21.0/${PAGE}/videos`, { method: 'POST', token: pageToken,
      params: { file_url: url, title: t.title.slice(0, 255), description: t.text, published: 'true' } });
    return { platform: 'facebook', kind: 'video', id: r.id, url: `https://www.facebook.com/${PAGE}/videos/${r.id}` };
  }
  const start = await call(`${G}/${PAGE}/video_reels`, { method: 'POST', token: pageToken, params: { upload_phase: 'start' } });
  const up = await fetch(start.upload_url, { method: 'POST', headers: { Authorization: `OAuth ${pageToken}`, file_url: url } });
  if (!up.ok) throw new Error(`Facebook reel upload failed: ${up.status} ${await up.text()}`);
  await call(`${G}/${PAGE}/video_reels`, { method: 'POST', token: pageToken,
    params: { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: t.text } });
  return { platform: 'facebook', kind: 'reel', id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
}

async function toInstagram(pkg, id, which) {
  const t = texts(pkg, id, which, 'instagram');
  let box;
  if (t.isMain) {
    // Instagram refuses the full-size episode by link, so the server makes a lighter copy and sends the file itself.
    const { R2_BUCKET, R2_ACCOUNT_ID } = process.env;
    execFileSync('aws', ['s3', 'cp', `s3://${R2_BUCKET}/renders/${id}/publish/${t.file}`, '/tmp/src.mp4', '--no-progress',
      '--endpoint-url', `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`], { stdio: 'inherit' });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', '/tmp/src.mp4', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '4500k',
      '-maxrate', '5000k', '-bufsize', '10000k', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
      '-movflags', '+faststart', '/tmp/ig.mp4'], { stdio: 'inherit' });
    const size = fs.statSync('/tmp/ig.mp4').size;
    console.log(`Instagram copy: ${(size / 1e6).toFixed(1)} MB`);
    box = await call(`${G}/${IG}/media`, { method: 'POST', params: { media_type: 'REELS', upload_type: 'resumable', caption: t.ig, share_to_feed: 'true' } });
    const up = await fetch(box.uri, { method: 'POST', headers: { Authorization: `OAuth ${TOKEN}`, offset: '0', file_size: String(size) }, body: fs.readFileSync('/tmp/ig.mp4') });
    if (!up.ok) throw new Error(`Instagram upload failed: ${up.status} ${(await up.text()).slice(0, 200)}`);
  } else {
    box = await call(`${G}/${IG}/media`, { method: 'POST', params: { media_type: 'REELS', video_url: signedUrl(id, t.file), caption: t.ig, share_to_feed: 'true' } });
  }
  for (let i = 0; i < 90; i++) {
    const s = await call(`${G}/${box.id}?fields=status_code,status`);
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not process the video: ${s.status}`);
    if (i === 89) throw new Error('Instagram took too long to process the video');
    await sleep(20000);
  }
  const done = await call(`${G}/${IG}/media_publish`, { method: 'POST', params: { creation_id: box.id } });
  const info = await call(`${G}/${done.id}?fields=permalink`);
  return { platform: 'instagram', kind: 'reel', id: done.id, url: info.permalink };
}

async function publish(dir, id, which, to) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, `${id}.youtube.json`), 'utf8'));
  const out = [];
  for (const p of to) {
    try {
      out.push(p === 'fb' ? await toFacebook(pkg, id, which) : await toInstagram(pkg, id, which));
    } catch (err) {
      out.push({ platform: p, error: String(err.message || err).slice(0, 300) });
    }
  }
  for (const r of out) console.log(`RESULT:${JSON.stringify({ episode: id, which, ...r })}`);
  return out;
}

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const queueFile = opt('--queue', '');
if (queueFile) {
  // Each item: { episode, which, to: ["fb","ig"], at: ISO time, done: false }. The workflow syncs each episode to publish/<episode>.
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  const due = queue.filter((q) => !q.done && Date.parse(q.at) <= Date.now());
  for (const q of due) {
    const res = await publish(path.join('publish', q.episode), q.episode, q.which, q.to);
    q.done = new Date().toISOString();
    q.results = res;
  }
  if (due.length) fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);   // untouched when nothing was due
  console.log(`Queue: ${due.length} published, ${queue.filter((q) => !q.done).length} waiting.`);
} else {
  const [dir, id, which] = args;
  if (!dir || !id || !which) throw new Error('usage: <publish dir> <episode id> <main|R1|R2|R3> [--to fb,ig]');
  const res = await publish(dir, id, which, opt('--to', 'fb,ig').split(','));
  if (res.some((r) => r.error)) process.exitCode = 1;
}
