// Versioned default exclusion list (§4.1.1). Published in the README and in
// the report metadata (`scan.defaultExcludes`).

/** Directory names excluded at any depth, exact match. */
export const EXCLUDED_DIR_NAMES: readonly string[] = [
  // VCS
  '.git',
  '.hg',
  '.svn',
  // JavaScript
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.nyc_output',
  'storybook-static',
  // Python
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  // JVM
  '.gradle',
  // PHP / Ruby
  'vendor',
  '.bundle',
  // IaC
  '.terraform',
];

/** Directory name suffixes excluded at any depth. */
export const EXCLUDED_DIR_SUFFIXES: readonly string[] = ['.egg-info'];

/** File names excluded at any depth. */
export const EXCLUDED_FILE_NAMES: readonly string[] = ['.DS_Store', 'Thumbs.db'];

/** Directories excluded only when their parent holds a project file of the ecosystem. */
export const CONDITIONAL_DIR_EXCLUDES: readonly { names: readonly string[]; markers: readonly RegExp[]; label: string }[] = [
  {
    names: ['bin', 'obj'],
    markers: [/\.csproj$/i, /\.fsproj$/i, /\.vbproj$/i, /\.sln$/i],
    label: '*.csproj, *.fsproj, *.vbproj or *.sln',
  },
  {
    names: ['target'],
    markers: [/^cargo\.toml$/i, /^pom\.xml$/i, /^build\.gradle$/i, /^build\.gradle\.kts$/i],
    label: 'Cargo.toml, pom.xml, build.gradle or build.gradle.kts',
  },
];

const dirNames = new Set(EXCLUDED_DIR_NAMES);
const fileNames = new Set(EXCLUDED_FILE_NAMES);

/** Human-readable list for the report metadata. */
export function describeDefaultExcludes(): string[] {
  return [
    ...EXCLUDED_DIR_NAMES.map((n) => `${n}/`),
    ...EXCLUDED_DIR_SUFFIXES.map((s) => `*${s}/`),
    ...CONDITIONAL_DIR_EXCLUDES.flatMap((c) => c.names.map((n) => `${n}/ (next to ${c.label})`)),
    ...EXCLUDED_FILE_NAMES,
  ];
}

export function isDefaultExcludedDir(name: string, siblingNames: readonly string[]): boolean {
  if (dirNames.has(name)) return true;
  if (EXCLUDED_DIR_SUFFIXES.some((s) => name.endsWith(s))) return true;
  for (const rule of CONDITIONAL_DIR_EXCLUDES) {
    if (rule.names.includes(name) && siblingNames.some((s) => rule.markers.some((re) => re.test(s)))) {
      return true;
    }
  }
  return false;
}

export function isDefaultExcludedFile(name: string): boolean {
  return fileNames.has(name);
}
