// media/lib/director.mjs — the director: every line shows what it talks about, or an honest text card instead.
// It screens each picture once (nudity, modern intrusions, poor scans), chooses pictures per chapter, then checks each choice by eye.
const LITE = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const MAX_USES = 2;   // one picture appears at most twice in an episode

export async function askVision(parts, { keyFor, markSpent, log, sleep, models = LITE }) {
  for (let round = 1; round <= 5; round++) {
    for (const model of models) {
      const key = keyFor(model);
      if (!key) continue;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }), signal: AbortSignal.timeout(180000),
        });
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
        if (res.ok && text) return JSON.parse(text);
        if (JSON.stringify(data.error || '').includes('PerDay')) markSpent(model, key);
        log(`  ${model}: answered ${res.status}`);
      } catch (e) { log(`  ${model}: ${e.name}`); }
    }
    if (models.every((m) => !keyFor(m))) return null;
    await sleep(15000 * round);
  }
  return null;
}

/** Looks at each picture once and remembers the answer in the library. */
export async function screenPictures(pics, tools) {
  const { thumb, log, sleep } = tools;
  const todo = pics.filter((p) => !p.seen.check);
  log(`Director: looking at ${todo.length} pictures not screened yet`);
  for (let i = 0; i < todo.length; i += 8) {
    const group = todo.slice(i, i + 8);
    const parts = [{ text: `You screen pictures for a family-friendly true-history video channel. For each numbered picture return JSON {"items":[{"n":0,"nudity":false,"modern":false,"poor":false,"kind":"","note":""}]}.
nudity: true if any bare breasts, genitals or a naked or nearly naked body is visible, even in a classical painting or statue.
modern: true if the picture is dominated by modern things: cars, street signs, glass buildings, museum visitors, display cases filling the frame.
poor: true if it is very blurry, a tiny scan, heavily watermarked, or mostly a picture frame or empty paper.
kind: one of ancient-object, ancient-site, ancient-art, later-painting, later-engraving, map, satellite, modern-photo, modern-building, other.` }];
    const ok = [];
    for (const p of group) {
      const data = await thumb(p);
      if (!data) { p.seen.check = { poor: true, note: 'could not open' }; continue; }
      parts.push({ text: `Picture ${ok.length}. Label: ${String(p.title).slice(0, 120)}` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data } });
      ok.push(p);
    }
    if (ok.length) {
      const a = await askVision(parts, tools);
      if (!a?.items) { log('Director: no answer while screening, the rest stay unscreened and are not used'); break; }
      for (const r of a.items) { const p = ok[r.n]; if (p) { const { n, ...check } = r; p.seen.check = check; } }
    }
    log(`  screened ${Math.min(i + 8, todo.length)}/${todo.length}`);
    await sleep(4000);
  }
  const clean = pics.filter((p) => p.seen.check && !p.seen.check.nudity && !p.seen.check.poor);
  log(`Director: ${clean.length} of ${pics.length} pictures are clean, ${pics.filter((p) => p.seen.check?.nudity).length} show nudity`);
  return clean;
}

const catalogRow = (p) => [p.id, p.seen.check?.kind, p.seen.check?.modern ? 'MODERN' : '', p.seen.subject, p.seen.what, p.seen.period, p.seen.place].join(' | ');

const MODERN_LINE = /\b(nineteen|two thousand|twenty (ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)|eighteen|today|modern|now)\b/i;
const isModernPicture = (p) => p.seen.check?.modern || /^modern/.test(p.seen.check?.kind || '');

/** A photo of a named place belongs only to lines about that place. A modern picture belongs only to modern lines. */
function allowedForLine(p, line, places) {
  if (isModernPicture(p) && !MODERN_LINE.test(line)) return false;
  if (!/site|photo|building|satellite/.test(p.seen.check?.kind || '')) return true;
  const about = [p.title, p.seen.subject, p.seen.what, p.seen.place].join(' ');
  const shows = places.filter((x) => new RegExp(x.match).test(about));
  return !shows.length || shows.some((x) => new RegExp(x.match).test(line));
}

