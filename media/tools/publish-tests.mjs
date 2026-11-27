#!/usr/bin/env node
// media/tools/publish-tests.mjs — publishes one approved test short to the platforms listed in publish-tests.json.
// The licences of the music and pictures are written at the end of the description (CC BY needs the author named).
// What was published is kept in renders/<id>/published.json and is never posted a second time.
// Usage: node media/tools/publish-tests.mjs <id>   (publish/ holds the package; script.json and items.jsonl beside it)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const id = process.argv[2];
const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'publish-tests.json'), 'utf8'))[id];
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
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 26 });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  return (r.stdout || '').split('\n').filter((l) => l.startsWith('RESULT:')).map((l) => JSON.parse(l.slice(7)));
};

let failed = false;
if (!done.youtube) {
  const [res] = run(['media/tools/youtube-upload.mjs', dir, id, 'R1', '--privacy', 'public'], { EXPECT_CHANNEL: spec.channel });
  if (res?.url) { done.youtube = res; save(); } else failed = true;
}
console.log(`PUBLISHED ${id} youtube ${done.youtube ? `${done.youtube.url} (${done.youtube.privacy})` : 'FAILED'}`);

if (spec.meta) {
  const G = 'https://graph.facebook.com/v21.0';
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const page = await (await fetch(`${G}/${spec.meta.page}?fields=name,instagram_business_account&access_token=${token}`)).json();
  const ig = page.instagram_business_account?.id;
  const want = ['fb', ...(ig ? ['ig'] : [])].filter((p) => !done[p]);
  if (!ig) console.log(`PUBLISHED ${id} instagram NOT CONNECTED to the page`);
  if (want.length) {
    const res = run(['media/tools/meta-publish.mjs', dir, id, 'R1', '--to', want.join(',')], { FB_PAGE_ID: spec.meta.page, IG_ACCOUNT_ID: ig || '' });
    for (const r of res) {
      const key = r.platform === 'facebook' ? 'fb' : r.platform === 'instagram' ? 'ig' : r.platform;
      if (!r.error && (key === 'fb' || key === 'ig')) done[key] = r; else if (r.error) console.log(`PUBLISHED ${id} ${r.platform} FAILED ${String(r.error).slice(0, 200)}`);
    }
    save();
  }
  for (const p of ['fb', 'ig']) { if (done[p]) console.log(`PUBLISHED ${id} ${p} ${done[p].url || done[p].id}`); else if (p === 'fb' || ig) failed = true; }
}
// the audience channel of the language gets the YouTube link (the credits are on the video it points to)
if (spec.telegram && done.youtube && !done.tg) {
  const call = async (method, body) => (await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(30000) })).json();
  const me = (await call('getMe')).result;
  const member = await call('getChatMember', { chat_id: spec.telegram, user_id: me?.id });
  const can = member.ok && member.result.status === 'administrator' && member.result.can_post_messages;
  if (!can) { console.log(`PUBLISHED ${id} telegram NOT POSTED: the bot cannot post in ${spec.telegram} (${member.ok ? member.result.status : member.description})`); failed = true; }
  else {
    const sent = await call('sendMessage', { chat_id: spec.telegram, text: `${spec.text.split('\n')[0]}\n\n${done.youtube.url}` });
    if (sent.ok) { done.tg = { channel: spec.telegram, id: sent.result.message_id, url: `https://t.me/${spec.telegram.slice(1)}/${sent.result.message_id}` }; save(); }
    else { console.log(`PUBLISHED ${id} telegram FAILED ${sent.description}`); failed = true; }
  }
}
if (done.tg) console.log(`PUBLISHED ${id} telegram ${done.tg.url}`);
if (failed) process.exitCode = 1;
