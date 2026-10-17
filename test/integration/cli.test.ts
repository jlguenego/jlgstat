import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv } from 'ajv';
import { afterAll, describe, expect, test } from 'bun:test';
import { CREDIT, type Report } from '../../src/report/model.js';
import { cleanupTrees, makeTree, runCli, runJson, trySymlink } from '../helpers/fixture.js';

afterAll(cleanupTrees);

const schema = JSON.parse(await readFile(new URL('../../schema/jlgstat.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

function expectValid(report: unknown): void {
  const ok = validate(report);
  expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  expect(ok).toBe(true);
}

// Symlink creation needs a privilege on Windows; probe it once so the test can be skipped.
const probe = await makeTree({ 'f.txt': 'x\n', d: null });
const canSymlink =
  (await trySymlink(path.join(probe, 'd'), path.join(probe, 'dl'), 'dir')) &&
  (await trySymlink(path.join(probe, 'f.txt'), path.join(probe, 'fl.txt'), 'file'));

const paths = (r: Report): string[] => r.largestFiles.map((f) => f.path).sort();

describe('basic scan', () => {
  test('empty directory', async () => {
    const root = await makeTree({});
    const { code, report } = await runJson(['.'], root);
    expect(code).toBe(0);
    expectValid(report);
    expect(report.summary).toMatchObject({ files: 0, physicalLines: 0, directories: 0, maxDepth: 0 });
    expect(report.distribution.p50).toBeNull();
    expect(report.scan.complete).toBe(true);
  });

  test('defaults to the current directory and counts lines', async () => {
    const root = await makeTree({
      'a.ts': 'const a = 1;\n\n// c\n',
      'empty.txt': '',
      'src/b.py': '# c\nprint(1)',
      'src/deep/c.md': '# Title\r\n\r\ntext\r\n',
      'Makefile': 'all:\n',
      '.env': 'A=1\n',
    });
    const { code, report } = await runJson([], root);
    expect(code).toBe(0);
    expectValid(report);
    expect(report.root).toBe('.');
    expect(report.summary).toMatchObject({
      files: 6,
      textFiles: 6,
      physicalLines: 3 + 0 + 2 + 3 + 1 + 1,
      nonEmptyLines: 2 + 0 + 2 + 2 + 1 + 1,
      directories: 2,
      maxDepth: 2,
    });
    const ext = Object.fromEntries(report.byExtension.map((e) => [e.extension, e]));
    expect(ext['.ts']).toMatchObject({ files: 1, physicalLines: 3, nonEmptyLines: 2, commentLines: 1, codeLines: 1 });
    expect(ext['[no extension]']).toMatchObject({ files: 2, physicalLines: 2 });
    expect(report.byExtension[0]!.extension).toBe('.md');
    expect(report.rootFiles.files).toBe(4);
  });

  test('extension table is sorted by lines, then extension', async () => {
    const root = await makeTree({ 'a.b': 'x\n', 'a.a': 'x\n', 'c.c': 'x\ny\n' });
    const { report } = await runJson([], root);
    expect(report.byExtension.map((e) => e.extension)).toEqual(['.c', '.a', '.b']);
  });

  test('encodings: UTF-8 BOM, UTF-16 LE/BE, Latin-1', async () => {
    const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\r\n \r\nb', 'utf16le')]);
    const utf16be = Buffer.from(utf16le);
    utf16be[0] = 0xfe;
    utf16be[1] = 0xff;
    for (let i = 2; i < utf16be.length; i += 2) [utf16be[i], utf16be[i + 1]] = [utf16le[i + 1]!, utf16le[i]!];
    const root = await makeTree({
      'bom.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\n\nb\n')]),
      'le.txt': utf16le,
      'be.txt': utf16be,
      'latin1.txt': Buffer.from('caf\xe9\n\xa0\n', 'latin1'),
    });
    const { report } = await runJson([], root);
    expect(report.summary.encodings).toEqual({ 'unknown-8bit': 1, 'utf-16be': 1, 'utf-16le': 1, 'utf-8-bom': 1 });
    const byPath = Object.fromEntries(report.largestFiles.map((f) => [f.path, f]));
    expect(byPath['le.txt']!.physicalLines).toBe(3);
    expect(byPath['be.txt']!.physicalLines).toBe(3);
    expect(byPath['latin1.txt']!.encoding).toBe('unknown-8bit');
    // NBSP is blank in UTF-16 (\s) but not in 8-bit fallback.
    expect(report.summary.nonEmptyLines).toBe(2 + 2 + 2 + 2);
  });

  test('binary files are inventoried without lines', async () => {
    const root = await makeTree({
      'logo.png': Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20000, 1)]),
      'a.txt': 'x\n',
    });
    const { report } = await runJson([], root);
    expect(report.summary).toMatchObject({ files: 2, textFiles: 1, binaryFiles: 1, physicalLines: 1 });
    const png = report.byExtension.find((e) => e.extension === '.png')!;
    expect(png).toMatchObject({ binaryFiles: 1, physicalLines: 0, meanLinesPerFile: null, commentLines: null });
    expect(paths(report)).toEqual(['a.txt']);
  });

  test('large files are counted in full across 64 kB blocks', async () => {
    const line = 'abcdefghij\r\n';
    const count = 200_000; // ~2.4 MB, CRLF pairs straddle block boundaries
    const root = await makeTree({ 'big.log': line.repeat(count) + 'tail' });
    const { report } = await runJson([], root);
    expect(report.summary.physicalLines).toBe(count + 1);
  });

  test('Unicode, spaces and special characters in paths', async () => {
    const root = await makeTree({ 'dossier é/fichier à ü 漢字.ts': 'x\n', 'a b/#c [d].js': 'y\n' });
    const { report } = await runJson([], root);
    expect(paths(report)).toEqual(['a b/#c [d].js', 'dossier é/fichier à ü 漢字.ts']);
  });
});

