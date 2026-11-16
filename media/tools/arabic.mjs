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
const STYLE = `أسلوب الحكواتي المتحمس — شخصية القناة:
الراوي مش مذيع ومش دكتور. هو اللي بيحكيلك على القهوة وعينيه بتلمع. بيفاجئك مش بيشرحلك.

قانون الهوك — السطر الأول:
- لازم يكون مفاجأة أو سؤال بيوجع أو رقم صادم، مش مقدمة أبدًا.
- أمثلة: "تمثال نفرتيتي اتسرق من مصر، والألمان عارفين" / "مات وهو عنده ١٩ سنة، ودفنوه بـ ١١٠ كيلو ذهب" / "ليه أعظم ملكة في التاريخ محدش يعرف عيلتها؟"

بنية الحلقة:
Hook صادم ← "بس استنى" / "والغريب إن" ← المعلومة الحقيقية بتفاصيل حسية ← الربط بيننا ودلوقتي ← جملة أخيرة بتفضل في الدماغ.

قواعد الأسلوب:
- روابط الحكي المصري لما تيجي طبيعية: "بس استنى"، "وهنا بقى"، "والغريب إن"، "طب إزاي؟"، "ماعرفوش".
- الأرقام بالكلام المصري: "تلت آلاف سنة" مش "3000". مقارنات حسية: مش "كان ضخم" ← "أعلى من ٥ طوابق".
- الأسماء بكتابتها العربي المعروفة (توت عنخ آمون، نفرتيتي، رمسيس التاني). مش كلام إنجليزي ولا إيموجي.
- كل سطر عربي طوله قريب من السطر الإنجليزي (يمشي مع نفس الصورة)، ما يزيدش عن ١٨ كلمة.
- الحقائق زي ما هي بالظبط: ما تزودش ولا تشيل معلومة أو رقم، ما تخترعش.
- آخر سطر يقفل الحكاية بجملة تفضل في الدماغ أو سؤال يخلي الناس تعلّق.

ممنوع تمامًا:
"في هذا الفيديو سنتحدث عن..." / "دعونا نستكشف..." / "يُعدّ" / "تُعتبر" / "الحضارة المصرية القديمة كانت عظيمة..." / أي جملة تبدأ بكلام إنشائي تقيل.`;

const draft = await askJson(`Retell this YouTube Short about ancient Egypt in spoken Egyptian Arabic for the ZALA VIP Arabic channel.
${STYLE}
- "hook": من ٢ لـ ٤ كلمات عربي قوية بالعامية للكلام الكبير على أول صورة — الصادمة اللي تشد.
- "title": عنوان يوتيوب بالفصحى البسيطة فيه الاسم الأساسي، أقل من ٧٠ حرف، وآخره #shorts.
- "description": جملتين قصيرين بالفصحى البسيطة.
English title: ${src.title}
Lines:
${english}
One Arabic line for each English line, same order. Return only JSON {"title":"","hook":"","description":"","lines":["..."]}`, { temperature: 0.6 });
if (!draft?.lines || draft.lines.length !== lines.length) throw new Error(`Translation gave ${draft?.lines?.length} lines for ${lines.length}`);

// second pass: Egyptian director's cut — energy, hooks, forbidden phrases
const edited = await askJson(`انت مخرج سكريبتات متخصص في قناة ZALA عربي، الأسلوب الحكواتي المتحمس.
مهمتك: خد الدرافت ده وحوّله لسكريبت يخبط، من غير ما تغيّر ولا معلومة.
${STYLE}
- نفس عدد السطور (${lines.length}) ونفس الترتيب.
- السطر الأول هو الهوك: لازم يكون مفاجأة أو سؤال بيوجع، مش مقدمة.
- صلّح أي جملة فيها "يُعدّ"/"تُعتبر"/"دعونا نستكشف" أو مترجمة حرفيًا.
- التوتر: بدّل "و" بـ "بس"/"والغريب إن"/"وهنا بقى" لما يفيد.
- الـ hook لازم يكون أقوى حاجة في الشورت، من ٢ لـ ٤ كلمات.
English (the facts — لا تغيّر منها حاجة):
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
  delete l.ar; delete l.card;  // callout kept: English artifact name shown on screen
}
Object.assign(copy, {
  id, lang: 'ar', sourceId: src.id, title: ans.title, description: ans.description, thumbnailText: ans.hook,
  voice, voiceStyle: 'Speak only in Egyptian Arabic dialect (عامية مصرية). Warm storyteller tone, natural Egyptian rhythm, lively pace. اتكلم بلهجة مصرية شعبية دافية، زي حكواتي بيحكي حكاية مشوقة لصحابه، بإيقاع طبيعي ومش سريع:',
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
