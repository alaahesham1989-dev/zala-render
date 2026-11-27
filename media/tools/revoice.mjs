#!/usr/bin/env node
// media/tools/revoice.mjs — lines the last check heard wrongly get recorded again (the old audio file stays, it is
// simply no longer the one used). A line's "take" is the time of the verdict that refused it, so running this twice
// asks for nothing twice.  Usage: node media/tools/revoice.mjs <script.json> <verdict.json>
import fs from 'node:fs';

const [scriptFile, verdictFile] = process.argv.slice(2);
const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
const verdict = JSON.parse(fs.readFileSync(verdictFile, 'utf8'));
const bad = new Set((verdict.reasons || []).map((r) => String(r).match(/^line (\d+): (?:the voice and the words|the captions are out of step|most words were not heard)/)?.[1]).filter(Boolean).map(Number));
let n = 0, marked = 0;
for (const c of script.chapters) for (const l of c.lines) if (bad.has(++n)) { l.take = verdict.checkedAt; marked++; }
if (marked) fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2) + '\n');
console.log(`revoice: ${marked} lines will be recorded again`);
