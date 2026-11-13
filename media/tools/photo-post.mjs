// One picture post a day on Facebook and Instagram — a standalone piece, nothing to do with the video schedule.
// This is the PUBLISHING step only: it takes the next ready item off content/photo-queue.json (filled ahead of
// time by photo-prep.mjs, from our own checked episode stories, each with a real open-license photo or a clearly
// labelled AI reconstruction already found and quality-checked) and posts it. It never picks a fresh picture itself.
// The post is a short, real ARTICLE people actually read (a hook line, 3 short paragraphs, then a reason to
// watch/read more and to follow the page), under the already-made photo card. The same article becomes its own
// page on the zalavip.com blog. Runs on the server (photos.yml). State: content/photo-posts.json (in git).
// Usage: node media/tools/photo-post.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
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

/** The episode this picture belongs to, if that episode's video is already public (so the post can send people to watch it). */
function videoFor(topicId) {
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(CONTENT, 'schedule.json'), 'utf8'));
    const m = plan.find((p) => p.episode === topicId && p.which === 'main' && p.youtube && Date.parse(p.at) < Date.now());
    if (m) return { episode: topicId, youtube: m.youtube };
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

/** Builds the post as a short real article: hook, 3 fact paragraphs, a real question (not "like if"/"tag a friend",
 * which Facebook and Instagram actually push down), then watch/read more + follow + the site. */
function buildCaption(a, { videoUrl, blogUrl, tags }) {
  const article = (Array.isArray(a.article) ? a.article : [a.article]).filter(Boolean).join('\n\n');
  const more = videoUrl ? `🎥 Watch the full story: ${videoUrl}` : `📖 Read the full story: ${blogUrl}`;
  const engage = a.engage ? `💬 ${a.engage}` : null;
  return [a.hook, article, engage, more, '🔔 Follow us for a true story from Ancient Egypt every day.', `🌐 ${SITE}`, tags].filter(Boolean).join('\n\n');
}

// ── take the next ready item off the queue photo-prep.mjs filled ahead of time ──
const queueFile = path.join(CONTENT, 'photo-queue.json');
const queue = fs.existsSync(queueFile) ? JSON.parse(fs.readFileSync(queueFile, 'utf8')) : [];
const pick = queue[0];
if (!pick) { console.log('[photo] the queue is empty, nothing to post today (run photo-prep.mjs to fill it)'); process.exit(0); }

const day = new Date().toISOString().slice(0, 10);
const ans = { hook: pick.hook, article: pick.article, engage: pick.engage };
const words = pick.words;
const title = `${String(pick.hook || pick.topic).slice(0, 100)}`;
const slug = `${slugOf(title)}-${day}`;
const video = videoFor(pick.topic);
const videoUrl = video?.youtube || null;
const episodeSlug = await episodeBlogSlug(video?.episode);
const tags = ['AncientEgypt', 'Egypt', 'History', ...(pick.tags || [])].map((t) => '#' + String(t).replace(/[^A-Za-z0-9]/g, '')).filter((t, i, a) => t.length > 2 && a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i).slice(0, 5).join(' ');
const caption = buildCaption(ans, { videoUrl, blogUrl: `${SITE}/blog/${slug}`, tags });
// kept for our own log and the blog's small image credit line only — owner's standing order: never a comment or any
// mention of the source on Facebook or Instagram, not even in a reply. The post itself talks about the object only.
const credit = pick.isAI ? 'AI reconstruction, no real photo existed yet' : `Photo: ${pick.author || 'unknown'}${pick.license ? `, ${pick.license}` : ''}${pick.sourceUrl ? ` (${pick.sourceUrl})` : ''}`;
console.log(`[photo] ${pick.topic}\n[photo] words: ${words}\n[photo] caption:\n${caption}\n[photo] (not posted) ${credit}`);

if (dry) { console.log('[photo] dry run, nothing posted'); process.exit(0); }
const imageUrl = pick.cardUrl;

queue.shift();
fs.writeFileSync(queueFile, `${JSON.stringify(queue, null, 2)}\n`);
const done = { id: pick.topic, topic: pick.topic, at: new Date().toISOString(), words, caption, image: imageUrl, blogSlug: slug, isAI: pick.isAI || false };
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
    slug, date: day, image: { url: imageUrl, credit: pick.isAI ? 'AI reconstruction' : (pick.author || ''), license: pick.isAI ? '' : (pick.license || ''), sourceUrl: pick.isAI ? '' : (pick.sourceUrl || '') },
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
