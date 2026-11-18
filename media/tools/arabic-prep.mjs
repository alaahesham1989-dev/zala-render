// arabic-prep.mjs — Original Arabic Short prep (NOT a translation).
// Picks a topic from arabic-treasures.json, researches facts from Wikipedia,
// writes a 60-second Egyptian Arabic script using the الحكواتي المتحمس direction,
// runs an editor pass, and writes content/youtube/<id>.json ready for make.sh.
// Usage: node media/tools/arabic-prep.mjs <id e.g. ZV-AR01> [voice]
// Runs on GitHub Actions inside arabic.yml when no source= input is given.
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './gemini-lite.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const YT   = path.join(REPO, 'content', 'youtube');
const [, , id = '', voice = 'Orus'] = process.argv;
if (!id) throw new Error('usage: node media/tools/arabic-prep.mjs <id> [voice]');

const TREASURES = path.join(import.meta.dirname, 'arabic-treasures.json');
const spec = JSON.parse(fs.readFileSync(TREASURES, 'utf8'))[id];
if (!spec) throw new Error(`${id} not found in arabic-treasures.json`);

const log = (...a) => console.log('[arabic-prep]', ...a);
const UA  = { 'User-Agent': 'ZALA-VIP-arabic-prep/1.0 (https://www.zalavip.com)' };
fs.mkdirSync(YT, { recursive: true });
fs.mkdirSync(path.join(REPO, 'content', 'factbank'), { recursive: true });

// ── direction rules (الحكواتي المتحمس) ──────────────────────────────
const DIRECTION = `أسلوب الحكواتي المتحمس — قناة ZALA عربي:

الشخصية: الراوي مش مذيع ومش دكتور. بيحكيلك على القهوة وعينيه بتلمع. بيفاجئك مش بيشرحلك.

قانون الهوك — السطر الأول (أهم سطر):
- لازم يكون مفاجأة أو سؤال بيوجع أو رقم صادم، مش مقدمة أبدًا.
- يخلي المشاهد يحس إنه لو عدّى هيفوت حاجة.
- أمثلة: "لما تموت قلبك بيتوزن — والحكم في ثانية واحدة" / "بناه من غير آلات، ومرتين في السنة الشمس بتلمس وشه"

بنية الحلقة:
Hook صادم ← "بس استنى" / "والغريب إن" ← المعلومة الحقيقية بتفاصيل حسية ← الربط بيننا ودلوقتي ← جملة أخيرة بتفضل في الدماغ.

قواعد الأسلوب:
- روابط الحكي المصري لما تيجي طبيعية: "بس استنى"، "وهنا بقى"، "والغريب إن"، "طب إزاي؟"، "ماعرفوش".
- الأرقام بالكلام المصري: "تلت آلاف سنة" مش "3000". مقارنات حسية: مش "كان ضخم" ← "أعلى من ٥ طوابق".
- الأسماء بكتابتها العربي المعروفة. مش كلام إنجليزي ولا إيموجي.
- كل سطر فكرة واحدة، جملة قصيرة، كلام يتقال بصوت عالي بسهولة.
- الحقائق زي ما هي بالظبط: ما تزودش ولا تشيل معلومة أو رقم، ما تخترعش.
- آخر سطر يقفل الحكاية بجملة تفضل في الدماغ أو سؤال يخلي الناس تعلّق.

ممنوع تمامًا:
"في هذا الفيديو سنتحدث عن..." / "دعونا نستكشف..." / "يُعدّ" / "تُعتبر" / أي كلام إنشائي تقيل.`;

const SHOT_RULES = `How to write a Flow prompt (a video model):
- Describe only what is in the frame and how the view moves. Never name filming equipment.
- The movement is already under way before the clip starts.
- One fixed lens, no zoom: things get bigger because the view travels closer.
- Every shot reveals something by its end.
- Light: torches, oil lamps, sunlight through dust; warm gold against deep shadow. Ancient Egyptian look.
- End with one sentence of failures: "It fails if any text, logo, modern object or modern person appears."
- 8 seconds, one continuous shot.`;

