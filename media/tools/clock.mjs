#!/usr/bin/env node
// THE CLOCK — the one scheduler of the whole machine. GitHub's own timer runs 5 to 7 hours late on this repository
// (measured 2026-11-14: a 12:13 timer fired at 17:57, a 04:23 one at 11:37), so nothing may depend on it for WHEN.
// This process stays alive for about five hours, looks at the time every minute and starts each workflow at its
// minute; before it ends it starts the next clock (clock.yml also has a timer, only to bring a dead clock back).
// It keeps no file: "did this slot run?" is read from the workflow's own run list, so a new clock catches up on
// anything the old one missed and never starts the same slot twice.
// Usage (clock.yml): node media/tools/clock.mjs
import { execFileSync } from 'node:child_process';
import { isProduction } from './lang/paths.mjs';
import { byChat, findTrouble, troubleText } from '../lib/watchdog.mjs';

const REPO = process.env.GITHUB_REPOSITORY;
const LIFE_MS = Number(process.env.CLOCK_MINUTES || 320) * 60e3;
const born = Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });

// daily slots, UTC. days: 0 Sunday … 6 Saturday. The four that render share one lane (GitHub keeps one waiting
// run per lane and drops an older waiting one), so a render is only started when nothing is waiting in that lane.
const LANE = ['shorts.yml', 'prep.yml', 'tours.yml', 'factory.yml'];
const LANE_AR = ['arabic-prep.yml', 'arabic.yml'];   // the Arabic machine has its own lane: it never waits for, or blocks, the English one
const ARABIC_LIVE = process.env.ARABIC_LIVE === '1' && isProduction('ar');   // the owner's go-live word (repository variable ARABIC_LIVE)
const ENGLISH_PAUSED = !isProduction('en');   // lang.config.json languages.en.production=false: English paused per owner directive (2026-11-23); scheduled queue publishing remains active
const SLOTS = [
  { wf: 'shorts.yml', at: '00:17' },
  { wf: 'prep.yml', at: '01:41' },
  { wf: 'tours.yml', at: '02:53', inputs: ['-f', 'place=auto'] },   // a new place on Tuesday and Friday, other days only a tour still being fixed
  { wf: 'factory.yml', at: '04:23' },
  { wf: 'arabic-prep.yml', at: '05:00', needs: 'ARABIC_LIVE' },   // Arabic machine: off until the owner sets ARABIC_LIVE=1
  { wf: 'arabic.yml', at: '05:30', needs: 'ARABIC_LIVE' },
  { wf: 'photo-prep.yml', at: '06:05' },
  { wf: 'long.yml', at: '08:20' },   // one long video a day, languages in turn; just after the free voice quota resets
  { wf: 'insights.yml', at: '09:47' },
  { wf: 'telegram-day.yml', at: '15:00' },   // the audience channels: today's written posts, 6 pm Cairo
  { wf: 'photos.yml', at: '18:00', inputs: ['-f', 'now=true'] },   // 1pm US Eastern
  ...[0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ wf: 'comments.yml', at: `${String(h).padStart(2, '0')}:17`, window: 170 })),
];

const runs = (wf, n = 8) => { try { return JSON.parse(gh('run', 'list', '-R', REPO, '-w', wf, '-L', String(n), '--json', 'status,createdAt')); } catch { return null; } };
const waiting = (wf) => (runs(wf, 5) || [{ status: 'queued' }]).some((r) => ['queued', 'pending', 'waiting', 'requested'].includes(r.status));
const active = (wf) => (runs(wf, 5) || [{ status: 'queued' }]).some((r) => r.status !== 'completed');
const start = (wf, inputs = []) => { try { gh('workflow', 'run', wf, '-R', REPO, ...inputs); log(`started ${wf} ${inputs.join(' ')}`); return true; } catch (e) { log(`could not start ${wf}: ${String(e.stderr || e.message).trim().split('\n').pop()}`); return false; } };

