# Asserticide bench scripts

Perf tooling. Not part of the published package. Used to validate the perf
claims in `AGENTS.md` and to bench changes to the per-iteration `tsgo`
call.

## Scripts

General perf tooling:

- `bench.mjs` — runs asserticide once with `ASSERTICIDE_TRACE=1` and prints a
  per-phase timing breakdown. Pass a project dir as the first arg.
- `tsgo-probe.mjs` — times 5 consecutive cold-start `tsgo --noEmit -p <dir>`
  invocations. Isolates per-call subprocess cost.
- `count-assertions.mjs` — regex-based count of `as X` and `!` tokens in a
  project (rough; overcounts `as const` and undercounts angle-bracket
  assertions).
- `bench-fixtures-gen.mjs` — generates a self-contained synthetic TS project
  with a known mix of assertion shapes.
- `fetch-fixture.mjs` — downloads + extracts a GitHub source tarball into
  `bench-fixtures/<name>/`.
- `cleanup.mjs` — removes content under `bench-fixtures/`.

Probes that map to the gotchas in `AGENTS.md` — keep these as executable
documentation of the perf claims:

- `tsgo-incremental-probe.mjs` — cold vs `--incremental` vs
  `--incremental --assumeChangesOnlyAffectDirectDependencies` on a project.
- `tsgo-incremental-transitive-probe.mjs` — confirms `--incremental` propagates
  errors to transitive importers through `export { x } from './a'` re-exports.
- `tsgo-incremental-scripts-probe.mjs` — demonstrates that `--incremental`
  with a warm buildinfo silently misses cross-file breakage when the modified
  file is a script (`moduleDetection: 'legacy'`). Cold tsgo catches it.

Fixtures live under `bench-fixtures/` (gitignored).

## Yarn shortcuts

- `yarn perf <project-dir>` — run the trace bench
- `yarn tsgo-probe <project-dir>` — time the cold-start cost
- `yarn count-assertions <project-dir>` — count candidates
- `yarn gen-fixture <out-dir> <files> <assertions-per-file>` — generate synthetic
- `yarn fetch-fixture <name> <github-tarball-url>` — download real source
- `yarn bench-cleanup` — manage `bench-fixtures/` contents
- `yarn tsgo-incremental-probe <project-dir>` — incremental flag matrix
- `yarn tsgo-incremental-transitive-probe` — transitive-importer propagation
- `yarn tsgo-incremental-scripts-probe` — script-file safety hole

## `ASSERTICIDE_TRACE` env var

When `ASSERTICIDE_TRACE=1`, `src/index.ts` prints per-phase timings:
`initial tsgo`, `incremental build info warmup`, `collectAssertions`,
`tsgo (N calls)`, `TS program rebuild`, `returnTypeCheck`.
