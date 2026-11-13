// Prepares picture posts AHEAD of the publishing day, from our OWN checked episode stories — not from whatever
// photo happens to already be in the library. For each topic not yet queued or posted:
//   1. pick the single most shareable true moment from that episode's script,
//   2. search the open-license museums (Wikimedia Commons, the Met, Cleveland, the Art Institute, Smithsonian,
//      Europeana) for a real photo of that exact object or scene,
//   3. if none exists, make one with Nano Banana (Gemini's own image model, no browser, no laptop) and label it
//      "AI RECONSTRUCTION" right on the picture, so it is never mistaken for the real thing,
//   4. check the finished card the same way the publishing step does, and push it onto content/photo-queue.json.
// The publishing step (photo-post.mjs) only ever takes the next ready item off that queue and posts it.
// Usage: node media/tools/photo-prep.mjs [--count 3] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { askJson, generateImage } from './gemini-lite.mjs';
import { findOpenPhoto } from '../library-harvest.mjs';
import { CONTENT, REPO } from '../lib/paths.mjs';

const dry = process.argv.includes('--dry');
const countArg = process.argv.find((a) => a.startsWith('--count='));
const count = Number(countArg ? countArg.split('=')[1] : 3) || 3;
const BASE = process.env.VITE_MEDIA_BASE_URL || 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev';

const queueFile = path.join(CONTENT, 'photo-queue.json');
const postedFile = path.join(CONTENT, 'photo-posts.json');
const queue = fs.existsSync(queueFile) ? JSON.parse(fs.readFileSync(queueFile, 'utf8')) : [];
const posted = fs.existsSync(postedFile) ? JSON.parse(fs.readFileSync(postedFile, 'utf8')) : [];
const claimed = new Set([...queue, ...posted].map((x) => x.topic).filter(Boolean));
const usedPhotoUrls = new Set([...queue, ...posted].map((x) => x.sourceUrl).filter(Boolean));

const topics = JSON.parse(fs.readFileSync(path.join(CONTENT, 'library', 'topics.json'), 'utf8'));
const PY = process.env.LIB_PY || 'python3';
const CARD_PY = path.join(REPO, 'media', 'tools', 'photo_card.py');

async function scriptFor(topicId) {
  const local = path.join(CONTENT, 'youtube', `${topicId}.json`);
  try { return JSON.parse(fs.readFileSync(local, 'utf8')); } catch {}
  try { return await (await fetch(`${BASE}/render-state/content/youtube/${topicId}.json`)).json(); } catch { return null; }
}

async function qualityCheck(url) {
  try { return JSON.parse(execFileSync(PY, [CARD_PY, '--check', url], { encoding: 'utf8' }).trim().split('\n').pop()); }
  catch { return { ok: false, reasons: ['could not check'] }; }
}

async function judgeCard(cardPath, facts, hook, article) {
  return askJson([
    { text: `A reasonable quality check (not strict) for a history page. The picture is supposed to show: """${facts}"""
Hook: """${hook}"""\nArticle: """${article}"""
Fail it ONLY if something would genuinely embarrass the page: the picture clearly does NOT show that object or scene; a real
person's face is clearly visible in the background; a museum label is the main thing in frame; the article states something
the facts plainly contradict. Minor things (a plain background, an ordinary photo, a short article) are fine.
Return JSON {"pass": true|false, "score": 1-10, "reasons": ["..."]}` },
    { inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(cardPath).toString('base64') } },
  ], { temperature: 0 });
}

