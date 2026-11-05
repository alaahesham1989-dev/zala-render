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

const OPEN_LICENSE = /^(cc0|cc by(-sa)?( [\d.]+)?|public domain|pd\b)/i;
const stripHtml = (x) => String(x || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Open-license pictures for a search, from Wikimedia Commons. */
async function searchCommons(query, log) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ZalaRender/1.0 (https://www.zalavip.com)' }, signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    return Object.values(data?.query?.pages || {}).flatMap((p) => {
      const i = p.imageinfo?.[0], m = i?.extmetadata || {};
      const license = stripHtml(m.LicenseShortName?.value);
      if (!i || i.width < 800 || !OPEN_LICENSE.test(license) || /nc|nd/i.test(license.replace(/^public domain/i, ''))) return [];
      return [{ title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''), url: i.thumburl || i.url, source_url: i.descriptionurl, license, author: stripHtml(m.Artist?.value).slice(0, 80) || 'Wikimedia Commons' }];
    });
  } catch (e) { log(`  search failed: ${e.name}`); return []; }
}

/** Lines with no picture get a real search: each find must pass the eye test, and only then joins the library. */
async function findMissingPictures(script, tools, byId, uses, topicId) {
  const { log, sleep, thumb, addPicture, places = [] } = tools;
  const lines = script.chapters.flatMap((c) => c.lines).filter((l) => !l.pictures.length);
  if (!lines.length) return;
  log(`Director: searching for pictures for ${lines.length} lines`);
  const seen = new Set([...byId.values()].map((p) => p.source_url));
  let tried = 0;
  for (let i = 0; i < lines.length; i += 12) {
    const group = lines.slice(i, i + 12);
    const a = await askVision([{ text: `For each sentence from a true-history video about ancient Egypt, write 2 short Wikimedia Commons search terms for a real photograph, ancient artwork or map that would show it. Use concrete names of people, places and objects. Return only JSON {"items":[{"n":0,"queries":["",""]}]}.\n\n${group.map((l, n) => `${n}. ${l.en}`).join('\n')}` }], tools);
    for (const r of a?.items || []) {
      const line = group[r.n];
      if (!line || line.pictures.length || tried > 180) continue;
      for (const q of (r.queries || []).slice(0, 2)) {
        if (line.pictures.length) break;
        const found = (await searchCommons(q, log)).filter((c) => !seen.has(c.source_url)).slice(0, 5);
        const parts = [{ text: `The sentence is spoken in a family-friendly true-history video: "${line.en}". For each numbered picture answer: does it really show the person, place, object or event of the sentence? A generic object, a different person, or a modern object for an ancient event does not fit. Also report nudity: any bare breast, genitals or naked body, even in art. Return only JSON {"items":[{"n":0,"fits":false,"nudity":false,"kind":"ancient-object|ancient-site|ancient-art|later-painting|later-engraving|map|modern-photo|other","what":"short description","subject":"","place":"","period":""}]}.` }];
        const ok = [];
        for (const c of found) {
          const data = await thumb(c);
          if (!data) continue;
          seen.add(c.source_url);
          parts.push({ text: `Picture ${ok.length}. Label: ${c.title.slice(0, 110)}` });
          parts.push({ inlineData: { mimeType: 'image/jpeg', data } });
          ok.push(c);
          tried++;
        }
        if (!ok.length) continue;
        const v = await askVision(parts, tools);
        const hit = (v?.items || []).find((x) => ok[x.n] && x.fits === true && !x.nudity);
        if (hit) {
          const c = ok[hit.n];
          const p = { ...c, kind: 'image', source: 'Wikimedia Commons', topics: [topicId], seen: { usable: true, what: hit.what, subject: hit.subject, place: hit.place, period: hit.period, check: { nudity: false, modern: /^modern/.test(hit.kind), poor: false, kind: hit.kind } } };
          if (allowedForLine(p, line.en, places)) {
            const item = addPicture(p);
            byId.set(item.id, item);
            line.pictures = [item.id];
            uses.set(item.id, 1);
            log(`  found: ${c.title.slice(0, 60)} -> ${line.en.slice(0, 50)}`);
          }
        }
        await sleep(3000);
      }
    }
    await sleep(3000);
  }
}

const MAX_CARDS = 5;

/** The short line at the top of the screen, about every 25 seconds. It only points at what is coming, it never adds a fact. */
async function writeTeasers(lines, tools) {
  const a = await askVision([{ text: `These numbered lines are a true-history video. Write a short line for the top of the screen about every 6 lines that makes the viewer keep watching, like "STAY UNTIL THE END", "WATCH WHAT HAPPENS NEXT", or a question the coming lines answer. Up to 5 words. Use only names from the lines. Never state a new fact, a number or a date. Return only JSON {"items":[{"line":0,"text":""}]}.\n\n${lines.map((l, n) => `${n}. ${l.en}`).join('\n')}` }], tools);
  const known = new Set(lines.flatMap((l) => l.en.toLowerCase().match(/[a-z']+/g) || []));
  const plain = new Set('stay watch what happens next until the end keep did you know how why who where when is was it this that will wait for see comes and not a an of to in on at her his their she he they'.split(' '));
  return (a?.items || []).filter((x) => lines[x.line] && !/\d/.test(x.text) && (String(x.text).toLowerCase().match(/[a-z']+/g) || []).every((w) => known.has(w) || plain.has(w))).map((x) => ({ line: x.line, text: String(x.text).trim() })).filter((x) => x.text);
}

/** Card words come straight from the sentence, so a card can never say more than the story says. */
function cardFromLine(line, proposed) {
  const clean = (t) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim();
  const words = line.split(/\s+/);
  const clauses = line.split(/[,.;:?!]/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 2);
  const fits = (x) => x.split(/\s+/).length <= 7;
  const asked = String(proposed || '').replace(/[.,!?]+$/, '');
  // a card is always a whole clause, so it can never stop in the middle of a thought
  if (asked && clauses.some((x) => clean(x) === clean(asked)) && fits(asked)) return asked;
  return clauses.find(fits) || (words.length <= 7 ? line.replace(/[.,!?]+$/, '') : '');
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
- Write "card" for every line: up to 6 words copied exactly, in order, from the line itself, the most striking part. Do not rephrase and do not add anything.
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
  await findMissingPictures(script, tools, byId, uses, script.id);
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
  lines.forEach((l) => { l.card = cardFromLine(l.en, l.card); });
  // few cards, far apart: any other line without a picture shows the nearest one again with a new camera move
  let sinceCard = 99, shown = 0;
  for (const l of lines) {
    sinceCard++;
    if (l.pictures.length) continue;
    if (l.card && shown < MAX_CARDS && sinceCard >= 8) { shown++; sinceCard = 0; } else l.card = '';
  }
  if (!script.teasers?.length) script.teasers = await writeTeasers(lines, tools);
  script.directed = 8;
  log(`Director: ${lines.length - cards.length} lines with pictures, ${shown} text cards, ${(script.teasers || []).length} lines at the top`);
}
