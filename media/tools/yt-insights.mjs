#!/usr/bin/env node
// Learns from the channel's own numbers (YouTube Analytics API, scope yt-analytics.readonly):
//   - for every public video: views, average view duration and percentage, subscribers gained, traffic sources,
//     and thumbnail impressions with click-through rate when the API gives them
//   - content/insights.json: the numbers, the best titles and thumbnail words (prep.mjs shows them to Gemini as examples)
//   - a short Arabic report on Telegram (weekly in insights.yml)
//   - --retitle: a video 48 to 120 hours old whose click-through rate is weak gets the next title from its idea list
// Usage: node media/tools/yt-insights.mjs [--retitle] [--telegram]
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(REPO, 'content', 'insights.json');
const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
const args = process.argv.slice(2);
const log = (...a) => console.log('[insights]', ...a);

const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: YOUTUBE_CLIENT_ID, client_secret: YOUTUBE_CLIENT_SECRET, refresh_token: YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' }) })).json();
if (!tok.access_token) throw new Error(`Google refused the token: ${tok.error}`);
const H = { Authorization: `Bearer ${tok.access_token}` };
const data = async (u) => { const r = await fetch(`https://www.googleapis.com/youtube/v3/${u}`, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j.error || j).slice(0, 300)); return j; };
const report = async (params) => {
  const r = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({ ids: 'channel==MINE', ...params })}`, { headers: H });
  const j = await r.json();
  if (!r.ok) return { error: j.error?.message || r.status };
  const cols = j.columnHeaders.map((c) => c.name);
  return { rows: (j.rows || []).map((row) => Object.fromEntries(row.map((v, i) => [cols[i], v]))) };
};

// every upload with its state
const ch = await data('channels?part=contentDetails&mine=true');
const uploads = ch.items[0].contentDetails.relatedPlaylists.uploads;
const ids = [];
for (let page = ''; ;) {
  const pl = await data(`playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ''}`);
  ids.push(...pl.items.map((i) => i.contentDetails.videoId));
  if (!(page = pl.nextPageToken)) break;
}
const videos = [];
for (let k = 0; k < ids.length; k += 50) {
  const v = await data(`videos?part=snippet,status,contentDetails,statistics&id=${ids.slice(k, k + 50).join(',')}`);
  for (const x of v.items) if (x.status.privacyStatus === 'public') videos.push({ id: x.id, title: x.snippet.title, published: x.snippet.publishedAt, short: /PT(\d+S|1M\d?S?)$/.test(x.contentDetails.duration) && !/M[1-9]\d*M/.test(x.contentDetails.duration), views: Number(x.statistics.viewCount || 0) });
}
const today = new Date().toISOString().slice(0, 10);
const start = '2025-01-01';
// per video: watch numbers; impressions and click-through rate are asked separately (not every channel gets them)
const base = await report({ startDate: start, endDate: today, dimensions: 'video', metrics: 'views,averageViewDuration,averageViewPercentage,subscribersGained', maxResults: 200, sort: '-views' });
const imp = await report({ startDate: start, endDate: today, dimensions: 'video', metrics: 'videoThumbnailImpressions,videoThumbnailImpressionsClickRate', maxResults: 200, sort: '-videoThumbnailImpressions' });
if (base.error) throw new Error(`Analytics refused: ${base.error} (the YouTube permission needs yt-analytics.readonly)`);
if (imp.error) log(`impressions not available: ${imp.error}`);
const by = Object.fromEntries((base.rows || []).map((r) => [r.video, r]));
const byImp = Object.fromEntries((imp.rows || []).map((r) => [r.video, r]));
for (const v of videos) {
  Object.assign(v, by[v.id] || {}, byImp[v.id] || {});
  const src = await report({ startDate: start, endDate: today, dimensions: 'insightTrafficSourceType', metrics: 'views', filters: `video==${v.id}`, sort: '-views' });
  v.sources = Object.fromEntries((src.rows || []).map((r) => [r.insightTrafficSourceType, r.views]));
}
const longs = videos.filter((v) => !v.short), shorts = videos.filter((v) => v.short);
const rank = (a) => [...a].sort((x, y) => (y.averageViewPercentage || 0) * Math.log10(10 + (y.views || 0)) - (x.averageViewPercentage || 0) * Math.log10(10 + (x.views || 0)));
const insights = {
  at: new Date().toISOString(),
  impressionsAvailable: !imp.error,
  bestTitles: rank(longs).slice(0, 5).map((v) => v.title),
  bestShorts: rank(shorts).slice(0, 5).map((v) => v.title),
  videos,
};
fs.writeFileSync(OUT, JSON.stringify(insights, null, 2) + '\n');
log(`${videos.length} public videos, best: ${insights.bestTitles.join(' | ')}`);

// a weak click-through rate 48 to 120 hours after going public: the next title from the episode's idea list.
// This channel's impressions/CTR are not available from the API yet (small-channel limit), so CTR never fires —
// retitle fell back to a views-based signal instead: owner's order 2026-11-14, applies to videos AND shorts.
if (args.includes('--retitle')) {
  const scripts = path.join(REPO, 'content', 'youtube');
  const plan = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'schedule.json'), 'utf8'));
  for (const v of [...longs, ...shorts]) {
    const age = (Date.now() - Date.parse(v.published)) / 3600e3;
    if (age < 48 || age > 120) continue;
    const ctr = v.videoThumbnailImpressionsClickRate;
    let reason;
    if (!imp.error && ctr !== undefined && (v.videoThumbnailImpressions || 0) >= 300) {
      if (ctr >= 3) continue;   // a real CTR number, and it is fine
      reason = `CTR ${ctr}%`;
    } else {
      // fallback: nobody is finishing it. A real flop, not just a quiet day (needs a minimum audience first).
      if ((v.views || 0) < (v.short ? 50 : 15) || (v.averageViewPercentage || 0) >= 20) continue;
      reason = `${Math.round(v.averageViewPercentage || 0)}% watched, ${v.views} views`;
    }
    const ep = plan.find((p) => (p.which === 'main' || /^R\d$/.test(p.which)) && String(p.youtube || '').includes(v.id))?.episode;
    const s = ep && JSON.parse(fs.readFileSync(path.join(scripts, `${ep}.json`), 'utf8'));
    const next = s?.titleIdeas?.find((t) => t !== v.title && !(s.triedTitles || []).includes(t));
    if (!next) continue;
    const cur = await data(`videos?part=snippet&id=${v.id}`);
    const snippet = { ...cur.items[0].snippet, title: next };
    const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.id, snippet }) });
    log(`retitle ${v.id} (${reason}): "${v.title}" -> "${next}" ${r.ok ? 'done' : 'refused ' + r.status}`);
    if (r.ok) { s.triedTitles = [...(s.triedTitles || []), v.title]; fs.writeFileSync(path.join(scripts, `${ep}.json`), JSON.stringify(s, null, 2) + '\n'); }
  }
}

// the owner's weekly report, in Egyptian Arabic
if (args.includes('--telegram') && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
  const fmt = (v) => `• ${v.title.slice(0, 55)}: ${v.views} مشاهدة، بيتفرجوا ${Math.round(v.averageViewPercentage || 0)}%${v.videoThumbnailImpressionsClickRate !== undefined ? `، الضغط ${v.videoThumbnailImpressionsClickRate.toFixed(1)}%` : ''}${v.subscribersGained ? `، +${v.subscribersGained} مشترك` : ''}`;
  const src = {};
  for (const v of videos) for (const [k, n] of Object.entries(v.sources || {})) src[k] = (src[k] || 0) + n;
  const total = Object.values(src).reduce((a, b) => a + b, 0) || 1;
  const names = { YT_SEARCH: 'البحث', RELATED_VIDEO: 'الاقتراحات', SHORTS: 'الشورتس', BROWSE: 'الصفحة الرئيسية', EXT_URL: 'روابط بره', SUBSCRIBER: 'المشتركين', NO_LINK_OTHER: 'تاني' };
  const text = `ZALA تقرير الأسبوع (يوتيوب)
أحسن الحلقات:
${rank(longs).slice(0, 3).map(fmt).join('\n')}
أحسن الشورتس:
${rank(shorts).slice(0, 3).map(fmt).join('\n')}
الناس جاية منين: ${Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${names[k] || k} ${Math.round((n / total) * 100)}%`).join('، ')}`;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', body: new URLSearchParams({ chat_id: TELEGRAM_CHAT_ID, text }) });
  log('telegram report sent');
}
