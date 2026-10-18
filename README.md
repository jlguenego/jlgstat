# jlgstat

A quantitative X-ray of a software project, in one command:

```bash
npx jlgstat .
```

`jlgstat` inventories files by extension and language, counts physical, non-empty, code and comment lines, and shows the size distribution and the largest files and directories. It does no semantic analysis and uses no LLM. It needs no configuration and makes no network calls, except to fetch a repository you give by URL. It never modifies the analyzed files.

The report is readable by a human in a terminal, and with `--json` it can be consumed directly by scripts and AI agents. `jlgstat` itself consumes no tokens. An AI that later reads the report may.

- Works on Windows, macOS and Linux. Requires Node.js ≥ 22, plus `git` only to analyze a repository by URL.
- Deterministic: the same files and options produce the same report, whatever the locale or Git configuration of the machine.
- No telemetry. Paths in the output are relative to the project.

## Usage

```text
jlgstat [path] [options]

path                  Directory or Git repository URL to analyze (default: .)
--json                Write a single JSON report to stdout
--depth <n>           Maximum depth of the directory ranking (default: 2)
--largest <n>         Number of files in the largest-files ranking (default: 10, 0 hides it)
--all                 Include files normally excluded (.gitignore, default exclusions)
--include <glob>      Keep only matching files (.gitignore syntax, repeatable)
--exclude <glob>      Exclude matching files and directories (.gitignore syntax, repeatable)
--compare <file>      Compare with an earlier JSON snapshot
--output <file>       Write the report to a file (.json => JSON, otherwise plain text)
--ref <ref>           Branch, tag or full commit SHA to analyze (URL only; default: default branch)
--keep-clone          Keep the fetched repository in the jlgstat cache (reused on the next run)
--clear-cache         Delete the kept repositories (all, or only those of the given URL) and exit
--quiet               No progress indicator and no confirmation on stderr
--no-color            Disable colors (NO_COLOR is also honored)
-h, --help            Show help
-v, --version         Show the version
```

Examples:

```bash
npx jlgstat                                   # current directory
npx jlgstat ./packages/frontend --depth 3
npx jlgstat . --include "src/**" --exclude "*.test.ts"
npx jlgstat . --json > before.json            # or: --output before.json
npx jlgstat . --compare before.json
npx jlgstat . --all
npx jlgstat https://github.com/owner/repo    # a remote repository, see below
```

`path` must be a single directory or repository URL. To target specific files, use `--include`. Quote glob patterns so that the shell does not expand them.

### Exit codes

| Code | Meaning |
|---:|---|
| `0` | Complete analysis |
| `1` | Error that prevents the analysis: invalid option, missing or non-directory path, unreadable or incompatible snapshot, `--output` not writable; for a URL: `git` not found, repository not accessible, unknown ref or subdirectory |
| `2` | Report produced but partial: unreadable files, files that disappeared during the analysis, access errors |

Skipped symlinks, special files and informational warnings (files over 50 MB) do not cause exit code `2`.

### Analyzing a remote repository

Give the URL of a Git repository instead of a directory, as copied from the address bar of your browser if you like:

```bash
npx jlgstat https://github.com/owner/repo                      # latest commit of the default branch
npx jlgstat https://github.com/owner/repo/tree/dev/src         # branch dev, only src/
npx jlgstat git@github.com:owner/repo.git --ref v2.0.0         # a tag (or a branch, or a full commit SHA)
npx jlgstat https://gitlab.com/group/repo/-/tree/main/lib --json
```

