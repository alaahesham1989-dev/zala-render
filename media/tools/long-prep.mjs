#!/usr/bin/env node
// media/tools/long-prep.mjs — writes one long virtual tour from long-treasures.json, chapter by chapter:
// Wikipedia text of the chapter -> lines in the language -> editor check against the same text -> (Arabic) proofreading.
// A short draft is grown, never thrown away. Finished chapters are kept in content/long/<id>.json, so a second run
// continues where the first one stopped. Writes content/youtube/<id>.json and puts the tour's places on the map list.
// Nothing is added to any state, queue or outbox. Usage: node media/tools/long-prep.mjs <id>
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './gemini-lite.mjs';
import { proofArabic } from '../lib/arabic-proof.mjs';
import { inLang } from '../lib/lang-check.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const id = process.argv[2];
const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'long-treasures.json'), 'utf8'))[id];
if (!spec) throw new Error(`no long tour ${id}`);
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the satellite zooms onto each stop come from these places: first in the list, so the tour's own names win
const placesFile = path.join(REPO, 'content', 'library', 'places.json');
const others = read(placesFile, []).filter((p) => !spec.places.some((x) => x.name === p.name));
write(placesFile, [...spec.places, ...others]);

const out = path.join(REPO, 'content', 'youtube', `${id}.json`);

const LANGS = {
  ar: { name: 'العامية المصرية الأصيلة، بأسلوب حكواتي وثائقي هادي وذكي (مش مبالغة ومش فصحى)', style: 'اتكلم بالعامية المصرية الأصيلة زي حكواتي سينمائي وثائقي: صوت عميق ودافي وهادي، فيه تشويق من غير مبالغة، ووقفات طبيعية.' },
  es: { name: 'neutral Latin American Spanish, plain and vivid, written to be spoken, calm documentary storytelling', style: 'Narra en español latino neutro, como un narrador de documental: voz grave, cálida y tranquila, con intriga y pausas naturales.' },
  en: { name: 'plain, vivid spoken American English (simple words, for viewers 45 and older), calm documentary storytelling', style: undefined },
};
const L = LANGS[spec.lang];

// every spoken line must be in the video's language: a line that is not gets rewritten in it, or the run stops
// before any voice is paid for
async function inOwnLanguage(lines) {
  for (let round = 1; round <= 6; round++) {
    const wrong = lines.filter((l) => !inLang(l.en, spec.lang));
    if (!wrong.length) return;
    console.log(`language: ${wrong.length} lines are not in "${spec.lang}", rewriting (round ${round})`);
    for (let i = 0; i < wrong.length; i += 12) {
      const part = wrong.slice(i, i + 12);
      const r = await askJson(`Translate these narration lines of a documentary into: ${L.name}.
Keep every fact, name, date and number exactly; add nothing, drop nothing; natural spoken sentences. Never leave a line in English.
Return JSON {"lines": [{"n": 1, "line": "the translated line"}]}.
${JSON.stringify(part.map((l, k) => ({ n: k + 1, line: l.en })))}`, { temperature: 0.2 });
      for (const t of r?.lines || []) {
        const l = part[t.n - 1];
        if (l && t.line && inLang(t.line, spec.lang) && t.line.length > l.en.length * 0.5 && t.line.length < l.en.length * 1.8) { l.en = spec.lang === 'ar' ? proofArabic([t.line]).fixed[0] : t.line; if (l.card) l.card = ''; }
      }
      await sleep(8000);
    }
  }
  const left = lines.filter((l) => !inLang(l.en, spec.lang)).length;
  if (left) throw new Error(`${left} lines are still not in "${spec.lang}"`);
}

// wrong or non-Egyptian words slipped through before ("تخلّص هندسي"): a language pass that may only swap words
async function proofread(lines) {
  for (let i = 0; i < lines.length; i += 25) {
    const part = lines.slice(i, i + 25);
    const p = await askJson(`راجع السطور دي لغوياً بالعامية المصرية. صلّح بس الكلمة الغلط أو اللي مالهاش معنى في السياق أو اللي مش مصري. متغيرش المعنى ولا الأسماء ولا الأرقام ولا ترتيب الجمل.
رجّع JSON {"fixes": [{"n": 1, "line": "السطر بعد التصليح"}]} للسطور اللي اتغيرت بس.
وصلّح كمان أي تعبير مترجم حرفياً من الإنجليزي ومعناه طلع غلط (مثال: "راساً على تحت" معناها مقلوب، والمقصود "على طول").
${JSON.stringify(part.map((l, k) => ({ n: k + 1, line: l.en })))}`, { temperature: 0.1 });
    for (const f of p?.fixes || []) {
      const l = part[f.n - 1];
      if (l && f.line && inLang(f.line, 'ar') && Math.abs(f.line.length - l.en.length) < l.en.length * 0.15) { console.log(`  proofread ${i + f.n}: ${f.line.slice(0, 80)}`); l.en = f.line; }
    }
  }
  const proofed = proofArabic(lines.map((l) => l.en));
  lines.forEach((l, i) => { l.en = proofed.fixed[i]; });
}

