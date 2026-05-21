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

# tsgo Perf Gotchas

The per-iteration `tsgo --noEmit ...` call is asserticide's hot path. Changes
to its invocation are deceptively easy to regress. Things that look like
simplifications but are not:

- **The two-call design is "one on revert, two on success", not "two always".**
  The fast incremental call runs every iteration; the cold confirm only runs
  when the fast call passes. Reverts are the common case (~92% on SBPA), so
  the average is close to one call. Don't drop either call without measuring
  end-to-end on a real codebase.
- **`--assumeChangesOnlyAffectDirectDependencies` is a real speedup on
  semantic edits**, not a no-op or a future-tsgo speculation. On real
  workloads it halves per-call cost vs plain `--incremental`.
- **`--incremental` alone (no `--assumeChangesOnly...`) is roughly as slow as
  cold** on real semantic edits to a tightly-coupled codebase. The probe
  that says "incremental is 3× faster" used trivial comment-only edits to a
  single file — that pattern doesn't represent asserticide's behavior and
  the win evaporates on real edits.
- **`--incremental` with a warm buildinfo silently misses cross-file
  breakage when the modified file is a script** (no imports/exports —
  global scope, often paired with `moduleDetection: 'legacy'`). The same
  edit caught from a cold check is missed by incremental. The cold confirm
  on the success path doubles as the script-file safety net; the
  per-iteration script-vs-module branch in `tryRemove` exists for this.
- **Reverted iterations pollute the buildinfo with the failed edit's broken
  state.** Without snapshotting and restoring the buildinfo on revert, every
  subsequent iter pays a recovery cost — net ~2× slowdown end-to-end. The
  backup-and-restore around each iter is load-bearing, not bookkeeping.
- **The Windows `tsgo.cmd` wrapper adds a `cmd.exe` shell hop per call.**
  Spawning `node node_modules/@typescript/native-preview/bin/tsgo.js`
  directly skips it and saves ~50–100 ms per call. Worth it because there
  are hundreds of calls.

Before changing any of the above, write a probe that mirrors the actual
asserticide pattern (semantic edits to many different files, with
revert/keep cycles) and bench it against SBPA — synthetic-medium and tiny
fixtures don't surface these effects.
