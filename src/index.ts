#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';

interface CutRange {
  cutStart: number;
  cutEnd: number;
}

interface FnContext {
  fnStartPos: number;
  fnOriginalReturnType: string;
}

interface Assertion extends CutRange {
  filePath: string;
  pendingOuter?: CutRange;
  fnContext?: FnContext;
}

interface IncrementalProgram {
  getProgram(): ts.Program;
  getChecker(): ts.TypeChecker;
  getContents(filePath: string): string;
  setContents(filePath: string, newContents: string): void;
}

const log = (msg: string): void => console.log(`asserticide: ${msg}`);
const err = (msg: string): void => console.error(`asserticide: ${msg}`);

function resolveProject(): string {
  const { positionals } = parseArgs({ allowPositionals: true, strict: true });
  if (positionals.length > 1) {
    throw new Error(
      `expected at most one tsconfig path, got ${positionals.length}`,
    );
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

function runTsgo(
  bin: string,
  project: string,
): { ok: boolean; output: string } {
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
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
    ? (f) => f
    : (f) => f.toLowerCase(),
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
};

function loadProgram(tsconfigPath: string): IncrementalProgram {
  const format = (ds: readonly ts.Diagnostic[]): string =>
    ts.formatDiagnosticsWithColorAndContext(ds, diagnosticHost);
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (read.error)
    throw new Error(`failed to read ${tsconfigPath}:\n${format([read.error])}`);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0)
    throw new Error(`tsconfig errors:\n${format(parsed.errors)}`);

  const overlay = new Map<string, string>();
  const sourceFileCache = new Map<string, ts.SourceFile>();
  const baseHost = ts.createCompilerHost(parsed.options);
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile: (filename, langVer) => {
      const cached = sourceFileCache.get(filename);
      if (cached) return cached;
      const content = overlay.get(filename) ?? baseHost.readFile(filename);
      if (content === undefined) return undefined;
      const sf = ts.createSourceFile(filename, content, langVer, true);
      sourceFileCache.set(filename, sf);
      return sf;
    },
    readFile: (f) => overlay.get(f) ?? baseHost.readFile(f),
    fileExists: (f) => overlay.has(f) || baseHost.fileExists(f),
  };

  const programOptions = {
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    host,
  };

  let program = ts.createProgram(programOptions);
  let checker = program.getTypeChecker();
  let dirty = false;

  const rebuild = (): void => {
    if (!dirty) return;
    program = ts.createProgram({ ...programOptions, oldProgram: program });
    checker = program.getTypeChecker();
    dirty = false;
  };

  return {
    getProgram: () => {
      rebuild();
      return program;
    },
    getChecker: () => {
      rebuild();
      return checker;
    },
    getContents: (filePath) => {
      const content = overlay.get(filePath) ?? baseHost.readFile(filePath);
      if (content === undefined) throw new Error(`cannot read ${filePath}`);
      return content;
    },
    setContents: (filePath, newContents) => {
      overlay.set(filePath, newContents);
      sourceFileCache.delete(filePath);
      dirty = true;
    },
  };
}

const isAnyKeyword = (t: ts.TypeNode): boolean =>
  t.kind === ts.SyntaxKind.AnyKeyword;

const isNeverKeyword = (t: ts.TypeNode): boolean =>
  t.kind === ts.SyntaxKind.NeverKeyword;

const unwrapParens = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
};

const cutRangeFor = (
  node: ts.AssertionExpression,
  sf: ts.SourceFile,
): CutRange =>
  ts.isAsExpression(node)
    ? { cutStart: node.expression.end, cutEnd: node.end }
    : { cutStart: node.getStart(sf), cutEnd: node.expression.getStart(sf) };

const isInitializerOfUntypedVarDecl = (n: ts.Node): boolean => {
  let p: ts.Node | undefined = n.parent;
  while (
    p &&
    (ts.isParenthesizedExpression(p) || ts.isSatisfiesExpression(p))
  ) {
    p = p.parent;
  }
  return (
    p !== undefined &&
    ts.isVariableDeclaration(p) &&
    p.type === undefined &&
    ts.isIdentifier(p.name)
  );
};

