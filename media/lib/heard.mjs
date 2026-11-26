// media/lib/heard.mjs — does the voice say what the captions say? For the languages the word-by-word English
// comparison cannot judge (Arabic, Spanish). Compares letters, not words: Whisper splits and spells Egyptian Arabic
// its own way ("ال" joined or apart, ة/ه, hamzas), so a word list would fail good lines.

const MARKS = /[\p{M}ـ]/gu;   // harakat and every other combining mark, and the tatweel
const AR_NUMBERS = new Set(('صفر واحد واحده اتنين اثنين اثنان تلاته تلات ثلاثه ثلاث اربعه اربع خمسه خمس سته ست سبعه سبع تمانيه تمن تمان ثمانيه ثماني تسعه تسع '
  + 'عشره عشر حداشر اتناشر تلتاشر اربعتاشر خمستاشر ستاشر سبعتاشر تمنتاشر تسعتاشر عشرين تلاتين اربعين خمسين ستين سبعين تمانين تسعين '
  + 'ميه مايه مئه ميت متين ميتين تلتميه ربعميه خمسميه ستميه سبعميه تمنميه تسعميه الف الاف الفين مليون ملايين مليار').split(' '));
const ES_NUMBERS = new Set(('cero uno una dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte '
  + 'treinta cuarenta cincuenta sesenta setenta ochenta noventa cien ciento doscientos trescientos cuatrocientos quinientos seiscientos setecientos ochocientos novecientos mil millon millones').split(' '));

/** Words of a line the way they are compared: spelling variants folded, punctuation and numbers dropped
 *  (the voice reads "سنة ألف وربعمية", Whisper may write 1400: neither is a defect). */
export function normalize(text, lang) {
  let s = String(text || '').normalize('NFKC').toLowerCase();
  if (lang === 'ar') {
    s = s.replace(MARKS, '').replace(/[أإآٱ]/g, 'ا').replace(/[ىئی]/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ک/g, 'ك').replace(/ء/g, '')
      .replace(/[^ء-يa-z0-9٠-٩]+/g, ' ');
  } else {
    s = s.normalize('NFD').replace(MARKS, '').replace(/[^a-z0-9]+/g, ' ');
  }
  const numbers = lang === 'ar' ? AR_NUMBERS : ES_NUMBERS;
  return s.split(' ').filter((w) => w && !/^[0-9٠-٩]+$/.test(w) && !numbers.has(w) && !(lang === 'ar' && w.startsWith('و') && numbers.has(w.slice(1))));
}

/** 0..1: how much of `expected` is found, in order, in the best matching stretch of `heard` (edit distance, free ends on the heard side). */
export function matchScore(expected, heard, lang) {
  const a = normalize(expected, lang).join('');
  if (!a.length) return 1;   // a line of only numbers: nothing to judge
  const b = normalize(heard, lang).join('');
  if (!b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array(b.length + 1);
    row[0] = i;
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), prev[j] + 1, row[j - 1] + 1);
    prev = row;
  }
  return Math.max(0, 1 - Math.min(...prev) / a.length);
}

const between = (words, from, to) => words.filter((w) => { const m = (w.start + w.end) / 2; return m >= from && m <= to; }).map((w) => w.w).join(' ');

/** Scores every caption line against the words heard around it.
 *  `near` = inside the line's own time (1 s of slack), `wide` = within 8 s of it, which tells a wrong voice from late captions. */
export function hearLines(srt, heardWords, lang) {
  return srt.map((s) => {
    const heard = between(heardWords, s.start - 1, s.end + 1);
    const near = matchScore(s.text, heard, lang);
    const wide = near >= 0.9 ? near : matchScore(s.text, between(heardWords, s.start - 8, s.end + 8), lang);
    return { n: s.n, heard, near: Number(near.toFixed(3)), wide: Number(wide.toFixed(3)), letters: normalize(s.text, lang).join('').length };
  });
}

/** The whole video: letter-weighted score, and how much more is spoken than written (a voice reading its instructions aloud). */
export function hearTotals(scored, srt, heardWords, lang) {
  const letters = scored.reduce((n, x) => n + x.letters, 0) || 1;
  const written = normalize(srt.map((s) => s.text).join(' '), lang).join('').length || 1;
  const last = srt.length ? srt[srt.length - 1].end + 1 : 0;
  const spoken = normalize(between(heardWords, 0, last), lang).join('').length;
  return {
    near: Number((scored.reduce((n, x) => n + x.near * x.letters, 0) / letters).toFixed(3)),
    wide: Number((scored.reduce((n, x) => n + x.wide * x.letters, 0) / letters).toFixed(3)),
    spokenToWritten: Number((spoken / written).toFixed(3)),
  };
}

// Limits per language. A line fails under `line`; the video fails under `video` or over `extra` (spoken / written).
// `blocking: false` only reports. Calibrate with hear-check.yml on approved videos before changing a number.
export const LIMITS = {
  ar: { line: 0.5, video: 0.7, extra: 1.25, blocking: false },
  es: { line: 0.6, video: 0.8, extra: 1.2, blocking: false },
};

/** Reasons to hold the video, empty when the voice matches. */
export function hearProblems(scored, totals, srt, lang, limits = LIMITS[lang]) {
  const out = [];
  if (!limits) return out;
  for (const x of scored) {
    if (x.letters < 8 || x.near >= limits.line) continue;   // too short to judge by letters
    const text = String(srt.find((s) => s.n === x.n)?.text || '').slice(0, 60);
    if (x.wide >= limits.line + 0.2) out.push(`line ${x.n}: the captions are out of step with the voice: ${text}`);
    else out.push(`line ${x.n}: the voice and the words do not match (${Math.round(x.near * 100)}%): ${x.heard.slice(0, 80)}`);
  }
  if (totals.near < limits.video) out.push(`only ${Math.round(totals.near * 100)}% of the script is heard in place`);
  if (totals.spokenToWritten > limits.extra) out.push(`the voice says ${Math.round((totals.spokenToWritten - 1) * 100)}% more than the script`);
  return out;
}
