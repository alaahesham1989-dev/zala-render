#!/usr/bin/env node
// media/tools/test-prep.mjs — writes one standalone short of a minute or more, in English or Spanish, from a topic in
// test-treasures.json: Wikipedia text -> script in the language -> editor check against the same text.
// Nothing is added to any state, queue or outbox. Usage: node media/tools/test-prep.mjs <id>
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './gemini-lite.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const id = process.argv[2];
const spec = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'test-treasures.json'), 'utf8'))[id];
if (!spec?.topic) throw new Error(`no test topic ${id}`);
const out = path.join(REPO, 'content', 'youtube', `${id}.json`);
if (fs.existsSync(out)) { console.log(`${id} is written already`); process.exit(0); }

const LANGS = {
  en: { name: 'plain, vivid spoken American English (simple words, for viewers 45 and older)', voiceStyle: undefined },
  es: { name: 'neutral Latin American Spanish, plain and vivid, written to be spoken', voiceStyle: 'Narra en español latino neutro, como un narrador de documental: voz grave, cálida y tranquila, con intriga y pausas naturales.' },
};
const L = LANGS[spec.lang];
if (!L) throw new Error(`no rules for language ${spec.lang}`);

const UA = { 'User-Agent': 'ZALA-VIP-shorts/1.0 (https://www.zalavip.com)' };
let text = '';
const sources = [];
for (const title of spec.wiki) {
  try {
    const r = await (await fetch(`https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`, { headers: UA })).json();
    const page = Object.values(r.query.pages)[0];
    if (page?.extract) { text += `\n\n== ${page.title} ==\n${page.extract.slice(0, 11000)}`; sources.push(`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`); }
  } catch { /* next page */ }
}
if (text.length < 1500) throw new Error('not enough facts');

const count = (lines) => lines.reduce((n, l) => n + String(l.en).split(/\s+/).filter(Boolean).length, 0);
let script = null, feedback = '';
for (let attempt = 1; attempt <= 4 && !script; attempt++) {
  const s = await askJson(`Write ONE standalone vertical video about ancient Egypt in ${L.name}. Topic: ${spec.topic}.
Spoken length 65 to 80 seconds: 10 or 11 lines, 170 to 190 words in total. Each line one or two short sentences.
Line 1 is the hook: a question or a mystery, no greeting, no introduction. Then calm documented storytelling that builds up. The last line pays off and ends with a question to the viewer. No "subscribe", no links, no hype.
Use ONLY the facts in the TEXT. Never invent or guess a name, date or number; if unsure, leave it out or say it in general terms. The title and hook must not promise anything the script does not tell.
For each line give 2 short ENGLISH picture search queries that would really show it.
Everything a viewer reads or hears (title, hook, badge, sub, thumbnailText, line text, tags) is in the same language as the script.
Return JSON {"title": "max 60 characters", "hook": "3 to 5 words", "badge": "1 to 3 words", "sub": "one short sentence", "thumbnailText": "2 to 4 words", "lines": [{"en": "the spoken line", "queries": ["", ""]}], "tags": ["5 tags"]}
${feedback}
TEXT:
${text.slice(0, 30000)}`, { temperature: 0.7 });
  if (!s?.lines?.length) continue;
  const words = count(s.lines);
  console.log(`attempt ${attempt}: ${s.lines.length} lines, ${words} words`);
  if (words < 160 || words > 205) { feedback = `Your last answer had ${words} words. It must be 170 to 190 words.`; continue; }
  const check = await askJson(`Check this script against the text. A line is bad when it says something the text does not support (an invented or wrong name, date or number).
Return JSON {"bad": [{"n": 1, "why": ""}]} with an empty list when every line is supported.
SCRIPT: ${JSON.stringify(s.lines.map((l, i) => ({ n: i + 1, line: l.en })))}
TEXT:
${text.slice(0, 30000)}`, { temperature: 0.1 });
  if (!check) continue;
  if (check.bad?.length) { feedback = `These lines of your last answer are not supported by the text, fix them: ${JSON.stringify(check.bad)}`; console.log(feedback.slice(0, 400)); continue; }
  script = s;
}
if (!script) throw new Error('no script passed the editor');

const doc = {
  id, series: 'ZALA VIP Shorts', verticalOnly: true, kind: 'mystery', lang: spec.lang, packaged: true,
  title: script.title, thumbnailText: script.thumbnailText, description: script.sub, tags: script.tags || [], sources,
  ...(L.voiceStyle ? { voice: 'Orus', voiceStyle: L.voiceStyle } : {}),
  chapters: [{ title: script.title, lines: script.lines.map((l) => ({ en: l.en, queries: l.queries || [] })) }],
  reels: [{ chapter: 1, from: 0, title: script.title, hook: script.hook, badge: script.badge, sub: script.sub }],
  prepared: { at: new Date().toISOString(), shots: 0, kind: 'mystery' },
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`saved ${id}: "${doc.title}"`);
doc.chapters[0].lines.forEach((l, i) => console.log(`  ${i + 1}. ${l.en}`));
