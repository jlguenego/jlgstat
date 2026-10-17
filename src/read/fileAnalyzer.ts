import { open } from 'node:fs/promises';
import type { Encoding } from '../report/model.js';
import type { Syntax } from '../syntax/languages.js';
import { LineAnalyzer, type LineCounts } from '../syntax/lineAnalyzer.js';
import { SNIFF_BYTES, sniff } from './sniff.js';

/** Read block size for streamed counting (§4.4). */
const CHUNK_BYTES = 64 * 1024;

export interface FileAnalysis {
  /** Size in bytes, from the open handle. */
  bytes: number;
  binary: boolean;
  encoding: Encoding | null;
  counts: LineCounts | null;
  /** Decoded first bytes, for generated-file detection. null for binaries. */
  header: string | null;
}

interface ChunkDecoder {
  decode(chunk: Uint8Array, final: boolean): string;
}

function createDecoder(encoding: Encoding): ChunkDecoder {
  switch (encoding) {
    case 'utf-8':
    case 'utf-8-bom': {
      // Strips the BOM; invalid sequences become U+FFFD (deterministic).
      const d = new TextDecoder('utf-8');
      return { decode: (chunk, final) => d.decode(chunk, { stream: !final }) };
    }
    case 'utf-16le': {
      const d = new TextDecoder('utf-16le');
      return { decode: (chunk, final) => d.decode(chunk, { stream: !final }) };
    }
    case 'utf-16be': {
      // Byte-swap to UTF-16 LE so that no full-ICU build is required.
      const d = new TextDecoder('utf-16le');
      let carry: number | null = null;
      return {
        decode(chunk, final) {
          const bytes: Uint8Array =
            carry === null ? chunk : Buffer.concat([Uint8Array.of(carry), chunk]);
          carry = null;
          const even = bytes.length - (bytes.length % 2);
          if (even < bytes.length) carry = bytes[bytes.length - 1]!;
          const swapped = Buffer.allocUnsafe(even);
          for (let i = 0; i < even; i += 2) {
            swapped[i] = bytes[i + 1]!;
            swapped[i + 1] = bytes[i]!;
          }
          return d.decode(swapped, { stream: !final });
        },
      };
    }
    case 'unknown-8bit':
      // Byte-level: every byte maps to one character, line ends are unchanged.
      return { decode: (chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1') };
  }
}

/**
 * Detects binary vs text from the first bytes, then counts lines of text
 * files in streamed 64 kB blocks with constant memory. Binary files are
 * never read beyond the first sniffed bytes.
 */
export async function analyzeFile(absPath: string, syntax: Syntax | null): Promise<FileAnalysis> {
  const handle = await open(absPath, 'r');
  try {
    const { size: bytes } = await handle.stat();
    const head = Buffer.allocUnsafe(SNIFF_BYTES);
    let headLen = 0;
    while (headLen < SNIFF_BYTES) {
      const { bytesRead } = await handle.read(head, headLen, SNIFF_BYTES - headLen, headLen);
      if (bytesRead === 0) break;
      headLen += bytesRead;
    }
    const whole = headLen < SNIFF_BYTES;
    const { binary, encoding } = sniff(head, headLen, !whole);
    if (binary || encoding === null) return { bytes, binary: true, encoding: null, counts: null, header: null };

    const header = createDecoder(encoding).decode(head.subarray(0, headLen), whole);
    const analyzer = new LineAnalyzer(syntax, encoding === 'unknown-8bit');
    const decoder = createDecoder(encoding);

    if (whole) {
      analyzer.write(decoder.decode(head.subarray(0, headLen), true));
    } else {
      analyzer.write(decoder.decode(head.subarray(0, headLen), false));
      const buf = Buffer.allocUnsafe(CHUNK_BYTES);
      let position = headLen;
      for (;;) {
        const { bytesRead } = await handle.read(buf, 0, CHUNK_BYTES, position);
        if (bytesRead === 0) break;
        position += bytesRead;
        analyzer.write(decoder.decode(buf.subarray(0, bytesRead), false));
      }
      analyzer.write(decoder.decode(new Uint8Array(0), true));
    }
    return { bytes, binary: false, encoding, counts: analyzer.end(), header };
  } finally {
    await handle.close();
  }
}