describe('exclusions and filters (§3.2, §4.1)', () => {
  test('default exclusions at any depth, editor folders kept', async () => {
    const root = await makeTree({
      'node_modules/x/index.js': 'x\n',
      'packages/a/node_modules/y.js': 'x\n',
      'packages/a/dist/out.js': 'x\n',
      'pkg.egg-info/PKG-INFO': 'x\n',
      '.git/HEAD': 'x\n',
      '.DS_Store': 'x',
      '.vscode/settings.json': '{}\n',
      'src/a.js': 'x\n',
    });
    const { report } = await runJson([], root);
    expect(paths(report)).toEqual(['.vscode/settings.json', 'src/a.js']);
    expect(report.scan.defaultExcludedPaths).toEqual(['.git', 'node_modules', 'packages/a/dist', 'packages/a/node_modules', 'pkg.egg-info']);
    expect(report.scan.excludedBreakdown.defaultRules).toBe(6);
    expect(report.scan.defaultExcludes).toContain('node_modules/');
  });

  test('bin/obj/target excluded only next to a project file', async () => {
    const root = await makeTree({
      'cli/bin/run.js': 'x\n',
      'cli/package.json': '{}\n',
      'app/App.csproj': '<Project/>\n',
      'app/bin/Debug/a.dll.txt': 'x\n',
      'app/obj/b.txt': 'x\n',
      'rs/Cargo.toml': '[package]\n',
      'rs/target/debug/x.txt': 'x\n',
      'other/target/keep.txt': 'x\n',
    });
    const { report } = await runJson([], root);
    expect(paths(report)).toEqual(['app/App.csproj', 'cli/bin/run.js', 'cli/package.json', 'other/target/keep.txt', 'rs/Cargo.toml']);
  });

  test('.gitignore root and nested, with negations, without a Git repository', async () => {
    const root = await makeTree({
      '.gitignore': '*.log\nsecret/\n!keep.log\n',
      'a.log': 'x\n',
      'keep.log': 'x\n',
      'secret/s.txt': 'x\n',
      'sub/.gitignore': '*.tmp\n!important.log\n',
      'sub/x.tmp': 'x\n',
      'sub/important.log': 'x\n',
      'sub/other.log': 'x\n',
      'sub/b.txt': 'x\n',
    });
    const { report } = await runJson([], root);
    expect(paths(report)).toEqual(['.gitignore', 'keep.log', 'sub/.gitignore', 'sub/b.txt', 'sub/important.log']);
    expect(report.scan.excludedBreakdown.gitignore).toBe(4);

    // Same result with a .git directory present.
    await mkdir(path.join(root, '.git', 'objects'), { recursive: true });
    const again = await runJson([], root);
    expect(paths(again.report)).toEqual(paths(report));
  });

  test('.gitignore of parent directories is ignored', async () => {
    const root = await makeTree({ '.gitignore': '*.ts\n', 'pkg/a.ts': 'x\n' });
    const { report } = await runJson(['pkg'], root);
    expect(report.root).toBe('pkg');
    expect(paths(report)).toEqual(['a.ts']);
  });

  test('--all includes ignored and default-excluded files', async () => {
    const root = await makeTree({
      '.gitignore': '*.log\n',
      'a.log': 'x\n',
      'node_modules/m.js': 'x\n',
      'src/a.js': 'x\n',
    });
    const { report } = await runJson(['--all'], root);
    expect(report.scan.mode).toBe('all');
    expect(report.scan.defaultExcludes).toEqual([]);
    expect(paths(report)).toEqual(['.gitignore', 'a.log', 'node_modules/m.js', 'src/a.js']);
  });

  test('--include keeps matches but never re-includes excluded files; --exclude always wins', async () => {
    const root = await makeTree({
      '.gitignore': 'ignored.ts\n',
      'ignored.ts': 'x\n',
      'src/a.ts': 'x\n',
      'src/a.test.ts': 'x\n',
      'src/b.js': 'x\n',
      'scripts/s.ts': 'x\n',
      'lib/scripts/t.ts': 'x\n',
      'node_modules/n.ts': 'x\n',
    });
    const inc = await runJson(['--include', '*.ts'], root);
    expect(paths(inc.report)).toEqual(['lib/scripts/t.ts', 'scripts/s.ts', 'src/a.test.ts', 'src/a.ts']);

    const both = await runJson(['--include', '*.ts', '--exclude', '*.test.ts', '--exclude', '/scripts'], root);
    expect(paths(both.report)).toEqual(['lib/scripts/t.ts', 'src/a.ts']);
    expect(both.report.scan.include).toEqual(['*.ts']);
    expect(both.report.scan.exclude).toEqual(['*.test.ts', '/scripts']);

    const dirs = await runJson(['--include', 'src/**', '--exclude', 'src/b.js'], root);
    expect(paths(dirs.report)).toEqual(['src/a.test.ts', 'src/a.ts']);

    const all = await runJson(['--all', '--include', 'node_modules/', '--exclude', 'n.ts'], root);
    expect(paths(all.report)).toEqual([]);
  });

  test.skipIf(!canSymlink)('symlinks: directories never followed, files followed only inside the root', async () => {
    const outside = await makeTree({ 'outside.ts': 'x\n' });
    const root = await makeTree({ 'real/a.ts': 'x\ny\n' });
    await trySymlink(path.join(root, 'real'), path.join(root, 'loop'), 'dir');
    await trySymlink(path.join(root, 'real', 'a.ts'), path.join(root, 'link.ts'), 'file');
    await trySymlink(path.join(outside, 'outside.ts'), path.join(root, 'out.ts'), 'file');
    await trySymlink(path.join(root, 'missing.ts'), path.join(root, 'broken.ts'), 'file');
    const { code, report } = await runJson([], root);
    expect(code).toBe(0);
    expect(report.scan.complete).toBe(true);
    expect(paths(report)).toEqual(['link.ts', 'real/a.ts']);
    const codes = report.scan.warnings.map((w) => w.code).sort();
    expect(codes).toEqual(['symlink-broken-skipped', 'symlink-directory-skipped', 'symlink-outside-root-skipped']);
  });

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('unreadable files make the report partial (exit code 2)', async () => {
    const root = await makeTree({ 'ok.ts': 'x\n', 'locked.ts': 'secret\n', 'lockedDir/x.ts': 'x\n' });
    await chmod(path.join(root, 'locked.ts'), 0o000);
    await chmod(path.join(root, 'lockedDir'), 0o000);
    try {
      const { code, report } = await runJson([], root);
      expect(code).toBe(2);
      expectValid(report);
      expect(report.scan.complete).toBe(false);
      expect(report.summary.unreadableFiles).toBe(1);
      expect(report.scan.warnings.map((w) => w.code).sort()).toEqual(['unreadable-directory', 'unreadable-file']);
    } finally {
      await chmod(path.join(root, 'locked.ts'), 0o644);
      await chmod(path.join(root, 'lockedDir'), 0o755);
    }
  });
});

