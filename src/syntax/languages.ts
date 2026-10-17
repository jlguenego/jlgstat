// Versioned language table (§5.6.1). Organized by syntax family: one rule per
// family, then per-language overrides. Adding a language = adding an entry.

export interface StringDelimiter {
  open: string;
  close: string;
  /** Escape character inside the string, if any. */
  escape?: string;
  /** Whether the string may span several lines. */
  multiline?: boolean;
}

export interface Syntax {
  /** Line comment markers. */
  line?: readonly string[];
  /** Block comment pairs. */
  block?: readonly (readonly [string, string])[];
  /** Block comments nest (Rust, Haskell, Swift). */
  nested?: boolean;
  strings?: readonly StringDelimiter[];
  /** A `"""`/`'''` string starting a statement is a comment (Python). */
  docstrings?: boolean;
  /** Block comment delimited by whole lines starting at column 0 (Ruby `=begin`/`=end`). */
  lineBlock?: { begin: string; end: string };
  /** Pattern matched at line start that makes the whole line a comment (Batch). */
  lineStart?: RegExp;
}

export interface Language {
  name: string;
  extensions: readonly string[];
  /** Exact file names (lowercase) recognized regardless of extension. */
  filenames?: readonly string[];
  /** File name prefixes (lowercase), e.g. `dockerfile.` for `Dockerfile.dev`. */
  filenamePrefixes?: readonly string[];
  syntax: Syntax;
  /**
   * Whether files of this language may be classified as `sources` (§5.5).
   * False for comment-less data formats (JSON, Markdown, CSV, plain text).
   */
  source: boolean;
}

const DQ: StringDelimiter = { open: '"', close: '"', escape: '\\' };
const SQ: StringDelimiter = { open: "'", close: "'", escape: '\\' };
const BACKTICK: StringDelimiter = { open: '`', close: '`', escape: '\\', multiline: true };
const TRIPLE_DQ: StringDelimiter = { open: '"""', close: '"""', escape: '\\', multiline: true };
const TRIPLE_SQ: StringDelimiter = { open: "'''", close: "'''", escape: '\\', multiline: true };

// --- Families -------------------------------------------------------------

const C_FAMILY: Syntax = { line: ['//'], block: [['/*', '*/']], strings: [DQ, SQ] };
const HASH_FAMILY: Syntax = { line: ['#'], strings: [DQ, SQ] };
const MARKUP_FAMILY: Syntax = { block: [['<!--', '-->']] };
const NO_COMMENTS: Syntax = {};

const c = (overrides: Partial<Syntax> = {}): Syntax => ({ ...C_FAMILY, ...overrides });
const hash = (overrides: Partial<Syntax> = {}): Syntax => ({ ...HASH_FAMILY, ...overrides });

