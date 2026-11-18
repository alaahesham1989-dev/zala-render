// expand-library.mjs — Fetches open-license images from Wikimedia Commons
// and uploads them to R2, then appends to content/library/items.jsonl.
// Usage: node media/tools/expand-library.mjs [--topic ZV-AR04] [--limit 30]
// Runs on GitHub Actions via expand-library.yml (or manually).
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';

const REPO   = path.resolve(import.meta.dirname, '..', '..');
const ITEMS  = path.join(REPO, 'content', 'library', 'items.jsonl');
const UA     = 'ZALA-VIP-expand-library/1.0 (https://www.zalavip.com)';

// ── R2 config (from env) ─────────────────────────────────────────────
const R2_ENDPOINT   = process.env.CLOUDFLARE_R2_ENDPOINT;   // https://<id>.r2.cloudflarestorage.com
const R2_BUCKET     = process.env.CLOUDFLARE_R2_BUCKET || 'zalavip';
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_PUBLIC     = process.env.CLOUDFLARE_R2_PUBLIC_URL ||
  'https://pub-20815a715a814497b24a479c98b1815e.r2.dev';

// ── Topic queries ────────────────────────────────────────────────────
const TOPICS = {
  'ZV-AR01': { ar: 'محاكمة الموتى',       queries: ['Weighing of the Heart','Hall of Two Truths','Ammit goddess','Ma\'at feather judgment','Book of Dead vignette','Duat underworld Egypt'] },
  'ZV-AR02': { ar: 'أوزيريس',             queries: ['Osiris Egyptian god','Osiris resurrection','Abydos temple Osiris','Osiris Isis Horus','Osiris green skin statue'] },
  'ZV-AR03': { ar: 'أنوبيس',              queries: ['Anubis jackal god','Anubis mummification','Canopic jars Egypt','Anubis weighing heart','Anubis statue'] },
  'ZV-AR04': { ar: 'ست',                  queries: ['Set god Egypt','Seth Egyptian desert god','Set Horus battle','Set animal headed','Set typhon Egypt','Set god relief'] },
  'ZV-AR05': { ar: 'كتاب الموتى',         queries: ['Book of the Dead papyrus','Hunefer papyrus','Ani papyrus British Museum','Egyptian funerary spell','Papyrus hieroglyphs vignette','Coffin Texts Egypt'] },
  'ZV-AR06': { ar: 'حتشبسوت',            queries: ['Hatshepsut temple Deir el-Bahari','Hatshepsut obelisk Karnak','Hatshepsut statue','Female pharaoh Egypt','Punt expedition relief','Hatshepsut sphinx'] },
  'ZV-AR07': { ar: 'الأهرامات من الداخل', queries: ['Great Pyramid interior','Grand Gallery Khufu','King Chamber pyramid','Pyramid passage shaft','Pyramid construction ancient','Pyramid subterranean chamber'] },
  'ZV-AR08': { ar: 'نيفرتيتي',           queries: ['Nefertiti bust Berlin','Amarna art relief','Nefertiti portrait','Akhenaten family','Amarna period Egypt','Thutmose sculptor nefertiti'] },
  'ZV-AR09': { ar: 'الغرفة المخفية',      queries: ['ScanPyramids muon tomography','Pyramid void discovery','Great Pyramid scan 2017','Pyramid secret chamber','Cosmic ray pyramid imaging'] },
  'ZV-AR10': { ar: 'أبو سمبل',            queries: ['Abu Simbel temple','Ramesses II colossal statue','Abu Simbel sun alignment','Nefertari temple Nubia','Abu Simbel relocation UNESCO'] },
  'ZV-AR11': { ar: 'الموميا',             queries: ['Egyptian mummy wrapping','Mummification process natron','Canopic jars organs','Linen wrapped mummy','Mummy mask Egypt','Golden mummy Egypt'] },
  'ZV-AR12': { ar: 'كليوباترا',           queries: ['Cleopatra VII coin','Cleopatra portrait ancient','Ptolemaic Egypt queen','Alexandria ancient Egypt','Cleopatra Julius Caesar relief','Cleopatra temple Dendera'] },
};

// ── Parse args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const topicArg = args[args.indexOf('--topic') + 1];
const limitArg = parseInt(args[args.indexOf('--limit') + 1] || '20');
const dryRun   = args.includes('--dry-run');

const topicsToRun = topicArg
  ? { [topicArg]: TOPICS[topicArg] }
  : TOPICS;

if (topicArg && !TOPICS[topicArg]) {
  console.error(`Unknown topic: ${topicArg}. Valid: ${Object.keys(TOPICS).join(', ')}`);
  process.exit(1);
}

// ── Load existing IDs ────────────────────────────────────────────────
function loadExistingIds() {
  if (!fs.existsSync(ITEMS)) return new Set();
  const lines = fs.readFileSync(ITEMS, 'utf8').split('\n').filter(Boolean);
  return new Set(lines.map(l => { try { return JSON.parse(l).id; } catch { return null; } }).filter(Boolean));
}

