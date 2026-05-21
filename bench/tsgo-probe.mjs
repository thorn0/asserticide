#!/usr/bin/env node
// Probe tsgo capabilities and timings.
import path from 'node:path';
import { repoRoot, spawnTsgo } from './lib.mjs';

console.log('=== tsgo --help --all ===');
const help = await spawnTsgo(['--help', '--all']);
console.log(`exit=${help.code} time=${help.ms.toFixed(0)}ms`);
console.log(help.stdout);
if (help.stderr.trim()) console.log('stderr:', help.stderr);

console.log('\n=== tsgo --version ===');
const version = await spawnTsgo(['--version']);
console.log(`exit=${version.code} time=${version.ms.toFixed(0)}ms`);
console.log(version.stdout);

const args = process.argv.slice(2);
const project = args[0] ?? path.resolve(repoRoot, 'bench-fixtures', 'synthetic-small');
console.log(`\n=== 5 consecutive cold-start typechecks of ${project} ===`);
const times = [];
for (let i = 0; i < 5; i++) {
  const r = await spawnTsgo(['--noEmit', '-p', project]);
  times.push(r.ms);
  if (r.code !== 0) {
    console.log(`run ${i}: FAILED exit=${r.code}`);
    console.log(r.stderr || r.stdout);
    break;
  }
}
const sorted = [...times].sort((a, b) => a - b);
console.log(`times (ms): ${times.map((t) => t.toFixed(0)).join(', ')}`);
console.log(
  `min=${sorted[0].toFixed(0)} median=${sorted[Math.floor(sorted.length / 2)].toFixed(0)}`,
);