if (fs.existsSync(out)) {
  const script = read(out);
  await inOwnLanguage(script.chapters.flatMap((x) => x.lines));
  // once, before any of it is voiced: the lines rewritten from English get the same language pass as new ones
  if (spec.lang === 'ar' && !script.proofed) { await proofread(script.chapters.flatMap((x) => x.lines)); script.proofed = true; }
  write(out, script);
  console.log(`${id} is written already, every line is in "${spec.lang}"`);
  process.exit(0);
}

const UA = { 'User-Agent': 'ZALA-VIP-tours/1.0 (https://www.zalavip.com)' };
const sources = new Set();
async function wiki(titles) {
  let text = '';
  for (const title of titles) {
    try {
      const r = await (await fetch(`https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
      const page = Object.values(r.query.pages)[0];
      if (page?.extract) { text += `\n\n== ${page.title} ==\n${page.extract.slice(0, 14000)}`; sources.add(`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`); }
    } catch { /* next page */ }
  }
  return text;
}

const count = (lines) => lines.reduce((n, l) => n + String(l.en).split(/\s+/).filter(Boolean).length, 0);
const per = Math.ceil(spec.words / spec.chapters.length);
const draftFile = path.join(REPO, 'content', 'long', `${id}.json`);
const draft = read(draftFile, { chapters: [] });

for (let c = 0; c < spec.chapters.length; c++) {
  const ch = spec.chapters[c];
  const text = await wiki(ch.wiki);
  if (draft.chapters[c]) { console.log(`chapter ${c + 1}: kept (${count(draft.chapters[c].lines)} words)`); continue; }
  if (text.length < 2000) throw new Error(`chapter ${c + 1}: not enough facts`);
  let lines = [], title = '';
  const told = draft.chapters.map((x, i) => `${i + 1}. ${x.title}: ${x.lines.slice(0, 3).map((l) => l.en).join(' ').slice(0, 240)}`).join('\n');
  for (let attempt = 1; attempt <= 10 && count(lines) < per * 0.92; attempt++) {
    const need = per - count(lines);
    const s = await askJson(`You are writing chapter ${c + 1} of ${spec.chapters.length} of a long virtual tour video. Subject: ${spec.subject}.
This chapter is about: ${ch.focus}
Language of everything spoken and shown: ${L.name}.
${c === 0 && !lines.length ? `The first line is the hook: a question or a mystery, no greeting, no introduction. Lines 1 to 3 are spoken over a map flight and describe exactly this journey, nothing else: ${spec.route.said}. Mark those three lines "flight": true.` : ''}
${lines.length ? `The chapter already has these lines. Do NOT repeat them. Write MORE lines that continue it, about ${need} words, with other facts from the TEXT.\nALREADY WRITTEN: ${JSON.stringify(lines.map((l) => l.en))}` : `Write about ${per} words, in lines of 2 or 3 sentences, 28 to 40 words each (about ${Math.round(per / 34)} lines).`}
Walk the viewer through the place: "now we stand before...", what to look at, who built it, the story behind it. Use the exact name of each monument when you talk about it.
Use ONLY the facts in the TEXT. Never invent or guess a name, date or number; if unsure, say it in general terms or leave it out. Never say we filmed inside. No hype, no "subscribe".
${told ? `Earlier chapters already told this (do not repeat it):\n${told}` : ''}
For each line give 2 short ENGLISH picture search queries that would really show it.
Every "line" is written in that language only${spec.lang === 'en' ? '' : ', never in English, although the TEXT is English'}.
Return JSON {"title": "short chapter title in the same language", "lines": [{"line": "the spoken line", "flight": false, "queries": ["", ""]}]}
TEXT:
${text.slice(0, 40000)}`, { temperature: 0.6 });
    const fresh = (s?.lines || []).map((l) => ({ ...l, en: l.line || l.en })).filter((l) => l.en && !lines.some((x) => x.en === l.en));
    if (!fresh.length) { await sleep(30000); continue; }
    const check = await askJson(`Check each line against the TEXT. A line is bad only when it states a name, date, number or event that the text does not support, or contradicts it.
Return JSON {"bad": [{"n": 1, "why": ""}]}.
LINES: ${JSON.stringify(fresh.map((l, i) => ({ n: i + 1, line: l.en })))}
TEXT:
${text.slice(0, 40000)}`, { temperature: 0.1 });
    if (!check) { await sleep(30000); continue; }
    const bad = new Set((check.bad || []).map((b) => b.n));
    lines.push(...fresh.filter((_, i) => !bad.has(i + 1)));
    title ||= s.title;
    console.log(`chapter ${c + 1} attempt ${attempt}: ${fresh.length} lines, ${bad.size} dropped by the editor, ${count(lines)}/${per} words`);
    await sleep(8000);
  }
  if (count(lines) < per * 0.75) throw new Error(`chapter ${c + 1}: only ${count(lines)} of ${per} words`);

  await inOwnLanguage(lines);
  if (spec.lang === 'ar') await proofread(lines);
  draft.chapters[c] = { title, lines: lines.map((l) => ({ en: l.en, queries: l.queries || [], ...(c === 0 && l.flight ? { flight: true } : {}) })) };
  write(draftFile, draft);
}

// chapters kept from an earlier run are held to the same rule
await inOwnLanguage(draft.chapters.flatMap((x) => x.lines));
// the map flight covers at most the first three lines
const first = draft.chapters[0].lines;
first.forEach((l, i) => { if (i < 3) l.flight = true; else delete l.flight; });

let meta = null;
for (let attempt = 1; attempt <= 4 && !meta?.title; attempt++) {
  meta = await askJson(`Title and description for this long virtual tour video, in ${L.name}. Subject: ${spec.subject}. Chapters: ${draft.chapters.map((x) => x.title).join(' / ')}.
Promise nothing the video does not show (it uses maps, photographs and narration, it was not filmed inside).
Return JSON {"title": "max 60 characters", "description": "two sentences", "thumbnailText": "2 to 4 words", "tags": ["8 tags"]}`, { temperature: 0.5 });
}
if (!meta?.title) throw new Error('no title');

// road legs follow the real road when Mapbox answers; a flight is a straight line
const legs = [];
for (const leg of spec.route.legs) {
  const km = Math.round(Math.hypot((leg.b[0] - leg.a[0]) * 100, (leg.b[1] - leg.a[1]) * 111));
  let line = [leg.a, leg.b], got = km;
  if (leg.mode === 'drive' && process.env.MAPBOX_TOKEN) {
    try {
      const r = await (await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${leg.a.join(',')};${leg.b.join(',')}?geometries=geojson&overview=full&access_token=${process.env.MAPBOX_TOKEN}`, { headers: { Referer: 'https://www.zalavip.com/' }, signal: AbortSignal.timeout(30000) })).json();
      if (r.routes?.[0]) { line = r.routes[0].geometry.coordinates; got = Math.round(r.routes[0].distance / 1000); }
    } catch { /* straight line */ }
  }
  legs.push({ mode: leg.mode, from: leg.from, ...(leg.fromAr ? { fromAr: leg.fromAr } : {}), to: leg.to, km: got, minutes: leg.mode === 'fly' ? Math.round(got / 11) + 20 : got, line });
}

write(out, {
  id, series: 'ZALA Virtual Tour', kind: 'tour', lang: spec.lang, verticalOnly: false, noReels: true,
  ...(L.style ? { voice: 'Orus', voiceStyle: L.style, voiceTempo: 1 } : {}),
  title: meta.title, thumbnailText: meta.thumbnailText, description: meta.description, tags: meta.tags || [],
  sources: [...sources].map((url) => ({ url })),
  route: { mode: legs[0].mode, summary: spec.route.said, legs, to: spec.route.to },
  prepared: { at: new Date().toISOString(), kind: 'tour' },
  chapters: draft.chapters,
});
const all = draft.chapters.flatMap((x) => x.lines);
console.log(`saved ${id}: "${meta.title}" — ${draft.chapters.length} chapters, ${all.length} lines, ${count(all)} words (wanted ${spec.words})`);
