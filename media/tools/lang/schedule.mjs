// The day plan per language, computed from lang.config.json. Pure functions, no clock and no network:
// the clock and the lane scripts call daySchedule(lang, 'YYYY-MM-DD') and decide what to start.
import { config, lang } from './paths.mjs';

const pad = (n) => String(n).padStart(2, '0');
export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const fromMin = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };

export function dayOfYear(dateISO) {
  const d = Date.parse(`${dateISO}T00:00:00Z`);
  return Math.floor((d - Date.parse(`${dateISO.slice(0, 4)}-01-01T00:00:00Z`)) / 864e5);
}
export const weekday = (dateISO) => new Date(`${dateISO}T00:00:00Z`).getUTCDay();   // 0 Sunday ... 6 Saturday

// Pillars rotate one step per slot (perDay slots a day), so two slots in a row, even across midnight, never share one.
export function pillarFor(dateISO, slotIndex, perDay, offset = 0) {
  const p = config().pillars;
  return p[(dayOfYear(dateISO) * perDay + slotIndex + offset) % p.length];
}

export function longSlots(code, dateISO) {
  const l = lang(code), k = config().kinds.long;
  if (!l.production || !k.days.includes(weekday(dateISO))) return [];
  return [{ kind: 'long', lang: code, date: dateISO, at: l.longAnchorUtc, platforms: [...k.platforms], pillar: pillarFor(dateISO, 0, 1, 2), ads: false, publish: l.publish }];
}

export function storySlots(code, dateISO) {
  const l = lang(code), k = config().kinds['short-story'];
  if (!l.production) return [];
  return l.storyAnchorsUtc.slice(0, k.perDay).map((at, i) => ({
    kind: 'short-story', lang: code, date: dateISO, at, platforms: [...k.platforms], pillar: pillarFor(dateISO, i, k.perDay), ads: false, publish: l.publish,
  }));
}

export function hybridSlots(code, dateISO) {
  const l = lang(code), k = config().kinds['short-hybrid'];
  if (!l.production) return [];
  const start = toMin(l.hybrid.startUtc), span = l.hybrid.spanHours * 60, n = k.perDay;
  return Array.from({ length: n }, (_, i) => ({
    kind: 'short-hybrid', lang: code, date: dateISO, at: fromMin(start + (n > 1 ? (i * span) / (n - 1) : 0)),
    platforms: [...k.platforms], pillar: pillarFor(dateISO, i, k.perDay, 1), ads: true, publish: l.publish,
  }));
}

export function daySchedule(code, dateISO) {
  return [...longSlots(code, dateISO), ...storySlots(code, dateISO), ...hybridSlots(code, dateISO)]
    .sort((a, b) => toMin(a.at) - toMin(b.at) || a.kind.localeCompare(b.kind));
}

// Smallest gap in hours between the story slots of a language, counting the wrap to the next day.
export function minStoryGapHours(code) {
  const a = lang(code).storyAnchorsUtc.map(toMin).sort((x, y) => x - y);
  if (a.length < 2) return 24;
  const gaps = a.map((m, i) => (i === a.length - 1 ? a[0] + 1440 - m : a[i + 1] - m));
  return Math.min(...gaps) / 60;
}
