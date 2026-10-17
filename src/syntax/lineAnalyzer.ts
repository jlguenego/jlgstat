import type { StringDelimiter, Syntax } from './languages.js';

/**
 * Streaming line analyzer: splits decoded text into physical lines (LF, CRLF
 * and CR are line terminators), and classifies each line as blank, comment
 * or code with a small string/comment state machine (§5.6).
 *
 * The machine works on index ranges of the decoded chunk (no per-line
 * substring) and jumps between "interesting" characters with indexOf/regex
 * searches. Memory stays bounded: a very long line is processed in slices.
 */

/** Longest delimiter lookahead needed by the state machine. */
const LOOKAHEAD = 8;
/** A pending (unterminated) line longer than this is processed in slices. */
const MAX_PENDING = 1 << 20;

const MODE_CODE = 0;
const MODE_STRING = 1;
const MODE_BLOCK = 2;
const MODE_LINE_COMMENT = 3;
const MODE_LINE_BLOCK = 4;

type TokenKind = 'block' | 'line' | 'string';
interface Token {
  text: string;
  kind: TokenKind;
  close?: string;
  str?: StringDelimiter;
}

/** JavaScript `\s` class, tested on a UTF-16 code unit. */
function isJsWhitespace(c: number): boolean {
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    (c >= 0xa0 &&
      (c === 0xa0 ||
        c === 0x1680 ||
        (c >= 0x2000 && c <= 0x200a) ||
        c === 0x2028 ||
        c === 0x2029 ||
        c === 0x202f ||
        c === 0x205f ||
        c === 0x3000 ||
        c === 0xfeff))
  );
}

/** Whitespace for 8-bit fallback files: space, tab, FF and VT only. */
function isAsciiBlank(c: number): boolean {
  return c === 32 || c === 9 || c === 12 || c === 11;
}

const LINE_BREAK = /[\r\n]/g;

const escapeClass = (ch: string): string => ch.replace(/[\\\]^-]/g, '\\$&');

export interface LineCounts {
  physicalLines: number;
  nonEmptyLines: number;
  blankLines: number;
  /** null when the format is not in the syntax table. */
  commentLines: number | null;
  codeLines: number | null;
}

export class LineAnalyzer {
  private readonly syntax: Syntax | null;
  private readonly tokens: Token[];
  /** Matches the first character of any token; null when there is none. */
  private readonly tokenStart: RegExp | null;
  private readonly isWs: (c: number) => boolean;

  // Splitter state.
  private pending = '';
  private skipLF = false;
  private lineStarted = false;

  // State machine (persists across lines).
  private mode = MODE_CODE;
  private str: StringDelimiter | null = null;
  private strEscape = -1;
  private strAsComment = false;
  private blockOpen = '';
  private blockClose = '';
  private depth = 0;
  private lineBlockEndsAfterLine = false;

  // Per-line flags.
  private atLineStart = true;
  private hasCode = false;
  private hasComment = false;
  private hasNonBlank = false;
  private escapedEol = false;

  // Next-occurrence cache. Within one text, positions only move forward, so
  // a cached index >= the search start is still the next occurrence.
  private cacheText: string | null = null;
  private readonly cache = new Map<string, number>();

  // Counters.
  private code = 0;
  private comment = 0;
  private blank = 0;

  constructor(syntax: Syntax | null, eightBit = false) {
    this.syntax = syntax;
    this.isWs = eightBit ? isAsciiBlank : isJsWhitespace;
    const tokens: Token[] = [];
    if (syntax) {
      for (const [open, close] of syntax.block ?? []) tokens.push({ text: open, kind: 'block', close });
      for (const marker of syntax.line ?? []) tokens.push({ text: marker, kind: 'line' });
      for (const s of syntax.strings ?? []) tokens.push({ text: s.open, kind: 'string', str: s });
    }
    // Longest first, so that `--[[` wins over `--` and `"""` over `"`.
    // Stable sort keeps declaration order (blocks, lines, strings) on ties.
    tokens.sort((a, b) => b.text.length - a.text.length);
    this.tokens = tokens;
    const firsts = [...new Set(tokens.map((t) => t.text[0]!))];
    this.tokenStart = firsts.length > 0 ? new RegExp(`[${firsts.map(escapeClass).join('')}]`, 'g') : null;
  }

