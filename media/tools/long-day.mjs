#!/usr/bin/env node
// media/tools/long-day.mjs — one long video a day, the languages taking turns (owner, 2026-11-27): Arabic, Spanish,
// English, and again. One a day also fits the free voice quota. Nothing is published; the video goes to R2.
//   node media/tools/long-day.mjs                 prints today's job (and writes it to GITHUB_OUTPUT)
//   node media/tools/long-day.mjs --prepare <id>  writes that video's description into long-treasures.json (server only)
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const queue = read('long-queue.json');

export function languageOf(now) {
  const days = Math.floor((now - Date.parse(`${queue.startDay}T00:00:00Z`)) / 864e5);
  const opening = queue.opening || [];
  if (days >= 0 && days < opening.length) return opening[days];
  const turn = days < 0 ? days : days - opening.length;
  return queue.order[((turn % queue.order.length) + queue.order.length) % queue.order.length];
}

async function passed(id) {
  const base = process.env.VITE_MEDIA_BASE_URL;
  if (!base) throw new Error('VITE_MEDIA_BASE_URL is not set');
  const r = await fetch(`${base.replace(/\/$/, '')}/renders/${id}/review/verdict.json?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`R2 answered ${r.status} for ${id}`);   // never remake a finished video on a bad answer
  return (await r.json()).pass === true;
}

async function started(id) {
  const r = await fetch(`${process.env.VITE_MEDIA_BASE_URL.replace(/\/$/, '')}/renders/${id}/script.json?t=${Date.now()}`, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  return r.ok;
}

const [cmd, wanted] = process.argv.slice(2);
if (cmd === '--prepare') {
  const lang = queue.order.find((l) => queue.videos[l].some((v) => v.id === wanted));
  const video = lang && queue.videos[lang].find((v) => v.id === wanted);
  if (!video) throw new Error(`no long video ${wanted} in the queue`);
  const specs = read('long-treasures.json');
  specs[wanted] = { ...specs[video.topic], lang, ...queue.size[lang] };
  fs.writeFileSync(path.join(here, 'long-treasures.json'), JSON.stringify(specs, null, 2) + '\n');
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `TOPIC=${video.topic}\n`);
  console.log(`${wanted}: ${lang}, topic ${video.topic}`);
} else if (cmd !== '--test') {
  const forced = (process.env.FORCE_ID || '').trim();
  const lang = forced ? queue.order.find((l) => queue.videos[l].some((v) => v.id === forced)) : languageOf(Date.now());
  const jobs = [];
  for (const v of forced ? [{ id: forced }] : queue.videos[lang]) {
    if (!forced && (await passed(v.id))) continue;
    jobs.push({ id: v.id, lang });
    // a video already started needs only a little voice to finish: the next one is made after it, so the day's quota is used
    if (forced || jobs.length === 2 || !(await started(v.id))) break;
  }
  console.log(jobs.length ? `today: ${jobs.map((j) => j.id).join(' then ')} (${lang})` : `nothing left to make in "${lang}": add topics to long-queue.json`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `jobs=${JSON.stringify(jobs)}\n`);
}