// ── Wikimedia Commons search ─────────────────────────────────────────
async function wikiSearch(query, limit = 15) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    list: 'search', srnamespace: '6',  // File: namespace
    srsearch: `${query} filetype:bitmap`,
    srlimit: String(limit),
  });
  const url = `https://commons.wikimedia.org/w/api.php?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const json = await res.json();
  return (json.query?.search || []).map(p => p.title.replace(/^File:/, ''));
}

async function wikiImageInfo(titles) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    prop: 'imageinfo', iiprop: 'url|extmetadata|size|mediatype',
    titles: titles.map(t => `File:${t}`).join('|'),
    iiurlwidth: '1200',
  });
  const url = `https://commons.wikimedia.org/w/api.php?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const json = await res.json();
  return Object.values(json.query?.pages || {});
}

function extractLicense(meta) {
  const lic = meta?.LicenseShortName?.value || meta?.License?.value || '';
  const ok = ['cc0','public domain','cc-by','cc by','pdm'].some(x => lic.toLowerCase().includes(x));
  return ok ? lic : null;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ── R2 upload via S3-compatible API ─────────────────────────────────
async function uploadToR2(localPath, r2Key, contentType) {
  if (!R2_ENDPOINT || !R2_ACCESS_KEY) {
    console.log(`  [dry-upload] Would upload to ${r2Key}`);
    return `${R2_PUBLIC}/vault/${r2Key}`;
  }
  // Use AWS SDK v3 (available in GitHub Actions)
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
  const body = fs.readFileSync(localPath);
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: `vault/${r2Key}`,
    Body: body, ContentType: contentType,
  }));
  return `${R2_PUBLIC}/vault/${r2Key}`;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const existing = loadExistingIds();
  console.log(`Existing items: ${existing.size}`);
  let totalAdded = 0;

  for (const [topicId, info] of Object.entries(topicsToRun)) {
    console.log(`\n── ${topicId} (${info.ar}) ──`);
    const added = [];

    for (const query of info.queries) {
      if (added.length >= limitArg) break;
      let titles;
      try { titles = await wikiSearch(query, 10); } catch (e) { console.log(`  search error: ${e.message}`); continue; }

      // batch imageinfo (max 10 at a time)
      for (let i = 0; i < titles.length && added.length < limitArg; i += 10) {
        const batch = titles.slice(i, i + 10);
        let pages;
        try { pages = await wikiImageInfo(batch); } catch (e) { continue; }

        for (const page of pages) {
          if (added.length >= limitArg) break;
          const ii = page.imageinfo?.[0];
          if (!ii) continue;
          if (!['BITMAP','DRAWING'].includes(ii.mediatype)) continue;
          if ((ii.width || 0) < 600) continue;

          const meta  = ii.extmetadata || {};
          const license = extractLicense(meta);
          if (!license) continue;

          const title  = (meta.ObjectName?.value || page.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '').trim();
          const author = meta.Artist?.value?.replace(/<[^>]+>/g, '').trim() || 'Unknown';
          const srcUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.title?.replace(/^File:/, '') || '')}`;

          const itemId = `wiki-${slugify(title)}-${Date.now().toString(36)}`;
          if (existing.has(itemId)) continue;

          const ext   = (ii.url.match(/\.([a-z]+)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
          const r2Key = `ancient/wiki/${topicId.toLowerCase()}/${itemId}.${ext}`;

          if (!dryRun) {
            // download
            const tmp = path.join(tmpdir(), `${itemId}.${ext}`);
            try {
              const imgRes = await fetch(ii.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
              if (!imgRes.ok) continue;
              await pipeline(imgRes.body, createWriteStream(tmp));
            } catch { continue; }

            let pubUrl;
            try {
              pubUrl = await uploadToR2(tmp, r2Key, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
            } catch (e) { console.log(`  upload error: ${e.message}`); fs.unlinkSync(tmp); continue; }
            fs.unlinkSync(tmp);

            const item = {
              id: itemId, kind: 'image', title,
              url: pubUrl,
              source: 'Wikimedia Commons', source_url: srcUrl,
              license, author,
              topics: [topicId],
              seen: { usable: true, what: `${topicId} — ${title}` },
            };
            fs.appendFileSync(ITEMS, JSON.stringify(item) + '\n', 'utf8');
            existing.add(itemId);
            added.push(itemId);
            console.log(`  ✅ ${title.slice(0, 60)} [${license}]`);
          } else {
            console.log(`  [dry] ${title.slice(0, 60)} [${license}] → ${r2Key}`);
            added.push(itemId);
          }
        }
      }
    }
    console.log(`  Added: ${added.length}`);
    totalAdded += added.length;
  }

  console.log(`\nDone. Total added: ${totalAdded}`);
}

main().catch(e => { console.error(e); process.exit(1); });
