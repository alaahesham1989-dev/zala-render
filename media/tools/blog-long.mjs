#!/usr/bin/env node
// media/tools/blog-long.mjs — a blog article from one long video, in the video's own language.
// The same topic made later in another language joins the same article (one blog, a version per language).
//   node media/tools/blog-long.mjs draft <id>        writes blog-draft.json; nothing goes live
//   node media/tools/blog-long.mjs add <draft.json>  puts an approved draft on the live blog (blog/auto.json on R2)
// The draft needs content/youtube/<id>.json and content/library/items.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const slugOf = (t) => String(t).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const CTA = { ar: 'خطط لرحلتك لمصر مع ZALA VIP', en: 'Plan your visit to Egypt with ZALA VIP', es: 'Planee su visita a Egipto con ZALA VIP' };
const CREDITS = { ar: 'الصور', en: 'Pictures', es: 'Imágenes' };

export function draft(id, script, items, specs, queue) {
  const lang = script.lang || 'en';
  const topic = Object.values(queue.videos).flat().find((v) => v.id === id)?.topic || id;
  const name = specs[topic]?.route?.to?.name;
  if (!name) throw new Error(`no topic description for ${id}`);
  const used = new Set();
  const body = [];
  let image = null;
  for (const c of script.chapters) {
    body.push({ h: c.title });
    const lines = c.lines.map((l) => l.en).filter(Boolean);
    const pic = c.lines.flatMap((l) => l.pictures || []).map((p) => items.get(p)).find((i) => i && i.kind === 'image' && !used.has(i.id) && String(i.url).startsWith('http') && i.license);
    if (pic) {
      used.add(pic.id);
      const credit = [pic.author, pic.license].filter(Boolean).join(', ').replace(/<[^>]*>/g, '').slice(0, 120);
      image ||= { url: pic.url, credit };
      body.push({ img: pic.url, credit: `${CREDITS[lang]}: ${credit}` });
    }
    for (let k = 0; k < lines.length; k += 3) body.push(lines.slice(k, k + 3).join(' '));
  }
  if (!image) throw new Error('no licensed picture for the article');
  return {
    slug: slugOf(`${name} virtual tour`), topic, image,
    title: { [lang]: script.title }, excerpt: { [lang]: String(script.description || '').slice(0, 200) }, body: { [lang]: body },
    cta: { to: '/egypt', ...CTA },
  };
}

/** The new language joins the article of the same topic; the others are kept as they are. */
export function merge(feed, article, today) {
  const old = (feed.posts || []).find((p) => p.topic === article.topic);
  const joined = old ? { ...old, title: { ...old.title, ...article.title }, excerpt: { ...old.excerpt, ...article.excerpt }, body: { ...old.body, ...article.body }, videos: { ...old.videos, ...article.videos } }
    : { ...article, date: today };
  return { ...feed, posts: [...(feed.posts || []).filter((p) => p.topic !== article.topic), joined] };
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'draft') {
  const content = path.join(REPO, 'content');
  const items = new Map(fs.readFileSync(path.join(content, 'library', 'items.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((i) => [i.id, i]));
  const a = draft(arg, read(path.join(content, 'youtube', `${arg}.json`)), items, read(path.join(import.meta.dirname, 'long-treasures.json')), read(path.join(import.meta.dirname, 'long-queue.json')));
  fs.writeFileSync('blog-draft.json', JSON.stringify(a, null, 2));
  const [lang] = Object.keys(a.title);
  console.log(`[blog] draft ${a.slug} (${lang}): ${a.body[lang].filter((b) => typeof b === 'string').length} paragraphs`);
} else if (cmd === 'add') {
  const E = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const s3 = (...a) => execFileSync('aws', ['s3', ...a, '--endpoint-url', E, '--no-progress'], { stdio: 'pipe' });
  s3('cp', `s3://${process.env.R2_BUCKET}/blog/auto.json`, 'blog-auto.json');   // fails rather than overwrite the blog with one article
  const feed = merge(read('blog-auto.json'), read(arg), new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }));
  fs.writeFileSync('blog-auto.json', JSON.stringify(feed));
  s3('cp', 'blog-auto.json', `s3://${process.env.R2_BUCKET}/blog/auto.json`, '--content-type', 'application/json; charset=utf-8', '--cache-control', 'public, max-age=300');
  console.log(`[blog] added ${read(arg).slug} (${feed.posts.length} automatic articles)`);
}
