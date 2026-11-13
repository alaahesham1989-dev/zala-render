// One picture post a day on Facebook and Instagram — a standalone piece, nothing to do with the video schedule.
// Owner's order: not a quick question-and-answer under a photo. A short, real ARTICLE people actually read for the
// information (a hook line, 3 short paragraphs of real facts, then a reason to watch/read more and to follow the page),
// under a professional photo card. The same article also becomes its own page on the zalavip.com blog.
// Runs on the server (photos.yml). State: content/photo-posts.json (in git), so a picture is never posted twice.
// Usage: node media/tools/photo-post.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { askJson } from './gemini-lite.mjs';
import { addArticle, withArabic, slugOf } from './blog-feed.mjs';

const dry = process.argv.includes('--dry');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..');
const CONTENT = path.join(REPO, 'content');
const G = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const PAGE = process.env.FB_PAGE_ID || '108172631323930';
const IG = process.env.IG_ACCOUNT_ID || '17841480123002919';
const BASE = process.env.VITE_MEDIA_BASE_URL || 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev';
const SITE = 'https://www.zalavip.com';
const stateFile = path.join(CONTENT, 'photo-posts.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, { method = 'GET', params = {}, token = TOKEN } = {}) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET' ? await fetch(`${url}${url.includes('?') ? '&' : '?'}${body}`) : await fetch(url, { method, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Meta refused ${url.replace(G, '')}: ${data.error?.message || res.status}`);
  return data;
}

// the object's own words: "Pectoral of Sithathoryunet MET 16.1.3 back" -> pectoral, sithathoryunet
const GENERIC = /^(egyptian|egypt|ancient|museum|museo|egizio|metropolitan|walters|exhibition|exhib|collection|photo|image|front|back|detail|side|view|with|from|the|and|name)$/i;
const cleanTitle = (t) => String(t).replace(/\(.*?\)|\bMET\b[\d.\s]*|\b[A-Z]{1,3}\s?\d[\w.]*|\d{3,}|DSC\s*\d+|\b20\d\d\b|[-_,]/g, ' ').replace(/\s+/g, ' ').trim();
const keyWords = (t) => cleanTitle(t).split(' ').filter((w) => w.length > 5 && !GENERIC.test(w)).map((w) => w.toLowerCase());

/** Lines of our own episode story (facts checked by the editor) that talk about this object. */
function storyFacts(cand) {
  const words = keyWords(cand.title);
  if (!words.length) return '';
  const out = [];
  for (const t of cand.topics || []) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(CONTENT, 'youtube', `${t}.json`), 'utf8'));
      for (const l of (s.chapters || []).flatMap((c) => c.lines || [])) if (l.en && words.some((w) => l.en.toLowerCase().includes(w))) out.push(l.en);
    } catch { /* no script */ }
  }
  return out.length ? `From our checked episode story:\n${out.slice(0, 6).join('\n')}` : '';
}

/** A short Wikipedia extract about the object itself (an article that shares one of its words), so the article has real facts. */
async function wikiFacts(title) {
  try {
    const term = cleanTitle(title).slice(0, 90);
    const words = keyWords(title);
    const h = { headers: { 'user-agent': 'zala-render/1.0' } };
    const sr = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(term)}`, h)).json();
    const t = (sr?.query?.search || []).map((x) => x.title).find((x) => words.some((w) => x.toLowerCase().includes(w.slice(0, 7)))); if (!t) return '';
    const ex = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles=${encodeURIComponent(t)}`, h)).json();
    const p = Object.values(ex?.query?.pages || {})[0];
    return p?.extract ? `From Wikipedia (${t}): ${p.extract.slice(0, 1200)}` : '';
  } catch { return ''; }
}

/** The episode this picture belongs to, if that episode's video is already public (so the post can send people to watch it). */
function videoFor(cand) {
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(CONTENT, 'schedule.json'), 'utf8'));
    for (const t of cand.topics || []) {
      const m = plan.find((p) => p.episode === t && p.which === 'main' && p.youtube && Date.parse(p.at) < Date.now());
      if (m) return { episode: t, youtube: m.youtube };
    }
  } catch { /* no plan yet */ }
  return null;
}

/** The episode's own blog article, if the factory has already written one (so the "read more" button is a real page, not a raw external link). */
async function episodeBlogSlug(episodeId) {
  if (!episodeId) return null;
  try {
    const feed = await (await fetch(`${BASE}/blog/auto.json`)).json();
    return (feed.posts || feed || []).find((x) => x.episode === episodeId)?.slug || null;
  } catch { return null; }
}

/** Builds the post as a short real article: hook, 3 fact paragraphs, then watch/read more + follow + the site. */
function buildCaption(a, { videoUrl, blogUrl, tags }) {
  const article = (Array.isArray(a.article) ? a.article : [a.article]).filter(Boolean).join('\n\n');
  const more = videoUrl ? `🎥 Watch the full story: ${videoUrl}` : `📖 Read the full story: ${blogUrl}`;
  return [a.hook, article, more, '🔔 Follow us for a true story from Ancient Egypt every day.', `🌐 ${SITE}`, tags].filter(Boolean).join('\n\n');
}

// ── pick the picture ──
const items = fs.readFileSync(path.join(CONTENT, 'library', 'items.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const used = new Set(state.map((s) => s.id));
const shiny = /gold|treasure|jewel|mask|coffin|necklace|pectoral|crown|bracelet|scarab|dagger|throne|statue|amulet|ring|collar|diadem/i;
const textOf = (i) => `${i.title} ${i.seen?.what || ''} ${i.note || ''}`;
// old glass slides, scans and archive photos look poor on a card: only real colour photographs of the object
const oldScan = /ETH-BIB|\bDia\b|lantern|\bslide\b|postcard|photograph|negative|glass plate|\.tif\b|archive|1920s|black and white|engraving|drawing|lithograph|replica|reproduction|copy|souvenir|modern/i;
const pool = items.filter((i) => i.kind === 'image' && String(i.url).startsWith(BASE) && !used.has(i.id)
  && i.seen?.usable !== false && !i.seen?.check?.modern && !i.seen?.check?.nude && shiny.test(textOf(i)) && !oldScan.test(`${textOf(i)} ${i.source_url || ''}`)
  && ((i.topics || []).some((t) => /^ZV-T/.test(t)) || /\/vault\/library\/ZV-T/.test(i.url)));
if (!pool.length) { console.log('[photo] no unused treasure picture left'); process.exit(0); }
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

const PY = process.env.LIB_PY || 'python3';
const CARD_PY = path.join(REPO, 'media', 'tools', 'photo_card.py');
const day = new Date().toISOString().slice(0, 10);
const card = path.join(REPO, `post-${day}.jpg`);

// ── quality control, like the reviewer for the videos: numbers first (size, colour, light, sharpness, frames),
// then Gemini looks at the finished card and the article. Only a card that passes both is posted; up to 10 tries a day.
let pick, ans, words, caption, credit, videoUrl, title, slug;
// measure up to 40 pictures, then send the best-looking ones to the eye check first
const measured = [];
for (const cand of pool.slice(0, 40)) {
  let m;
  try { m = JSON.parse(execFileSync(PY, [CARD_PY, '--check', cand.url], { encoding: 'utf8' }).trim().split('\n').pop()); } catch { continue; }
  if (!m.ok) { console.log(`[qc] ${cand.id} refused by the numbers: ${m.reasons.join(', ')}`); used.add(cand.id); continue; }
  // clean studio photos from the museums' open collections go first
  const museum = /metmuseum|clevelandart|walters|smithsonian|si\.edu/i.test(`${cand.source_url || ''} ${cand.license || ''} ${cand.title}`) ? 25 : 0;
  measured.push({ cand, score: museum + m.colour + m.contrast * 0.5 + m.sharp * 2 + Math.min(m.w, m.h) / 100 });
}
measured.sort((a, b) => b.score - a.score);
let judged = 0;
for (const { cand } of measured.slice(0, 30)) {
  const wiki = await wikiFacts(cand.title);
  const story = storyFacts(cand);
  if (!story && !wiki) { console.log(`[qc] ${cand.id} ${cand.title}: no real facts found about it yet, kept for later`); continue; }
  if (++judged > 10) break;   // at most 10 full checks a day
  const facts = [cand.title, cand.seen?.what, cand.note, story, wiki].filter(Boolean).join('\n');
  const a = await askJson(`You write a short, real ARTICLE for a Facebook and Instagram history page (audience: Americans who love history and treasure),
to be read under a photo. This is NOT a quick caption or a question-and-answer: it is a small piece of writing people actually read to learn
something, so they follow the page for more. Use ONLY facts found in this text; never invent dates, names or numbers:
"""${facts}"""
Write for curious readers, not scholars: skip bibliographic details (whose dictionary, whose textbook, which exercise number, how many authors cite it) and
skip exact findspot/excavation bookkeeping unless it IS the surprise. Each paragraph makes its own point; never repeat the same number or phrase from an
earlier paragraph. Paragraph 3 must connect to the reader today (what it would feel like, what it still means, a question to picture), not a trivia aside.
Return JSON: {"words": "2 to 5 big words for the picture card, a hook, no place or person names, e.g. 3,300 YEARS OF GOLD",
"hook": "one short, specific opening line or question that makes people stop scrolling (not generic)",
"article": ["paragraph 1 (2 to 3 sentences): the single most surprising true fact about this object", "paragraph 2 (2 to 3 sentences): more real context or history behind it, a different fact than paragraph 1", "paragraph 3 (1 to 2 sentences): why it still matters or how it would feel to see it in person, not a citation or trivia aside"],
"tags": ["3 to 5 hashtags without #"],
"title": "a blog article title of 5 to 10 words about this object"}`);
  if (!a?.article || !a?.words || !a?.hook) { console.log('[qc] Gemini gave no words, trying later'); break; }
  let w = String(a.words).slice(0, 40);
  execFileSync(PY, [CARD_PY, cand.url, w, card], { stdio: 'inherit' });
  const article = (Array.isArray(a.article) ? a.article : [a.article]).join('\n\n');
  const judge = await askJson([
    { text: `You are a strict quality controller for a premium history page. Look at this finished post card and the article written to go under it.
The picture is supposed to show: """${facts}"""
Hook: """${a.hook}"""
Article: """${article}"""
Fail it if ANY of these is true: the picture does not clearly show that object; it is dull, washed out, yellowed, blurry, low resolution or badly cropped (the object cut off);
it is an old slide, scan, drawing or black-and-white photo; there are watermarks, museum labels, modern people or handwriting; the big words on the card are hard to read, cover the object's face, or are wrong English;
the article says something the text does not support, has a mistake, or reads like a quick caption instead of real writing (fewer than 3 short paragraphs of real facts, or mostly a question with no information);
the object is a replica, copy or souvenir. Be strict: only a picture and an article that would make people stop scrolling, read, and follow the page pass.
Return JSON {"pass": true|false, "score": 1-10, "pictureOk": true|false (false only for a problem with the picture itself), "reasons": ["..."]}` },
    { inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(card).toString('base64') } },
  ], { temperature: 0 });
  console.log(`[qc] hook: ${a.hook}`);
  console.log(`[qc] article: ${article}`);
  console.log(`[qc] ${cand.id} ${cand.title}: ${judge ? `${judge.pass ? 'pass' : 'fail'} ${judge.score}/10 ${(judge.reasons || []).join('; ')}` : 'no answer'}`);
  if (judge?.pass && judge.score >= 8) { pick = cand; ans = a; words = w; break; }
  // the picture is fine and only the writing is weak: rewrite it from the reviewer's notes and check once more
  if (judge && judge.pictureOk) {
    const fix = await askJson(`Rewrite this Facebook/Instagram article. Reviewer notes: ${(judge.reasons || []).join('; ')}
It must read like a short real article (a hook line, then 3 short paragraphs of real facts, 2 to 3 sentences each), never a quick caption or a bare question.
Write for curious readers, not scholars: skip bibliographic details and exact findspot bookkeeping. Each paragraph makes its own point; never repeat a
number or phrase from an earlier paragraph. Paragraph 3 connects to the reader today, not a citation or trivia aside.
Use ONLY facts from this text: """${facts}"""
The big words on the card now: "${w}".
Return JSON {"hook": "one short specific opening line or question",
"article": ["paragraph 1: the single most surprising fact", "paragraph 2: more real context, a different fact than paragraph 1", "paragraph 3: why it matters today or how it would feel to see it in person"],
"words": "the big words for the card, 2 to 5 words, correct English spelling (keep them if they were fine), no place or person names"}`);
    if (fix?.article) {
      const fw = String(fix.words || w).slice(0, 40);
      if (fw !== w) { w = fw; execFileSync(PY, [CARD_PY, cand.url, w, card], { stdio: 'inherit' }); }
      const fixedArticle = (Array.isArray(fix.article) ? fix.article : [fix.article]).join('\n\n');
      const again = await askJson([{ text: `Strict quality check of a history-page post card and its article. Facts: """${facts}"""
Hook: """${fix.hook || a.hook}"""
Article: """${fixedArticle}"""
Fail it if the article says anything the facts do not support, or if it is not at least 3 short paragraphs of real facts (not a bare caption or question),
or if the big words on the card are misspelled, wrong English or hard to read.
Return JSON {"pass": true|false, "score": 1-10, "reasons": ["..."]}` },
      { inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(card).toString('base64') } }], { temperature: 0 });
      console.log(`[qc] ${cand.id} article rewritten: ${again ? `${again.pass ? 'pass' : 'fail'} ${again.score}/10` : 'no answer'}`);
      if (again?.pass && again.score >= 8) { pick = cand; ans = { ...a, hook: fix.hook || a.hook, article: fix.article }; words = w; break; }
    }
    continue;   // a good picture stays for another day
  }
  if (judge) used.add(cand.id);   // refused pictures are not tried again on another day
}
const refused = pool.filter((c) => used.has(c.id) && !state.some((s) => s.id === c.id)).map((c) => c.id);
if (refused.length && !dry) state.push(...refused.map((id) => ({ id, refused: true, at: new Date().toISOString() })));
if (!pick) {
  if (!dry) fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  console.log('[photo] no picture passed quality control today, nothing posted');
  process.exit(0);
}
title = String(ans?.title || pick.title).slice(0, 120);
slug = `${slugOf(title)}-${day}`;
const video = videoFor(pick);
videoUrl = video?.youtube || null;
const episodeSlug = await episodeBlogSlug(video?.episode);
const tags = ['AncientEgypt', 'Egypt', 'History', ...(ans?.tags || [])].map((t) => '#' + String(t).replace(/[^A-Za-z0-9]/g, '')).filter((t, i, a) => t.length > 2 && a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i).slice(0, 5).join(' ');
caption = buildCaption(ans, { videoUrl, blogUrl: `${SITE}/blog/${slug}`, tags });
// kept for our own log and the blog's small image credit line only — owner's standing order: never a comment or any
// mention of the source on Facebook or Instagram, not even in a reply. The post itself talks about the object only.
credit = `Photo: ${pick.author || 'unknown'}${pick.license ? `, ${pick.license}` : ''}${pick.source_url ? ` (${pick.source_url})` : ''}`;
console.log(`[photo] ${pick.id} ${pick.title}\n[photo] words: ${words}\n[photo] caption:\n${caption}\n[photo] (not posted) ${credit}`);

const key = `posts/${day}-${pick.id}.jpg`;
if (dry) { console.log('[photo] dry run, nothing posted'); process.exit(0); }
execFileSync('aws', ['s3', 'cp', card, `s3://${process.env.R2_BUCKET}/${key}`, '--endpoint-url', `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--content-type', 'image/jpeg', '--no-progress'], { stdio: 'inherit' });
const imageUrl = `${BASE}/${key}`;

const done = { id: pick.id, at: new Date().toISOString(), words, caption, image: imageUrl, blogSlug: slug };
// Facebook
try {
  const { access_token: pageToken } = await call(`${G}/${PAGE}?fields=access_token`);
  const fb = await call(`${G}/${PAGE}/photos`, { method: 'POST', token: pageToken, params: { url: imageUrl, message: caption, published: 'true' } });
  done.fb = fb.post_id || fb.id;
  console.log('[photo] facebook', done.fb);
} catch (e) { done.fbError = e.message; console.log('[photo] facebook failed:', e.message); }
// Instagram
try {
  const box = await call(`${G}/${IG}/media`, { method: 'POST', params: { image_url: imageUrl, caption } });
  for (let i = 0; i < 20; i++) { const s = await call(`${G}/${box.id}?fields=status_code`); if (s.status_code === 'FINISHED') break; await sleep(5000); }
  const pub = await call(`${G}/${IG}/media_publish`, { method: 'POST', params: { creation_id: box.id } });
  done.ig = pub.id;
  console.log('[photo] instagram', done.ig);
} catch (e) { done.igError = e.message; console.log('[photo] instagram failed:', e.message); }

// the same article on its own zalavip.com blog page: the hook as the lead line, then the 3 fact paragraphs,
// then a link to the full episode video when one is public, else an invitation to plan a trip
try {
  const paras = [ans.hook, ...(Array.isArray(ans.article) ? ans.article : [ans.article])].map(String).filter(Boolean);
  const excerpt = String(ans.article?.[0] || ans.hook || '').slice(0, 160);
  const tr = await withArabic(title, excerpt, paras);
  // the video (when public) is embedded right on the page; the button is always an internal link —
  // to the episode's own full-story article when one exists, else to plan a trip
  await addArticle({
    slug, date: day, image: { url: imageUrl, credit: pick.author || '', license: pick.license || '', sourceUrl: pick.source_url || '' },
    cta: episodeSlug ? { to: `/blog/${episodeSlug}`, ar: 'اقرأ قصة الحلقة كاملة', en: 'Read the full episode story' }
      : { to: '/egypt/booking', ar: 'خطط رحلتك إلى مصر مع زالا', en: 'Plan your Egypt trip with ZALA VIP' },
    ...(videoUrl ? { video: String(videoUrl).match(/(?:youtu\.be\/|v=)([\w-]{11})/)?.[1] } : {}),
    ...tr,
  });
  done.blog = true;
} catch (e) { console.log('[photo] blog failed:', e.message); }

state.push(done);
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
console.log(`PHOTO_RESULT:${JSON.stringify(done)}`);
