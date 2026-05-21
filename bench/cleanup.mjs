#!/usr/bin/env node
// Remove bench-fixtures content. Pass --all to remove the whole dir.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const fixturesRoot = path.resolve(repoRoot, 'bench-fixtures');

if (!existsSync(fixturesRoot)) {
  console.log('nothing to clean');
  process.exit(0);
}

const which = process.argv[2];
if (which === '--all') {
  rmSync(fixturesRoot, { recursive: true, force: true });
  console.log(`removed ${fixturesRoot}`);
} else if (which) {
  const target = path.resolve(fixturesRoot, which);
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
} else {
  console.log('contents of bench-fixtures/:');
  for (const ent of readdirSync(fixturesRoot)) console.log(`  ${ent}`);
  console.log('\npass a name to remove a specific fixture, or --all to wipe the dir');
}
