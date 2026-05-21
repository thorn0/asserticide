#!/usr/bin/env node
// Does `tsgo --noEmit --incremental --tsBuildInfoFile X -p .` catch a
// cross-file breakage when the modified file is a SCRIPT (not a module)?
//
//   tsconfig has moduleDetection: 'legacy'
//   a.ts: var sharedRecord = unknownValue as { n: number }   (global var)
//   b.ts: function readShared(): number { return sharedRecord.n; }
//
// Break a.ts (remove the `as`). b.ts.sharedRecord.n now errors.
// Test: incremental alone vs cold tsgo.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnTsgo } from './lib.mjs';

const projectDirectory = mkdtempSync(path.join(tmpdir(), 'asserticide-scripts-probe-'));
mkdirSync(path.join(projectDirectory, 'src'));
writeFileSync(
  path.join(projectDirectory, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2024',
        module: 'NodeNext',
        moduleDetection: 'legacy',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        types: [],
      },
      include: ['**/*.ts'],
    },
    null,
    2,
  ),
);

const aPath = path.join(projectDirectory, 'src', 'a.ts');
const bPath = path.join(projectDirectory, 'src', 'b.ts');
const aOriginal =
  'declare const unknownValue: unknown;\nvar sharedRecord = unknownValue as { n: number };\n';
const aBroken = 'declare const unknownValue: unknown;\nvar sharedRecord = unknownValue;\n';
const bSource = 'function readShared(): number {\n  return sharedRecord.n;\n}\n';
writeFileSync(aPath, aOriginal);
writeFileSync(bPath, bSource);

const buildInfoPath = path.join(projectDirectory, 'a.tsbuildinfo');
const tsconfigPath = path.join(projectDirectory, 'tsconfig.json');

try {
  console.log('--- warmup incremental on clean tree ---');
  let r = await spawnTsgo([
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    buildInfoPath,
    '-p',
    tsconfigPath,
  ]);
  console.log(`exit=${r.code} ${(r.stdout + r.stderr).trim() || '(clean)'}`);

  console.log('\n--- break a.ts on disk ---');
  writeFileSync(aPath, aBroken);

  console.log('\n--- test A: --incremental (no assume flag), same buildinfo ---');
  r = await spawnTsgo([
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    buildInfoPath,
    '-p',
    tsconfigPath,
  ]);
  console.log(`exit=${r.code}`);
  console.log(`output:\n${(r.stdout + r.stderr).trim() || '(no diagnostics — MISSED THE BUG)'}`);

  console.log('\n--- test B: cold tsgo (no incremental, no buildinfo) ---');
  r = await spawnTsgo(['--noEmit', '-p', tsconfigPath]);
  console.log(`exit=${r.code}`);
  console.log(`output:\n${(r.stdout + r.stderr).trim() || '(no diagnostics)'}`);

  console.log('\n--- test C: --incremental from scratch (delete buildinfo first, no warmup) ---');
  rmSync(buildInfoPath, { force: true });
  r = await spawnTsgo([
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    buildInfoPath,
    '-p',
    tsconfigPath,
  ]);
  console.log(`exit=${r.code}`);
  console.log(`output:\n${(r.stdout + r.stderr).trim() || '(no diagnostics)'}`);
} finally {
  rmSync(projectDirectory, { recursive: true, force: true });
}
