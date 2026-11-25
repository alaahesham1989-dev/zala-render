// A strict check of Arabic narration lines BEFORE the voice is made (owner 2026-11-25: tighten the Arabic and the
// historical names). Pure rules, no network: Latin letters, digits written as figures, repeated words, doubled
// punctuation, spaces before punctuation, over-long lines, and historical names spelled in a non-standard way.
// Usage: const { fixed, problems } = proofArabic(lines)   // lines: string[]

// Common wrong or inconsistent spellings -> the spelling the channel uses.
export const NAMES = [
  [/تحتمس\s+التالت/g, 'تحتمس التالت'],
  [/(?<![؀-ۿ])توتعنخ\s*آمون/g, 'توت عنخ آمون'],
  [/توت\s*عنخ\s*امون/g, 'توت عنخ آمون'],
  [/(?<![؀-ۿ])حتشبثوت|حتشيبسوت|حتشبسوط/g, 'حتشبسوت'],
  [/(?<![؀-ۿ])نفرتيتى|نيفرتيتي|نفرتتي/g, 'نفرتيتي'],
  [/(?<![؀-ۿ])رمسيس\s+الثانى|رمسيس\s+التانى/g, 'رمسيس التاني'],
  [/(?<![؀-ۿ])أبوالهول|ابو\s*الهول|أبو\s+الهَول/g, 'أبو الهول'],
  [/(?<![؀-ۿ])ابو\s*سمبل|أبوسمبل/g, 'أبو سمبل'],
  [/(?<![؀-ۿ])إخناتون|اخناتون/g, 'أخناتون'],
  [/(?<![؀-ۿ])الكرنَك|الكرنق/g, 'الكرنك'],
];

const LATIN = /[A-Za-z]{2,}/;
const DIGITS = /[0-9٠-٩]/;
const DOUBLE_WORD = /(^|\s)([؀-ۿ]{2,})\s+\2(?=\s|$|[.،؟!])/;
const MAX_WORDS = 34;

export function proofLine(line) {
  const problems = [];
  let fixed = String(line ?? '').replace(/\s+/g, ' ').trim();
  for (const [wrong, right] of NAMES) fixed = fixed.replace(wrong, right);
  fixed = fixed.replace(/\s+([،.؟!:])/g, '$1').replace(/([،.؟!])\1+/g, '$1').replace(/\.{4,}/g, '...');
  if (!fixed) problems.push('empty line');
  if (LATIN.test(fixed)) problems.push('has Latin letters');
  if (DIGITS.test(fixed)) problems.push('has figures: write numbers as spoken words');
  if (DOUBLE_WORD.test(fixed)) problems.push('a word is repeated');
  if (fixed.split(' ').length > MAX_WORDS) problems.push(`too long (${fixed.split(' ').length} words, ${MAX_WORDS} at most)`);
  return { fixed, problems };
}

export function proofArabic(lines) {
  const out = lines.map((l) => proofLine(l));
  return {
    fixed: out.map((o) => o.fixed),
    problems: out.flatMap((o, i) => o.problems.map((p) => `line ${i + 1}: ${p}`)),
  };
}