export const LANGUAGES: readonly Language[] = [
  // C style
  { name: 'JavaScript', extensions: ['.js', '.mjs', '.cjs'], syntax: c({ strings: [DQ, SQ, BACKTICK] }), source: true },
  { name: 'JSX', extensions: ['.jsx'], syntax: c({ strings: [DQ, SQ, BACKTICK] }), source: true },
  { name: 'TypeScript', extensions: ['.ts', '.mts', '.cts'], syntax: c({ strings: [DQ, SQ, BACKTICK] }), source: true },
  { name: 'TSX', extensions: ['.tsx'], syntax: c({ strings: [DQ, SQ, BACKTICK] }), source: true },
  { name: 'Java', extensions: ['.java'], syntax: c({ strings: [TRIPLE_DQ, DQ, SQ] }), source: true },
  { name: 'C', extensions: ['.c', '.h'], syntax: c(), source: true },
  { name: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.ipp'], syntax: c(), source: true },
  { name: 'C#', extensions: ['.cs', '.csx'], syntax: c(), source: true },
  { name: 'Objective-C', extensions: ['.m', '.mm'], syntax: c(), source: true },
  {
    name: 'Go',
    extensions: ['.go'],
    syntax: c({ strings: [DQ, SQ, { open: '`', close: '`', multiline: true }] }),
    source: true,
  },
  // `'` is not a string delimiter in Rust: it also introduces lifetimes.
  { name: 'Rust', extensions: ['.rs'], syntax: c({ nested: true, strings: [DQ] }), source: true },
  { name: 'Kotlin', extensions: ['.kt', '.kts'], syntax: c({ strings: [TRIPLE_DQ, DQ, SQ] }), source: true },
  { name: 'Swift', extensions: ['.swift'], syntax: c({ nested: true, strings: [TRIPLE_DQ, DQ] }), source: true },
  { name: 'Scala', extensions: ['.scala', '.sc'], syntax: c({ strings: [TRIPLE_DQ, DQ, SQ] }), source: true },
  { name: 'Dart', extensions: ['.dart'], syntax: c({ strings: [TRIPLE_DQ, TRIPLE_SQ, DQ, SQ] }), source: true },
  {
    name: 'Groovy',
    extensions: ['.groovy', '.gradle', '.gvy'],
    filenames: ['jenkinsfile'],
    syntax: c({ strings: [TRIPLE_DQ, TRIPLE_SQ, DQ, SQ] }),
    source: true,
  },
  { name: 'CSS', extensions: ['.css'], syntax: { block: [['/*', '*/']], strings: [DQ, SQ] }, source: true },
  { name: 'SCSS', extensions: ['.scss'], syntax: c(), source: true },
  { name: 'Less', extensions: ['.less'], syntax: c(), source: true },
  { name: 'JSON with Comments', extensions: ['.jsonc', '.json5'], syntax: c(), source: false },

  // Hash style
  {
    name: 'Python',
    extensions: ['.py', '.pyw', '.pyi'],
    syntax: hash({ strings: [TRIPLE_DQ, TRIPLE_SQ, DQ, SQ], docstrings: true }),
    source: true,
  },
  {
    name: 'Ruby',
    extensions: ['.rb', '.rake', '.gemspec'],
    filenames: ['gemfile', 'rakefile'],
    syntax: hash({ lineBlock: { begin: '=begin', end: '=end' } }),
    source: true,
  },
  {
    name: 'Shell',
    extensions: ['.sh', '.bash', '.zsh', '.ksh', '.fish'],
    syntax: hash(),
    source: true,
  },
  { name: 'Perl', extensions: ['.pl', '.pm'], syntax: hash(), source: true },
  { name: 'R', extensions: ['.r'], syntax: hash(), source: true },
  { name: 'YAML', extensions: ['.yml', '.yaml'], syntax: hash(), source: true },
  { name: 'TOML', extensions: ['.toml'], syntax: hash({ strings: [TRIPLE_DQ, TRIPLE_SQ, DQ, SQ] }), source: true },
  {
    name: 'Dockerfile',
    extensions: ['.dockerfile'],
    filenames: ['dockerfile', 'containerfile'],
    filenamePrefixes: ['dockerfile.'],
    syntax: { line: ['#'] },
    source: true,
  },
  {
    name: 'Makefile',
    extensions: ['.mk', '.mak'],
    filenames: ['makefile', 'gnumakefile'],
    syntax: { line: ['#'] },
    source: true,
  },
  { name: 'Elixir', extensions: ['.ex', '.exs'], syntax: hash({ strings: [TRIPLE_DQ, DQ, SQ] }), source: true },

  // Specific
  { name: 'PHP', extensions: ['.php', '.phtml'], syntax: c({ line: ['//', '#'] }), source: true },
  {
    name: 'PowerShell',
    extensions: ['.ps1', '.psm1', '.psd1'],
    syntax: {
      line: ['#'],
      block: [['<#', '#>']],
      strings: [{ open: '"', close: '"', escape: '`' }, { open: "'", close: "'" }],
    },
    source: true,
  },
  {
    name: 'SQL',
    extensions: ['.sql'],
    syntax: { line: ['--'], block: [['/*', '*/']], strings: [{ open: "'", close: "'" }, { open: '"', close: '"' }] },
    source: true,
  },
  {
    name: 'Lua',
    extensions: ['.lua'],
    syntax: {
      line: ['--'],
      block: [['--[[', ']]']],
      strings: [DQ, SQ, { open: '[[', close: ']]', multiline: true }],
    },
    source: true,
  },
  {
    name: 'Haskell',
    extensions: ['.hs', '.lhs'],
    syntax: { line: ['--'], block: [['{-', '-}']], nested: true, strings: [DQ] },
    source: true,
  },
  { name: 'HTML', extensions: ['.html', '.htm', '.xhtml'], syntax: MARKUP_FAMILY, source: true },
  { name: 'XML', extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.plist'], syntax: MARKUP_FAMILY, source: true },
  { name: 'SVG', extensions: ['.svg'], syntax: MARKUP_FAMILY, source: true },
  { name: 'Vue', extensions: ['.vue'], syntax: MARKUP_FAMILY, source: true },
  { name: 'Svelte', extensions: ['.svelte'], syntax: MARKUP_FAMILY, source: true },
  {
    name: 'Batch',
    extensions: ['.bat', '.cmd'],
    syntax: { lineStart: /^\s*@?(?:rem(?:\s|$)|::)/i },
    source: true,
  },
  { name: 'INI', extensions: ['.ini'], syntax: { line: [';', '#'] }, source: true },

  // Formats without comments: comment lines are 0, blank lines computed.
  { name: 'JSON', extensions: ['.json'], syntax: NO_COMMENTS, source: false },
  { name: 'Markdown', extensions: ['.md', '.markdown', '.mdx'], syntax: NO_COMMENTS, source: false },
  { name: 'CSV', extensions: ['.csv', '.tsv'], syntax: NO_COMMENTS, source: false },
  { name: 'Text', extensions: ['.txt'], syntax: NO_COMMENTS, source: false },
];

const byExtension = new Map<string, Language>();
const byFilename = new Map<string, Language>();
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) {
    if (byExtension.has(ext)) throw new Error(`Duplicate extension in language table: ${ext}`);
    byExtension.set(ext, lang);
  }
  for (const name of lang.filenames ?? []) byFilename.set(name, lang);
}

/** Finds the language of a file from its base name and normalized extension. */
export function detectLanguage(baseName: string, extension: string): Language | null {
  const lower = baseName.toLowerCase();
  const named = byFilename.get(lower);
  if (named) return named;
  for (const lang of LANGUAGES) {
    for (const prefix of lang.filenamePrefixes ?? []) if (lower.startsWith(prefix)) return lang;
  }
  return byExtension.get(extension) ?? null;
}
