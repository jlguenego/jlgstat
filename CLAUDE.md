# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`jlgstat` is a zero-config CLI (`npx jlgstat .`) that produces a quantitative report of a project: files, lines (code/comment/blank), extensions, languages, distribution, largest files and directories, categories, and snapshot comparison. It makes no network calls and uses no LLM. The output (terminal, help, JSON, docs) is in English.

## Tooling: Bun for development, Node.js for users

- Development uses **Bun**: `bun install` (lockfile `bun.lock`; there is no `package-lock.json`), `bun run <script>`, and `bun test`.
- The **published package runs on Node.js ≥ 22** (`#!/usr/bin/env node`, `engines.node`). Code in `src/` must only use Node APIs (`node:*`) and never Bun-specific APIs. `tsconfig.build.json` restricts `types` to `node` to enforce this. Tests may use `bun:test`.
- `mise.toml` pins Bun, Node and scc, and mirrors the package.json scripts as mise tasks (`mise run ci` runs typecheck, then build and tests, then test:pack).

## Commands

```bash
bun install
bun run typecheck                 # tsc on src + test
bun run build                     # src → dist/ (ESM); needed by the compiled-binary tests
bun run test                      # bun test --timeout 30000
bun test test/unit/lineAnalyzer.test.ts          # a single file
bun test --timeout 30000 -t "symlinks"           # tests whose name matches
bun run test:pack                 # bun pm pack + install + run the installed bin with Node
bun run bench [sizes...]          # benchmarks; runs the CLI under Node
bun run compare:scc src --tolerance 0.02         # line counts vs scc (scc in PATH)
bun run example                   # regenerate schema/example.json
```

There is no linter or formatter configured; `tsc` in strict mode with `noUncheckedIndexedAccess` is the check.

## Architecture

The pipeline is orchestrated by `src/cli/run.ts`: `parseCliArgs` → `walk()` → `buildReport()` → optional `compareReports()` → JSON or `renderTerminal()` → stdout or `atomicWrite`. `run()` takes an injected `RunIO` (stdout/stderr callbacks, cwd, env, TTY info) and returns the exit code. `src/cli/main.ts` only wires `process` to it, so tests call `run()` in-process (`test/helpers/fixture.ts`: `runCli` and `runJson`).

- **scan/**: `walker.ts` walks directories asynchronously with a concurrency limiter. It applies, in order, default exclusions (`defaultExcludes.ts`; `bin/obj/target` only next to a project file), then nested `.gitignore` chains (always honored, even outside a Git repo; parent-directory `.gitignore` files are ignored), then `--include`, then `--exclude`, which always wins. `--all` skips the defaults and `.gitignore`. Symlinked directories are never followed; symlinked files are followed only inside the root. Every skip is counted in `excludedBreakdown`, and problems become `ScanWarning`s.
- **read/**: `analyzeEntry()` takes a file path and returns an `EntryAnalysis` (sniffs binary and encoding, counts lines in a streaming way, classifies the file). `AnalyzerPool` runs it in-process for the first 300 files, then switches to `worker_threads` (CPU count − 1, at most 8; `JLGSTAT_WORKERS=n`, `0` = in-process). Workers only exist when `dist/read/worker.js` exists, so tests run from TypeScript sources stay in-process. `test/integration/dist.test.ts` checks that the worker results are identical to the in-process ones (it requires `bun run build`). `main.ts` raises `UV_THREADPOOL_SIZE` before any fs call.
- **syntax/**: `languages.ts` is the versioned language table, grouped by syntax family; adding a language means adding an entry. `lineAnalyzer.ts` is a streaming string/comment state machine (LF/CRLF/CR, nested blocks, Python docstrings, very long lines processed in slices). A line that mixes code and a comment counts as code.
- **classify/**: extension (lowercase; a dotfile with no other dot has `[no extension]`), generated-file detection (by path or name, header markers, minification), and a single category per file with precedence generated > tests > documentation > configuration > sources.
- **aggregate/** and **report/**: pure functions that turn `FileRecord[]` into the report. `report/model.ts` is the source of truth for the JSON shape and **must stay in sync with `schema/jlgstat.schema.json`** and `schema/example.json`. The schema test and the CLI tests validate against the schema with Ajv. `SCHEMA_VERSION` is `major.minor`: a minor bump only adds fields, and `--compare` rejects snapshots with a different major version.
- **Exit codes**: `0` complete, `1` error, `2` partial (any warning in `PARTIAL_WARNINGS`, such as unreadable files or directories).

## Invariants worth preserving

- The output is deterministic: sorting by UTF-16 code unit, numbers formatted independently of the locale (`1,234,567`, sizes in base 1000), `/` path separators, and never an absolute root path in the report.
- The tool is read-only: it writes only with `--output` (an atomic write).
- Test fixtures are created at runtime with `makeTree()`, so Git checkouts cannot alter CRLF line endings, BOMs or symlinks. Do not commit fixture trees.

## Specification

`specification-detaillee/` (in French) is the detailed spec. Code comments reference it as `§x.y`, using the numbering of its `README.md` index. `09-decisions.md` lists the decisions already made, and `README.md` holds the user-facing documentation and benchmark results. When behavior changes, update the relevant spec section and the README together.
