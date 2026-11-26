import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, matchScore, hearLines, hearTotals, hearProblems } from './heard.mjs';

test('Arabic spelling variants are the same letters', () => {
  assert.equal(normalize('الهرم الأكبر', 'ar').length, 2);   // the letters themselves must survive
  assert.deepEqual(normalize('أبو الهَوْلِ، حارسُ الأُفُق!', 'ar'), normalize('ابو الهول حارس الافق', 'ar'));
  assert.deepEqual(normalize('قاعة الملكة إلى', 'ar'), normalize('قاعه الملكه الي', 'ar'));
});

test('numbers said as words or digits are not compared', () => {
  assert.deepEqual(normalize('سنة ألف وربعمية قبل الميلاد', 'ar'), normalize('سنة 1400 قبل الميلاد', 'ar'));
  assert.deepEqual(normalize('hace cuatro mil años', 'es'), normalize('hace 4000 años', 'es'));
});

test('a right line scores high, even split differently; another line scores low', () => {
  const line = 'إحنا دلوقتي قدام تمثال أبو الهول العظيم';
  assert.ok(matchScore(line, 'احنا دلوقتى قدام تمثال ابوالهول العظيم', 'ar') > 0.9);
  assert.ok(matchScore(line, 'المركب دي مصنوعة من خشب الأرز اللبناني الفاخر ومربوطة بالحبال', 'ar') < 0.5);
  assert.ok(matchScore('La Gran Esfinge guarda la meseta', 'la gran esfinge guarda la meseta', 'es') > 0.95);
  assert.equal(matchScore(line, '', 'ar'), 0);
});

test('late captions are told apart from a wrong voice', () => {
  const srt = [{ n: 1, start: 0, end: 3, text: 'الهرم الأكبر بناه الملك خوفو' }, { n: 2, start: 10, end: 13, text: 'تحتمس نام تحت راس أبو الهول' }];
  const at = (text, t) => text.split(' ').map((w, i) => ({ w, start: t + i * 0.4, end: t + i * 0.4 + 0.3 }));
  const late = [...at(srt[0].text, 5), ...at(srt[1].text, 10)];
  const scored = hearLines(srt, late, 'ar');
  const problems = hearProblems(scored, hearTotals(scored, srt, late, 'ar'), srt, 'ar');
  assert.match(problems[0], /line 1: the captions are out of step/);
  const wrong = [...at('كلام تاني خالص ملوش علاقه بحاجه', 0), ...at(srt[1].text, 10)];
  const s2 = hearLines(srt, wrong, 'ar');
  assert.match(hearProblems(s2, hearTotals(s2, srt, wrong, 'ar'), srt, 'ar')[0], /line 1: the voice and the words do not match/);
});

test('a voice that says much more than the script is caught', () => {
  const srt = [{ n: 1, start: 0, end: 20, text: 'الهرم الأكبر بناه الملك خوفو' }];
  const heard = 'اتكلم بالعامية المصرية زي حكواتي سينمائي الهرم الأكبر بناه الملك خوفو'.split(' ').map((w, i) => ({ w, start: i, end: i + 0.5 }));
  const scored = hearLines(srt, heard, 'ar');
  assert.ok(hearProblems(scored, hearTotals(scored, srt, heard, 'ar'), srt, 'ar').some((x) => /more than the script/.test(x)));
});