- **git is used.** `jlgstat` runs the `git` command of your machine, with your credentials (credential helper, SSH keys, proxy). Private repositories work as they do with `git clone`. This is the only case where `jlgstat` uses the network.
- **Minimal download.** Only the requested commit is fetched, without history. For a subdirectory, only its files are downloaded when the server supports partial clone.
- **Accepted URLs.** `https://`, `http://`, `ssh://`, `git://`, `file://` and `user@host:path`. Browser URLs of GitHub (`/tree/<ref>/<dir>`), GitLab (`/-/tree/<ref>/<dir>`) and Bitbucket (`/src/<ref>/<dir>`) select a ref and a subdirectory. `--ref` wins over the ref of the URL.
- **Files as stored.** No end-of-line conversion and no Git filters are applied, so counts are the same on every OS. Git LFS files are counted as pointers; submodules are not fetched.
- **Nothing left behind.** The copy goes to the jlgstat cache and is deleted at the end, even on error or Ctrl+C. With `--keep-clone` it is kept (its path is printed on stderr) and the next run updates it instead of downloading everything again. `jlgstat --clear-cache` deletes every kept copy, and `jlgstat <url> --clear-cache` only those of one repository.
- **Cache location.** `JLGSTAT_CACHE_DIR` if set, otherwise `%LOCALAPPDATA%\jlgstat` (Windows), `~/Library/Caches/jlgstat` (macOS), `$XDG_CACHE_HOME/jlgstat` or `~/.cache/jlgstat` (Linux).
- **Report.** `root` is the URL (credentials removed) followed by the subdirectory, and the JSON field `source` gives the URL, the analyzed ref, the full commit SHA and the subdirectory.

### Output streams

- The report goes to stdout, or to the `--output` file. In that case stdout stays empty and a one-line confirmation is written to stderr.
- `--json` writes exactly one JSON object to stdout, with no banner, colors or progress.
- A progress line (`12,340 files…`) appears on stderr only when stderr is a terminal, only after the first second, and never in CI. It is erased before the report.
- `--output` replaces an existing file atomically (temporary file + rename), so the file is never left half-written.

## What is counted

- **Files**: regular files in scope, text or binary. Binary files are detected from their first 8 kB and are never read further. They are inventoried without lines.
- **Physical lines**: LF, CRLF and CR all end a line. `""` has 0 lines; `abc` has 1; `abc\n` has 1; `abc\n\n` has 2.
- **Non-empty lines**: lines with at least one character outside JavaScript's `\s` class (which includes NBSP, BOM and other Unicode spaces). For 8-bit files, only space, tab, FF and VT are blank.
- **Code and comment lines**: computed by a built-in syntax engine for about 45 languages (see below). A line with both code and a comment (`x = 1 // note`) counts as code, so `code + comment + blank = physical`. Formats not in the table get `null`, never an estimate.
- **Size**: logical bytes (not disk blocks), displayed in base 1000 (`kB`, `MB`, `GB`).
- **Directories**: directories actually traversed, root excluded. The root has depth 0.
- **Extensions**: the last suffix, lowercased (`App.TS` → `.ts`, `index.d.ts` → `.ts`). Dotfiles without another dot (`.gitignore`, `.env`) and names without a dot (`Makefile`) go to `[no extension]`. `.eslintrc.json` is `.json`.
- **Encodings**: UTF-8 with or without BOM; UTF-16 LE/BE detected by BOM. Any other text file is counted byte by byte and reported as `unknown-8bit`. There is no statistical encoding detection.
- **Large files**: there is no size cap. Text files are streamed in 64 kB blocks with constant memory. Files over 50 MB are listed in an informational warning.

Numbers use a fixed format whatever the locale: `1,234,567`, sizes in base 1000, percentages with one decimal. Percentiles use the nearest-rank method.

## Scope rules

### Default mode

- `.gitignore` files are honored at the root and in subdirectories, including negations, **whether or not a Git repository is present**. `.git/info/exclude`, the global `core.excludesFile` and `.gitignore` files above the analyzed directory are ignored, so results do not depend on the machine.
- Directory symlinks are never followed. File symlinks are followed only when their target is inside the analyzed directory. Sockets, devices and pipes are skipped. These are reported as exclusions, not as errors.
- The following default exclusions also apply.