const chainBottomsAtObjectLiteral = (e: ts.Expression): boolean => {
  let cur = unwrapParens(e);
  while (ts.isAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) {
    cur = unwrapParens(cur.expression);
  }
  return ts.isObjectLiteralExpression(cur);
};

type AnalyzableFunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration;

// Constructors and setters have bodies but no inferred return type; signature-only kinds have no body.
const isAnalyzableFunctionLike = (n: ts.Node): n is AnalyzableFunctionLike =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isGetAccessorDeclaration(n);

function locateFunctionLikeAtPos(
  sf: ts.SourceFile,
  pos: number,
): AnalyzableFunctionLike | undefined {
  let found: AnalyzableFunctionLike | undefined;
  const walk = (node: ts.Node): true | undefined => {
    if (pos < node.getStart(sf) || pos >= node.getEnd()) return undefined;
    if (isAnalyzableFunctionLike(node) && node.getStart(sf) === pos) {
      found = node;
      return true;
    }
    return ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
}

function collectAssertions(ip: IncrementalProgram): {
  files: ts.SourceFile[];
  assertions: Assertion[];
  preserved: number;
} {
  const program = ip.getProgram();
  const checker = ip.getChecker();
  const isAnyOperand = (e: ts.Expression): boolean =>
    (checker.getTypeAtLocation(e).flags & ts.TypeFlags.Any) !== 0;
  const isAnyType = (t: ts.TypeNode): boolean =>
    (checker.getTypeFromTypeNode(t).flags & ts.TypeFlags.Any) !== 0;
  const fnContextCache = new Map<ts.Node, FnContext | undefined>();
  const computeFnContext = (
    node: ts.Node,
    sf: ts.SourceFile,
  ): FnContext | undefined => {
    const fn = ts.findAncestor(node.parent, isAnalyzableFunctionLike);
    if (!fn) return undefined;
    if (fnContextCache.has(fn)) return fnContextCache.get(fn);
    const sig = fn.type ? undefined : checker.getSignatureFromDeclaration(fn);
    const result = sig
      ? {
          fnStartPos: fn.getStart(sf),
          fnOriginalReturnType: checker.typeToString(sig.getReturnType()),
        }
      : undefined;
    fnContextCache.set(fn, result);
    return result;
  };
  const files = program
    .getSourceFiles()
    .filter(
      (sf) =>
        !sf.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sf),
    );
  const assertions: Assertion[] = [];
  let preserved = 0;
  for (const sf of files) {
    const handled = new Set<ts.Node>();
    const visit = (node: ts.Node): void => {
      const candidate =
        (ts.isAsExpression(node) && !ts.isConstTypeReference(node.type)) ||
        ts.isTypeAssertionExpression(node);
      if (candidate && !handled.has(node)) {
        const inner = unwrapParens(node.expression);
        if (isNeverKeyword(node.type)) {
          // `as never` is almost always an intentional type hack; preserve it.
          preserved++;
        } else if (
          chainBottomsAtObjectLiteral(node.expression) &&
          isInitializerOfUntypedVarDecl(node)
        ) {
          // `{...} as T` on an object-literal initializer drives the literal's contextual type.
          preserved++;
        } else if (
          ts.isAssertionExpression(inner) &&
          isAnyKeyword(inner.type)
        ) {
          // `x as any as T`: when the operand is `any`, the outer `as T` is the narrowing and must stay.
          const operandIsAny = isAnyOperand(inner.expression);
          assertions.push({
            filePath: sf.fileName,
            ...cutRangeFor(inner, sf),
            pendingOuter: operandIsAny ? undefined : cutRangeFor(node, sf),
            fnContext: computeFnContext(node, sf),
          });
          if (operandIsAny) preserved++;
          handled.add(inner);
        } else if (isAnyOperand(node.expression) && !isAnyType(node.type)) {
          // Removing a type assertion whose operand is `any` would silently let `any` propagate.
          preserved++;
        } else {
          assertions.push({
            filePath: sf.fileName,
            ...cutRangeFor(node, sf),
            fnContext: computeFnContext(node, sf),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { files, assertions, preserved };
}

function main(): void {
  try {
    const project = resolveProject();
    const tsgoBin = resolveTsgoBin();
    const ip = loadProgram(project);
    run(project, tsgoBin, ip);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}

type TryResult = 'removed' | 'reverted' | 'preserved';

function run(project: string, tsgoBin: string, ip: IncrementalProgram): void {
  log(`project = ${project}`);
  log(`tsgo    = ${tsgoBin}`);
  log('running initial typecheck...');

  const initial = runTsgo(tsgoBin, project);
  if (!initial.ok) {
    err('initial typecheck failed; refusing to modify files.');
    if (initial.output.trim()) console.error(initial.output);
    process.exit(1);
  }

  const {
    files,
    assertions,
    preserved: initialPreserved,
  } = collectAssertions(ip);
  let preserved = initialPreserved;
  let total = 0;
  for (const a of assertions) total += a.pendingOuter ? 2 : 1;
  log(`scanned ${files.length} files, found ${total} type assertions`);
  if (preserved > 0)
    log(
      `(${preserved} assertion${preserved === 1 ? '' : 's'} preserved by rule)`,
    );

  assertions.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || b.cutStart - a.cutStart,
  );

  let removed = 0;
  let revertedByTsgo = 0;
  let progress = 0;
  const changedFiles = new Set<string>();

  const checkReturnTypeStable = (
    filePath: string,
    fnContext: FnContext,
  ): boolean => {
    const sf = ip.getProgram().getSourceFile(filePath);
    const fn = sf
      ? locateFunctionLikeAtPos(sf, fnContext.fnStartPos)
      : undefined;
    if (!fn) return false;
    const checker = ip.getChecker();
    const sig = checker.getSignatureFromDeclaration(fn);
    if (!sig) return false;
    return (
      checker.typeToString(sig.getReturnType()) ===
      fnContext.fnOriginalReturnType
    );
  };

  const tryRemove = (
    filePath: string,
    cut: CutRange & { fnContext?: FnContext },
  ): TryResult => {
    const before = ip.getContents(filePath);
    const after = before.slice(0, cut.cutStart) + before.slice(cut.cutEnd);
    const apply = (content: string): void => {
      writeFileSync(filePath, content);
      ip.setContents(filePath, content);
    };
    apply(after);
    if (!runTsgo(tsgoBin, project).ok) {
      apply(before);
      return 'reverted';
    }
    if (cut.fnContext && !checkReturnTypeStable(filePath, cut.fnContext)) {
      apply(before);
      return 'preserved';
    }
    return 'removed';
  };

  const reportStep = (filePath: string, label: string): void => {
    progress++;
    log(
      `[${progress}/${total}] ${relative(process.cwd(), filePath)} - ${label}`,
    );
  };

  const bump = (r: TryResult): void => {
    if (r === 'removed') removed++;
    else if (r === 'preserved') preserved++;
    else revertedByTsgo++;
  };

  for (const a of assertions) {
    const r = tryRemove(a.filePath, a);
    reportStep(a.filePath, r);
    bump(r);
    if (r === 'removed') changedFiles.add(a.filePath);
    if (!a.pendingOuter) continue;
    if (r !== 'removed') {
      // Outer is blocked; inherits the inner's outcome bucket.
      reportStep(a.filePath, r);
      bump(r);
      continue;
    }
    // Inner removal shifts positions >= cutEnd by W; angle-bracket outer sits before the inner and needs no shift.
    const w = a.cutEnd - a.cutStart;
    const shift = a.pendingOuter.cutStart >= a.cutEnd ? w : 0;
    const rOuter = tryRemove(a.filePath, {
      cutStart: a.pendingOuter.cutStart - shift,
      cutEnd: a.pendingOuter.cutEnd - shift,
      fnContext: a.fnContext,
    });
    reportStep(a.filePath, rOuter);
    bump(rOuter);
  }

  console.log('---');
  console.log(`total assertions found:    ${total}`);
  console.log(`removed assertions:        ${removed}`);
  console.log(`reverted by typecheck:     ${revertedByTsgo}`);
  console.log(`preserved by rule:         ${preserved}`);
  console.log(`files changed:             ${changedFiles.size}`);
  for (const f of changedFiles) {
    console.log(`- ${relative(process.cwd(), f)}`);
  }
}

main();
