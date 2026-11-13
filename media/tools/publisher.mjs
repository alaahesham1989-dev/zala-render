#!/usr/bin/env node
// THE PUBLISHING FILE — organises posting for everything waiting in the outbox (outbox.mjs), one kind at a time:
//   episode     long video Monday/Thursday 16:00 UTC, its 3 reels on the days between (autopublish.mjs)
//   tour        virtual tour Saturday 18:00 UTC (autopublish.mjs, no reels: its short version is its own short)
//   short       standalone short or short tour in the daily short slots 13:00, 19:00, 23:30 UTC (shorts.mjs)
// YouTube gets it private with a publish time; Facebook and Instagram from content/meta-queue.json (meta.yml).
// Then, for every video: its ZALA Guide map places get the link (atlas-link.mjs) and the blog gets an article that
// links back to the map place (blog-feed.mjs), so video, map and blog all point to each other.
// Picture posts and their articles are a separate line (photo-post.mjs) and never pass here.
// Usage: node media/tools/publisher.mjs            everything waiting
//        node media/tools/publisher.mjs <id>       one video
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { readOutbox, writeOutbox } from './outbox.mjs';
import { addVideo } from './atlas-link.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const CONTENT = path.join(REPO, 'content');
const QUEUE = path.join(CONTENT, 'meta-queue.json');
const log = (...a) => console.log('[publisher]', ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const node = (args, env = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  if (r.status !== 0) throw new Error(`${path.basename(args[0])} stopped`);
};
const tool = (name) => path.join(REPO, 'media', 'tools', name);

/** The publish files are on the runner after a render; otherwise they come back from the outbox. */
function bring(id) {
  const dir = path.join(REPO, 'media', 'out', id, 'publish');
  if (!fs.existsSync(path.join(dir, `${id}.mp4`))) {
    execFileSync('aws', ['s3', 'sync', `s3://${process.env.R2_BUCKET}/outbox/${id}`, dir, '--endpoint-url', `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--no-progress'], { stdio: 'inherit' });
  }
  return dir;
}

async function publish(item) {
  const dir = bring(item.id);
  if (item.kind === 'episode') {
    node([tool('autopublish.mjs'), dir, item.id, QUEUE]);
    node([tool('atlas-link.mjs'), 'episode', item.id]);
  } else if (item.kind === 'tour') {
    node([tool('autopublish.mjs'), dir, item.id, QUEUE], { AP_HOUR: '18', AP_DAYS: '6', AP_REELS: '0' });
    const main = readJson(path.join(CONTENT, 'schedule.json'), []).find((p) => p.episode === item.id && p.which === 'main');
    if (item.place && main) addVideo(item.place, { url: main.youtube, title: item.title, kind: 'tour', at: main.at, episode: item.id });
  } else {
    node([tool('shorts.mjs'), 'schedule', item.id]);
    const q = readJson(QUEUE, []).find((x) => x.episode === item.id && x.youtube);
    if (item.place && q) addVideo(item.place, { url: q.youtube, title: item.title, kind: item.kind === 'tour-short' ? 'tour' : 'short', at: q.at, episode: item.id });
  }
  // the blog article for this video, linked to its map place; a failed article never holds the video back
  try { node([tool('blog-feed.mjs'), 'episode', item.id]); } catch (e) { log(`${item.id}: blog article failed (${e.message}), tried again next run`); item.blog = 'retry'; return; }
  item.blog = 'done';
}

const only = process.argv[2];
const list = readOutbox();
for (const item of list) {
  if (only && item.id !== only) continue;
  if (item.scheduled) {
    // an article that failed earlier is tried again
    if (item.blog === 'retry') { try { node([tool('blog-feed.mjs'), 'episode', item.id]); item.blog = 'done'; } catch { /* next run */ } }
    continue;
  }
  try {
    await publish(item);
    item.scheduled = new Date().toISOString();
    log(`${item.id} (${item.kind}) scheduled: ${item.title}`);
  } catch (e) { log(`${item.id}: not scheduled yet (${e.message}), tried again next run`); }
  writeOutbox(list);
}
writeOutbox(list);