describe('CLI contract (§3, §10)', () => {
  test('invalid options and targets exit with code 1', async () => {
    const root = await makeTree({ 'a.ts': 'x\n' });
    for (const args of [['--depth', 'abc'], ['--largest', '-1'], ['--bogus'], ['a', 'b'], ['missing'], ['a.ts'], ['--include', '']]) {
      const r = await runCli(args, root);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^jlgstat: error: /);
    }
  });

  test('--help and --version', async () => {
    const root = await makeTree({});
    expect((await runCli(['--help'], root)).stdout).toMatch(/^Usage: jlgstat \[path\] \[options\]/);
    expect((await runCli(['--version'], root)).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  test('authorship notice in the help, the terminal report and the JSON report', async () => {
    const root = await makeTree({ 'a.ts': 'x\n' });
    expect((await runCli(['--help'], root)).stdout.endsWith(`\n${CREDIT}\n`)).toBe(true);
    expect((await runCli([], root)).stdout.endsWith(`\n${CREDIT}\n`)).toBe(true);
    expect((await runJson([], root)).report.credit).toBe(CREDIT);
  });

  test('--json writes a single JSON object and nothing on stderr', async () => {
    const root = await makeTree({ 'a.ts': 'x\n' });
    const r = await runCli(['--json'], root);
    expect(r.stderr).toBe('');
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stdout.trim().startsWith('{')).toBe(true);
  });

  test('--largest and --depth', async () => {
    const root = await makeTree({ 'a/b/c/d.ts': 'x\n', 'a/e.ts': 'x\ny\n', 'f.ts': 'x\ny\nz\n' });
    const one = await runJson(['--largest', '1', '--depth', '1'], root);
    expect(one.report.largestFiles.map((f) => f.path)).toEqual(['f.ts']);
    expect(one.report.largestDirectories.map((d) => d.path)).toEqual(['a']);
    expect(one.report.directories.map((d) => d.path)).toEqual(['a', 'a/b', 'a/b/c']);
    const none = await runJson(['--largest', '0'], root);
    expect(none.report.largestFiles).toEqual([]);
    const text = await runCli(['--largest', '0'], root);
    expect(text.stdout).not.toContain('Largest files');
  });

  test('terminal report is deterministic and color-free when not a TTY', async () => {
    const root = await makeTree({ 'src/a.ts': 'x\n', 'b.md': '# t\n' });
    const strip = (s: string) => s.replace(/· \d[\d,.]* m?s/, '· X');
    const a = await runCli([], root);
    const b = await runCli([], root);
    expect(strip(a.stdout)).toBe(strip(b.stdout));
    expect(a.stdout).not.toMatch(/\x1b\[/);
    expect(a.stdout).toContain('./ (root files)');
    expect(a.stdout).toContain('Directory (cumulative)');
  });

  test('more than 15 extensions are summarized', async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i < 20; i++) tree[`f${i}.e${String(i).padStart(2, '0')}`] = 'x\n'.repeat(i + 1);
    const root = await makeTree(tree);
    const r = await runCli([], root);
    expect(r.stdout).toMatch(/\+ 5 more extensions \(15 lines, 7\.1%\)/);
  });
});

