#!/usr/bin/env node
// THE OUTBOX — the one plate on R2 where every finished video lands after it passed the quality stage:
//   R2 outbox/<id>/            the video files, thumbnails and the publish package
//   content/outbox.json        the list (kept in git): id, kind, title, map place, rounds, when it landed, when scheduled
// Nothing is published from here directly: publisher.mjs takes what is waiting and organises the posting.
//   node media/tools/outbox.mjs put <id> <kind: episode|short|tour> [quality rounds]
//   node media/tools/outbox.mjs list
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const CONTENT = path.join(REPO, 'content');
export const OUTBOX = path.join(CONTENT, 'outbox.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const readOutbox = () => readJson(OUTBOX, []);
export const writeOutbox = (list) => fs.writeFileSync(OUTBOX, JSON.stringify(list, null, 2) + '\n');
const s3 = (...a) => execFileSync('aws', ['s3', ...a, '--endpoint-url', `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--no-progress'], { stdio: 'inherit' });

function put(id, kind, rounds) {
  if (!['episode', 'short', 'tour', 'tour-short'].includes(kind)) throw new Error(`unknown kind ${kind}`);
  const dir = path.join(REPO, 'media', 'out', id, 'publish');
  if (!fs.existsSync(path.join(dir, `${id}.mp4`))) throw new Error(`${id}: no finished video in ${dir}`);
  const script = readJson(path.join(CONTENT, 'youtube', `${id}.json`), {});
  const verdict = readJson(path.join(REPO, `quality-${id}`, 'verdict.json'), {});
  if (!verdict.pass) throw new Error(`${id}: the quality stage has not passed it`);
  s3('sync', dir, `s3://${process.env.R2_BUCKET}/outbox/${id}`, '--exclude', '*.ass');
  const list = readOutbox().filter((x) => x.id !== id || x.scheduled);   // a video made again replaces its waiting copy
  if (list.some((x) => x.id === id)) { console.log(`[outbox] ${id} is scheduled already, kept as it is`); return; }
  list.push({ id, kind, title: script.title, place: script.place || null, rounds: Number(rounds) || 1, landed: new Date().toISOString(), quality: verdict.checkedAt, scheduled: null });
  writeOutbox(list);
  console.log(`[outbox] ${id} (${kind}) landed: ${script.title}`);
}

if (process.argv[1]?.endsWith('outbox.mjs')) {
  const [cmd, id, kind, rounds] = process.argv.slice(2);
  if (cmd === 'put') put(id, kind, rounds);
  else if (cmd === 'list') for (const x of readOutbox()) console.log(`${x.id}\t${x.kind}\t${x.scheduled ? 'scheduled ' + x.scheduled.slice(0, 10) : 'waiting'}\t${x.title}`);
  else throw new Error('usage: put <id> <kind> [rounds] | list');
}
