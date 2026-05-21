#!/usr/bin/env node
// Time asserticide on a project with per-phase trace.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib.mjs';

const asserticide = path.resolve(repoRoot, 'dist', 'index.js');

if (!existsSync(asserticide)) {
  console.error(`Build first: ${asserticide} missing`);
  process.exit(1);
}

function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
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

async function benchTraced(name, args, cwd) {
  const r = await runCapture(process.execPath, [asserticide, ...args], {
    cwd,
    env: { ...process.env, ASSERTICIDE_TRACE: '1' },
  });
  console.log(`\n=== ${name} (single trace run) ===`);
  console.log(`total wall time: ${r.ms.toFixed(0)}ms  exit=${r.code}`);
  console.log(r.stdout);
  if (r.stderr.trim()) console.log('--- stderr ---\n' + r.stderr);
  return r;
}

const args = process.argv.slice(2);
const fixtureDir = args[0]
  ? path.resolve(args[0])
  : path.resolve(repoRoot, 'bench-fixtures', 'synthetic-small');
if (!existsSync(fixtureDir)) {
  console.error(`fixture dir not found: ${fixtureDir}`);
  console.error('generate one via: yarn run gen-fixture bench-fixtures/synthetic-small 10 10');
  process.exit(1);
}
await benchTraced(`asserticide on ${path.basename(fixtureDir)}`, [fixtureDir], fixtureDir);
