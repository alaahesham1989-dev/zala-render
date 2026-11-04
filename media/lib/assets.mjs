// media/lib/assets.mjs — open-license b-roll for each scene.
// Sources (commercial use allowed):
//   pexels     videos + photos (Pexels license; needs PEXELS_API_KEY — free)
//   pixabay    videos + photos (Pixabay Content License; needs PIXABAY_API_KEY — free)
//   wikimedia  photos of real monuments/artifacts — only PD / CC0 / CC BY / CC BY-SA (attribution kept)
//   met        The Met Open Access artworks (CC0)
// Everything is cached on disk; every asset carries its attribution line for the video description.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import { CACHE, VAULT } from './paths.mjs';

dns.setDefaultResultOrder('ipv4first');

const DIR = path.join(CACHE, 'assets');
fs.mkdirSync(DIR, { recursive: true });
const UA = 'ZALA-VIP-media/1.0 (https://www.zalavip.com; contact via site)';
const OK_LICENSES = /^(public domain|pd|cc0|cc by(-sa)? ?\d(\.\d)?|cc-by(-sa)?-\d(\.\d)?)/i;

const DEFAULT_AVOID = [
  'replica', 'model', 'reconstruction', 'reproduction', 'drawing', 'illustration',
  'diagram', 'cartoon', 'fake', 'miniature', 'souvenir', 'postcard', 'toy'
];

let _vaultItems = null;
function getVault() {
  if (_vaultItems) return _vaultItems;
  _vaultItems = [];
  try {
    if (fs.existsSync(VAULT)) {
      const files = fs.readdirSync(VAULT).filter((f) => f.endsWith('.json') && !['taxonomy.json', 'master-index.json'].includes(f));
      for (const f of files) {
        try {
          const list = JSON.parse(fs.readFileSync(path.join(VAULT, f), 'utf8'));
          if (Array.isArray(list)) _vaultItems.push(...list);
        } catch {}
      }
    }
  } catch {}
  return _vaultItems;
}

function lookupVault(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  const vault = getVault();
  const qTokens = q.split(/[^a-z0-9\u0600-\u06FF]+/).filter((t) => t.length >= 3);
  if (!qTokens.length) return null;

  let best = null, bestScore = 0;
  for (const item of vault) {
    let score = 0;
    const id = (item.id || '').toLowerCase();
    const titleEn = (item.title?.en || '').toLowerCase();
    const titleAr = (item.title?.ar || '').toLowerCase();
    const tags = (item.tags || []).map((t) => String(t).toLowerCase());

    if (id === q || titleEn === q || titleAr === q) score += 100;
    if (titleEn.includes(q) || q.includes(titleEn)) score += 50;

    for (const t of qTokens) {
      if (id.includes(t)) score += 15;
      if (titleEn.includes(t)) score += 10;
      if (titleAr.includes(t)) score += 10;
      if (tags.some((tag) => tag.includes(t))) score += 8;
    }

    if (score > bestScore && score >= 50) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, ext) {
  const file = path.join(DIR, `${hash(url)}${ext}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 5000) return file;
  let res;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) break;
    if (res.status !== 429 && res.status < 500) break;
    const wait = Math.max(Number(res.headers.get('retry-after')) || 0, 2 ** attempt * 1.5) * 1000;
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  await new Promise((r) => setTimeout(r, 400));
  return file;
}

// ── Pexels ────────────────────────────────────────────────────────────────────
async function pexels(query, orientation, wantVideo, used) {
  if (!process.env.PEXELS_API_KEY) return null;
  const headers = { Authorization: process.env.PEXELS_API_KEY };
  if (wantVideo) {
    const j = await getJson(`https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=10`, headers);
    for (const v of j.videos || []) {
      if (used.has(`pexels-v-${v.id}`) || v.duration < 4) continue;
      const files = (v.video_files || []).filter((f) => f.file_type === 'video/mp4' && f.width && f.height)
        .sort((a, b) => b.width * b.height - a.width * a.height);
      const pick = files.find((f) => Math.min(f.width, f.height) >= 1080 && Math.max(f.width, f.height) <= 2160) || files[0];
      if (!pick) continue;
      used.add(`pexels-v-${v.id}`);
      return { kind: 'video', file: await download(pick.link, '.mp4'), duration: v.duration, source: 'Pexels', url: v.url,
        author: v.user?.name, license: 'Pexels License', attribution: `Video by ${v.user?.name} on Pexels` };
    }
  }
  const j = await getJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=10`, headers);
  for (const p of j.photos || []) {
    if (used.has(`pexels-p-${p.id}`)) continue;
    used.add(`pexels-p-${p.id}`);
    return { kind: 'image', file: await download(p.src.original, '.jpg'), source: 'Pexels', url: p.url,
      author: p.photographer, license: 'Pexels License', attribution: `Photo by ${p.photographer} on Pexels` };
  }
  return null;
}

// ── Pixabay (free for commercial use, no attribution required; needs PIXABAY_API_KEY — free) ──
// Pixabay asks API users to download files (no hotlinking) and to credit Pixabay where results are shown.
async function pixabay(query, orientation, wantVideo, used) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return null;
  const q = encodeURIComponent(query.slice(0, 100));
  if (wantVideo) {
    const j = await getJson(`https://pixabay.com/api/videos/?key=${key}&q=${q}&safesearch=true&per_page=20`);
    for (const v of j.hits || []) {
      if (used.has(`pixabay-v-${v.id}`) || v.duration < 4) continue;
      const pick = ['large', 'medium'].map((k) => v.videos?.[k]).find((f) => f?.url && Math.min(f.width, f.height) >= 720);
      if (!pick) continue;
      used.add(`pixabay-v-${v.id}`);
      return { kind: 'video', file: await download(pick.url, '.mp4'), duration: v.duration, source: 'Pixabay', url: v.pageURL,
        author: v.user, license: 'Pixabay Content License', attribution: `Video by ${v.user} on Pixabay` };
    }
  }
  const j = await getJson(`https://pixabay.com/api/?key=${key}&q=${q}&image_type=photo&safesearch=true&per_page=20` +
    `&orientation=${orientation === 'portrait' ? 'vertical' : 'horizontal'}&min_width=1600`);
  for (const p of j.hits || []) {
    if (used.has(`pixabay-p-${p.id}`)) continue;
    used.add(`pixabay-p-${p.id}`);
    return { kind: 'image', file: await download(p.largeImageURL, '.jpg'), source: 'Pixabay', url: p.pageURL,
      author: p.user, license: 'Pixabay Content License', attribution: `Image by ${p.user} on Pixabay` };
  }
  return null;
}

