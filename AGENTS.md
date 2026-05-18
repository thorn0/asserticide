# Required Workflow

- After every code change, run `yarn run check`.
- `yarn run check` validates: lint, unused code, formatting, typecheck, tests, spellcheck. `yarn run check:fix` does the same with auto-fix. Do not run individual checks separately.
- Fix all type errors and lint issues. Do not suppress with `// @ts-ignore`, `any`, `eslint-disable`, or similar.

# Test-Driven Development

- Before implementing a feature, add failing tests first.
- Before fixing a bug, add a failing regression test first.
- TDD relentlessly: red, green, refactor. No exceptions.

# Code Style

- Avoid redundant type assertions and non-null assertions.
- Prefer early returns. Keep short early-return `if` on one line.
- Nest functions only for closures. Place functions and constants at module scope when possible.
- Keep code simple, robust, elegant, minimalistic.

# Terminology

- Do not use the term "cast". It is type assertion, not cast.

# General

- Do not make formatting-only changes — Prettier handles it via `check:fix`.
