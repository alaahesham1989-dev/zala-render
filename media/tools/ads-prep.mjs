#!/usr/bin/env node
// media/tools/ads-prep.mjs — one partner ad as a factory short: the sentences of ads-partners.json, the presenter's
// picture (served only inside the job from ads-local/), a real screenshot of the sign-up page on a phone, a map of the
// cities, and licensed pictures for the rest. Nothing is published. Usage: node media/tools/ads-prep.mjs <id>
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const id = process.argv[2];
const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'ads-partners.json'), 'utf8'))[id];
if (!spec?.lines) throw new Error(`no ad ${id}`);
const local = path.join(REPO, 'ads-local');
const LOCAL = 'http://127.0.0.1:8765';
const itemsFile = path.join(REPO, 'content', 'library', 'items.jsonl');

// the phone screenshot of our own sign-up page (looked at only: nothing is typed or sent)
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 693, deviceScaleFactor: 2.77, isMobile: true, hasTouch: true });
await page.setExtraHTTPHeaders({ 'Accept-Language': 'ar' });
await page.goto(spec.page, { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: path.join(local, 'form.jpg'), quality: 90 });
await browser.close();

const map = await fetch(`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-l+d4af37(31.24,30.05),pin-l+d4af37(29.92,31.2),pin-l+d4af37(33.81,27.26),pin-l+d4af37(32.64,25.69),pin-l+d4af37(32.9,24.09)/31.2,27.4,4.9,0/640x1137@2x?access_token=${process.env.MAPBOX_TOKEN}`, { headers: { Referer: 'https://www.zalavip.com/' } });
if (!map.ok) throw new Error(`map refused: ${map.status}`);
fs.writeFileSync(path.join(local, 'map.jpg'), Buffer.from(await map.arrayBuffer()));

const item = (pid, file, title, what, extra = {}) => ({ id: pid, kind: 'image', title, url: `${LOCAL}/${file}`, source: 'ZALA VIP', source_url: `${LOCAL}/${file}`, author: 'ZALA VIP', license: 'ZALA VIP', topics: [id], shine: 0.5, seen: { usable: true, wide: false, what, subject: title, check: { kind: 'modern-photo' } }, ...extra });
const own = [
  item(`${id}-owner`, 'owner.jpg', 'ZALA VIP presenter', 'A man in a suit presenting to the camera (AI scene)', { recon: true }),
  item(`${id}-form`, 'form.jpg', 'ZALA VIP partner sign-up page', 'The partner sign-up form on a phone screen'),
  item(`${id}-map`, 'map.jpg', 'Map of Egypt', 'A satellite map of Egypt with pins on cities'),
];
const rows = (fs.existsSync(itemsFile) ? fs.readFileSync(itemsFile, 'utf8').split('\n').filter(Boolean) : []).filter((l) => !own.some((o) => JSON.parse(l).id === o.id));
fs.writeFileSync(itemsFile, [...rows, ...own.map((o) => JSON.stringify(o))].join('\n') + '\n');

const specsFile = path.join(REPO, 'content', 'library', 'treasures.json');
const specs = JSON.parse(fs.readFileSync(specsFile, 'utf8'));
specs[id] = { title: spec.title, hook: spec.hook, seconds: 26, match: spec.queries.join('|'), archive: spec.queries[0], queries: spec.queries };
fs.writeFileSync(specsFile, JSON.stringify(specs));

const out = path.join(REPO, 'content', 'youtube', `${id}.json`);
if (!fs.existsSync(out)) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    id, series: 'ZALA VIP partners', kind: 'promo', lang: 'ar', verticalOnly: true, directed: 8, packaged: true,
    voice: 'Orus', voiceStyle: 'اتكلم بالعامية المصرية بنبرة واثقة ودودة وسريعة شوية، زي صاحب شغل بيعرض فرصة بهدوء من غير مبالغة.', voiceTempo: 1,
    title: spec.title, description: spec.title, tags: [],
    endLine: 'كن شريكنا · اللينك في البايو · تابعنا', noEarlyMark: true,
    chapters: [{ title: spec.title, lines: spec.lines.map((l) => ({ en: l.en, queries: l.queries || [], ...(l.use ? { pictures: [`${id}-${l.use}`], keep: true } : {}) })) }],
    reels: [{ chapter: 1, from: 0, title: spec.title, hook: spec.hook, badge: 'كن شريكنا', sub: '' }],
    prepared: { at: new Date().toISOString(), kind: 'promo' },
  }, null, 2) + '\n');
}
console.log(`ad ${id} ready: ${spec.lines.length} lines`);
