import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const asserticideEntry = resolve(here, '..', 'dist', 'index.js');

export const defaultTsconfig = {
  compilerOptions: {
    target: 'ES2024',
    module: 'NodeNext',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    types: [],
  },
  include: ['**/*.ts', '**/*.tsx'],
};

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Fixture {
  dir: string;
  write(relPath: string, content: string): void;
  writeJson(relPath: string, data: unknown): void;
  read(relPath: string): string;
  run(args?: string[]): RunResult;
}

export interface FixtureOptions {
  tsconfig?: object | false;
}

export function makeFixture(t: TestContext, options: FixtureOptions = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'asserticide-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const write = (relPath: string, content: string): void => {
    const full = join(dir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  if (options.tsconfig !== false) {
    write('tsconfig.json', JSON.stringify(options.tsconfig ?? defaultTsconfig, null, 2));
  }

  return {
    dir,
    write,
    writeJson(relPath, data) {
      write(relPath, JSON.stringify(data, null, 2));
    },
    read(relPath) {
      return readFileSync(join(dir, relPath), 'utf8');
    },
    run(args) {
      const finalArgs = args ?? [join(dir, 'tsconfig.json')];
      const result = spawnSync(process.execPath, [asserticideEntry, ...finalArgs], {
        cwd: dir,
        encoding: 'utf8',
      });
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    },
  };
}

export interface Summary {
  total: number;
  removed: number;
  reverted: number;
  preserved: number;
  filesChanged: number;
}

export function parseSummary(stdout: string): Summary {
  const grab = (label: string): number => {
    const m = stdout.match(new RegExp(`${label}\\s+(\\d+)`));
    if (!m) throw new Error(`parseSummary: '${label}' not found in:\n${stdout}`);
    return Number(m[1]);
  };
  return {
    total: grab('total assertions found:'),
    removed: grab('removed assertions:'),
    reverted: grab('reverted by typecheck:'),
    preserved: grab('preserved by rule:'),
    filesChanged: grab('files changed:'),
  };
}