/** Chooses pictures per chapter and checks them by eye. Returns nothing: fills line.pictures and line.card in the script. */
export async function directEpisode(script, pics, tools) {
  const { thumb, log, sleep, places = [] } = tools;
  const byId = new Map(pics.map((p) => [p.id, p]));
  const uses = new Map();
  for (const chapter of script.chapters) {
    const free = pics.filter((p) => (uses.get(p.id) || 0) < MAX_USES);
    const numbered = chapter.lines.map((l, n) => `${n}. ${l.en}`).join('\n');
    const a = await askVision([{ text: `You are the film director of a true-history YouTube video. Choose the pictures shown over each line of this chapter.
RULES:
- The picture must really show what the line talks about: the same person, object, place, or event. A loosely related ancient object is not good enough.
- A line about a named place needs that place. A line about a named person needs that person or a work that depicts them. Never show one person's portrait for another person.
- Modern photos and MODERN pictures only for lines about modern discoveries or today. Never a modern building for an ancient one.
- later-painting is fine for dramatic scenes from the story, but not for a claim about evidence or a specific object.
- Give 1 to 2 pictures per line. Prefer variety and never repeat a picture within this chapter.
- A line telling the story of a person may show that person's portrait, coin, or a painting of the scene. The opening line of the episode must always have a striking picture of its main subject.
- A photo of a named place only for a line about that place.
- If no picture truly fits, give an empty list.
- Write "card" for every line: one complete, striking fact of up to 6 words, keeping apostrophes, never starting with a filler like However or Furthermore.
Always include "card" for every line, even when pictures fit.
Return only JSON {"items":[{"n":0,"pictures":["id"],"card":""}]}.

LINES:
${numbered}

PICTURE CATALOG (id | kind | flag | subject | what is visible | period | place):
${free.map(catalogRow).join('\n')}` }], tools);
    chapter.lines.forEach((l) => { l.pictures = []; });
    for (const r of a?.items || []) {
      const line = chapter.lines[r.n];
      if (!line) continue;
      line.card = String(r.card || '').trim();
      line.pictures = (r.pictures || []).filter((id) => byId.has(id) && (uses.get(id) || 0) < MAX_USES && allowedForLine(byId.get(id), line.en, places)).slice(0, 2);
      line.pictures.forEach((id) => uses.set(id, (uses.get(id) || 0) + 1));
    }
    await sleep(4000);
    // the eye test: each choice is seen together with its sentence
    const checks = chapter.lines.flatMap((l) => l.pictures.map((id) => ({ l, id })));
    for (let i = 0; i < checks.length; i += 6) {
      const group = checks.slice(i, i + 6);
      const parts = [{ text: 'For each numbered picture you get the sentence spoken over it in a true-history video. Answer "fits" true if the picture really shows the person, place, object or event of the sentence, including a portrait or coin of the person the sentence is about or a painting of that scene. A generic ancient object or a different person does not fit. Return only JSON {"items":[{"n":0,"fits":true,"why":""}]}.' }];
      const ok = [];
      for (const c of group) {
        const data = await thumb(byId.get(c.id));
        if (!data) continue;
        parts.push({ text: `Picture ${ok.length}. Sentence: ${c.l.en}` });
        parts.push({ inlineData: { mimeType: 'image/jpeg', data } });
        ok.push(c);
      }
      const v = ok.length ? await askVision(parts, tools) : null;
      for (const r of v?.items || []) {
        const c = ok[r.n];
        if (c && r.fits === false) {
          c.l.pictures = c.l.pictures.filter((x) => x !== c.id);
          (c.l.rejected ||= []).push(c.id);
          uses.set(c.id, Math.max(0, (uses.get(c.id) || 1) - 1));
          log(`  rejected a picture for: ${c.l.en.slice(0, 60)} (${String(r.why).slice(0, 70)})`);
        }
      }
      await sleep(4000);
    }
  }
  // a last, closer look for nudity at everything chosen, so it is caught before an hour of rendering
  const chosen = [...new Set(script.chapters.flatMap((c) => c.lines.flatMap((l) => l.pictures)))];
  for (let i = 0; i < chosen.length; i += 6) {
    const group = chosen.slice(i, i + 6);
    const parts = [{ text: 'A family-friendly channel may not show any bare breast, exposed nipple, deep open neckline showing the breast, genitals or naked body, even in classical art. For each numbered picture return only JSON {"items":[{"n":0,"nudity":false}]}. When unsure, answer true.' }];
    const ok = [];
    for (const id of group) {
      const data = await (tools.thumbLarge || thumb)(byId.get(id));
      if (!data) continue;
      parts.push({ text: `Picture ${ok.length}` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data } });
      ok.push(id);
    }
    const v = ok.length ? await askVision(parts, tools) : null;
    for (const r of v?.items || []) {
      const id = ok[r.n];
      if (id && r.nudity) {
        byId.get(id).seen.check = { ...(byId.get(id).seen.check || {}), nudity: true, note: 'closer look' };
        script.chapters.forEach((c) => c.lines.forEach((l) => { l.pictures = l.pictures.filter((x) => x !== id); if (l.rejected) l.rejected = l.rejected.filter((x) => x !== id); }));
        byId.delete(id);
        log('  removed one picture on a closer look');
      }
    }
    await sleep(3000);
  }
  const lines = script.chapters.flatMap((c) => c.lines);
  // never more than two cards in a row: give back the nearest picture the eye test was unsure of, then one from the same chapter
  const chapterOf = new Map(script.chapters.flatMap((c) => c.lines.map((l) => [l, c])));
  let run = 0;
  for (const l of lines) {
    if (l.pictures.length) { run = 0; continue; }
    run++;
    if (run <= 2) continue;
    const back = (l.rejected || []).find((id) => byId.has(id) && (uses.get(id) || 0) < MAX_USES && allowedForLine(byId.get(id), l.en, places));
    const near = chapterOf.get(l).lines.flatMap((x) => x.pictures).find((id) => byId.has(id) && (uses.get(id) || 0) < MAX_USES + 1 && allowedForLine(byId.get(id), l.en, places));
    const pick = back || near;
    if (pick) { l.pictures = [pick]; uses.set(pick, (uses.get(pick) || 0) + 1); run = 0; }
  }
  lines.forEach((l) => { delete l.rejected; });
  const cards = lines.filter((l) => !l.pictures.length);
  cards.forEach((l) => { if (!l.card) l.card = l.en.split(/[,.]/)[0].split(/\s+/).slice(0, 7).join(' '); });
  script.directed = 6;
  log(`Director: ${lines.length - cards.length} lines with pictures, ${cards.length} with a text card`);
}
