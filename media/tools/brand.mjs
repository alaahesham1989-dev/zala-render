// Owner's order 2026-11-17: every title and description says the channel's identity first — Ancient Egypt —
// so YouTube learns what the channel is about. The mystery comes after it. The ZALA travel promo keeps its own title.

const HAS = /ancient egypt/i;
const PROMO = /zala\s*vip/i;

export function brandTitle(title, max = 100) {
  let t = String(title || '').replace(/\s+#shorts\b/i, '').trim();
  if (!t || HAS.test(t) || PROMO.test(t)) return t.slice(0, max);
  if (/^egypt's\s/i.test(t)) t = t.replace(/^egypt's\s/i, "Ancient Egypt's ");
  else if (/^(the\s)?egyptian(s)?\s/i.test(t)) t = t.replace(/^(the\s)?egyptian(s)?\s/i, (m, the, s) => `Ancient Egyptian${s || ''} `);
  else t = `Ancient Egypt: ${t}`;
  return t.slice(0, max);
}

export const TITLE_RULE = `Every title must carry the channel identity "Ancient Egypt" in its words, woven in naturally and near the start
(e.g. "Ancient Egypt's Lost Pyramid Nobody Talks About", "The Ancient Egypt Tomb That Was Never Supposed to Be Opened",
"Ancient Egypt Mystery: Why Were 60-Ton Boxes Hidden Underground?"). Then a concrete object or person plus a mystery.
No vague titles ("The Impossible Rescue") and no expert jargon an American would not know ("KV62", "TT320").`;
