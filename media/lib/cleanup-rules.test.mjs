import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from './cleanup-rules.mjs';

const now = Date.parse('2026-11-30T00:00:00Z');
const o = (key, days = 10, etag = key, size = 100) => ({ key, size, etag, modified: new Date(now - days * 864e5).toISOString() });
const keys = (list, opts = {}) => plan(list, { now, ...opts }).map((x) => x.key);

test('AI media, library, voice and audio are never removed', () => {
  const list = [
    o('vault/flow/clip.mp4'), o('vault/library/a.jpg'), o('library/images/a.jpg'), o('handover/voice/x/bundle.box'),
    o('renders/ZV-L01/publish/ZV-L01.mp4'), o('render-cache/voice/ZV-L01/a.wav'), o('render-cache/work/ZV-L01/line.wav'),
    o('render-cache/work/ZV-L01/flow_shot.mp4'), o('render-cache/work/ZV-L01/nano-banana-1.png'), o('render-cache/work/ZV-L01/veo3.mp4'),
  ];
  assert.deepEqual(keys(list), []);
});

test('a copy of an AI clip under another name is kept too', () => {
  const list = [o('vault/flow/clip.mp4', 10, 'same'), o('renders/ZV-L01/publish/ZV-L01.mp4'), o('render-cache/work/ZV-L01/seg7.mp4', 10, 'same')];
  assert.deepEqual(keys(list), []);
});

test('old working files go only when the finished video exists and they are old', () => {
  const list = [o('renders/ZV-L01/publish/ZV-L01.mp4'), o('render-cache/work/ZV-L01/s1.mp4', 4), o('render-cache/work/ZV-L01/s2.mp4', 1),
    o('render-cache/work/ZV-L02/s1.mp4', 40)];
  assert.deepEqual(keys(list), ['render-cache/work/ZV-L01/s1.mp4']);
});

test('cut shorts of long videos go unless still waiting to be posted; standalone shorts stay', () => {
  const list = [o('renders/ZV-L01/publish/ZV-L01-R1.mp4'), o('outbox/ZV-D05/ZV-D05-R2.mp4'), o('renders/ZV-S202611121/publish/ZV-S202611121-R1.mp4')];
  assert.deepEqual(keys(list), ['renders/ZV-L01/publish/ZV-L01-R1.mp4', 'outbox/ZV-D05/ZV-D05-R2.mp4']);
  assert.deepEqual(keys(list, { queue: [{ episode: 'ZV-L01', which: 'R1', done: false }] }), ['outbox/ZV-D05/ZV-D05-R2.mp4']);
});

test('the outbox copy goes only when identical and already scheduled', () => {
  const list = [o('renders/ZV-D01/publish/ZV-D01.mp4', 10, 'e1'), o('outbox/ZV-D01/ZV-D01.mp4', 10, 'e1'),
    o('renders/ZV-D02/publish/ZV-D02.mp4', 10, 'e2'), o('outbox/ZV-D02/ZV-D02.mp4', 10, 'other'),
    o('renders/ZV-D03/publish/ZV-D03.mp4', 10, 'e3'), o('outbox/ZV-D03/ZV-D03.mp4', 10, 'e3'), o('outbox/ZV-D01/ZV-D01.youtube.json')];
  const outbox = [{ id: 'ZV-D01', scheduled: 'x' }, { id: 'ZV-D02', scheduled: 'x' }, { id: 'ZV-D03' }];
  assert.deepEqual(keys(list, { outbox }), ['outbox/ZV-D01/ZV-D01.mp4']);
});

test('finished long videos and review copies are left alone', () => {
  const list = [o('renders/ZV-L01/publish/ZV-L01.mp4', 90), o('renders/ZV-L01/DO-NOT-PUBLISH-internal/ZV-L01_ARABIC-REVIEW_DO-NOT-PUBLISH.mp4', 90)];
  assert.deepEqual(keys(list), []);
});
