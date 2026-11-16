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

const english = lines.map((l, i) => `${i + 1}. ${l.say || l.en}`).join('\n');
const STYLE = `الأسلوب: عامية مصرية طبيعية زي حكواتي شاطر بيحكي لصحابه على القهوة، مش ترجمة.
- الجملة الأولى لازم تشد من أول ثانية: سؤال أو مفاجأة أو "تخيّل..."، مش مقدمة.
- استخدم روابط الحكي المصري لما تيجي طبيعية: "بس استنى"، "وهنا بقى"، "والغريب إن"، "طب إزاي؟".
- جمل قصيرة، كل سطر فكرة واحدة، كلام يتقال بصوت عالي بسهولة. ممنوع الفصحى التقيلة والكلام الإنشائي.
- كل سطر عربي طوله قريب من طول السطر الإنجليزي (عشان يمشي مع نفس الصورة)، ما يزيدش عن ١٨ كلمة.
- الحقائق زي ما هي بالظبط: ما تزودش ولا تشيل أي معلومة أو تاريخ أو رقم، وما تخترعش.
- الأرقام والتواريخ بالكلام العربي (زي "تلات آلاف سنة")، مش أرقام. من غير كلام إنجليزي ولا إيموجي.
- الأسماء بكتابتها العربي المعروفة (توت عنخ آمون، نفرتيتي، رمسيس التاني).
- آخر سطر يقفل الحكاية بجملة تفضل في الدماغ أو سؤال يخلي الناس تعلّق.`;

const draft = await askJson(`Retell this YouTube Short about ancient Egypt in spoken Egyptian Arabic.
${STYLE}
- "hook": من ٢ لـ ٤ كلمات عربي قوية بالعامية للكلام الكبير على أول صورة.
- "title": عنوان يوتيوب بالفصحى البسيطة فيه الاسم الأساسي، أقل من ٧٠ حرف، وآخره #shorts.
- "description": جملتين قصيرين بالفصحى البسيطة.
English title: ${src.title}
Lines:
${english}
One Arabic line for each English line, same order. Return only JSON {"title":"","hook":"","description":"","lines":["..."]}`, { temperature: 0.6 });
if (!draft?.lines || draft.lines.length !== lines.length) throw new Error(`Translation gave ${draft?.lines?.length} lines for ${lines.length}`);

// second pass: an Egyptian script editor polishes the draft against the English facts
const edited = await askJson(`انت مُحرر سكريبتات شاطر لقناة يوتيوب مصرية عن مصر القديمة. ده سكريبت شورت بالعامية، عايزك تحسّنه عشان يتسمع أحلى ويشد أكتر، من غير ما تغيّر ولا معلومة.
${STYLE}
- نفس عدد السطور (${lines.length}) ونفس الترتيب، كل سطر عربي قصاد السطر الإنجليزي بتاعه.
- صلّح أي جملة شكلها مترجمة حرفي أو تقيلة، وأي كلمة مش مصرية.
- الـ hook لازم يكون أقوى حاجة، من ٢ لـ ٤ كلمات.
English (the facts):
${english}
Arabic draft:
${draft.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}
hook: ${draft.hook}
Return only JSON {"hook":"","lines":["..."]}`, { temperature: 0.4 });
const ans = { ...draft };
if (edited?.lines?.length === lines.length) { ans.lines = edited.lines; if (edited.hook) ans.hook = edited.hook; }
else console.log('Editor pass gave the wrong number of lines, keeping the draft');
console.log('Arabic script:'); ans.lines.forEach((l, i) => console.log(`  ${i + 1}. ${l}`)); console.log(`  hook: ${ans.hook}`);

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
