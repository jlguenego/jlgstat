export const NO_EXTENSION = '[no extension]';

/**
 * Normalized extension of a file name (§4.3): last suffix, lowercased.
 * Dotfiles without another dot (`.gitignore`) and names without a dot
 * (`Makefile`) have no extension; `.eslintrc.json` has `.json`.
 */
export function extensionOf(baseName: string): string {
  const idx = baseName.lastIndexOf('.');
  if (idx <= 0 || idx === baseName.length - 1) return NO_EXTENSION;
  return baseName.slice(idx).toLowerCase();
}
