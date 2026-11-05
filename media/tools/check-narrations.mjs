#!/usr/bin/env node
// Listens to every finished narration on the server and reports any line the voice did not read.
// Usage: node media/tools/check-narrations.mjs <dir with ZV-Lxx/part-N.mp3 or chapter-N.mp3> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tokens, matchWords } from '../lib/voice-chunks.mjs';
import { numerals } from '../lib/display-numbers.mjs';
import { CONTENT } from '../lib/paths.mjs';

const [root, outFile] = process.argv.slice(2);
const tool = path.join(path.dirname(new URL(import.meta.url).pathname), 'words.py');
const norm = (s) => tokens(numerals(s).replace(/(\d),(\d)/g, '$1$2'));

function partsOf(ep) {
  const narration = path.join(CONTENT, 'youtube', 'narration', `${ep}.txt`);
  if (fs.existsSync(narration)) {
    return fs.readFileSync(narration, 'utf8').split(/^=== PART \d+\s*$/m).slice(1).map((b, i) => ({
      name: `part-${i + 1}`,
      lines: b.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('## ')),
    }));
  }
  const script = JSON.parse(fs.readFileSync(path.join(CONTENT, 'youtube', `${ep}.json`), 'utf8'));
  return script.chapters.map((c, i) => ({ name: `chapter-${i + 1}`, lines: c.lines.map((l) => l.say || l.en) }));
}

const report = {};
for (const ep of fs.readdirSync(root).filter((x) => /^ZV-L\d+$/.test(x)).sort()) {
  report[ep] = [];
  for (const part of partsOf(ep)) {
    const file = path.join(root, ep, `${part.name}.mp3`);
    if (!fs.existsSync(file)) { console.log(`${ep} ${part.name}: no file`); continue; }
    const r = spawnSync(process.env.WHISPER_PY, [tool, file], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.log(`${ep} ${part.name}: could not listen`); continue; }
    const heard = JSON.parse(r.stdout).flatMap((w) => norm(w.w));
    const lineTokens = part.lines.map(norm);
    const map = matchWords(lineTokens.flat(), heard);
    let at = 0;
    const weak = [];
    lineTokens.forEach((t, i) => {
      const got = map.slice(at, at + t.length).filter((x) => x >= 0).length;
      at += t.length;
      if (t.length && got / t.length < 0.5) weak.push({ line: i + 1, heard: `${got}/${t.length}`, text: part.lines[i] });
    });
    const total = lineTokens.flat().length, found = map.filter((x) => x >= 0).length;
    console.log(`${ep} ${part.name}: ${part.lines.length} lines, ${Math.round((found / total) * 100)}% of words heard, ${weak.length} lines missing`);
    weak.forEach((w) => console.log(`   line ${w.line} (${w.heard}): ${w.text.slice(0, 90)}`));
    report[ep].push({ part: part.name, lines: part.lines.length, percent: Math.round((found / total) * 100), weak });
  }
}
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
