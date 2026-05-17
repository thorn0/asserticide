# asserticide

<p align="center"><img src="logo/logo.webp" alt="asserticide" width="400"></p>

Kill every redundant type assertion in your TypeScript codebase

## How

For each type assertion.

1. Delete it.
2. Typecheck via [`tsgo`](https://github.com/microsoft/typescript-go).
3. Keep the deletion if it typechecks; revert otherwise.

What survives is the set of assertions actually doing work — plus the small set [preserved by rule](#preserved-by-rule).

## Preserved by rule

A few cases where a cast is kept even though `tsgo` would accept the deletion:

- `as const` — never touched.
- `as never` (and `<never>`) — never touched; almost always an intentional type hack.
- `x as T` when `x` already has type `any` (and `T` ≠ `any`) — removing it would let `any` silently propagate.
- `x as any as T` is treated as a force-cast pair; neither half is removed in a way that would change the value's effective type. When `x` already has type `any`, the inner `as any` is removed and the outer `as T` stays.
- A cast inside a function with an *inferred* return type, when removing it would change the function's inferred return type. Functions with an explicit return annotation are exempt.

## Use

```sh
asserticide                          # uses ./tsconfig.json
asserticide path/to/tsconfig.json
```

Requires Node ≥ 24.
