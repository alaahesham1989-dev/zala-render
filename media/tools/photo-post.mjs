// One picture post a day on Facebook and Instagram: a treasure from the library, a card with a few big words,
// a short caption (one true fact from the picture's own notes + a question that invites comments), credits in the first comment.
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

// ── pick the picture ──
const items = fs.readFileSync(path.join(CONTENT, 'library', 'items.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const used = new Set(state.map((s) => s.id));
const shiny = /gold|treasure|jewel|mask|coffin|necklace|pectoral|crown|bracelet|scarab|dagger|throne|statue|amulet|ring|collar|diadem/i;
const textOf = (i) => `${i.title} ${i.seen?.what || ''} ${i.note || ''}`;
// old glass slides, scans and archive photos look poor on a card: only real colour photographs of the object
const oldScan = /ETH-BIB|\bDia\b|lantern|\bslide\b|postcard|photograph|negative|glass plate|\.tif\b|archive|1920s|black and white|engraving|drawing|lithograph|replica|reproduction|copy|souvenir|modern/i;
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
// then Gemini looks at the finished card and the words. Only a card that passes both is posted; up to 10 tries a day.
let pick, ans, words, caption, credit;
// measure up to 40 pictures, then send the best-looking ones to the eye check first
const measured = [];
for (const cand of pool.slice(0, 40)) {
  let m;
  try { m = JSON.parse(execFileSync(PY, [CARD_PY, '--check', cand.url], { encoding: 'utf8' }).trim().split('\n').pop()); } catch { continue; }
  if (!m.ok) { console.log(`[qc] ${cand.id} refused by the numbers: ${m.reasons.join(', ')}`); used.add(cand.id); continue; }
  measured.push({ cand, score: m.colour + m.contrast * 0.5 + m.sharp * 2 + Math.min(m.w, m.h) / 100 });
}
measured.sort((a, b) => b.score - a.score);
for (const { cand } of measured.slice(0, 10)) {
  const facts = [cand.title, cand.seen?.what, cand.note].filter(Boolean).join('\n');
  const a = await askJson(`You write one social media picture post for an Ancient Egypt history page (audience: Americans who love history and treasure).
Use ONLY facts found in this text about the picture; never invent dates, names or numbers:
"""${facts}"""
Return JSON: {"words": "2 to 5 big words for the picture, a hook, no place or person names, e.g. 3,300 YEARS OF GOLD",
"caption": "two short sentences: one surprising true fact from the text, then one simple question that makes people comment (an opinion or a guess, e.g. Would you wear it?). No hashtags, no links, no emojis except at most one.",
"tags": ["3 to 5 hashtags without #"],
"title": "a blog title of 5 to 10 words about this object",
"story": ["2 or 3 short paragraphs for a blog post about this object, using only the facts in the text, simple words"]}`);
  if (!a?.caption || !a?.words) { console.log('[qc] Gemini gave no words, trying later'); break; }
  const w = String(a.words).slice(0, 40);
  execFileSync(PY, [CARD_PY, cand.url, w, card], { stdio: 'inherit' });
  const judge = await askJson([
    { text: `You are a strict quality controller for a premium history page. Look at this finished post card and its caption.
The picture is supposed to show: """${facts}"""
Caption: """${a.caption}"""
Fail it if ANY of these is true: the picture does not clearly show that object; it is dull, washed out, yellowed, blurry, low resolution or badly cropped (the object cut off);
it is an old slide, scan, drawing or black-and-white photo; there are watermarks, museum labels, modern people or handwriting; the big words on the card are hard to read, cover the object's face, or are wrong English;
the caption says something the text does not support or has a mistake; the caption is vague or boring (it must give one specific, surprising fact);
the object is a replica, copy or souvenir. Be strict: only a picture that would make people stop scrolling passes.
Return JSON {"pass": true|false, "score": 1-10, "reasons": ["..."]}` },
    { inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(card).toString('base64') } },
  ], { temperature: 0 });
  console.log(`[qc] ${cand.id} ${cand.title}: ${judge ? `${judge.pass ? 'pass' : 'fail'} ${judge.score}/10 ${(judge.reasons || []).join('; ')}` : 'no answer'}`);
  if (judge?.pass && judge.score >= 8) { pick = cand; ans = a; words = w; break; }
  if (judge) used.add(cand.id);   // refused pictures are not tried again on another day
}
const refused = pool.filter((c) => used.has(c.id) && !state.some((s) => s.id === c.id)).map((c) => c.id);
if (refused.length && !dry) state.push(...refused.map((id) => ({ id, refused: true, at: new Date().toISOString() })));
if (!pick) {
  if (!dry) fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  console.log('[photo] no picture passed quality control today, nothing posted');
  process.exit(0);
}
const tags = ['AncientEgypt', 'Egypt', 'History', ...(ans?.tags || [])].map((t) => '#' + String(t).replace(/[^A-Za-z0-9]/g, '')).filter((t, i, a) => t.length > 2 && a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i).slice(0, 6).join(' ');
caption = `${ans.caption}\n\n${tags}`;
credit = `Photo: ${pick.author || 'unknown'}${pick.license ? `, ${pick.license}` : ''}${pick.source_url ? ` (${pick.source_url})` : ''}`;
console.log(`[photo] ${pick.id} ${pick.title}\n[photo] words: ${words}\n[photo] caption: ${caption}\n[photo] ${credit}`);

const key = `posts/${day}-${pick.id}.jpg`;
if (dry) { console.log('[photo] dry run, nothing posted'); process.exit(0); }
execFileSync('aws', ['s3', 'cp', card, `s3://${process.env.R2_BUCKET}/${key}`, '--endpoint-url', `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--content-type', 'image/jpeg', '--no-progress'], { stdio: 'inherit' });
const imageUrl = `${BASE}/${key}`;

const done = { id: pick.id, at: new Date().toISOString(), words, caption, image: imageUrl, credit };   // shown on zalavip.com/credits
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

// the same post on the zalavip.com blog
try {
  const paras = (Array.isArray(ans?.story) ? ans.story : [ans?.caption || pick.title]).map(String).filter(Boolean);
  const title = String(ans?.title || pick.title).slice(0, 120);
  const tr = await withArabic(title, String(ans?.caption || '').split('?')[0], [...paras, String(ans?.caption || '').match(/[^.!]*?/)?.[0]?.trim() || ''].filter(Boolean));
  await addArticle({ slug: `${slugOf(title)}-${day}`, date: day, image: { url: imageUrl, credit: pick.author || '', license: pick.license || '', sourceUrl: pick.source_url || '' },
    cta: { to: '/egypt/booking', ar: 'خطط رحلتك إلى مصر مع زالا', en: 'Plan your Egypt trip with ZALA VIP' }, ...tr });
  done.blog = true;
} catch (e) { console.log('[photo] blog failed:', e.message); }

state.push(done);
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
console.log(`PHOTO_RESULT:${JSON.stringify(done)}`);
