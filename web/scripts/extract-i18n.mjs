// One-off generator: extracts the I18N object literal from the original
// channel/web/static/js/console.js and emits a typed TypeScript module.
// Run with: node scripts/extract-i18n.mjs <path-to-console.js>
import fs from 'node:fs';
import path from 'node:path';

const source = process.argv[2];
if (!source) {
  console.error('usage: node extract-i18n.mjs <console.js>');
  process.exit(1);
}
const js = fs.readFileSync(source, 'utf8');

const startMarker = 'const I18N = ';
const start = js.indexOf(startMarker);
if (start < 0) throw new Error('I18N declaration not found');

// Locate the object literal's opening brace and balance to its close.
let i = start + startMarker.length;
while (js[i] !== '{') i++;
const open = i;
let depth = 0;
let inString = null;
let escaped = false;
let inLineComment = false;
let inBlockComment = false;

for (; i < js.length; i++) {
  const ch = js[i];
  const next = js[i + 1];
  if (inLineComment) {
    if (ch === '\n') inLineComment = false;
    continue;
  }
  if (inBlockComment) {
    if (ch === '*' && next === '/') { inBlockComment = false; i++; }
    continue;
  }
  if (inString) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === inString) inString = null;
    continue;
  }
  if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
  if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
  if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) break;
  }
}

const literal = js.slice(open, i + 1);

const out = `/* AUTO-GENERATED from channel/web/static/js/console.js — do not edit by hand.
 * Regenerate with: node scripts/extract-i18n.mjs <console.js> */
/* eslint-disable */
export const I18N = ${literal};

export type Lang = 'zh' | 'zh-Hant' | 'en';
export type I18nKey = keyof typeof I18N['en'];
`;

const target = path.resolve(process.cwd(), 'src/i18n/dictionary.ts');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out, 'utf8');
console.log('wrote', target, '(' + literal.length + ' chars)');
