// media/lib/lang-check.mjs — is a spoken line written in the video's language? Found 2026-11-27: the long Arabic and
// Spanish tours were mostly in English (the writer's field was called "en"), and English audio of them was recorded.
const AR = /[ء-ي]/g;
const LATIN = /[A-Za-zÀ-ɏ]/g;
const ES_WORDS = new Set('el la los las de del que y en un una por para con se su sus es al como lo más este esta estos estas donde sobre entre fue son hay también cada desde hasta pero sin'.split(' '));
const EN_WORDS = new Set('the and of is to in that was with for on this we you it as are by from our at his her their its be were which has have'.split(' '));

export function inLang(text, lang) {
  const s = String(text || '');
  const arabic = (s.match(AR) || []).length, latin = (s.match(LATIN) || []).length;
  if (lang === 'ar') return arabic > 0 && arabic >= 0.7 * (arabic + latin);
  if (arabic > latin * 0.2) return false;
  const words = s.toLowerCase().split(/[^a-zà-ÿ]+/).filter(Boolean);
  const es = words.filter((w) => ES_WORDS.has(w)).length, en = words.filter((w) => EN_WORDS.has(w)).length;
  if (lang === 'es') return es > en;
  return en >= es;
}