// ── Wikimedia Commons ─────────────────────────────────────────────────────────
async function wikimedia(query, used, avoid = []) {
  const avoidAll = [...avoid, ...DEFAULT_AVOID];
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12' +
    `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=2400`;
  const j = await getJson(api);
  // Rank by how many query words appear in the file title (search relevance alone picks loose matches).
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const score = (p) => tokens.filter((t) => p.title.toLowerCase().includes(t)).length;
  const pages = Object.values(j.query?.pages || {})
    .sort((a, b) => score(b) - score(a) || (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    if (avoidAll.some((w) => String(p.title || '').toLowerCase().includes(String(w).toLowerCase()))) continue;
    const ii = p.imageinfo?.[0];
    if (!ii || used.has(`wm-${p.pageid}`)) continue;
    const meta = ii.extmetadata || {};
    const license = stripHtml(meta.LicenseShortName?.value);
    if (!OK_LICENSES.test(license) || Math.min(ii.width, ii.height) < 900) continue;
    used.add(`wm-${p.pageid}`);
    const author = stripHtml(meta.Artist?.value).slice(0, 80) || 'Unknown';
    return { kind: 'image', file: await download(ii.thumburl || ii.url, '.jpg'), source: 'Wikimedia Commons', url: ii.descriptionurl,
      author, license, attribution: `"${stripHtml(meta.ObjectName?.value || p.title.replace(/^File:/, '')).slice(0, 80)}" by ${author}, ${license}, via Wikimedia Commons` };
  }
  return null;
}

// ── The Met Open Access (CC0) ─────────────────────────────────────────────────
async function met(query, used) {
  const s = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(query)}`);
  for (const id of (s.objectIDs || []).slice(0, 15)) {
    if (used.has(`met-${id}`)) continue;
    const o = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
    if (!o.isPublicDomain || !o.primaryImage) continue;
    used.add(`met-${id}`);
    return { kind: 'image', file: await download(o.primaryImage, '.jpg'), source: 'The Metropolitan Museum of Art', url: o.objectURL,
      author: 'The Met', license: 'CC0', attribution: `${o.title} — The Metropolitan Museum of Art (Open Access, CC0)` };
  }
  return null;
}

/**
 * Finds one asset for a b-roll line. Tries the hinted source first, then the others.
 * @param {{ query: string, source_hint?: string }} item
 * @param {{ orientation: 'portrait'|'landscape', used: Set<string>, preferVideo?: boolean }} opts
 */
export async function findAsset(item, { orientation, used, preferVideo = true }) {
  if (item.file && fs.existsSync(item.file)) {
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(item.file);
    return {
      kind: isVideo ? 'video' : 'image',
      file: item.file,
      duration: item.duration || 0,
      source: 'verified-archive',
      url: item.url || '',
      author: item.author || 'Historical Archive',
      license: item.license || 'Public Domain',
      attribution: item.attribution || 'ZALA Verified Archive'
    };
  }
  // A script may pin an exact open-license file (from content/media/candidates.json).
  const pinUrl = item.media_url || item.url;
  if (pinUrl && item.license && OK_LICENSES.test(item.license) && !used.has(pinUrl)) {
    used.add(pinUrl);
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(pinUrl);
    try {
      return { kind: isVideo ? 'video' : 'image', file: await download(pinUrl, isVideo ? '.mp4' : '.jpg'), duration: item.duration || 0,
        source: item.source || 'pinned', url: item.page_url || pinUrl, author: item.author || 'Unknown', license: item.license,
        attribution: item.attribution || `${item.author || 'Unknown'}, ${item.license}` };
    } catch (err) {
      console.warn(`[assets] pinned media failed: ${err.message}`);
    }
    if (item.pinOnly) return null;   // a dead pin must not quietly become a random search result
  }

  // Tier 1: Check ZALA Heritage Vault first (curated authentic Egyptian artifacts & monuments)
  const vaultMatch = lookupVault(item.query);
  if (vaultMatch && !used.has(`vault-${vaultMatch.id}`)) {
    used.add(`vault-${vaultMatch.id}`);
    const localFile = path.join(CACHE, 'vault', `${vaultMatch.id}.jpg`);
    let file = localFile;
    if (!fs.existsSync(localFile) || fs.statSync(localFile).size < 1000) {
      const url = vaultMatch.image?.r2_url || vaultMatch.image?.direct_url;
      if (url) {
        try {
          file = await download(url, '.jpg');
        } catch (err) {
          console.warn(`[assets] vault download fallback for ${vaultMatch.id}: ${err.message}`);
        }
      }
    }
    if (fs.existsSync(file) && fs.statSync(file).size >= 1000) {
      return {
        kind: 'image',
        file,
        source: 'ZALA Heritage Vault',
        url: vaultMatch.image?.r2_url || vaultMatch.image?.direct_url || vaultMatch.image?.source_url || '',
        author: vaultMatch.image?.author || 'Historical Archive',
        license: vaultMatch.image?.license || 'Public Domain / CC BY-SA',
        attribution: `"${vaultMatch.title?.en || vaultMatch.id}" (${vaultMatch.era}) — ZALA Heritage Vault`
      };
    }
  }

  const order = {
    pexels: ['pexels', 'pixabay', 'wikimedia', 'met'], pixabay: ['pixabay', 'pexels', 'wikimedia', 'met'],
    wikimedia: ['wikimedia', 'pexels', 'pixabay', 'met'], met: ['met', 'wikimedia', 'pexels', 'pixabay'],
  };
  let sources = order[item.source_hint] || ['pexels', 'pixabay', 'wikimedia', 'met'];
  sources = sources.filter((x) => x !== 'met'); // the Met API now answers 410
  if (item.wikiOnly) sources = sources.filter((x) => x !== 'pexels' && x !== 'pixabay');
  for (const s of sources) {
    try {
      const a = s === 'pexels' ? await pexels(item.query, orientation, preferVideo, used)
        : s === 'pixabay' ? await pixabay(item.query, orientation, preferVideo, used)
        : s === 'wikimedia' ? await wikimedia(item.query, used, item.avoid || [])
        : await met(item.query, used);
      if (a) return a;
    } catch (err) {
      console.warn(`[assets] ${s} failed for "${item.query}": ${err.message}`);
    }
  }
  return null;
}
