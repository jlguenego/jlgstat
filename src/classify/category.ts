import type { Category, FileKind } from '../report/model.js';
import type { Language } from '../syntax/languages.js';
import { hasGeneratedMarker, isGeneratedByPath, looksMinified } from './generated.js';

// Single-category classification (§5.5): the first matching rule wins, in
// priority order generated > tests > documentation > configuration > sources
// > other > unknown. Name comparisons are case-insensitive.

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', '__mocks__', 'testdata', 'fixtures']);

const TEST_NAME_PATTERNS: readonly RegExp[] = [
  /\.test\./i,
  /\.spec\./i,
  /_test\.go$/i,
  /^test_.*\.py$/i,
  /_test\.py$/i,
  /_spec\.rb$/i,
];
// CamelCase conventions keep their capital letter: a case-insensitive
// `*test.java` would also match names such as `Latest.java`.
const TEST_CAMEL_PATTERNS: readonly RegExp[] = [/Tests?\.java$/, /Test\.kt$/, /Tests\.cs$/];

const DOC_DIRS = new Set(['docs', 'doc']);
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.adoc', '.txt']);
const DOC_NAME_PREFIXES = ['license', 'changelog', 'authors', 'notice'];

const CONFIG_DIRS = new Set(['.github', '.vscode', '.idea']);
const CONFIG_NAMES = new Set([
  'package.json',
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  'makefile',
  'pom.xml',
  'cargo.toml',
  'pyproject.toml',
  'setup.cfg',
]);
const CONFIG_NAME_PATTERNS: readonly RegExp[] = [
  /^tsconfig.*\.json$/,
  /^jsconfig.*\.json$/,
  /\.config\./,
  /^\..*rc$/,
  /^\..*rc\..+$/,
  /^\.env/,
  /^dockerfile/,
  /^docker-compose.*\.ya?ml$/,
  /\.csproj$/,
  /\.sln$/,
  /^build\.gradle/,
];
const CONFIG_DEFAULT_EXTENSIONS = new Set([
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.xml',
]);
const DATA_DIRS = new Set(['data', 'assets', 'i18n', 'locales', 'lang', 'public']);

export interface ClassifyInput {
  /** Relative path, `/` separators. */
  path: string;
  extension: string;
  kind: FileKind;
  language: Language | null;
  /** Decoded first bytes of a text file (for header markers and minification). */
  header: string | null;
}

export function classify(input: ClassifyInput): Category {
  const parts = input.path.toLowerCase().split('/');
  const name = parts.pop()!;
  const dirs = parts;
  const originalName = input.path.slice(input.path.lastIndexOf('/') + 1);
  const isSourceLanguage = input.language?.source === true;

  // 1. Generated: path first, then content.
  if (isGeneratedByPath(dirs, name)) return 'generated';
  if (input.header !== null) {
    if (hasGeneratedMarker(input.header)) return 'generated';
    if (isSourceLanguage && looksMinified(input.header)) return 'generated';
  }

  // 2. Tests.
  if (dirs.some((d) => TEST_DIRS.has(d))) return 'tests';
  if (TEST_NAME_PATTERNS.some((re) => re.test(name))) return 'tests';
  if (TEST_CAMEL_PATTERNS.some((re) => re.test(originalName))) return 'tests';

  // 3. Documentation.
  if (dirs.some((d) => DOC_DIRS.has(d))) return 'documentation';
  if (DOC_EXTENSIONS.has(input.extension)) return 'documentation';
  if (DOC_NAME_PREFIXES.some((p) => name.startsWith(p))) return 'documentation';

  // 4. Configuration (and the data exception).
  if (CONFIG_NAMES.has(name)) return 'configuration';
  if (CONFIG_NAME_PATTERNS.some((re) => re.test(name))) return 'configuration';
  if (dirs.some((d) => CONFIG_DIRS.has(d))) return 'configuration';
  if (CONFIG_DEFAULT_EXTENSIONS.has(input.extension)) {
    return dirs.some((d) => DATA_DIRS.has(d)) ? 'other' : 'configuration';
  }

  // 5. Sources.
  if (isSourceLanguage && input.kind !== 'binary') return 'sources';

  // 6-7. Other text files, then binaries and unclassifiable files.
  if (input.kind === 'text') return 'other';
  return 'unknown';
}
