// node --test media/lib/delta.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, collect, merge, snapshot } from './delta.mjs';

describe('parallel jobs', () => {
  it('keeps what both jobs added to one list', () => {
    const base = [{ id: 'A', n: 1 }];
    const one = [{ id: 'A', n: 1 }, { id: 'B', n: 2 }];
    const two = [{ id: 'A', n: 1 }, { id: 'C', n: 3 }];
    assert.deepEqual(merge(base, two, one).map((x) => x.id), ['A', 'B', 'C']);
  });

  it('keeps changes to different entries of one object, and a replaced outbox copy', () => {
    const base = { made: [{ id: 'A' }, { id: 'B' }], seen: { x: 1 } };
    const one = { made: [{ id: 'A', done: true }, { id: 'B' }], seen: { x: 1, y: 2 } };
    const two = { made: [{ id: 'A' }, { id: 'B', done: true }], seen: { x: 1, z: 3 } };
    assert.deepEqual(merge(base, two, one), { made: [{ id: 'A', done: true }, { id: 'B', done: true }], seen: { x: 1, y: 2, z: 3 } });
  });

  it('does not bring back an entry another job removed, nor lose one it did not touch', () => {
    const base = [{ id: 'A' }, { id: 'B' }];
    assert.deepEqual(merge(base, [{ id: 'B' }], [{ id: 'A' }, { id: 'B' }, { id: 'C' }]).map((x) => x.id), ['B', 'C']);
  });

  it('collects and applies only what changed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-'));
    const at = (...p) => path.join(root, ...p);
    const put = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
    const get = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    put(at('job', 'outbox.json'), []);
    put(at('job', 'youtube', 'A.json'), { title: 'a' });
    snapshot(at('job'), at('before'));
    put(at('job', 'outbox.json'), [{ id: 'A' }]);
    put(at('job', 'youtube', 'new.json'), { title: 'n' });
    assert.equal(collect(at('job'), at('before'), at('out')), 2);
    put(at('main', 'outbox.json'), [{ id: 'B' }]);
    assert.equal(apply(at('out'), at('main')), 2);
    assert.deepEqual(get(at('main', 'outbox.json')).map((x) => x.id), ['B', 'A']);
    assert.equal(get(at('main', 'youtube', 'new.json')).title, 'n');
  });
});
