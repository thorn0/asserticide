#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';

interface Assertion {
  filePath: string;
  cutStart: number;
  cutEnd: number;
}

const log = (msg: string): void => console.log(`asserticide: ${msg}`);
const err = (msg: string): void => console.error(`asserticide: ${msg}`);

function resolveProject(): string {
  const { positionals } = parseArgs({ allowPositionals: true, strict: true });
  if (positionals.length > 1) {
    throw new Error(`expected at most one tsconfig path, got ${positionals.length}`);
  }
  return pathResolve(positionals[0] ?? 'tsconfig.json');
}

function resolveTsgoBin(): string {
  const exe = process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo';
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const seen = new Set<string>();
  for (const start of [moduleDir, process.cwd()]) {
    let dir = pathResolve(start);
    while (!seen.has(dir)) {
      seen.add(dir);
      const candidate = pathResolve(dir, 'node_modules', '.bin', exe);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    `${exe} not found in any ancestor node_modules/.bin. Install @typescript/native-preview@beta.`,
  );
}

function runTsgo(bin: string, project: string): { ok: boolean; output: string } {
  const result =
    process.platform === 'win32'
      ? spawnSync(`"${bin}" --noEmit --project "${project}"`, {
          encoding: 'utf8',
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawnSync(bin, ['--noEmit', '--project', project], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
  if (result.error) {
    return { ok: false, output: result.error.message };
  }
  return {
    ok: result.status === 0,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
  };
}

const diagnosticHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? (f) => f : (f) => f.toLowerCase(),
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
};

function loadProgram(tsconfigPath: string): ts.Program {
  const format = (ds: readonly ts.Diagnostic[]): string =>
    ts.formatDiagnosticsWithColorAndContext(ds, diagnosticHost);
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (read.error) throw new Error(`failed to read ${tsconfigPath}:\n${format([read.error])}`);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) throw new Error(`tsconfig errors:\n${format(parsed.errors)}`);
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
}

function collectAssertions(program: ts.Program): { files: ts.SourceFile[]; assertions: Assertion[] } {
  const files = program.getSourceFiles().filter(
    (sf) => !sf.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sf),
  );
  const assertions: Assertion[] = [];
  for (const sf of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isAsExpression(node) && !ts.isConstTypeReference(node.type)) {
        assertions.push({
          filePath: sf.fileName,
          cutStart: node.expression.end,
          cutEnd: node.end,
        });
      } else if (ts.isTypeAssertionExpression(node)) {
        assertions.push({
          filePath: sf.fileName,
          cutStart: node.getStart(sf),
          cutEnd: node.expression.getStart(sf),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { files, assertions };
}

function main(): void {
  try {
    const project = resolveProject();
    const tsgoBin = resolveTsgoBin();
    const program = loadProgram(project);
    run(project, tsgoBin, program);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}

function run(project: string, tsgoBin: string, program: ts.Program): void {
  log(`project = ${project}`);
  log(`tsgo    = ${tsgoBin}`);
  log('running initial typecheck...');

  const initial = runTsgo(tsgoBin, project);
  if (!initial.ok) {
    err('initial typecheck failed; refusing to modify files.');
    if (initial.output.trim()) console.error(initial.output);
    process.exit(1);
  }

  const { files, assertions } = collectAssertions(program);
  log(`scanned ${files.length} files, found ${assertions.length} type assertions`);

  assertions.sort((a, b) => a.filePath.localeCompare(b.filePath) || b.cutStart - a.cutStart);

  let removed = 0;
  const changedFiles = new Set<string>();
  const contents = new Map<string, string>();

  for (let i = 0; i < assertions.length; i++) {
    const a = assertions[i];
    const before = contents.get(a.filePath) ?? readFileSync(a.filePath, 'utf8');
    const after = before.slice(0, a.cutStart) + before.slice(a.cutEnd);
    writeFileSync(a.filePath, after);
    const ok = runTsgo(tsgoBin, project).ok;
    if (ok) {
      contents.set(a.filePath, after);
      removed++;
      changedFiles.add(a.filePath);
    } else {
      writeFileSync(a.filePath, before);
      contents.set(a.filePath, before);
    }
    log(`[${i + 1}/${assertions.length}] ${relative(process.cwd(), a.filePath)} - ${ok ? 'removed' : 'kept'}`);
  }

  console.log('---');
  console.log(`total assertions found:    ${assertions.length}`);
  console.log(`removed assertions:        ${removed}`);
  console.log(`kept/reverted assertions:  ${assertions.length - removed}`);
  console.log(`files changed:             ${changedFiles.size}`);
  for (const f of changedFiles) {
    console.log(`- ${relative(process.cwd(), f)}`);
  }
}

main();
