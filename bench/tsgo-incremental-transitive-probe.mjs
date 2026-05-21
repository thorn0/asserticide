#!/usr/bin/env node
// Does the "fast incremental followed by full incremental" chain catch
// transitive-importer breakage?
//
//   a.ts: const v = (unknownValue as number)
//   b.ts: export { v } from './a.js'        (direct importer — no type usage)
//   c.ts: imports v from b.js, uses it as a number  (transitive importer)
//
// Break a (remove the `as`). Direct check on b sees no error (re-export only).
// Transitive check on c should fail. Verify:
//   1. fast incremental alone:               does it catch c's error?
//   2. fast incremental → full incremental:  does the chain catch it?
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tsgoBin = path.resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo',
);

const projectDirectory = mkdtempSync(path.join(tmpdir(), 'asserticide-trans-probe-'));
console.log(`project: ${projectDirectory}`);
mkdirSync(path.join(projectDirectory, 'src'));
writeFileSync(
  path.join(projectDirectory, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      include: ['src/**/*'],
    },
    null,
    2,
  ),
);

const aPath = path.join(projectDirectory, 'src', 'a.ts');
const bPath = path.join(projectDirectory, 'src', 'b.ts');
const cPath = path.join(projectDirectory, 'src', 'c.ts');
const aOriginal = `declare const unknownValue: unknown;\nexport const v = unknownValue as number;\n`;
const aBroken = `declare const unknownValue: unknown;\nexport const v = unknownValue;\n`;
const bSource = `export { v } from './a.js';\n`;
const cSource = `import { v } from './b.js';\nexport const doubled: number = v * 2;\n`;
writeFileSync(aPath, aOriginal);
writeFileSync(bPath, bSource);
writeFileSync(cPath, cSource);

const buildInfoPath = path.join(projectDirectory, 'fast.tsbuildinfo');
const tsconfigPath = path.join(projectDirectory, 'tsconfig.json');

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(tsgoBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => {
      stdout += d;
    });
    p.stderr.on('data', (d) => {
      stderr += d;
    });
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function go() {
  // Warmup: build the buildinfo from the clean original.
  console.log('\n--- warmup (clean tree, populate buildinfo) ---');
  let r = await run([
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    buildInfoPath,
    '-p',
    tsconfigPath,
  ]);
  console.log(`exit=${r.code}; output: ${(r.stdout + r.stderr).trim() || '(none)'}`);

  // Break a.ts on disk.
  console.log('\n--- break a.ts on disk ---');
  writeFileSync(aPath, aBroken);

  // Test 1: fast incremental alone.
  console.log('\n--- test 1: fast (--assumeChangesOnlyAffectDirectDependencies) ---');
  r = await run([
    '--noEmit',
    '--incremental',
    '--assumeChangesOnlyAffectDirectDependencies',
    '--tsBuildInfoFile',
    buildInfoPath,
    '-p',
    tsconfigPath,
  ]);
  console.log(`exit=${r.code}`);
  console.log(`output:\n${(r.stdout + r.stderr).trim() || '(no diagnostics)'}`);

  // Test 2: full incremental immediately after.
  console.log('\n--- test 2: full incremental, same buildinfo ---');
  r = await run([
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    buildInfoPath,
    '-p',
    tsconfigPath,
  ]);
  console.log(`exit=${r.code}`);
  console.log(`output:\n${(r.stdout + r.stderr).trim() || '(no diagnostics)'}`);

  // Test 3 control: revert a.ts, rebuild clean, then break a.ts and run FULL incremental from scratch (no fast first).
  console.log('\n--- test 3 control: revert, rebuild clean, break, full incremental only ---');
  writeFileSync(aPath, aOriginal);
  rmSync(buildInfoPath, { force: true });
  r = await run([
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    buildInfoPath,
    '-p',
    tsconfigPath,
  ]);
  console.log(`  clean warmup exit=${r.code}`);
  writeFileSync(aPath, aBroken);
  r = await run([
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    buildInfoPath,
    '-p',
    tsconfigPath,
  ]);
  console.log(`  full incremental exit=${r.code}`);
  console.log(`  output:\n${(r.stdout + r.stderr).trim() || '(no diagnostics)'}`);
}

try {
  await go();
} finally {
  rmSync(projectDirectory, { recursive: true, force: true });
}