const settled = new Set();   // slots this clock has dealt with: `${day} ${wf} ${at}`
function slots(now) {
  const day = now.toISOString().slice(0, 10);
  for (const s of SLOTS) {
    const key = `${day} ${s.wf} ${s.at}`;
    if (settled.has(key) || (s.days && !s.days.includes(now.getUTCDay()))) continue;
    if (s.needs === 'ARABIC_LIVE' && !ARABIC_LIVE) continue;
    if (ENGLISH_PAUSED && ['shorts.yml', 'prep.yml', 'tours.yml', 'factory.yml', 'photo-prep.yml', 'photos.yml'].includes(s.wf)) continue;
    const due = Date.parse(`${day}T${s.at}:00Z`);
    if (now.getTime() < due) continue;
    // a slot nobody needs any more (a comments round three hours old) is dropped, not caught up
    if (s.window && now.getTime() > due + s.window * 60e3) { settled.add(key); continue; }
    const list = runs(s.wf);
    if (!list) continue;                                             // GitHub did not answer: next minute
    if (list.some((r) => Date.parse(r.createdAt) >= due - 120e3)) { settled.add(key); continue; }   // it ran (or is running) since its slot
    const lane = LANE_AR.includes(s.wf) ? LANE_AR : LANE.includes(s.wf) ? LANE : null;
    if (lane && lane.some((w) => waiting(w))) continue;   // the lane has a run waiting: next minute
    if (start(s.wf, s.inputs)) { settled.add(key); return; }             // one start a minute keeps the lane check honest
  }
}

// Facebook and Instagram: meta.yml is started the minute something in the queue is due
let lastMeta = 0;
function queue(now) {
  if (now.getTime() - lastMeta < 6 * 60e3) return;
  let q;
  try { q = JSON.parse(gh('api', `repos/${REPO}/contents/content/meta-queue.json`, '-H', 'Accept: application/vnd.github.raw')); } catch { return; }
  const due = q.filter((x) => !x.done && Date.parse(x.at) <= now.getTime());
  if (!due.length || active('meta.yml')) return;
  log(`queue: ${due.length} due (${due.slice(0, 3).map((x) => `${x.episode} ${x.which}`).join(', ')})`);
  if (start('meta.yml', ['-f', 'episode=queue'])) lastMeta = now.getTime();
}

// the watchdog: every quarter hour, tell the owner once about runs that failed, hang or wait too long
let looked = born - 15 * 60e3;
const told = new Set();
async function watch(now) {
  if (now.getTime() - looked < 15 * 60e3) return;
  let list;
  try { list = JSON.parse(gh('run', 'list', '-R', REPO, '-L', '60', '--json', 'databaseId,workflowName,status,conclusion,createdAt,updatedAt')); } catch { return; }
  const trouble = findTrouble(list, { now: now.getTime(), since: looked, told });
  looked = now.getTime();
  if (!trouble.length) return;
  trouble.forEach((t) => told.add(t.id));
  log(troubleText(trouble, REPO));
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const chats = { admin: process.env.ADMIN_CHAT || process.env.TELEGRAM_CHAT_ID, arabic: process.env.AR_CHAT };
  for (const [chat, items] of byChat(trouble, chats)) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20e3),
      body: JSON.stringify({ chat_id: chat, text: troubleText(items, REPO), disable_web_page_preview: true }),
    });
    if (!res.ok) log(`watchdog message not sent: ${res.status}`);
  }
}

// one clock at a time: an older clock that is still alive two minutes from now keeps the job, this one leaves
const others = () => { try { return JSON.parse(gh('run', 'list', '-R', REPO, '-w', 'clock.yml', '-L', '10', '--json', 'status,databaseId')).filter((r) => r.status !== 'completed' && r.databaseId < Number(process.env.GITHUB_RUN_ID)); } catch { return []; } };
if (others().length) { await sleep(120e3); if (others().length) { log('another clock is alive, leaving'); process.exit(0); } }
log(`clock up for ${Math.round(LIFE_MS / 60e3)} minutes`);
while (Date.now() - born < LIFE_MS) {
  const now = new Date();
  try { slots(now); queue(now); await watch(now); } catch (e) { log(`tick: ${e.name === 'TimeoutError' ? 'watchdog timeout' : e.message}`); }
  await sleep(60e3 - (Date.now() % 60e3) + 500);   // the top of the next minute
}
log('handing over to the next clock');
start('clock.yml');
