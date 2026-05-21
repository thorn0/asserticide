#!/usr/bin/env node
// Compare tsgo cold-start vs --incremental vs --incremental+assumeChangesOnlyAffectDirectDependencies
// on a project. Times 5 consecutive runs of each mode.
//
// For incremental, between runs we touch a real source file (append a no-op
// comment, then revert), so the buildinfo sees a change but the next run still
// has work to do — mirroring asserticide's per-assertion edit pattern.
import { spawn } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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

const project = process.argv[2];
if (!project) {
  console.error('usage: node tsgo-incremental-probe.mjs <project-dir>');
  process.exit(1);
}
const projectDir = path.resolve(project);
const tsconfigPath = statSync(projectDir).isDirectory()
  ? path.join(projectDir, 'tsconfig.json')
  : projectDir;

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

// Find a representative source .ts file to edit between runs.
function* walkTs(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (
      ent.name === 'node_modules' ||
      ent.name === '.git' ||
      ent.name === 'dist' ||
      ent.name === 'build'
    )
      continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkTs(full);
    else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name) && !ent.name.endsWith('.d.ts'))
      yield full;
  }
}
const dirToWalk = statSync(projectDir).isDirectory() ? projectDir : path.dirname(projectDir);
const targetFile = [...walkTs(dirToWalk)].find((f) => f.includes(path.sep + 'src' + path.sep));
if (!targetFile) {
  console.error('could not find a src/*.ts file to use for edits');
  process.exit(1);
}
console.log(`target file for edits: ${targetFile}`);

const originalContent = readFileSync(targetFile, 'utf8');

async function bench(label, args, { editBetween }) {
  console.log(`\n=== ${label} ===`);
  // Clean any existing .tsbuildinfo so first call is truly cold for incremental
  const buildInfoCandidates = ['.tsbuildinfo', 'tsconfig.tsbuildinfo'];
  for (const name of buildInfoCandidates) {
    const candidate = path.join(path.dirname(tsconfigPath), name);
    if (existsSync(candidate)) {
      try {
        unlinkSync(candidate);
        console.log(`  (removed ${candidate})`);
      } catch (error) {
        console.log(`  (could not remove ${candidate}: ${error.message})`);
      }
    }
  }

  const times = [];
  for (let i = 0; i < 5; i++) {
    if (editBetween && i > 0) {
      // Toggle one no-op comment line at end
      writeFileSync(targetFile, originalContent + `\n// probe iter ${i}\n`);
    }
    const r = await run(args);
    times.push(r.ms);
    if (r.code !== 0) {
      console.log(`  run ${i}: exit=${r.code} time=${r.ms.toFixed(0)}ms`);
      const tail = (r.stderr || r.stdout).split('\n').slice(-5).join('\n');
      console.log('  output tail:', tail);
    } else {
      console.log(`  run ${i}: exit=0 time=${r.ms.toFixed(0)}ms`);
    }
  }
  writeFileSync(targetFile, originalContent);
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`  median: ${sorted[2].toFixed(0)}ms`);
  return sorted[2];
}

try {
  const cold = await bench('cold-start each call (--noEmit -p)', ['--noEmit', '-p', tsconfigPath], {
    editBetween: true,
  });
  const inc = await bench(
    'incremental, edit one file between runs (--noEmit --incremental -p)',
    ['--noEmit', '--incremental', '-p', tsconfigPath],
    { editBetween: true },
  );
  const incDirect = await bench(
    'incremental + assumeChangesOnlyAffectDirectDependencies',
    [
      '--noEmit',
      '--incremental',
      '--assumeChangesOnlyAffectDirectDependencies',
      '-p',
      tsconfigPath,
    ],
    { editBetween: true },
  );

  console.log('\n=== SUMMARY ===');
  console.log(`cold:                        ${cold.toFixed(0)}ms`);
  console.log(
    `+incremental:                ${inc.toFixed(0)}ms  (${((cold / inc) * 1).toFixed(1)}× of cold)`,
  );
  console.log(
    `+incr +directDeps:           ${incDirect.toFixed(0)}ms  (${((cold / incDirect) * 1).toFixed(1)}× of cold)`,
  );
} finally {
  // Always restore
  writeFileSync(targetFile, originalContent);
  console.log(`\nrestored ${targetFile}`);
}
