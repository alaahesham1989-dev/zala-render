// node --test media/lib/voice-chunks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutsFromWords } from './voice-chunks.mjs';
import { inLang } from './lang-check.mjs';

const say = (texts) => texts.join(' ').split(/\s+/).map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.4 }));
const EN = ['the great temple stands here', 'kings built it over many years', 'the sacred lake lies behind it', 'priests washed there every morning', 'our walk ends at the gate'];
const AR = ['المعبد الكبير واقف هنا', 'الملوك بنوه على سنين طويلة', 'البحيرة المقدسة وراه على طول'];

test('a full narration is cut into every line', () => {
  const r = cutsFromWords(EN, say(EN), [], 40);
  assert.equal(r.lines.length, 5);
  assert.equal(r.done, undefined);
});

test('a narration that stops early keeps only the well heard start', () => {
  const r = cutsFromWords(EN, say(EN.slice(0, 3)), [], 20);
  assert.equal(r.done, 2);
});

test('a narration of something else is refused', () => {
  assert.throws(() => cutsFromWords(EN, say(['completely different words about nothing at all']), [], 10));
});

test('Arabic is cut by its words too', () => {
  const r = cutsFromWords(AR, say(AR), [], 20);
  assert.equal(r.done, undefined);
  assert.ok(r.lines[1].t0 > 1 && r.lines[1].t0 < r.lines[2].t0);
});

test('a line in the wrong language is noticed', () => {
  assert.equal(inLang('How did a sleepy bend on the Nile become the golden capital?', 'ar'), false);
  assert.equal(inLang('دلوقتي واقفين قدام معبد رمسيس التاني', 'ar'), true);
  assert.equal(inLang('Now we stand before the great complex of King Djoser.', 'es'), false);
  assert.equal(inLang('Ahora estamos frente al gran complejo del rey Djoser.', 'es'), true);
  assert.equal(inLang('Now we stand before the great complex of King Djoser.', 'en'), true);
});
