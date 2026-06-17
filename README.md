# asserticide

<p align="center"><img src="logo/logo.webp" alt="asserticide" width="400"></p>

Kill every redundant type assertion and non-null assertion in your TypeScript codebase

## How

For each assertion.

1. Delete it.
2. Typecheck via [`tsgo`](https://github.com/microsoft/typescript-go).
3. Keep the deletion if it typechecks; revert otherwise.

What survives is the set of assertions actually doing work — plus the small set [preserved by rule](#preserved-by-rule).

## Preserved by rule

A few cases where an assertion is kept even though `tsgo` would accept the deletion:

- `as const` — never touched.
- `as never` — never touched; almost always an intentional type hack.
- `x as T` when removing it would let `any` from `x` silently propagate (and `T` ≠ `any`).
- `x as any as T` — neither half is removed in a way that would change the value's effective type.
- An assertion whose removal would change a function's _inferred_ return type (explicit annotations are exempt).
- `{ ... } as T` initializing an unannotated variable — the assertion drives the object literal's contextual typing.
- `x!` when `strictNullChecks` is off — usually scaffolding for an in-progress migration to strict null checks.

## Use

```sh
npx asserticide                          # uses ./tsconfig.json
npx asserticide path/to/tsconfig.json
npx asserticide path/to/dir              # uses path/to/dir/tsconfig.json
```

Requires Node ≥ 24. asserticide refuses to run if the project doesn't typecheck cleanly under `tsgo`. Commit your working tree first so you can review the diff afterwards.

Sample output:

```
---
total assertions found:    412
removed assertions:        287
reverted by typecheck:     118
preserved by rule:         7
files changed:             54
- src/api/client.ts
- src/components/Grid.tsx
- ...
```

## How it compares to `no-unnecessary-type-assertion`

The difference is scale.

The [`@typescript-eslint/no-unnecessary-type-assertion`](https://typescript-eslint.io/rules/no-unnecessary-type-assertion/) lint rule works at the expression level: it reports an assertion when removing it preserves the expression type or still satisfies the contextual type at that position.

asserticide works at project level: it tries deleting each type assertion, runs `tsgo`, and keeps the edit if the checked project still typechecks and no [preservation rule](#preserved-by-rule) applies.

So asserticide can remove assertions with real local type effects when those effects are unused projectwide.
