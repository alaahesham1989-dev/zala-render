// node --test media/lib/arabic-proof.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { proofArabic, proofLine } from './arabic-proof.mjs';

describe('arabic proofreading', () => {
  it('unifies historical names', () => {
    assert.equal(proofLine('توتعنخ امون كان ملك.').fixed, 'توت عنخ آمون كان ملك.');
    assert.equal(proofLine('معبد ابو سمبل').fixed, 'معبد أبو سمبل');
    assert.equal(proofLine('قصة اخناتون').fixed, 'قصة أخناتون');
  });
  it('fixes punctuation spacing and doubles', () => {
    assert.equal(proofLine('يا جماعة ،، شوفوا !!').fixed, 'يا جماعة، شوفوا!');
  });
  it('flags Latin letters, figures and repeated words', () => {
    const r = proofArabic(['ده VIP جداً', 'من 3000 سنة', 'الملك الملك مات']);
    assert.ok(r.problems.includes('line 1: has Latin letters'));
    assert.ok(r.problems.includes('line 2: has figures: write numbers as spoken words'));
    assert.ok(r.problems.includes('line 3: a word is repeated'));
  });
  it('flags long and empty lines, and passes a clean one', () => {
    assert.ok(proofLine(Array(40).fill('كلمة').map((w, i) => w + i % 2).join(' ')).problems.some((p) => p.startsWith('too long')));
    assert.deepEqual(proofLine('').problems, ['empty line']);
    assert.deepEqual(proofLine('بس استنى، الموضوع أعمق من كده.').problems, []);
  });
});
