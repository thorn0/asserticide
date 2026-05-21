// Shared helpers for bench scripts. Mirrors src/index.ts's tsgo invocation
// (bypasses the tsgo.cmd shell shim on Windows) so probe measurements
// correspond to what production pays.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
export const repoRoot = path.resolve(here, '..');

const tsgoCmd = path.resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo',
);
const windowsEntrypoint = path.resolve(
  repoRoot,
  'node_modules',
  '@typescript',
  'native-preview',
  'bin',
  'tsgo.js',
);
const useDirectNode = process.platform === 'win32' && existsSync(windowsEntrypoint);

export function spawnTsgo(args, opts = {}) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const child = useDirectNode
      ? spawn(process.execPath, [windowsEntrypoint, ...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          ...opts,
        })
      : spawn(tsgoCmd, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
          ...opts,
        });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, ms: performance.now() - t0 });
    });
  });
}