  /** Feeds a chunk of decoded text. */
  write(chunk: string): void {
    const n = chunk.length;
    if (n === 0) return;
    let start = 0;
    if (this.skipLF) {
      this.skipLF = false;
      if (chunk.charCodeAt(0) === 10) start = 1;
    }
    LINE_BREAK.lastIndex = start;
    let m: RegExpExecArray | null;
    while ((m = LINE_BREAK.exec(chunk)) !== null) {
      let idx = m.index;
      if (this.pending.length > 0) {
        const line = this.pending + chunk.slice(start, idx);
        this.pending = '';
        this.process(line, 0, line.length, true);
      } else {
        this.process(chunk, start, idx, true);
      }
      this.endLine();
      if (chunk.charCodeAt(idx) === 13) {
        if (idx + 1 < n) {
          if (chunk.charCodeAt(idx + 1) === 10) idx++;
        } else {
          this.skipLF = true;
        }
      }
      start = idx + 1;
      LINE_BREAK.lastIndex = start;
    }
    if (start < n) {
      this.pending += start === 0 ? chunk : chunk.slice(start);
      this.lineStarted = true;
      if (this.pending.length > MAX_PENDING) {
        const consumed = this.process(this.pending, 0, this.pending.length, false);
        this.pending = this.pending.slice(consumed);
      }
    }
  }

  /** Signals end of input and returns the counts. */
  end(): LineCounts {
    if (this.lineStarted || this.pending.length > 0) {
      const line = this.pending;
      this.pending = '';
      this.process(line, 0, line.length, true);
      this.endLine();
    }
    const physical = this.code + this.comment + this.blank;
    const known = this.syntax !== null;
    return {
      physicalLines: physical,
      nonEmptyLines: physical - this.blank,
      blankLines: this.blank,
      commentLines: known ? this.comment : null,
      codeLines: known ? this.code : null,
    };
  }

  /** Next index of `needle` in `text` from `from`, or -1. */
  private find(text: string, needle: string, from: number): number {
    if (text !== this.cacheText) {
      this.cacheText = text;
      this.cache.clear();
    }
    const cached = this.cache.get(needle);
    if (cached !== undefined && (cached === -1 || cached >= from)) return cached;
    let idx: number;
    if (needle === '') {
      const re = this.tokenStart!;
      re.lastIndex = from;
      idx = re.exec(text)?.index ?? -1;
    } else {
      idx = text.indexOf(needle, from);
    }
    this.cache.set(needle, idx);
    return idx;
  }

  /** True if text[from, to) holds a non-whitespace character. */
  private anyNonWs(text: string, from: number, to: number): boolean {
    for (let i = from; i < to; i++) if (!this.isWs(text.charCodeAt(i))) return true;
    return false;
  }

  /**
   * Runs the state machine over text[start, end). When `final` is false
   * (slice of a very long line), stops early enough to keep the delimiter
   * lookahead intact and returns the index reached.
   */
  private process(text: string, start: number, end: number, final: boolean): number {
    if (!this.hasNonBlank && this.anyNonWs(text, start, end)) this.hasNonBlank = true;
    if (this.syntax === null) return end;

    let i = start;
    if (this.atLineStart) {
      this.atLineStart = false;
      i = this.lineStartHook(text, start, end);
    }
    if (this.tokenStart === null && this.mode === MODE_CODE) {
      // Format without comments: any non-blank line is code.
      if (this.hasNonBlank) this.hasCode = true;
      return end;
    }
    const limit = final ? end : Math.max(start, end - LOOKAHEAD);

    while (i < limit) {
      switch (this.mode) {
        case MODE_CODE: {
          // The empty needle stands for "first character of any token".
          const found = this.find(text, '', i);
          const idx = found === -1 || found >= limit ? limit : found;
          if (!this.hasCode && idx > i && this.anyNonWs(text, i, idx)) this.hasCode = true;
          if (idx >= limit) return limit;
          const tok = this.matchToken(text, idx);
          if (tok) {
            i = idx + tok.text.length;
            this.openToken(tok);
          } else {
            this.hasCode = true;
            i = idx + 1;
          }
          break;
        }
        case MODE_STRING: {
          const s = this.str!;
          let close = this.find(text, s.close, i);
          if (close === -1 || close >= limit) close = limit;
          let esc = this.strEscape === -1 ? -1 : this.find(text, s.escape!, i);
          if (esc === -1 || esc >= limit) esc = limit;
          const idx = Math.min(close, esc);
          if (idx > i) this.markString(text, i, idx);
          if (idx >= limit) return limit;
          if (idx === esc && esc < close) {
            this.markString(text, idx, idx + 1);
            if (idx + 1 >= end && final) this.escapedEol = true;
            i = idx + 2;
          } else {
            this.markString(text, idx, idx + s.close.length);
            i = idx + s.close.length;
            this.mode = MODE_CODE;
            this.str = null;
          }
          break;
        }
        case MODE_BLOCK: {
          let close = this.find(text, this.blockClose, i);
          if (close === -1 || close >= limit) close = limit;
          let open = limit;
          if (this.syntax.nested) {
            open = this.find(text, this.blockOpen, i);
            if (open === -1 || open >= limit) open = limit;
          }
          const idx = Math.min(close, open);
          if (!this.hasComment && idx > i && this.anyNonWs(text, i, idx)) this.hasComment = true;
          if (idx >= limit) return limit;
          this.hasComment = true;
          if (idx === open && open < close) {
            this.depth++;
            i = idx + this.blockOpen.length;
          } else {
            i = idx + this.blockClose.length;
            this.depth--;
            if (this.depth === 0) this.mode = MODE_CODE;
          }
          break;
        }
        default:
          // Line comment or line block: the rest of the line is a comment.
          return end;
      }
    }
    return Math.min(i, end);
  }