// ── 1. Wikipedia facts ───────────────────────────────────────────────
async function wiki(params) {
  const url = `https://en.wikipedia.org/w/api.php?format=json&origin=*&${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  return res.json();
}

async function buildFacts() {
  const factFile = path.join(REPO, 'content', 'factbank', `${id.toLowerCase()}-facts.json`);
  const old = (() => { try { return JSON.parse(fs.readFileSync(factFile, 'utf8')); } catch { return null; } })();
  if (old?.facts?.length >= 20) { log(`facts: ${old.facts.length} already`); return old; }

  const titles = [];
  for (const q of spec.queries.slice(0, 8)) {
    try {
      const r = await wiki({ action: 'query', list: 'search', srsearch: q, srlimit: 2 });
      for (const p of (r.query?.search || [])) if (!titles.includes(p.title)) titles.push(p.title);
    } catch { /* next */ }
  }
  let text = '';
  for (const t of titles.slice(0, 6)) {
    try {
      const pages = (await wiki({ action: 'query', prop: 'extracts', explaintext: 1, titles: t })).query.pages;
      const body = Object.values(pages)[0]?.extract || '';
      text += `\n\n=== ${t} ===\n${body.slice(0, 12000)}`;
    } catch { /* skip */ }
  }
  log(`facts: Wikipedia pages: ${titles.slice(0, 6).join(' | ')}`);

  const bank = await askJson(`Build a fact bank for a 60-second Egyptian Arabic YouTube Short titled "${spec.title}".
Use ONLY the Wikipedia text below. Never add anything from memory.
Return JSON {"topic": "${spec.title}", "summary": "3 sentences in English", "facts": ["30 to 50 short facts, each one sentence, with names, dates, numbers exactly as in the text"], "common_myths": ["claims the text says are wrong"], "sources": [{"title": "", "url": ""}]}
TEXT:${text.slice(0, 80000)}`, { temperature: 0.1 });
  if (!bank?.facts?.length) throw new Error('no fact bank');
  fs.writeFileSync(factFile, JSON.stringify(bank, null, 2) + '\n');
  log(`facts: ${bank.facts.length} facts saved`);
  return bank;
}

// ── 2. picture library ───────────────────────────────────────────────
function loadPictures() {
  const ITEMS = path.join(REPO, 'content', 'library', 'items.jsonl');
  if (!fs.existsSync(ITEMS)) return [];
  const all = fs.readFileSync(ITEMS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const re = new RegExp(spec.match, 'i');
  return all.filter((i) => i.kind === 'image' && i.seen?.usable &&
    (re.test(i.title) || re.test(i.seen?.what || '') || (i.topics || []).includes(id)));
}

// ── 3. write the Arabic short script ────────────────────────────────
const TARGET_WORDS = 180;  // ~60 seconds at Egyptian speech pace (~3 words/sec)
const TARGET_LINES = 10;   // 8-12 lines for a 60-second short

async function writeScript(bank, pics) {
  const known = new Set(pics.map((p) => p.id));
  const catalog = pics.slice(0, 150).map((p) => [p.id, String(p.title).slice(0, 80), p.seen.what].join(' | ')).join('\n');

  const SCRIPT_RULES = `أنت بتكتب شورت يوتيوب بالعامية المصرية عن مصر القديمة لقناة ZALA عربي.
${DIRECTION}
${SHOT_RULES}

قواعد الشورت:
- المدة المطلوبة: ٦٠ ثانية بالظبط = تقريباً ${TARGET_WORDS} كلمة بالعامية المصرية.
- عدد السطور: ${TARGET_LINES} سطر تقريباً (٨-١٢ سطر).
- كل سطر: جملة واحدة أو جملتين قصيرتين بالعامية، أقصاها ٢٠ كلمة.
- السطر الأول: الهوك اللي يشد من أول ثانية.
- آخر سطر: الضربة اللي تفضل في الدماغ.

للصور: لو في صورة من الكتالوج بتوافق السطر، حطها. لو مش في، اكتب "gen" بـ Flow prompt لتوليد الصورة.
السطر الأول دايمًا gen (hook shot). استخدم gen في ٣-٤ سطور بالكتر.

Return JSON only:
{
  "title": "عنوان يوتيوب بالفصحى البسيطة أقل من ٧٠ حرف، آخره #shorts",
  "hook": "من ٢ لـ ٤ كلمات عامية — الكلام الكبير على أول صورة",
  "description": "جملتين بالفصحى البسيطة",
  "chapters": [{"title": "اسم قصير", "lines": [
    {"en": "السطر بالعامية المصرية", "pictures": ["id أو فاضي"], "gen": {"kind": "hook|reconstruction", "prompt": "Flow prompt بالإنجليزي"}}
  ]}],
  "reels": [{"chapter": 1, "title": "", "hook": "أقصاها ٥ كلمات", "sub": "جملة قصيرة عن الموضوع"}]
}
callout و sfx اختياريين. أول reel من chapter 1.`;

  const countWords = (ls) => ls.reduce((n, l) => n + String(l.en || '').split(/\s+/).filter(Boolean).length, 0);
  const numbered = (ls) => ls.map((l, i) => `${i + 1}. ${l.en}`).join('\n');
  let feedback = '', issues = '', best = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const s = await askJson(`${SCRIPT_RULES}

الموضوع: ${spec.title}
فكرة الهوك: ${spec.hook}
${feedback}

FACT BANK (استخدم بس الحقائق دي، ما تخترعش):
${JSON.stringify(bank.facts).slice(0, 30000)}

PICTURE CATALOG (id | title | what is visible):
${catalog || '(no pictures yet)'}`, { temperature: 0.7 });

    const lines = s?.chapters?.flatMap((c) => c.lines || []) || [];
    if (!lines.length) { log(`script ${attempt}: no answer`); continue; }

    // keep only valid picture ids
    for (const l of lines) {
      l.pictures = (l.pictures || []).filter((p) => known.has(p));
      if (!l.gen?.prompt || l.pictures.length) delete l.gen;
    }

    const words = countWords(lines);
    log(`script ${attempt}: ${lines.length} lines, ${words} words`);

    if (words < TARGET_WORDS * 0.7) {
      // a short answer (usually a lite model while the big ones are busy) keeps the editor's notes and builds on the best script so far
      const base = best ? `\nابدأ من السكريبت ده وزوّد عليه:\n${numbered(best.lines)}` : '';
      feedback = `${base}${issues}\nمحاولتك الأخيرة كانت ${words} كلمة بس. عايزين ${TARGET_WORDS} كلمة. أضف سطور من الـ FACT BANK من غير ما تخترع.`;
      continue;
    }

    // editor check
    const bad = await askJson(`أنت محرر متخصص في محتوى مصر القديمة. راجع السكريبت ده سطر بسطر.
السطر "بيبوظ" لو:
- بيقول حاجة مش في الـ FACT BANK (اسم أو تاريخ أو رقم مخترع).
- فيه فصحى تقيلة أو "يُعدّ" أو "دعونا نستكشف" أو مقدمة كلاسيكية.
- صورته (لو في) مش بتوافق الكلام.
Return JSON {"bad": [{"n": رقم السطر, "why": "سبب قصير"}]} (فاضي لو كل حاجة تمام).
FACT BANK: ${JSON.stringify(bank.facts).slice(0, 20000)}
SCRIPT:
${lines.map((l, i) => `${i + 1}. ${l.en}`).join('\n')}`, { temperature: 0 });

    // no editor answer means the facts were not checked: never accept that script
    if (!bad) { log(`script ${attempt}: editor did not answer`); continue; }
    const errors = bad.bad || [];
    log(`script ${attempt}: editor found ${errors.length} issues`);
    errors.forEach((b) => log(`  line ${b.n}: ${b.why}`));

    if (!errors.length) return s;

    if (!best || errors.length < best.errors.length) best = { s, lines, errors };
    issues = `\nالمحرر رفض السطور دي:\n${errors.map((b) => `  ${b.n}. ${b.why}`).join('\n')}`;
    feedback = `\nالسكريبت اللي فات:\n${numbered(lines)}${issues}\nصلّح السطور دي بس أو شيلها وعوّضها بحقائق من الـ FACT BANK، وسيب باقي السطور زي ما هي. المجموع حوالي ${TARGET_WORDS} كلمة.`;
  }

  // last resort: the best checked script without the lines the editor rejected
  if (best) {
    const rejected = new Set(best.errors.map((b) => Number(b.n)));
    let n = 0;
    for (const c of best.s.chapters) c.lines = (c.lines || []).filter(() => !rejected.has(++n));
    best.s.chapters = best.s.chapters.filter((c) => c.lines.length);
    const left = countWords(best.s.chapters.flatMap((c) => c.lines));
    log(`fallback: best script without ${rejected.size} rejected lines, ${left} words`);
    if (left >= TARGET_WORDS * 0.55) return best.s;
  }
  throw new Error('script failed all 4 attempts');
}

// ── 4. assemble and save ─────────────────────────────────────────────
async function main() {
  const outFile = path.join(YT, `${id}.json`);
  if (fs.existsSync(outFile)) { log(`already exists: ${outFile}`); process.exit(0); }

  const bank = await buildFacts();
  const pics = loadPictures();
  log(`pictures: ${pics.length} usable`);

  const script = await writeScript(bank, pics);

  const doc = Object.assign({}, script, {
    id,
    lang: 'ar',
    voice,
    voiceStyle: 'Speak only in Egyptian Arabic dialect (عامية مصرية). Passionate Egyptian storyteller tone — warm, energetic, lively pace, like a great Cairo kahwa storyteller. اتكلم بلهجة مصرية شعبية متحمسة زي حكواتي شاطر بيحكي حكاية بتشد:',
    voiceTempo: 1,
    verticalOnly: true,
    packaged: true,
  });

  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  log(`saved: ${outFile}`);
  console.log(`AR_ID:${id}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