#### Default exclusions

Directories excluded at any depth (exact name):

| Ecosystem | Directories |
|---|---|
| VCS | `.git`, `.hg`, `.svn` |
| JavaScript | `node_modules`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.parcel-cache`, `.cache`, `dist`, `build`, `out`, `coverage`, `.nyc_output`, `storybook-static` |
| Python | `__pycache__`, `.venv`, `venv`, `.tox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `*.egg-info` (suffix) |
| JVM | `.gradle` |
| PHP / Ruby | `vendor`, `.bundle` |
| IaC | `.terraform` |

Excluded files: `.DS_Store`, `Thumbs.db`.

Conditional exclusions:

| Directory | Excluded only if its parent directory contains |
|---|---|
| `bin`, `obj` | `*.csproj`, `*.fsproj`, `*.vbproj` or `*.sln` |
| `target` | `Cargo.toml`, `pom.xml`, `build.gradle` or `build.gradle.kts` |

So the `bin/` folder of a Node CLI is still analyzed. `.vscode`, `.idea` and other editor folders are **not** excluded; they are classified as configuration. Lockfiles, `*.min.js` and `*.map` are not excluded either; they are inventoried and classified as generated.

The list is part of the report (`scan.defaultExcludes`), together with the paths actually pruned (`scan.defaultExcludedPaths`).

### `--all`

Skips `.gitignore` files and the default exclusions. Symlink, special-file and access-error protections stay on. The report states the mode explicitly.

### Filters

`--include` and `--exclude` use `.gitignore` syntax, with the same engine as `.gitignore` files:

- patterns are relative to the analyzed directory and use `/` on every OS;
- `*.ts` matches at any depth, `/scripts` only at the root, `fixtures/` any directory with that name, `src/**` everything under `src/`;
- matching is case-insensitive on Windows and macOS and case-sensitive on Linux. **This is the one setting where results can differ between operating systems.**

Filters apply in this order:

1. The whole tree.
2. Default exclusions and `.gitignore` rules, skipped by `--all`.
3. `--include`: when given, only matching files are kept. It never brings back a file removed at step 2.
4. `--exclude`: removes matching files and directories. **It always wins.**

## Categories

Every file gets exactly one category: the first rule that matches wins. Name comparisons are case-insensitive.

1. **generated**:
   - paths and names: `*.min.js`, `*.min.css`, `*.map`, `*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `go.sum`, `*.generated.*`, `*.g.dart`, `*.pb.go`, `*_pb2.py`, `*.designer.cs`, anything under `__snapshots__/` or `__generated__/`;
   - header markers in the first 5 lines (at most 1 kB): `Code generated … DO NOT EDIT`, `@generated`, `<auto-generated`, `This file is automatically generated`, or `Generated by` / `Autogenerated by` followed by protoc, openapi, swagger, graphql-codegen, prisma, thrift or sqlc;
   - a line over 1,000 characters among the first 5 lines of a source file (minified code).
2. **tests**:
   - an ancestor directory named `test`, `tests`, `__tests__`, `spec`, `specs`, `e2e`, `__mocks__`, `testdata` or `fixtures`;
   - names `*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, `*_test.py`, `*_spec.rb`, `*Test.java`, `*Tests.java`, `*Test.kt`, `*Tests.cs`. The CamelCase patterns keep their capital `T`, so `Latest.java` is not a test.
3. **documentation**:
   - an ancestor `docs/` or `doc/`;
   - `*.md`, `*.mdx`, `*.rst`, `*.adoc`, `*.txt`;
   - `LICENSE*`, `CHANGELOG*`, `AUTHORS*`, `NOTICE*`.