  /** Handles constructs that only exist at column 0. Returns the start index. */
  private lineStartHook(text: string, start: number, end: number): number {
    const syn = this.syntax!;
    if (syn.lineBlock) {
      const { begin, end: endWord } = syn.lineBlock;
      if (this.mode === MODE_LINE_BLOCK) {
        this.hasComment = true;
        if (startsWithWord(text, start, end, endWord)) this.lineBlockEndsAfterLine = true;
        return end;
      }
      if (this.mode === MODE_CODE && startsWithWord(text, start, end, begin)) {
        this.mode = MODE_LINE_BLOCK;
        this.hasComment = true;
        return end;
      }
    }
    if (syn.lineStart && this.mode === MODE_CODE && syn.lineStart.test(text.slice(start, Math.min(end, start + 256)))) {
      this.mode = MODE_LINE_COMMENT;
      this.hasComment = true;
      return end;
    }
    return start;
  }

  private matchToken(text: string, i: number): Token | null {
    for (const tok of this.tokens) if (text.startsWith(tok.text, i)) return tok;
    return null;
  }

  private openToken(tok: Token): void {
    if (tok.kind === 'line') {
      this.mode = MODE_LINE_COMMENT;
      this.hasComment = true;
    } else if (tok.kind === 'block') {
      this.mode = MODE_BLOCK;
      this.blockOpen = tok.text;
      this.blockClose = tok.close!;
      this.depth = 1;
      this.hasComment = true;
    } else {
      this.mode = MODE_STRING;
      this.str = tok.str!;
      this.strEscape = this.str.escape === undefined ? -1 : this.str.escape.charCodeAt(0);
      // Python docstring: a triple-quoted string that starts the statement.
      this.strAsComment =
        this.syntax!.docstrings === true && tok.text.length === 3 && !this.hasCode && !this.hasComment;
      if (this.strAsComment) this.hasComment = true;
      else this.hasCode = true;
    }
  }

  /** Marks string content text[from, to) as code (or comment for docstrings). */
  private markString(text: string, from: number, to: number): void {
    if (this.strAsComment) {
      if (!this.hasComment && this.anyNonWs(text, from, to)) this.hasComment = true;
    } else if (!this.hasCode && this.anyNonWs(text, from, to)) {
      this.hasCode = true;
    }
  }

  private endLine(): void {
    if (!this.hasNonBlank) this.blank++;
    else if (this.hasCode) this.code++;
    else if (this.hasComment) this.comment++;
    else this.code++;

    if (this.mode === MODE_LINE_COMMENT) this.mode = MODE_CODE;
    else if (this.mode === MODE_STRING && !this.str!.multiline && !this.escapedEol) {
      // Unterminated single-line string: reset.
      this.mode = MODE_CODE;
      this.str = null;
    } else if (this.mode === MODE_LINE_BLOCK && this.lineBlockEndsAfterLine) {
      this.mode = MODE_CODE;
      this.lineBlockEndsAfterLine = false;
    }
    this.lineStarted = false;
    this.atLineStart = true;
    this.hasCode = false;
    this.hasComment = false;
    this.hasNonBlank = false;
    this.escapedEol = false;
  }
}

function startsWithWord(text: string, start: number, end: number, word: string): boolean {
  if (!text.startsWith(word, start)) return false;
  const after = start + word.length;
  if (after > end) return false;
  if (after === end) return true;
  const next = text.charCodeAt(after);
  return next === 32 || next === 9 || next === 12 || next === 11;
}

/** Convenience helper for tests: analyzes a complete string. */
export function analyzeText(text: string, syntax: Syntax | null, eightBit = false): LineCounts {
  const a = new LineAnalyzer(syntax, eightBit);
  a.write(text);
  return a.end();
}
