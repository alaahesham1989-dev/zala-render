// Articles on the zalavip.com blog, added by the server with no deploy: R2 blog/auto.json, read by the site's /api/blog-auto.
// One article per episode (the story, its pictures and the YouTube video), shown from the day the episode goes public,
// and one per daily picture post (photo-post.mjs calls addArticle). Arabic comes from Gemini; English stays when Gemini is busy.
// Usage: node media/tools/blog-feed.mjs episode <episode id>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { askJson } from './gemini-lite.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..');
const CONTENT = path.join(REPO, 'content');
const BASE = process.env.VITE_MEDIA_BASE_URL || 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev';
const E = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3 = (...a) => execFileSync('aws', ['s3', ...a, '--endpoint-url', E, '--no-progress'], { stdio: 'pipe' });
const cairoDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
export const slugOf = (t) => String(t).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

/** Adds or replaces one article (by slug) in blog/auto.json on R2. */
export async function addArticle(article) {
  const tmp = path.join(REPO, 'blog-auto.json');
  let feed = { posts: [] };
  try { s3('cp', `s3://${process.env.R2_BUCKET}/blog/auto.json`, tmp); feed = JSON.parse(fs.readFileSync(tmp, 'utf8')); } catch { /* first article */ }
  // an episode's article replaces its older version even when the slug changed
  const { replaces, ...clean } = article;
  feed.posts = [...(feed.posts || []).filter((p) => p.slug !== clean.slug && p.slug !== replaces && !(clean.episode && p.episode === clean.episode)), clean];
  fs.writeFileSync(tmp, JSON.stringify(feed));
  s3('cp', tmp, `s3://${process.env.R2_BUCKET}/blog/auto.json`, '--content-type', 'application/json; charset=utf-8', '--cache-control', 'public, max-age=300');
  console.log(`[blog] ${clean.date} ${clean.slug} (${feed.posts.length} automatic articles)`);
}

/** English article → the same article with Arabic, in one Gemini answer. */
export async function withArabic(title, excerpt, body) {
  const strings = body.map((b) => (typeof b === 'string' ? b : b.h || null));
  const ans = await askJson(`Translate this blog article about Ancient Egypt into elegant Modern Standard Arabic. Keep names correct. Return JSON {"title":"","excerpt":"","items":["..."]} with "items" in the same order and count; keep null as null.
${JSON.stringify({ title, excerpt, items: strings })}`, { temperature: 0.2 });
  const ok = ans && Array.isArray(ans.items) && ans.items.length === strings.length;
  const ar = body.map((b, i) => (typeof b === 'string' ? (ok && ans.items[i]) || b : b.h ? { h: (ok && ans.items[i]) || b.h } : b));
  return { title: { en: title, ar: (ok && ans.title) || title }, excerpt: { en: excerpt, ar: (ok && ans.excerpt) || excerpt }, body: { en: body, ar } };
}

// words of a phrase without the possessive 's, so "Tutankhamun's" and "tutankhamun" count as one word
const topicWords = (t) => String(t).toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2);

async function episode(id) {
  const script = JSON.parse(fs.readFileSync(path.join(CONTENT, 'youtube', `${id}.json`), 'utf8'));
  const items = new Map(fs.readFileSync(path.join(CONTENT, 'library', 'items.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((i) => [i.id, i]));
  const plan = fs.existsSync(path.join(CONTENT, 'schedule.json')) ? JSON.parse(fs.readFileSync(path.join(CONTENT, 'schedule.json'), 'utf8')) : [];
  const main = plan.find((p) => p.episode === id && p.which === 'main');
  const video = String(main?.youtube || '').match(/(?:youtu\.be\/|v=)([\w-]{11})/)?.[1];
  const credit = (i) => [i.author, i.license].filter(Boolean).join(', ');
  const used = new Set();
  const body = [];
  for (const c of script.chapters) {
    body.push({ h: c.title });
    const lines = c.lines.map((l) => l.en).filter(Boolean);
    for (let k = 0; k < lines.length; k += 3) body.push(lines.slice(k, k + 3).join(' '));
    // one picture per chapter, a real image from the library (never a video clip or title scene)
    const pic = c.lines.flatMap((l) => l.pictures || []).map((p) => items.get(p)).find((i) => i && i.kind === 'image' && !used.has(i.id) && String(i.url).startsWith('http'));
    if (pic) { used.add(pic.id); body.splice(body.length - Math.min(2, Math.ceil(lines.length / 3)), 0, { img: pic.url, credit: credit(pic) }); }
  }
  // SEO: what people really type into Google about this subject (Google's own free suggestions), then one keyword,
  // a title and description built around it, and a short FAQ from the story's own facts (questions people ask).
  const topic = (script.title.split(':')[0] || script.title).trim();
  const ideas = [];
  for (const q of [topic, `${topic} facts`, `${topic} treasure`]) {
    try { ideas.push(...(await (await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(q)}`)).json())[1]); } catch { /* no suggestions */ }
  }
  const facts = script.chapters.flatMap((c) => c.lines.map((l) => l.en)).join(' ').slice(0, 9000);
  const seo = await askJson(`You are an SEO editor for a history blog read in the USA. Article topic: "${script.title}".
Real Google searches about it: ${JSON.stringify([...new Set(ideas)].slice(0, 25))}
The article's facts: """${facts}"""
Pick the one main keyword with the clearest search intent from the real searches. Return JSON:
{"keyword": "...", "title": "SEO title, max 60 characters, starts with or contains the keyword, still exciting",
"description": "meta description, 140 to 155 characters, contains the keyword, makes people click",
"faq": [{"q": "a question people really search (use the real searches), rewritten in correct English with names capitalised (Abu Simbel, Tutankhamun)", "a": "a 1 to 2 sentence answer using ONLY the article's facts"}] (3 or 4 items; skip any question the facts cannot answer)}`, { temperature: 0.3 });
  if (seo?.faq?.length) {
    body.push({ h: 'Frequently asked questions' });
    for (const f of seo.faq.slice(0, 4)) { const q = String(f.q).trim(); body.push({ h: q[0].toUpperCase() + q.slice(1).replace(/([^?])$/, "$1?") }); body.push(f.a); }
  }
  const title = String(seo?.title || script.title).slice(0, 70);
  const excerpt = String(seo?.description || String(script.description || '').split(/(?<=[.!?])\s/).slice(0, 2).join(' ')).slice(0, 160);
  console.log(`[blog] keyword: ${seo?.keyword || '-'} | ${title}`);
  const tr = await withArabic(title, excerpt, body);
  await addArticle({
    slug: slugOf(seo?.keyword ? (topicWords(topic).every((w) => topicWords(seo.keyword).includes(w)) ? seo.keyword : `${seo.keyword} ${topic}`) : script.title), date: cairoDay(main?.at || Date.now()),
    image: { url: `${BASE}/renders/${id}/publish/${id}_thumbnail.jpg`, credit: 'ZALA VIP' },
    cta: { to: '/egypt/booking', ar: 'خطط رحلتك إلى مصر مع زالا', en: 'Plan your Egypt trip with ZALA VIP' },
    episode: id, replaces: slugOf(script.title), ...tr, ...(video ? { video } : {}),
  });
}

if (process.argv[2] === 'episode') await episode(process.argv[3]);
