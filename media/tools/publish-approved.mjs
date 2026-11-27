#!/usr/bin/env node
// Schedules one owner-approved video (publish-approved.json) on its YouTube channel and Facebook page.
// published.json beside the render stops a second upload.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const id = process.argv[2];
const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'publish-approved.json'), 'utf8'))[id];
if (!spec?.title) throw new Error(`${id} is not approved for publishing`);
const dir = path.join(REPO, 'publish');
const verdict = JSON.parse(fs.readFileSync(path.join(REPO, 'verdict.json'), 'utf8'));
if (!verdict.pass) throw new Error(`${id} did not pass the quality check`);

// ── credits of what is really in the video ──
const script = JSON.parse(fs.readFileSync(path.join(REPO, 'script.json'), 'utf8'));
const items = new Map(fs.readFileSync(path.join(REPO, 'items.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((i) => [i.id, i]));
const used = [...new Set(script.chapters.flatMap((c) => c.lines).flatMap((l) => l.pictures || []))];
const plain = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
const photos = new Map();
for (const p of used) {
  const i = items.get(p);
  if (!i) throw new Error(`picture ${p} has no library record: its licence is unknown, nothing is published`);
  const licence = String(i.license || '').trim();
  if (!licence) throw new Error(`picture ${p} has no licence: nothing is published`);
  if (/^(CC0|Public domain)/i.test(licence)) continue;
  photos.set(`${plain(i.author) || plain(i.source) || 'Wikimedia Commons'} (${licence})`, true);
}
const music = [...new Set((script.music || []).map((m) => m.track))].map((t) => `"${t}" Kevin MacLeod (incompetech.com), CC BY 4.0`);
const credits = [spec.creditsHead, ...music.map((m) => `Music: ${m}`), `Photos (Wikimedia Commons and others): ${[...photos.keys()].join('; ')}`, 'https://creativecommons.org/licenses/'].join('\n');
const description = `${spec.text}\n\n${credits}`;
console.log(description);

// ── the package the publishers read ──
const pkgFile = path.join(dir, `${id}.youtube.json`);
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
Object.assign(pkg, { lang: spec.lang, uploadTitle: spec.title, uploadDescription: description });
if (spec.noCover) pkg.reels[0].cover = 'no-cover.jpg';
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
if (process.env.DRY === '1') process.exit(0);

const doneFile = path.join(REPO, 'published.json');
const done = fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : {};
const save = () => fs.writeFileSync(doneFile, JSON.stringify(done, null, 2));
const when = spec.at;                                   // ISO time the owner's schedule gives it
if (!(Date.parse(when) > Date.now() + 15 * 60e3)) throw new Error(`${id}: the publish time must be at least 15 minutes ahead`);
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 26 });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  return (r.stdout || '').split('\n').filter((l) => l.startsWith('RESULT:')).map((l) => JSON.parse(l.slice(7)));
};

let failed = false;
if (!done.youtube) {
  const [res] = run(['media/tools/youtube-upload.mjs', dir, id, 'R1', '--privacy', 'private', '--publish-at', when], { EXPECT_CHANNEL: spec.channel });
  if (res?.url) { done.youtube = res; save(); } else failed = true;
}
console.log(`PUBLISHED ${id} youtube ${done.youtube ? `${done.youtube.url} (${done.youtube.privacy})` : 'FAILED'}`);

if (spec.meta && done.youtube && !done.fb) {
  const res = run(['media/tools/meta-publish.mjs', dir, id, 'R1', '--to', 'fb'], { FB_PAGE_ID: spec.meta.page, FB_SCHEDULE_AT: String(Math.floor(Date.parse(when) / 1000)) });
  for (const r of res) {
    if (!r.error && r.platform === 'facebook') done.fb = r; else if (r.error) console.log(`PUBLISHED ${id} facebook FAILED ${String(r.error).slice(0, 200)}`);
  }
  save();
  if (!done.fb) failed = true;
}
console.log(`SCHEDULED ${id} for ${when}: youtube ${done.youtube?.url || 'FAILED'} facebook ${done.fb?.url || 'FAILED'}`);
if (failed) process.exitCode = 1;
