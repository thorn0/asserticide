import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultTsconfig, makeFixture, parseSummary } from './helpers.ts';

describe('asserticide', { concurrency: true }, () => {
  test('exits non-zero and modifies nothing when initial typecheck fails', (t) => {
    const fx = makeFixture(t);
    const original = 'const x: number = "not a number";\nconst y = "hi" as string;\n';
    fx.write('src/bad.ts', original);

    const r = fx.run();

    assert.notEqual(r.exitCode, 0);
    assert.match(r.stderr, /initial typecheck failed/);
    assert.equal(fx.read('src/bad.ts'), original);
  });

  test('exits non-zero when tsconfig does not exist', (t) => {
    const fx = makeFixture(t, { tsconfig: false });

    const r = fx.run();

    assert.notEqual(r.exitCode, 0);
    assert.match(r.stderr, /failed to read|cannot read file/i);
  });

  test('removes a redundant `as` assertion', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const x = "hi" as string;\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const x = "hi";\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
    assert.equal(s.filesChanged, 1);
  });

  test('keeps a necessary `as` assertion', (t) => {
    const fx = makeFixture(t);
    const source = 'export function f(v: unknown) { return (v as { n: number }).n; }\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 0);
    assert.equal(s.reverted, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('removes a redundant `<Type>` angle-bracket assertion', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const x = <string>"hi";\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const x = "hi";\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
    assert.equal(s.filesChanged, 1);
  });

  test('keeps a necessary `<Type>` angle-bracket assertion', (t) => {
    const fx = makeFixture(t);
    const source = 'export function f(v: unknown) { return (<{ n: number }>v).n; }\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 0);
    assert.equal(s.reverted, 1);
  });

  test('handles mixed `as` and `<Type>` assertions in one file', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const a = <number>1;\nexport const b = "x" as string;\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const a = 1;\nexport const b = "x";\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 2);
  });

  test('exits cleanly when project has no `as` assertions', (t) => {
    const fx = makeFixture(t);
    const source = 'export const greet = (name: string) => `hi, ${name}`;\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    assert.deepEqual(parseSummary(r.stdout), {
      total: 0,
      removed: 0,
      reverted: 0,
      preserved: 0,
      filesChanged: 0,
    });
  });

  test('processes multiple files independently', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const a = 1 as number;\n');
    fx.write('src/b.ts', 'export const b = "x" as string;\n');
    fx.write('src/c.ts', 'export function c(v: unknown) { return (v as { n: number }).n; }\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const a = 1;\n');
    assert.equal(fx.read('src/b.ts'), 'export const b = "x";\n');
    assert.equal(
      fx.read('src/c.ts'),
      'export function c(v: unknown) { return (v as { n: number }).n; }\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 3);
    assert.equal(s.removed, 2);
    assert.equal(s.filesChanged, 2);
  });

  test('reverts removals that break script-global dependents', (t) => {
    const fx = makeFixture(t, {
      tsconfig: {
        ...defaultTsconfig,
        compilerOptions: { ...defaultTsconfig.compilerOptions, moduleDetection: 'legacy' },
      },
    });
    const source =
      'declare const unknownValue: unknown;\nvar sharedRecord = unknownValue as { n: number };\n';
    fx.write('src/a.ts', source);
    fx.write('src/b.ts', 'function readShared(): number {\n  return sharedRecord.n;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 0);
    assert.equal(s.reverted, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('handles two assertions on the same line via reverse processing', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const x = ("a" as string) + ("b" as string);\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const x = ("a") + ("b");\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 2);
  });

  test('never removes `as const`, even when the resulting code would typecheck', (t) => {
    const fx = makeFixture(t);
    const source = [
      'export const literal = "hi" as const;\n',
      'export const tuple = [1, 2, 3] as const;\n',
      'export const obj = { kind: "a", value: 1 } as const;\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 0);
    assert.equal(s.removed, 0);
    assert.equal(s.filesChanged, 0);
  });

  test('never removes `as never`, even when the resulting code would typecheck', (t) => {
    const fx = makeFixture(t);
    const source = [
      'export function impossible(): never { throw new Error(); }\n',
      'export const x = impossible() as never;\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 1);
    assert.equal(s.removed, 0);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('never removes `<never>` angle-bracket assertion, even when the resulting code would typecheck', (t) => {
    const fx = makeFixture(t);
    const source = [
      'export function impossible(): never { throw new Error(); }\n',
      'export const x = <never>impossible();\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 1);
    assert.equal(s.removed, 0);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('collapses `x as any as never` to `x as never`: outer preserved, inner redundant', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export function f(x: string): never {\n  throw x as any as never;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: string): never {\n  throw x as never;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 1);
  });

  test('strips nested `as A as B` chain when both are redundant', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const x = "hi" as string as string;\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const x = "hi";\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 2);
  });

  test('keeps both assertions of `as any as T` when the inner cannot be removed', (t) => {
    const fx = makeFixture(t);
    const source = [
      'interface Animated { animVal: string }\n',
      'export function f(s: string): string {\n',
      '  return (s as any as Animated).animVal;\n',
      '}\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 0);
    assert.equal(s.reverted, 2);
  });

  test('keeps both assertions of `<T><any>x` when the inner cannot be removed', (t) => {
    const fx = makeFixture(t);
    const source = [
      'interface Animated { animVal: string }\n',
      'export function f(s: string): string {\n',
      '  return (<Animated><any>s).animVal;\n',
      '}\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 0);
    assert.equal(s.reverted, 2);
  });

  test('removes both assertions of `as any as T` when the inner removal unblocks the outer', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      'export function f(s: string): string {\n  return s as any as string;\n}\n',
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export function f(s: string): string {\n  return s;\n}\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 2);
  });

  test('keeps the outer assertion of `as any as T` when only the inner is redundant', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      'export function f(x: unknown): string {\n  return x as any as string;\n}\n',
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: unknown): string {\n  return x as string;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 1);
    assert.equal(s.reverted, 1);
  });

  test('removes an `as any` assertion when the operand is already `any`', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export function f(x: any) {\n  return x as any;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export function f(x: any) {\n  return x;\n}\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 0);
  });

  test('removes an `as` assertion to an `any` alias when the operand is also `any`', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'type A = any;\nexport function f(x: any) {\n  return x as A;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'type A = any;\nexport function f(x: any) {\n  return x;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 0);
  });

  test('keeps an `as` assertion when the operand has type `any`', (t) => {
    const fx = makeFixture(t);
    const source = 'export function f(x: any): string {\n  return x as string;\n}\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 1);
    assert.equal(s.removed, 0);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('keeps an angle-bracket assertion when the operand has type `any`', (t) => {
    const fx = makeFixture(t);
    const source = 'export function f(x: any): string {\n  return <string>x;\n}\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 1);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('collapses `x as any as T` to `x as T` when x is already `any`', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export function f(x: any): string {\n  return x as any as string;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: any): string {\n  return x as string;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 1);
  });

  test('collapses `<T><any>x` to `<T>x` when x is already `any`', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export function f(x: any): string {\n  return <string><any>x;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: any): string {\n  return <string>x;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 1);
  });

  test('preserves the outer `as T` in `x as any as T` when removing it would change the inferred return type', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      'export function f(x: string | number) {\n  return x as any as number;\n}\n',
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: string | number) {\n  return x as number;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 1);
    assert.equal(s.reverted, 0);
  });

  test('preserves an assertion whose removal would widen an inferred return type', (t) => {
    const fx = makeFixture(t);
    const source = 'export function f(x: string | number) {\n  return x as string;\n}\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('removes an assertion whose enclosing function has an explicit return type annotation', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      'export function f(x: string | number): string | number {\n  return x as string;\n}\n',
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: string | number): string | number {\n  return x;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 0);
  });

  test('preserves a `<T>` angle-bracket assertion whose removal would widen an inferred return type', (t) => {
    const fx = makeFixture(t);
    const source = 'export function f(x: string | number) {\n  return <string>x;\n}\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('preserves an assertion inside an arrow function with inferred return type', (t) => {
    const fx = makeFixture(t);
    const source = 'export const f = (x: string | number) => x as string;\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('preserves an assertion inside a class method with inferred return type', (t) => {
    const fx = makeFixture(t);
    const source = 'export class C {\n  m(x: string | number) {\n    return x as string;\n  }\n}\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('within one function, removes a side-effect assertion and preserves a return-pinning assertion', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      'export function f(x: string | number) {\n  x as number;\n  return x as string;\n}\n',
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: string | number) {\n  x;\n  return x as string;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 1);
  });

  test('removes an assertion in a side-effect statement that does not affect the return type', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      'export function f(x: string | number) {\n  x as string;\n  return 42;\n}\n',
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: string | number) {\n  x;\n  return 42;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
    assert.equal(s.preserved, 0);
  });

  test('preserves an `as T` on an object literal in an untyped variable initializer', (t) => {
    const fx = makeFixture(t);
    const source = [
      'interface State { a?: number; b?: string }\n',
      'export const state = { a: 1 } as State;\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 1);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('preserves an `<T>` angle-bracket assertion on an object literal in an untyped variable initializer', (t) => {
    const fx = makeFixture(t);
    const source = [
      'interface State { a?: number; b?: string }\n',
      'export const state = <State>{ a: 1 };\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('preserves an `as T` on an object literal in an untyped `let` initializer', (t) => {
    const fx = makeFixture(t);
    const source = [
      'interface State { a?: number; b?: string }\n',
      'export let state = { a: 1 } as State;\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
  });

  test('removes an `as T` on an object literal when the variable has an explicit type annotation', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      'interface State { a?: number }\nexport const state: State = { a: 1 } as State;\n',
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'interface State { a?: number }\nexport const state: State = { a: 1 };\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
  });

  test('preserves the outer `as T` of a `{...} as unknown as T` chain in an untyped variable initializer', (t) => {
    const fx = makeFixture(t);
    const source = [
      'interface State { req: string }\n',
      'export const state = { a: 1 } as unknown as State;\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
    assert.equal(s.reverted, 1);
  });

  test('preserves the outer `as T` of a `{...} as any as T` chain in an untyped variable initializer', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      [
        'interface State { a: number; b?: string }\n',
        'export const state = { a: 1 } as any as State;\n',
      ].join(''),
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      [
        'interface State { a: number; b?: string }\n',
        'export const state = { a: 1 } as State;\n',
      ].join(''),
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
    assert.equal(s.removed, 1);
  });

  test('preserves the outer `as T` on an object literal wrapped in a `satisfies T` clause', (t) => {
    const fx = makeFixture(t);
    const source = [
      'interface State { a: number; b?: string }\n',
      'export const state = ({ a: 1 } as State) satisfies State;\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
  });

  test('preserves the outer `as T` over a `{...} satisfies U` operand in an untyped variable initializer', (t) => {
    const fx = makeFixture(t);
    const source = [
      'interface State { a: number; b?: string }\n',
      'export const state = ({ a: 1 } satisfies State) as State;\n',
    ].join('');
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
  });

  test('removes an `as T` on an object literal in argument position', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      [
        'interface State { a?: number }\n',
        'export function take(s: State): State { return s; }\n',
        'export const r = take({ a: 1 } as State);\n',
      ].join(''),
    );

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      [
        'interface State { a?: number }\n',
        'export function take(s: State): State { return s; }\n',
        'export const r = take({ a: 1 });\n',
      ].join(''),
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
  });

  test('removes a redundant non-null assertion `!`', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export function f(x: string): string {\n  return x!;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export function f(x: string): string {\n  return x;\n}\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
  });

  test('keeps a necessary non-null assertion `!`', (t) => {
    const fx = makeFixture(t);
    const source = 'export function f(x: string | undefined): string {\n  return x!;\n}\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.reverted, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('preserves a non-null assertion whose removal would widen an inferred return type', (t) => {
    const fx = makeFixture(t);
    const source = 'export function f(x?: string) {\n  return x!;\n}\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    const s = parseSummary(r.stdout);
    assert.equal(s.preserved, 1);
    assert.equal(s.filesChanged, 0);
  });

  test('removes redundant chained non-null assertions', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export function f(x: { y: string }): string {\n  return x!.y!;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(
      fx.read('src/a.ts'),
      'export function f(x: { y: string }): string {\n  return x.y;\n}\n',
    );
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 2);
    assert.equal(s.removed, 2);
  });

  test('does not touch non-null assertions when strictNullChecks is off', (t) => {
    const fx = makeFixture(t, {
      tsconfig: {
        ...defaultTsconfig,
        compilerOptions: { ...defaultTsconfig.compilerOptions, strict: false },
      },
    });
    const source = 'export function f(x: string): string {\n  return x!;\n}\n';
    fx.write('src/a.ts', source);

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), source);
    assert.match(r.stdout, /strictNullChecks is off/);
    const s = parseSummary(r.stdout);
    assert.equal(s.total, 1);
    assert.equal(s.preserved, 1);
    assert.equal(s.removed, 0);
  });

  test('considers non-null assertions when neither `strict` nor `strictNullChecks` is set (TS default-on)', (t) => {
    const fx = makeFixture(t, {
      tsconfig: {
        compilerOptions: {
          target: 'ES2024',
          module: 'NodeNext',
          esModuleInterop: true,
          skipLibCheck: true,
          types: [],
        },
        include: ['**/*.ts'],
      },
    });
    fx.write('src/a.ts', 'export function f(x: string): string {\n  return x!;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export function f(x: string): string {\n  return x;\n}\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
  });

  test('considers non-null assertions when strictNullChecks is explicitly enabled', (t) => {
    const fx = makeFixture(t, {
      tsconfig: {
        ...defaultTsconfig,
        compilerOptions: {
          ...defaultTsconfig.compilerOptions,
          strict: false,
          strictNullChecks: true,
        },
      },
    });
    fx.write('src/a.ts', 'export function f(x: string): string {\n  return x!;\n}\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export function f(x: string): string {\n  return x;\n}\n');
    const s = parseSummary(r.stdout);
    assert.equal(s.removed, 1);
  });

  test('does not touch `as` assertions in node_modules source files', (t) => {
    const fx = makeFixture(t);
    fx.write(
      'src/a.ts',
      'import { x } from "../node_modules/foo/index.js";\nexport const y = x;\n',
    );
    const depSource = 'export const x = "redundant" as string;\n';
    fx.write('node_modules/foo/index.ts', depSource);
    fx.writeJson('node_modules/foo/package.json', { name: 'foo', type: 'module' });

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('node_modules/foo/index.ts'), depSource);
  });

  test('scans transitively imported files outside the include pattern', (t) => {
    const fx = makeFixture(t, { tsconfig: { ...defaultTsconfig, include: ['src/**/*.ts'] } });
    fx.write('src/index.ts', 'import { x } from "../lib/util.js";\nexport const y = x;\n');
    fx.write('lib/util.ts', 'export const x = 7 as number;\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('lib/util.ts'), 'export const x = 7;\n');
    assert.equal(parseSummary(r.stdout).removed, 1);
  });

  test('handles `as` assertions in .tsx files', (t) => {
    const fx = makeFixture(t, {
      tsconfig: {
        ...defaultTsconfig,
        compilerOptions: { ...defaultTsconfig.compilerOptions, jsx: 'preserve' },
      },
    });
    fx.write('src/comp.tsx', 'export const x = "hi" as string;\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/comp.tsx'), 'export const x = "hi";\n');
    assert.equal(parseSummary(r.stdout).removed, 1);
  });

  test('preserves CRLF line endings through edits', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const a = 1 as number;\r\nexport const b = 2;\r\n');

    const r = fx.run();

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const a = 1;\r\nexport const b = 2;\r\n');
  });

  test('defaults to `tsconfig.json` in cwd when no positional given', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const a = 1 as number;\n');

    const r = fx.run([]);

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const a = 1;\n');
  });

  test('accepts a positional tsconfig path', (t) => {
    const fx = makeFixture(t, { tsconfig: false });
    fx.writeJson('custom.tsconfig.json', defaultTsconfig);
    fx.write('src/a.ts', 'export const a = 1 as number;\n');

    const r = fx.run(['custom.tsconfig.json']);

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const a = 1;\n');
  });

  test('accepts a positional directory path and uses tsconfig.json inside it', (t) => {
    const fx = makeFixture(t);
    fx.write('src/a.ts', 'export const a = 1 as number;\n');

    const r = fx.run([fx.dir]);

    assert.equal(r.exitCode, 0);
    assert.equal(fx.read('src/a.ts'), 'export const a = 1;\n');
  });

  test('exits 2 on an unknown flag', (t) => {
    const fx = makeFixture(t, { tsconfig: false });

    const r = fx.run(['--bogus']);

    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /unknown option/i);
  });

  test('exits 2 when given more than one positional', (t) => {
    const fx = makeFixture(t);

    const r = fx.run(['tsconfig.json', 'extra.json']);

    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /expected at most one tsconfig path/i);
  });
});
