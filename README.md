# asserticide

<p align="center"><img src="logo/logo.webp" alt="asserticide" width="400"></p>

Kill every redundant type assertion in your TypeScript codebase

## How

For each type assertion.

1. Delete it.
2. Typecheck via [`tsgo`](https://github.com/microsoft/typescript-go).
3. Keep the deletion if it typechecks; revert otherwise.

What survives is the set of assertions actually doing work.

## Use

```sh
asserticide                          # uses ./tsconfig.json
asserticide path/to/tsconfig.json
```

Requires Node ≥ 24.