4. **configuration**:
   - always: `package.json`, `tsconfig*.json`, `jsconfig*.json`, `*.config.*`, `.*rc`, `.*rc.*`, `.editorconfig`, `.gitignore`, `.gitattributes`, `.env*`, `Dockerfile*`, `docker-compose*.yml`, `Makefile`, `*.csproj`, `*.sln`, `pom.xml`, `build.gradle*`, `Cargo.toml`, `pyproject.toml`, `setup.cfg`, and anything under `.github/`, `.vscode/` or `.idea/`;
   - by default: `*.json`, `*.jsonc`, `*.yaml`, `*.yml`, `*.toml`, `*.ini`, `*.cfg`, `*.conf`, `*.properties`, `*.xml`. Exception: under `data/`, `assets/`, `i18n/`, `locales/`, `lang/` or `public/`, these files are classified as **other**.
5. **sources**: any extension of the language table, including HTML, CSS/SCSS/Less, SQL, Shell, Vue and Svelte. JSON, YAML, Markdown and CSV are never sources.
6. **other**: text files not recognized by any rule above, and data files.
7. **unknown**: binaries and files that cannot be classified.

The summary shows the classified source volume separately from the total physical volume. The source volume is only a proxy for code that may be relevant, for instance to an AI. It does not measure understanding, complexity or difficulty.

## Comment syntax

The engine is a small state machine driven by a versioned syntax table, modeled on `scc`/`tokei`. It tracks strings, so that a `//` inside a string is not counted as a comment.

| Family | Comments | Languages |
|---|---|---|
| C style | `//`, `/* */` | JavaScript, JSX, TypeScript, TSX, Java, C, C++, C#, Objective-C, Go, Rust, Kotlin, Swift, Scala, Dart, Groovy, CSS (`/* */` only), SCSS, Less, JSON with Comments |
| `#` style | `#` | Python (+ docstrings), Ruby (+ `=begin`/`=end`), Shell, Perl, R, YAML, TOML, Dockerfile, Makefile, Elixir |
| Specific | | PHP (`//`, `#`, `/* */`), PowerShell (`#`, `<# #>`), SQL (`--`, `/* */`), Lua (`--`, `--[[ ]]`), Haskell (`--`, `{- -}`), HTML / XML / SVG / Vue / Svelte (`<!-- -->`), Batch (`REM`, `::`), INI (`;`, `#`) |
| No comments | | JSON, Markdown, CSV/TSV, plain text: 0 comment lines, blank lines counted |

Known limitations:

- **Python docstrings**: a `"""`/`'''` string that starts a statement counts as a comment on all its lines. `x = """…"""` is code.
- **Multi-language files** (HTML, Vue, Svelte…): only the container syntax (`<!-- -->`) is applied. `//` and `/* */` inside `<script>` or `<style>` count as code, which under-counts comments.
- **Nested block comments** are handled for Rust, Haskell and Swift only.
- **Not handled**: heredocs, raw strings (Rust `r#"…"#`, C# verbatim strings), SQL embedded in strings, and `#` in the middle of a shell word. In Rust, `'` is not treated as a string delimiter, because it also introduces lifetimes.

## JSON report

`--json` (or `--output report.json`) produces a single object. Its main fields are:

| Field | Content |
|---|---|
| `schemaVersion`, `toolVersion`, `root` | Versions and analyzed directory (relative), or repository URL |
| `credit` | Authorship notice (since schema 1.1) |
| `source` | Only for a repository URL (since schema 1.2): `url`, `ref`, `commit`, `path` |
| `scan` | Mode, duration, completeness, warnings, exclusion counts, default exclusion list, filters |
| `summary` | Files (text/binary/unreadable), directories, depth, bytes, physical/non-empty/blank/code/comment lines, classified source lines, encodings |
| `byExtension`, `byLanguage` | Files, bytes, lines, share of physical lines, mean lines per file |
| `distribution` | Mean, P50, P90, P99 (nearest-rank), max, counts over 500/1,000/5,000 lines, share of the 10 largest files |
| `largestFiles` | Top `--largest` files by lines |
| `directories`, `largestDirectories`, `rootFiles` | Every traversed directory (cumulative, with depth); the ranking shown in the terminal; files directly at the root |
| `categories` | The 7 categories, in priority order |
| `comparison` | `null`, or the differences computed by `--compare` |

Numbers are raw and unformatted. A value that cannot be computed is `null`.

- **Schema**: a formal JSON Schema ships in the package at [`schema/jlgstat.schema.json`](schema/jlgstat.schema.json), importable as `jlgstat/schema.json`, together with a reference report at [`schema/example.json`](schema/example.json).
- **Versioning**: `schemaVersion` is `major.minor`. A minor version only adds fields, and consumers must ignore fields they do not know. A major version renames, removes or changes the meaning of a field, and comes with a major version of the tool.

The terminal view caps the extension table at 15 rows, followed by `+ N more extensions (X lines, Y%)`, and caps rankings at 10 entries. The JSON is never truncated.

## Comparing snapshots

```bash
npx jlgstat . --output before.json
# … time passes …
npx jlgstat . --compare before.json
```

The report shows absolute and relative changes in files, lines, bytes, extensions, categories and directories. A change from a baseline of zero shows `n/a` (`null` in JSON). Git is not needed.

- If the major `schemaVersion` differs, the snapshot is rejected (exit code `1`).
- If the mode, the default exclusions or the filters differ, the comparison still runs. A warning appears at the top of the report and the JSON contains `homogeneous: false`.
- `root` is not compared, so two clones or two locations can be compared.

## Performance

Lines are counted by a pure Node.js engine, with no bundled native binary. Directories are walked asynchronously with bounded concurrency. Once a tree holds more than 300 files, file analysis moves to a pool of worker threads (CPU count − 1, at most 8; override with `JLGSTAT_WORKERS=n`, where `0` means in-process). The report is identical either way.

The benchmark uses generated corpora (`bun run bench`, with corpora from `bench/generate.mjs`). It runs the CLI directly, so the time `npx` needs to download the package is excluded. Warm cache, median of 3 runs.

The reference machine was an Intel Core i7-7700HQ (8 threads) with 16 GB of RAM, a local SSD, Windows 10 and Node 26. Measured on 17 October 2026:

| Corpus | Lines | Size | Time | Max RSS | Target |
|---:|---:|---:|---:|---:|---:|
| 10,000 files | 1.9 M | 68 MB | 1.9 s | 236 MB | < 2 s |
| 50,000 files | 9.7 M | 337 MB | 11.9 s | 386 MB | < 5 s |
| 100,000 files | 19.5 M | 675 MB | 15.7 s | 542 MB | < 10 s |

On this Windows machine, merely opening and reading the 50,000 files (no counting at all) already takes about 6 s. The file system, with real-time antivirus scanning, is the bottleneck above 10,000 files. These figures are targets, not guarantees, and should be measured again on Linux and macOS.

## Development

Development uses [Bun](https://bun.sh) (dependencies are locked in `bun.lock`). The published package still targets Node.js ≥ 22, so `src/` only uses Node.js APIs; Node.js is needed locally for `test:pack` and `bench`, which run the CLI the way users do.

```bash
bun install
bun run build        # TypeScript → dist/ (ESM)
bun run test         # bun test; run after build to include the compiled-binary tests
bun run test:pack    # bun pm pack + install + run the real binary with Node.js
bun run bench        # benchmarks (§9.3 targets), CLI run with Node.js
bun run compare:scc <dir>   # confront line counts with scc (requires scc in PATH)
```

With [mise](https://mise.jdx.dev), `mise install` installs the pinned tools (Bun, Node.js, scc) from `mise.toml`, `mise tasks` lists the same tasks, and `mise run ci` runs what the CI runs.

CI runs on Windows, macOS and Linux with Bun, and tests the packed package with Node.js 22 and 24.

## License

MIT