async function uploadCard(cardPath, key) {
  execFileSync('aws', ['s3', 'cp', cardPath, `s3://${process.env.R2_BUCKET}/${key}`, '--endpoint-url',
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--content-type', 'image/jpeg', '--no-progress'], { stdio: 'inherit' });
  return `${BASE}/${key}`;
}

let made = 0;
for (const topicId of Object.keys(topics)) {
  if (made >= count) break;
  if (claimed.has(topicId)) continue;
  const script = await scriptFor(topicId);
  const lines = (script?.chapters || []).flatMap((c) => (c.lines || []).map((l) => l.en).filter(Boolean));
  if (lines.length < 3) { console.log(`[prep] ${topicId}: no finished story yet, skipped`); continue; }

  const beat = await askJson(`From this true story about ancient Egypt, pick the SINGLE most shareable, surprising moment — the
one detail that makes people stop scrolling. Write a Facebook/Instagram post about just that moment: a medium length piece,
not a one-liner and not an essay — a hook line, then exactly 3 short paragraphs of 2 sentences each. Use ONLY facts in the
text below; never invent a date, name or number.
Story:
"""${lines.join('\n')}"""
Return JSON {"hook": "one short specific opening line or question",
"article": ["paragraph 1: the single most surprising fact", "paragraph 2: more real context, a different fact", "paragraph 3: why it matters today or how it would feel to see it in person"],
"words": "2 to 5 big words for the picture card, no place or person names",
"searchQuery": "a precise English search phrase for a real museum photo of the exact object or scene this moment is about",
"engage": "one short, specific question tied to THIS exact story that invites a real comment (never 'like if' or 'tag a friend', a genuine question only, e.g. what they would have done, or what detail surprised them)",
"tags": ["3 to 5 hashtags without #"]}`);
  if (!beat?.article || !beat?.searchQuery) { console.log(`[prep] ${topicId}: no usable moment found yet, trying again later`); continue; }
  const article = (Array.isArray(beat.article) ? beat.article : [beat.article]).join('\n\n');
  const facts = lines.join(' ').slice(0, 1500);
  const words = String(beat.words).slice(0, 40);
  const card = path.join(REPO, `prep-${topicId}.jpg`);

  // ── a real photo of that exact scene first; our own topic search phrases as a backup ──
  const queries = [beat.searchQuery, ...(topics[topicId].queries || []).slice(0, 2)];
  let pick = null;
  outer:
  for (const q of queries) {
    const found = await findOpenPhoto(q, 6).catch(() => []);
    for (const cand of found) {
      if (usedPhotoUrls.has(cand.source_url)) continue;
      const m = await qualityCheck(cand.url);
      if (m.ok) { pick = cand; break outer; }
    }
  }

  let isAI = false;
  if (pick) {
    execFileSync(PY, [CARD_PY, pick.url, words, card], { stdio: 'inherit' });
  } else {
    console.log(`[prep] ${topicId}: no real open-license photo found, asking Nano Banana for one`);
    const img = await generateImage(`A realistic, respectful museum-style photo of: ${beat.searchQuery}. Ancient Egyptian
setting, natural lighting, no text, no watermark, no people's faces. A believable photograph, not a cartoon or painting.`);
    if (!img) { console.log(`[prep] ${topicId}: Nano Banana did not answer, trying again next run`); continue; }
    const raw = path.join(REPO, `prep-raw-${topicId}.${img.mime.includes('png') ? 'png' : 'jpg'}`);
    fs.writeFileSync(raw, Buffer.from(img.base64, 'base64'));
    execFileSync(PY, [CARD_PY, raw, words, card, '--ai'], { stdio: 'inherit' });
    isAI = true;
  }

  const judge = await judgeCard(card, facts, beat.hook, article);
  console.log(`[prep] ${topicId}: ${judge ? `${judge.pass ? 'pass' : 'fail'} ${judge.score}/10 ${(judge.reasons || []).join('; ')}` : 'no answer'}`);
  if (!judge?.pass || judge.score < 6) { console.log(`[prep] ${topicId}: did not pass, trying again later`); continue; }

  if (dry) { console.log(`[prep] ${topicId}: would queue (dry run)`); made++; continue; }
  const day = new Date().toISOString().slice(0, 10);
  const cardUrl = await uploadCard(card, `prep/photo/${topicId}-${day}.jpg`);
  queue.push({
    topic: topicId, queuedAt: new Date().toISOString(), hook: beat.hook, article: beat.article, words, tags: beat.tags || [],
    engage: beat.engage || null, cardUrl, isAI, sourceUrl: pick?.source_url || null, author: pick?.author || null, license: pick?.license || null,
  });
  fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
  claimed.add(topicId);
  if (pick?.source_url) usedPhotoUrls.add(pick.source_url);
  made++;
  console.log(`[prep] ${topicId}: queued${isAI ? ' (AI reconstruction)' : ''}`);
}
console.log(`[prep] done: ${made} queued this run, ${queue.length} waiting to be published`);
