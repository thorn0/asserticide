#!/usr/bin/env node
// Probe tsgo capabilities and timings.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tsgoBin = path.resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo',
);

function run(args) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn(tsgoBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '',
      stderr = '';
    p.stdout.on('data', (d) => {
      stdout += d;
    });
    p.stderr.on('data', (d) => {
      stderr += d;
    });
    p.on('close', (code) => {
      resolve({ code, stdout, stderr, ms: performance.now() - t0 });
    });
  });
}

console.log('=== tsgo --help --all ===');
const help = await run(['--help', '--all']);
console.log(`exit=${help.code} time=${help.ms.toFixed(0)}ms`);
console.log(help.stdout);
if (help.stderr.trim()) console.log('stderr:', help.stderr);

console.log('\n=== tsgo --version ===');
const ver = await run(['--version']);
console.log(`exit=${ver.code} time=${ver.ms.toFixed(0)}ms`);
console.log(ver.stdout);

// Time 5 consecutive --noEmit cold starts against our project
const args = process.argv.slice(2);
const project = args[0] ?? path.resolve(repoRoot, 'bench-fixtures', 'synthetic-small');
console.log(`\n=== 5 consecutive cold-start typechecks of ${project} ===`);
const times = [];
for (let i = 0; i < 5; i++) {
  const r = await run(['--noEmit', '-p', project]);
  times.push(r.ms);
  if (r.code !== 0) {
    console.log(`run ${i}: FAILED exit=${r.code}`);
    console.log(r.stderr || r.stdout);
    break;
  }
}
console.log(`times (ms): ${times.map((t) => t.toFixed(0)).join(', ')}`);
console.log(
  `min=${Math.min(...times).toFixed(0)} median=${times.sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(0)}`,
);
