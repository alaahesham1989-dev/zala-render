// Makes the Arabic copy of a finished English short: same pictures and shot choices, the words retold in
// Egyptian Arabic, an Egyptian Gemini voice. Writes content/youtube/<id>-AR.json (+ its shots file) and prints AR_ID:<id>.
// Usage: node media/tools/arabic.mjs <short id | words from its title> [voice]
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './gemini-lite.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const YT = path.join(REPO, 'content', 'youtube');
const [, , want = '', voice = 'Orus'] = process.argv;
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// the source short: an id, or words from its title
let src = read(path.join(YT, `${want}.json`));
if (!src) {
  const q = want.toLowerCase();
  for (const f of fs.readdirSync(YT).filter((f) => /^[^.]+\.json$/.test(f) && !f.includes('-AR'))) {
    const s = read(path.join(YT, f));
    if (s?.verticalOnly && String(s.title || '').toLowerCase().includes(q)) { src = s; break; }
  }
}
if (!src) throw new Error(`No English short found for "${want}"`);
const id = `${src.id}-AR`;
const lines = src.chapters.flatMap((c) => c.lines);

const ans = await askJson(`Retell this YouTube Short about ancient Egypt in spoken Egyptian Arabic (عامية مصرية شعبية دافية، زي حكواتي بيحكي لصحابه).
Rules:
- One Arabic line for each English line, same order, same facts. Never add or drop a fact, a date or a number.
- Write every number and date in Arabic words (مثلاً "تلات آلاف سنة"), never digits.
- Short spoken sentences, no English words, no emojis. Names in their usual Arabic spelling (توت عنخ آمون، نفرتيتي، رمسيس التاني).
- "hook": 2 to 4 strong Arabic words for the big text on the first picture.
- "title": a YouTube title in simple Modern Standard Arabic (فصحى بسيطة) with the main name in it, under 70 characters, ends with #shorts.
- "description": 2 short sentences in simple Modern Standard Arabic.
English title: ${src.title}
Lines:
${lines.map((l, i) => `${i + 1}. ${l.say || l.en}`).join('\n')}
Return only JSON {"title":"","hook":"","description":"","lines":["..."]}`, { temperature: 0.5 });

if (!ans?.lines || ans.lines.length !== lines.length) throw new Error(`Translation gave ${ans?.lines?.length} lines for ${lines.length}`);
let n = 0;
const copy = JSON.parse(JSON.stringify(src));
for (const c of copy.chapters) for (const l of c.lines) {
  const ar = String(ans.lines[n++]).trim();
  Object.assign(l, { en: ar, say: ar, enSource: l.en });
  delete l.ar; delete l.callout; delete l.card;
}
Object.assign(copy, {
  id, lang: 'ar', sourceId: src.id, title: ans.title, description: ans.description, thumbnailText: ans.hook,
  voice, voiceStyle: 'اتكلم بلهجة مصرية شعبية دافية، زي حكواتي بيحكي حكاية مشوقة لصحابه، بإيقاع طبيعي ومش سريع:',
  voiceTempo: 1, reels: undefined, reelLines: undefined, packaged: true,
});
fs.writeFileSync(path.join(YT, `${id}.json`), JSON.stringify(copy, null, 2) + '\n', 'utf8');
// the same picture choices, line for line
for (const ext of ['shots.json', 'pins.json']) {
  const f = path.join(YT, `${src.id}.${ext}`);
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(YT, `${id}.${ext}`));
}
console.log(`Arabic copy of ${src.id} "${src.title}" -> ${id} "${ans.title}", ${lines.length} lines, voice ${voice}`);
console.log(`AR_ID:${id}`);
