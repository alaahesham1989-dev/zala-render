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
  feed.posts = [...(feed.posts || []).filter((p) => p.slug !== article.slug), article];
  fs.writeFileSync(tmp, JSON.stringify(feed));
  s3('cp', tmp, `s3://${process.env.R2_BUCKET}/blog/auto.json`, '--content-type', 'application/json; charset=utf-8', '--cache-control', 'public, max-age=300');
  console.log(`[blog] ${article.date} ${article.slug} (${feed.posts.length} automatic articles)`);
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
  const excerpt = String(script.description || '').split(/(?<=[.!?])\s/).slice(0, 2).join(' ');
  const tr = await withArabic(script.title, excerpt, body);
  await addArticle({
    slug: slugOf(script.title), date: cairoDay(main?.at || Date.now()),
    image: { url: `${BASE}/renders/${id}/publish/${id}_thumbnail.jpg`, credit: 'ZALA VIP' },
    cta: { to: '/egypt/booking', ar: 'خطط رحلتك إلى مصر مع زالا', en: 'Plan your Egypt trip with ZALA VIP' },
    ...tr, ...(video ? { video } : {}),
  });
}

if (process.argv[2] === 'episode') await episode(process.argv[3]);
