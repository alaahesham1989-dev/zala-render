#!/usr/bin/env node
// media/tools/telegram-day.mjs — posts today's written posts (social-posts.json) to the audience channels, each once.
// A post is {id, lang, date, text, photo?}. A post up to two days late is still sent; older ones are left alone.
// What was sent is kept in telegram-done.json (the workflow keeps it on R2). DRY=1 only lists what would be sent.
import fs from 'node:fs';
import path from 'node:path';

const queue = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'social-posts.json'), 'utf8'));
const doneFile = process.env.DONE_FILE || 'telegram-done.json';
const done = fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);
const oldest = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
const BANNED = /travel agency|tour operator|شركة سياحة|agencia de viajes/i;

const due = queue.posts.filter((p) => !done[p.id] && p.date <= today && p.date >= oldest);
console.log(`due: ${due.map((p) => p.id).join(', ') || 'nothing'}`);
if (process.env.DRY === '1' || !due.length) process.exit(0);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
const call = async (method, body) => (await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })).json();

let failed = false;
for (const post of due) {
  const chat = queue.channels[post.lang];
  if (!chat || BANNED.test(post.text)) { console.log(`${post.id} REFUSED: ${chat ? 'a forbidden phrase' : 'no channel'}`); failed = true; continue; }
  const sent = post.photo ? await call('sendPhoto', { chat_id: chat, photo: post.photo, caption: post.text }) : await call('sendMessage', { chat_id: chat, text: post.text });
  if (!sent.ok) { console.log(`${post.id} FAILED ${sent.description}`); failed = true; continue; }
  done[post.id] = { at: new Date().toISOString(), url: `https://t.me/${chat.slice(1)}/${sent.result.message_id}` };
  fs.writeFileSync(doneFile, JSON.stringify(done, null, 2));
  console.log(`${post.id} ${done[post.id].url}`);
}
if (failed) process.exitCode = 1;
