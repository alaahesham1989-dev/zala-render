import test from 'node:test';
import assert from 'node:assert/strict';
import { captionEvents } from './punch.mjs';

const at = (words) => words.map((w, i) => ({ w, t0: i * 0.5, t1: i * 0.5 + 0.4 }));

test('an Arabic caption group is one line with no colour tags inside', () => {
  const ev = captionEvents(at(['حافة', 'الصحراء', 'الغربية']), { style: 'Cap' });
  assert.equal(ev.length, 1);
  assert.ok(!ev[0].includes('\c&'));
  assert.ok(ev[0].includes('حافة الصحراء الغربية'));
});

test('English captions keep the highlighted word', () => {
  const ev = captionEvents(at(['hello', 'egypt']), { style: 'Cap' });
  assert.equal(ev.length, 2);
  assert.ok(ev[0].includes('HELLO') && ev[0].includes('\c'));
});
