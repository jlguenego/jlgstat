// Locale-independent number formatting (§6.1): `1,234,567`, sizes in base
// 1000 (kB, MB, GB like npm), percentages with one decimal.

export function formatInt(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.round(Math.abs(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return sign + out;
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(n: number): string {
  const sign = n < 0 ? '-' : '';
  let value = Math.abs(n);
  if (value < 1000) return `${sign}${value} B`;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  // Avoid "1000.0 kB" after rounding.
  if (Number(value.toFixed(1)) >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${sign}${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Formats a ratio (0.1234 → "12.3%"). */
export function formatPct(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return 'n/a';
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatSignedInt(n: number | null): string {
  if (n === null) return 'n/a';
  return n > 0 ? `+${formatInt(n)}` : formatInt(n);
}

export function formatSignedPct(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return 'n/a';
  const s = `${(ratio * 100).toFixed(1)}%`;
  return ratio > 0 ? `+${s}` : s;
}

export function formatSignedBytes(n: number | null): string {
  if (n === null) return 'n/a';
  return n > 0 ? `+${formatBytes(n)}` : formatBytes(n);
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${formatInt(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Shortens a path from the left to fit `width` characters. */
export function truncatePath(p: string, width: number): string {
  if (p.length <= width) return p;
  if (width <= 1) return '…';
  return `…${p.slice(p.length - width + 1)}`;
}
