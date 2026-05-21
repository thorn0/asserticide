#!/usr/bin/env node
// Quick assertion-token count via regex (overcount: doesn't filter `as const`, comments, etc.)
// Usage: node count-assertions.mjs <project-dir>
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');

const TS_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  '.yarn',
]);

function* walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile() && TS_EXT.test(ent.name) && !ent.name.endsWith('.d.ts')) yield full;
  }
}

let files = 0,
  asCount = 0,
  asConst = 0,
  angle = 0,
  nonNull = 0;
for (const f of walk(root)) {
  files++;
  const src = readFileSync(f, 'utf8');
  // Strip line comments and block comments to reduce false positives
  const cleaned = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // ` as X` where X starts with a letter (rough)
  const asMatches = cleaned.match(/\s+as\s+[A-Za-z_$]/g) ?? [];
  const asConstMatches = cleaned.match(/\s+as\s+const\b/g) ?? [];
  asCount += asMatches.length;
  asConst += asConstMatches.length;
  // `<Type>expr` is hard to grep; skip rough
  // `x!` non-null (look for identifier or `)` followed by `!` followed by `.` or `,` or `)` or `;` or whitespace)
  const nonNullMatches = cleaned.match(/[A-Za-z_$0-9\])]!(?=[.,;)\s\[])/g) ?? [];
  nonNull += nonNullMatches.length;
}

console.log(`scanned: ${files} files in ${root}`);
console.log(`as <Type>:    ${asCount} (incl. ~${asConst} 'as const')`);
console.log(`net 'as':     ${asCount - asConst}`);
console.log(`non-null (!): ${nonNull}`);
console.log(`total candidates (approx): ${asCount - asConst + nonNull}`);
