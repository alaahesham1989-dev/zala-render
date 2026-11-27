// node --test media/lib/watchdog-radar.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findTrouble, mayRetry, needsHand, handText } from './watchdog.mjs';
import { blockedBy, radar } from './radar.mjs';

const now = Date.parse('2026-11-25T12:00:00Z');
const at = (hoursAgo) => new Date(now - hoursAgo * 3600e3).toISOString();
const run = (id, status, conclusion, created, updated = created, workflowName = 'Render') =>
  ({ databaseId: id, status, conclusion, createdAt: at(created), updatedAt: at(updated), workflowName });

describe('watchdog', () => {
  it('reports new failures, stuck and waiting runs once', () => {
    const runs = [
      run(1, 'completed', 'failure', 1, 0.1),
      run(2, 'completed', 'failure', 9, 8),           // old news
      run(3, 'completed', 'success', 1, 0.1),
      run(4, 'in_progress', null, 6),
      run(5, 'queued', null, 4),
      run(6, 'in_progress', null, 6, 6, 'ZALA clock (starts everything on time)'),
      run(7, 'completed', 'cancelled', 1, 0.1),
    ];
    const t = findTrouble(runs, { now, since: now - 900e3 });
    assert.deepEqual(t.map((x) => [x.id, x.why]), [[1, 'failed'], [4, 'stuck'], [5, 'waiting']]);
    assert.equal(findTrouble(runs, { now, since: now - 900e3, told: new Set([1, 4, 5]) }).length, 0);
    assert.equal(mayRetry('ZALA Arabic prep (facts)', 1), true);
    assert.equal(mayRetry('ZALA Arabic prep (facts)', 2), false);
    assert.equal(mayRetry('ZALA meta publish', 1), false);   // never retries a publisher
    assert.equal(needsHand('Error: invalid_grant').kind, 'login');
    assert.equal(needsHand('429 quota exceeded, please check your plan and billing details'), null);
    assert.match(handText(needsHand('API key not valid'), 'x', 'o/r', 4), /actions\/runs\/4/);
    assert.equal(findTrouble([{ databaseId: 9, workflowName: 'ZALA lip-sync test', status: 'completed', conclusion: 'failure', createdAt: at(1), updatedAt: at(0) }], { now, since: now - 900e3 }).length, 0);
  });
});

const ev = (id, start, extra = {}) => ({ id, title: { en: id, ar: 'مهرجان' }, start, source: 'https://example.org/x', ...extra });

describe('radar', () => {
  it('refuses political and security topics, not look-alike words', () => {
    assert.equal(blockedBy('Gold of the warm south'), null);
    assert.equal(blockedBy('The war museum'), 'war');
    assert.equal(blockedBy('مظاهرات في الشارع'), 'مظاهر');
  });
  it('keeps sourced events inside their window, fast ones first', () => {
    const r = radar([
      ev('sun festival', '2026-12-01'),
      ev('too far', '2027-03-01'),
      ev('new discovery', '2026-11-24', { track: 'fast' }),
      ev('election night', '2026-11-26'),
      ev('no source', '2026-11-26', { source: '' }),
    ], '2026-11-25');
    assert.deepEqual(r.due.map((d) => d.id), ['new discovery', 'sun festival']);
    assert.deepEqual(r.refused.map((x) => x.id), ['election night', 'no source']);
  });
});