describe('--output (§3.3)', () => {
  test('format by extension, overwrite, atomic, confirmation on stderr', async () => {
    const root = await makeTree({ 'a.ts': 'x\n' });
    await writeFile(path.join(root, 'out.json'), 'old content');
    const r = await runCli(['.', '--output', 'out.json'], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/JSON report written to out.json/);
    expectValid(JSON.parse(await readFile(path.join(root, 'out.json'), 'utf8')));

    const t = await runCli(['.', '--output', 'report.txt', '--quiet'], root);
    expect(t.stderr).toBe('');
    const text = await readFile(path.join(root, 'report.txt'), 'utf8');
    expect(text).toMatch(/^jlgstat /);
    expect(text).not.toMatch(/\x1b\[/);

    await runCli(['.', '--output', 'forced.txt', '--json', '--quiet'], root);
    const forced = await readFile(path.join(root, 'forced.txt'), 'utf8');
    expect(() => JSON.parse(forced)).not.toThrow();

    const leftovers = (await readdir(root)).filter((n) => n.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  test('unwritable output exits with code 1', async () => {
    const root = await makeTree({ 'a.ts': 'x\n' });
    const r = await runCli(['.', '--output', 'missing-dir/out.json'], root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/cannot write/);
  });
});

describe('--compare (§8)', () => {
  test('differences, n/a for zero baselines, valid combined JSON', async () => {
    const root = await makeTree({ 'src/a.ts': 'x\n'.repeat(10) });
    await runCli(['.', '--output', '../before.json', '--quiet'], path.join(root));
    const before = path.join(root, '..', 'before.json');
    await writeFile(path.join(root, 'src', 'b.py'), 'y\n'.repeat(5));
    await writeFile(path.join(root, 'src', 'a.ts'), 'x\n'.repeat(20));

    const { code, report } = await runJson(['--compare', before], root);
    expect(code).toBe(0);
    expectValid(report);
    const cmp = report.comparison!;
    expect(cmp.homogeneous).toBe(true);
    expect(cmp.summary.files).toEqual({ before: 1, after: 2, delta: 1, relative: 1 });
    expect(cmp.summary.physicalLines).toEqual({ before: 10, after: 25, delta: 15, relative: 1.5 });
    const py = cmp.byExtension.find((e) => e.extension === '.py')!;
    expect(py.physicalLines).toEqual({ before: 0, after: 5, delta: 5, relative: null });

    const text = await runCli(['--compare', before], root);
    expect(text.stdout).toContain('Comparison with');
    expect(text.stdout).toContain('n/a');
    await rm(before);
  });

  test('non-homogeneous snapshots are compared with a warning', async () => {
    const root = await makeTree({ 'a.ts': 'x\n' });
    const snap = path.join(root, 'snap.json');
    await runCli(['.', '--output', 'snap.json', '--all', '--quiet'], root);
    const { report } = await runJson(['--compare', 'snap.json', '--exclude', 'snap.json'], root);
    expect(report.comparison!.homogeneous).toBe(false);
    expect(report.comparison!.differences.length).toBeGreaterThanOrEqual(2);
    const text = await runCli(['--compare', snap], root);
    expect(text.stdout).toMatch(/Warning: non-homogeneous comparison/);
  });

  test('incompatible major schema, invalid or missing snapshot exit with code 1', async () => {
    const root = await makeTree({ 'a.ts': 'x\n', 'v2.json': JSON.stringify({ schemaVersion: '2.0' }), 'bad.json': '{' });
    for (const file of ['v2.json', 'bad.json', 'none.json']) {
      const r = await runCli(['--compare', file], root);
      expect(r.code, file).toBe(1);
      expect(r.stdout).toBe('');
    }
  });
});
