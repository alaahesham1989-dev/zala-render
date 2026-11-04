// Narration spells numbers out so the voice reads them well. Viewers should read digits: "thirty-one BC" becomes "31 BC".
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { thousand: 1000, million: 1000000, billion: 1000000000 };
const isNum = (w) => w in ONES || w in TENS || w === 'hundred' || w in SCALE || w === 'oh' || w === 'point';

const tensValue = (parts) => {
  // "ninety-six", "seventy", "thirteen", "oh four"
  if (parts.length === 1) return ONES[parts[0]] ?? TENS[parts[0]];
  if (parts.length === 2 && parts[0] === 'oh' && ONES[parts[1]] < 10) return ONES[parts[1]];
  if (parts.length === 2 && parts[0] in TENS && ONES[parts[1]] < 10) return TENS[parts[0]] + ONES[parts[1]];
  return undefined;
};

/** A spoken year: "nineteen ninety-six", "twelve seventy-four", "nineteen oh four", "twenty twenty-five", "twenty-six hundred". */
function asYear(ws) {
  if (ws.length >= 2 && ws[ws.length - 1] === 'hundred') {
    const head = tensValue(ws.slice(0, -1));
    if (head >= 10) return head * 100;
  }
  for (let cut = 1; cut <= 2 && cut < ws.length; cut++) {
    const head = tensValue(ws.slice(0, cut)), tail = tensValue(ws.slice(cut));
    if (head >= 10 && head <= 20 && tail !== undefined && tail >= 1 && tail <= 99 && (tail >= 10 || ws[cut] === 'oh')) return head * 100 + tail;
    if (head >= 21 && head <= 29 && tail >= 10 && tail <= 99) return head * 100 + tail;
  }
  return undefined;
}

function asCardinal(ws) {
  let total = 0, cur = 0, seen = false;
  for (const w of ws) {
    if (w === 'and') continue;
    if (w in ONES) { cur += ONES[w]; seen = true; } else if (w in TENS) { cur += TENS[w]; seen = true; } else if (w === 'hundred') { cur = (cur || 1) * 100; seen = true; } else if (w in SCALE) { total += (cur || 1) * SCALE[w]; cur = 0; seen = true; } else return undefined;
  }
  return seen ? total + cur : undefined;
}

const group = (n) => (n >= 10000 ? n.toLocaleString('en-US') : String(n));

function convert(words, nextWord) {
  const pointAt = words.indexOf('point');
  if (pointAt > 0 && pointAt === words.length - 2 && words[pointAt + 1] in ONES && ONES[words[pointAt + 1]] < 10) {
    const whole = asCardinal(words.slice(0, pointAt));
    if (whole !== undefined) return `${whole.toLocaleString('en-US')}.${ONES[words[pointAt + 1]]}`;
    return null;
  }
  if (words.includes('point')) return null;
  const year = asYear(words);
  if (year !== undefined) return String(year);
  const n = asCardinal(words);
  if (n === undefined) return null;
  // "two thousand two" is a year, "two thousand" alone is a count
  if (n > 2000 && n < 2100 && !words.includes('hundred')) return String(n);
  // small counts read better as words, unless a unit or era follows: "two gods", but "31 BC", "20 meters"
  if (n <= 10 && !/^(bc|ad|meters?|kilograms?|tonnes?|tons?|miles?|kilometers?|centimeters?|cubits?|talents?|percent|years?|dollars?)$/i.test(nextWord || '')) return null;
  return n >= 1000 && n < 10000 ? n.toLocaleString('en-US') : group(n);
}

export function numerals(text) {
  const tokens = String(text).match(/[A-Za-z]+(?:'[a-z]+)?|\d+|[^A-Za-z\d]+/g) || [];
  let out = '';
  for (let i = 0; i < tokens.length;) {
    const low = tokens[i].toLowerCase();
    if (!/^[a-z]+$/.test(low) || !isNum(low) || low === 'oh' || low === 'point') { out += tokens[i]; i++; continue; }
    const words = [], ends = [];
    let j = i;
    while (j < tokens.length) {
      const t = tokens[j].toLowerCase();
      if (/^[a-z]+$/.test(t) && isNum(t)) { words.push(t); ends.push(j); j++; continue; }
      if ((t === ' ' || t === '-') && j + 1 < tokens.length && isNum(tokens[j + 1].toLowerCase())) { j++; continue; }
      break;
    }
    while (words.length && ['point', 'oh'].includes(words[words.length - 1])) { words.pop(); ends.pop(); }
    const last = ends[ends.length - 1];
    const next = (tokens.slice(last + 1).find((x) => /^[A-Za-z]/.test(x)) || '').trim();
    const gapOk = /^[\s]*$/.test(tokens[last + 1] || ' ');
    const value = convert(words, gapOk ? next : '');
    if (value === null) { out += tokens.slice(i, last + 1).join(''); i = last + 1; continue; }
    // "two thousand-year-old" style: a number tied to a hyphen stays hyphenated
    out += value;
    i = last + 1;
  }
  return out;
}
