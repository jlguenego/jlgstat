import { isUtf8 } from 'node:buffer';
import type { Encoding } from '../report/model.js';

/** Number of leading bytes inspected to decide binary vs text and the encoding. */
export const SNIFF_BYTES = 8192;

export interface SniffResult {
  binary: boolean;
  encoding: Encoding | null;
}

// Magic numbers of common binary formats (checked at offset 0).
const SIGNATURES: readonly number[][] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  [0x50, 0x4b, 0x03, 0x04], // ZIP, JAR, DOCX, ...
  [0x50, 0x4b, 0x05, 0x06], // empty ZIP
  [0x1f, 0x8b], // GZIP
  [0x42, 0x5a, 0x68, 0x39], // BZIP2 (BZh9)
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // XZ
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], // RAR
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xca, 0xfe, 0xba, 0xbe], // Java class / Mach-O fat
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32
  [0x00, 0x61, 0x73, 0x6d], // WebAssembly
  [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66], // SQLite
  [0x49, 0x44, 0x33], // MP3 (ID3)
  [0x4f, 0x67, 0x67, 0x53], // OGG
  [0x77, 0x4f, 0x46, 0x46], // WOFF
  [0x77, 0x4f, 0x46, 0x32], // WOFF2
  [0x00, 0x01, 0x00, 0x00, 0x00], // TrueType
  [0x4f, 0x54, 0x54, 0x4f], // OpenType
  [0x00, 0x00, 0x01, 0x00], // ICO
  [0x1a, 0x45, 0xdf, 0xa3], // Matroska / WebM
];

function startsWith(buf: Uint8Array, n: number, sig: readonly number[]): boolean {
  if (n < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

/** Length of an incomplete UTF-8 sequence at the end of the buffer (0-3). */
function incompleteUtf8Tail(buf: Uint8Array, n: number): number {
  for (let back = 1; back <= Math.min(3, n); back++) {
    const b = buf[n - back]!;
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    if (b >= 0xc0) {
      const needed = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      return needed > back ? back : 0;
    }
    return 0;
  }
  return 0;
}

/**
 * Classifies a file from its first bytes.
 * @param truncated true when the buffer does not hold the whole file.
 */
export function sniff(buf: Uint8Array, n: number, truncated: boolean): SniffResult {
  if (n === 0) return { binary: false, encoding: 'utf-8' };

  if (n >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { binary: false, encoding: 'utf-8-bom' };
  }
  if (n >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // FF FE 00 00 is UTF-32 LE, which we treat as binary.
    if (n >= 4 && buf[2] === 0 && buf[3] === 0) return { binary: true, encoding: null };
    return { binary: false, encoding: 'utf-16le' };
  }
  if (n >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { binary: false, encoding: 'utf-16be' };
  }

  for (const sig of SIGNATURES) {
    if (startsWith(buf, n, sig)) return { binary: true, encoding: null };
  }

  let suspicious = 0;
  let highBytes = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i]!;
    if (b === 0) return { binary: true, encoding: null };
    if (b < 0x20) {
      // Allowed controls: BS, TAB, LF, VT, FF, CR, ESC.
      if (b !== 8 && b !== 9 && b !== 10 && b !== 11 && b !== 12 && b !== 13 && b !== 27) suspicious++;
    } else if (b === 0x7f) {
      suspicious++;
    } else if (b >= 0x80) {
      highBytes++;
    }
  }
  if (suspicious / n > 0.1) return { binary: true, encoding: null };
  if (highBytes === 0) return { binary: false, encoding: 'utf-8' };

  const end = truncated ? n - incompleteUtf8Tail(buf, n) : n;
  const valid = isUtf8(buf.subarray(0, end));
  return { binary: false, encoding: valid ? 'utf-8' : 'unknown-8bit' };
}
