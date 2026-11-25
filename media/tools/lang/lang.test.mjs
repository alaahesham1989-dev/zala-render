// node --test media/tools/lang/lang.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config, validateConfig, isProduction, isPublishing, keysFor, LANGS } from './paths.mjs';
import { daySchedule, minStoryGapHours, pillarFor, weekday } from './schedule.mjs';
import { BACKOFF_MINUTES, makeItem, markDone, markFailed, pickDue, deadLetters } from './queue.mjs';

const dates = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10));

describe('language config', () => {
  it('has no shared keys, prefixes, queues or outboxes between languages', () => {
    assert.deepEqual(validateConfig(), []);
  });
  it('matches the owner decisions of 2026-11-23: English paused, Arabic producing but not publishing, Spanish off', () => {
    assert.equal(isProduction('en'), false);
    assert.equal(isPublishing('en'), true);          // already scheduled videos keep publishing
    assert.equal(isProduction('ar'), true);
    assert.equal(isPublishing('ar'), false);
    assert.equal(isProduction('es'), false);
    assert.equal(isPublishing('es'), false);
  });
  it('each language has its own key slots', () => {
    const all = LANGS().flatMap((c) => keysFor(c));
    assert.equal(new Set(all).size, all.length);
  });
  it('catches a collision when one is introduced', () => {
    const bad = structuredClone(config());
    bad.languages.ar.keys.push('GEMINI_API_KEY');
    bad.languages.es.state.r2Prefix = bad.languages.ar.state.r2Prefix;
    const problems = validateConfig(bad);
    assert.ok(problems.some((p) => p.includes('keys "GEMINI_API_KEY"')));
    assert.ok(problems.some((p) => p.includes('r2Prefix')));
  });
});

describe('day schedule', () => {
  it('produces nothing for a paused or switched-off language', () => {
    for (const d of dates('2026-11-23', 14)) {
      assert.deepEqual(daySchedule('en', d), []);
      assert.deepEqual(daySchedule('es', d), []);
    }
  });
  it('Arabic day: 2 stories at most, 1 hybrid ad, no ads on YouTube or Facebook', () => {
    const day = daySchedule('ar', '2026-11-25');   // a Wednesday: no long video
    assert.equal(day.filter((s) => s.kind === 'short-story').length, 2);
    assert.equal(day.filter((s) => s.kind === 'short-hybrid').length, 1);
    assert.equal(day.filter((s) => s.kind === 'long').length, 0);
    for (const s of day) {
      if (s.ads) assert.ok(!s.platforms.includes('youtube') && !s.platforms.includes('facebook'));
      if (s.kind === 'short-story') assert.deepEqual(s.platforms, ['youtube', 'facebook']);
      if (s.kind === 'short-hybrid') assert.deepEqual(s.platforms, ['tiktok', 'instagram', 'x']);
      assert.equal(s.publish, false);   // Arabic renders for review only until the owner says go
    }
  });
  it('the long video lands on exactly two days a week, never sliced', () => {
    const week = dates('2026-11-23', 7).map((d) => ({ d, longs: daySchedule('ar', d).filter((s) => s.kind === 'long') }));
    assert.equal(week.filter((w) => w.longs.length).length, 2);
    assert.deepEqual(week.filter((w) => w.longs.length).map((w) => weekday(w.d)).sort(), [2, 6]);
    assert.equal(config().kinds.long.sliceIntoShorts, false);
  });
  it('story shorts of one channel are at least 8 hours apart', () => {
    for (const c of ['en', 'ar', 'es']) assert.ok(minStoryGapHours(c) >= config().kinds['short-story'].minGapHours, c);
  });
  it('no pillar repeats back to back, even across midnight', () => {
    const seq = dates('2026-11-23', 40).flatMap((d) => daySchedule('ar', d).filter((s) => s.kind === 'short-story')).map((s) => s.pillar);
    for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `repeat at ${i}`);
    assert.equal(new Set(seq).size, config().pillars.length);
  });
  it('hybrid slots rotate pillars too', () => {
    const seq = dates('2026-11-23', 20).flatMap((d) => daySchedule('ar', d).filter((s) => s.kind === 'short-hybrid')).map((s) => s.pillar);
    for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1]);
  });
  it('pillarFor is deterministic', () => {
    assert.equal(pillarFor('2026-11-24', 1, 2), pillarFor('2026-11-24', 1, 2));
  });
});

describe('owner rules 2026-11-25', () => {
  it('long videos: Arabic 15-20 minutes, English 8-10, twice a week, never sliced', () => {
    assert.deepEqual(config().languages.ar.longMinutes, [15, 20]);
    assert.deepEqual(config().languages.en.longMinutes, [8, 10]);
    assert.equal(config().kinds.long.perWeek, 2);
    assert.equal(config().kinds.long.sliceIntoShorts, false);
  });
  it('the hybrid short is a story that ends with the ad, only on TikTok, X and Instagram', () => {
    const k = config().kinds['short-hybrid'];
    assert.match(k.structure, /story.*ad/);
    assert.deepEqual([...k.platforms].sort(), ['instagram', 'tiktok', 'x']);
    assert.ok(config().kinds['short-story'].perDay <= 2);
  });
});

describe('queue retries', () => {
  const t0 = 1_000_000;
  it('backs off 5, 30, 180 minutes and then dead-letters', () => {
    let it1 = makeItem({ id: 'a' }, t0);
    const waits = [];
    for (let i = 0; i < BACKOFF_MINUTES.length; i++) {
      it1 = markFailed(it1, 'boom', t0);
      assert.equal(it1.status, 'waiting');
      waits.push((it1.dueAt - t0) / 60000);
    }
    assert.deepEqual(waits, [5, 30, 180]);
    it1 = markFailed(it1, 'boom', t0);
    assert.equal(it1.status, 'dead');
    assert.equal(deadLetters([it1]).length, 1);
  });
  it('a failed or dead item never blocks the lane', () => {
    const failed = markFailed(makeItem({ id: 'f' }, t0), 'x', t0);
    const dead = { ...makeItem({ id: 'd' }, t0), status: 'dead' };
    const ok = makeItem({ id: 'ok' }, t0 + 10);
    assert.deepEqual(pickDue([failed, dead, ok], t0 + 20).map((x) => x.id), ['ok']);
    assert.deepEqual(pickDue([failed, dead, ok], t0 + 6 * 60000).map((x) => x.id), ['ok', 'f']);
  });
  it('done items are not picked again', () => {
    assert.equal(pickDue([markDone(makeItem({ id: 'z' }, t0), t0)], t0 + 1).length, 0);
  });
});
