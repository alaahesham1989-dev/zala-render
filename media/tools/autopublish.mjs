// Puts a finished episode that passed the review into the next free places of the weekly plan, with no one asked:
//   the long video on the next free Monday or Thursday, its three reels on the next free days in between, 16:00 UTC (18:00 Cairo).
// YouTube: uploaded now as private with a publish time (YouTube makes them public on time).
// Facebook and Instagram: added to content/meta-queue.json, which meta.yml publishes when due (Instagram gets reels only).
// The plan is kept in content/schedule.json; places already taken in the queue are never used twice.
// Usage: node media/tools/autopublish.mjs <publish dir> <episode id> <queue file>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONTENT, REPO } from '../lib/paths.mjs';

const [dir, ep, queueFile] = process.argv.slice(2);
if (!dir || !ep || !queueFile) throw new Error('usage: <publish dir> <episode id> <queue file>');
const planFile = path.join(CONTENT, 'schedule.json');
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : [];
const queue = fs.existsSync(queueFile) ? JSON.parse(fs.readFileSync(queueFile, 'utf8')) : [];
if (plan.some((p) => p.episode === ep && p.youtube)) { console.log(`${ep} is scheduled already`); process.exit(0); }
const pkgFile = path.join(dir, `${ep}.youtube.json`);
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
// Each reel's one line about its subject, for the short post text on every platform (media/tools/captions.mjs)
try {
  const script = JSON.parse(fs.readFileSync(path.join(CONTENT, 'youtube', `${ep}.json`), 'utf8'));
  (pkg.reels || []).forEach((r, n) => { const s = (script.reels || [])[n]; if (s?.sub) r.sub = s.sub; });
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
} catch { /* no script: the reels take the episode's first sentence */ }

// a kind of long video has its own hour (episodes 16:00 UTC, virtual tours 18:00 UTC on Saturday); only that hour is
// counted as taken, so the shorts at 13:00, 19:00 and 23:30 never push a long video away
const HOUR = Number(process.env.AP_HOUR || 16);
const hh = `${String(HOUR).padStart(2, '0')}:00`;
const taken = new Set([...plan.map((p) => p.at), ...queue.map((q) => q.at)].filter((t) => String(t).slice(11, 16) === hh).map((t) => String(t).slice(0, 10)));
const LONG_DAYS = (process.env.AP_DAYS || '1,4').split(',').map(Number);   // Monday, Thursday (tours: Saturday)
if (process.env.AP_REELS === '0') pkg.reels = [];   // a tour's short version is its own short
const day = (d) => d.toISOString().slice(0, 10);
const at = (d) => `${day(d)}T${hh}:00Z`;
function next(from, ok) {
  const d = new Date(from);
  d.setUTCHours(HOUR, 0, 0, 0);
  if (d <= from) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 120; i++, d.setUTCDate(d.getUTCDate() + 1)) if (ok(d) && !taken.has(day(d))) { taken.add(day(d)); return new Date(d); }
  throw new Error('no free day in the next 120 days');
}
const soon = new Date(Date.now() + 12 * 3600 * 1000);   // at least half a day to check it
const longAt = next(soon, (d) => LONG_DAYS.includes(d.getUTCDay()));
let cursor = longAt;
const reelsAt = (pkg.reels || []).map(() => (cursor = next(cursor, (d) => !LONG_DAYS.includes(d.getUTCDay()))));

function youtube(which, when) {
  const args = [path.join(REPO, 'media', 'tools', 'youtube-upload.mjs'), dir, ep, which, '--privacy', 'private', '--publish-at', at(when)];
  if (which === 'main' && pkg.thumbnail) args.push('--thumbnail', pkg.thumbnail);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, EXPECT_CHANNEL: '@zalavip' } });
  process.stdout.write(r.stdout || '');
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT:'));
  if (r.status !== 0 || !line) throw new Error(`YouTube upload of ${ep} ${which} failed: ${(r.stderr || '').slice(-300)}`);
  return JSON.parse(line.slice(7));
}

const done = [];
const main = youtube('main', longAt);
done.push({ episode: ep, which: 'main', at: at(longAt), youtube: main.url, title: pkg.title });
queue.push({ episode: ep, which: 'main', to: ['fb'], at: at(longAt), done: false });
const later = (d) => new Date(new Date(d).getTime() + 20 * 60000).toISOString();   // credits comment once the video is public
queue.push({ episode: ep, which: 'main', to: [`yt:${main.id}`], at: later(longAt), done: false });
(pkg.reels || []).forEach((r, n) => {
  const which = `R${n + 1}`;
  const y = youtube(which, reelsAt[n]);
  done.push({ episode: ep, which, at: at(reelsAt[n]), youtube: y.url, title: r.title });
  queue.push({ episode: ep, which, to: ['fb', 'ig'], at: at(reelsAt[n]), done: false });
  queue.push({ episode: ep, which, to: [`yt:${y.id}`], at: later(reelsAt[n]), done: false });
});
fs.writeFileSync(planFile, JSON.stringify([...plan, ...done], null, 2) + '\n');
fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2) + '\n');
const cairo = (t) => new Date(t).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
const summary = done.map((d) => `${d.which === 'main' ? 'الحلقة' : `ريل ${d.which.slice(1)}`}: ${cairo(d.at)}`).join('\n');
fs.writeFileSync(path.join(REPO, 'schedule-summary.txt'), summary + '\n');
console.log(summary);
