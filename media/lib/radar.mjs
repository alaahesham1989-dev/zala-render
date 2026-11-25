// The radar's gate: which registered events may be covered, and when. Pure, no network.
// content/radar/events.json holds events with a source for every date. Two tracks:
//   proactive: an announced date, prepared `leadDays` ahead;   fast: just happened, worth covering for a few days.
// Anything political, military, security or disaster related is refused outright: the channels never touch it.

export const BLOCKED = [
  // English
  'election', 'protest', 'demonstration', 'war', 'military', 'army', 'police', 'attack', 'terror', 'bomb', 'explosion',
  'shooting', 'coup', 'sanction', 'president', 'government', 'minister', 'parliament', 'israel', 'gaza', 'palestin',
  'crash', 'accident', 'earthquake', 'flood', 'death toll', 'killed',
  // Arabic
  'انتخاب', 'مظاهر', 'احتجاج', 'حرب', 'عسكري', 'الجيش', 'الشرطة', 'هجوم', 'إرهاب', 'ارهاب', 'تفجير', 'انفجار',
  'إطلاق نار', 'انقلاب', 'عقوبات', 'رئيس الجمهورية', 'الحكومة', 'وزير', 'البرلمان', 'إسرائيل', 'غزة', 'فلسطين',
  'تحطم', 'حادث', 'زلزال', 'فيضان', 'ضحايا', 'مقتل',
];

export function blockedBy(text) {
  const t = String(text || '').toLowerCase();
  return BLOCKED.find((w) => (/^[a-z ]+$/.test(w)
    ? new RegExp(`\\b${w}${w === 'war' ? 's?\\b' : ''}`).test(t)   // whole words ("war", not "warm")
    : t.includes(w))) || null;
}

const DAY = 86400e3;
const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? Date.parse(`${s}T00:00:00Z`) : NaN);

/** Event: { id, title:{en,ar}, note?, start:'YYYY-MM-DD', end?, track?:'proactive'|'fast', leadDays?, source:'https://…' } */
export function checkEvent(e) {
  if (!e || !e.id || !e.title?.en) return 'missing id or title';
  if (Number.isNaN(date(e.start))) return 'bad start date';
  if (e.end && !(date(e.end) >= date(e.start))) return 'bad end date';
  if (!/^https:\/\//.test(e.source || '')) return 'no source';
  const word = blockedBy([e.title.en, e.title.ar, e.note].join(' '));
  return word ? `blocked topic: ${word}` : null;
}

/** What to work on today, soonest first, with the refused ones and why. */
export function radar(events, today) {
  const now = date(today);
  const due = [], refused = [];
  for (const e of events || []) {
    const why = checkEvent(e);
    if (why) { refused.push({ id: e?.id || '?', why }); continue; }
    const start = date(e.start), end = date(e.end || e.start);
    const fast = e.track === 'fast';
    const from = fast ? start : start - (e.leadDays ?? 14) * DAY;
    const to = fast ? end + 3 * DAY : end;
    if (now >= from && now <= to) due.push({ id: e.id, track: fast ? 'fast' : 'proactive', daysLeft: Math.round((start - now) / DAY), event: e });
  }
  due.sort((a, b) => (a.track === b.track ? a.daysLeft - b.daysLeft : a.track === 'fast' ? -1 : 1));
  return { due, refused };
}
