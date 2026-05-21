import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

const asserticideEntry = path.resolve(import.meta.dirname, '..', 'dist', 'index.js');

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
  const directory = mkdtempSync(path.join(tmpdir(), 'asserticide-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const write = (relPath: string, content: string): void => {
    const full = path.join(directory, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  if (options.tsconfig !== false) {
    write('tsconfig.json', JSON.stringify(options.tsconfig ?? defaultTsconfig, null, 2));
  }

  return {
    dir: directory,
    write,
    writeJson(relPath, data) {
      write(relPath, JSON.stringify(data, null, 2));
    },
    read(relPath) {
      return readFileSync(path.join(directory, relPath), 'utf8');
    },
    run(args) {
      const finalArgs = args ?? [path.join(directory, 'tsconfig.json')];
      const result = spawnSync(process.execPath, [asserticideEntry, ...finalArgs], {
        cwd: directory,
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
    const m = new RegExp(String.raw`${label}\s+(\d+)`).exec(stdout);
    if (!m) {
      throw new Error(`parseSummary: '${label}' not found in:\n${stdout}`);
    }
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
