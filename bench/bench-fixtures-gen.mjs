#!/usr/bin/env node
// Generate a self-contained big TS project with realistic assertions.
// Usage: node bench-fixtures-gen.mjs <out-dir> <file-count> <assertions-per-file>
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [, , outDir, fileCountArg, assertionsPerFileArg] = process.argv;
if (!outDir) {
  console.error(
    'usage: node bench-fixtures-gen.mjs <out-dir> [file-count=20] [assertions-per-file=30]',
  );
  process.exit(1);
}
const fileCount = parseInt(fileCountArg ?? '20', 10);
const assertionsPerFile = parseInt(assertionsPerFileArg ?? '30', 10);

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, 'src'), { recursive: true });

writeFileSync(
  path.join(outDir, 'tsconfig.json'),
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

// Generate N files. Each file imports a few other files (to make typechecker
// do nontrivial cross-module work). Each file contains a mix of assertions.
for (let i = 0; i < fileCount; i++) {
  const importTargets = [];
  for (let j = 1; j <= 3; j++) {
    const t = (i + j * 7) % fileCount;
    if (t !== i) importTargets.push(t);
  }
  const lines = [];
  for (const t of importTargets) {
    lines.push(`import { type Item${t}, makeItem${t} } from './mod${t}.js';`);
  }
  lines.push('');
  lines.push(
    `export interface Item${i} { id: number; tag: 'item${i}'; ${importTargets.map((t) => `dep${t}: Item${t}`).join('; ')} }`,
  );
  lines.push('');
  lines.push(`export function makeItem${i}(id: number): Item${i} {`);
  lines.push(
    `  return { id, tag: 'item${i}', ${importTargets.map((t) => `dep${t}: makeItem${t}(id)`).join(', ')} };`,
  );
  lines.push(`}`);
  lines.push('');

  // Function that contains the assertions; inferred return type so fnContext triggers
  lines.push(`export function use${i}(values: unknown[]) {`);
  lines.push(`  let total = 0;`);
  for (let a = 0; a < assertionsPerFile; a++) {
    // Mix of assertion shapes:
    //  - removable redundant `as` (~50%)
    //  - non-null on a typed value (~20%, removable when strictNullChecks)
    //  - `as` on `unknown` (~20%, necessary - revert)
    //  - `as any as T` (~5%, preserved)
    //  - `as never` (~5%, preserved)
    const r = a % 20;
    if (r < 10) {
      // removable: `${a} as number`
      lines.push(`  total += ${a} as number;`);
    } else if (r < 14) {
      // necessary narrowing: `values[a] as number`
      lines.push(`  total += (values[${a}] as number);`);
    } else if (r < 18) {
      // non-null assertion on map-like access
      lines.push(`  const m${a}: { v?: number } = { v: ${a} }; total += m${a}.v!;`);
    } else if (r < 19) {
      // double assertion via `any` — preserved
      lines.push(`  const f${a} = (values[${a}] as any as number); total += f${a};`);
    } else {
      // as never preserved
      lines.push(`  if (false) { total += (${a} as never); }`);
    }
  }
  lines.push(`  return total;`);
  lines.push(`}`);
  lines.push('');

  writeFileSync(path.join(outDir, 'src', `mod${i}.ts`), lines.join('\n'));
}

// Entry file so tsgo sees the dependency graph
const entryLines = [];
for (let i = 0; i < fileCount; i++) {
  entryLines.push(`import { use${i}, makeItem${i} } from './mod${i}.js';`);
}
entryLines.push('');
entryLines.push(
  'export const total = ' +
    Array.from({ length: fileCount }, (_, i) => `use${i}([])`).join(' + ') +
    ';',
);
entryLines.push(
  'export const items = [' +
    Array.from({ length: fileCount }, (_, i) => `makeItem${i}(0)`).join(', ') +
    '];',
);
writeFileSync(path.join(outDir, 'src', 'index.ts'), entryLines.join('\n'));

console.log(
  `generated ${fileCount} files (~${fileCount * assertionsPerFile} assertions) in ${outDir}`,
);
