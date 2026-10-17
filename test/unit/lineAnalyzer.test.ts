import { describe, expect, test } from 'bun:test';
import { detectLanguage, type Syntax } from '../../src/syntax/languages.js';
import { analyzeText, LineAnalyzer, type LineCounts } from '../../src/syntax/lineAnalyzer.js';

const syntaxOf = (file: string): Syntax => {
  const ext = file.slice(file.lastIndexOf('.'));
  const lang = detectLanguage(file, file.includes('.') ? ext.toLowerCase() : '[no extension]');
  if (!lang) throw new Error(`no language for ${file}`);
  return lang.syntax;
};

const counts = (text: string, file: string): Pick<LineCounts, 'codeLines' | 'commentLines' | 'blankLines'> => {
  const r = analyzeText(text, syntaxOf(file));
  expect(r.codeLines! + r.commentLines! + r.blankLines).toBe(r.physicalLines);
  return { codeLines: r.codeLines, commentLines: r.commentLines, blankLines: r.blankLines };
};

describe('physical lines (§4.3)', () => {
  test.each([
    ['', 0],
    ['abc', 1],
    ['abc\n', 1],
    ['abc\n\n', 2],
    ['a\r\nb\r\n', 2],
    ['a\rb\rc', 3],
    ['a\r\n\r\nb', 3],
    ['\n', 1],
    ['\r\n', 1],
    ['\r', 1],
    ['a\n\rb', 3],
  ])('%j has %i lines', (text, expected) => {
    expect(analyzeText(text, null).physicalLines).toBe(expected);
  });

  test('CRLF split across chunks counts once', () => {
    const a = new LineAnalyzer(null);
    a.write('one\r');
    a.write('\ntwo\r');
    a.write('\n');
    expect(a.end().physicalLines).toBe(2);
  });

  test('chunk boundaries do not change counts', () => {
    const text = 'x = 1 // c\r\n/* a\r\n b */\r\n\r\n"s // not"\n';
    const whole = analyzeText(text, syntaxOf('a.js'));
    for (let size = 1; size <= 5; size++) {
      const a = new LineAnalyzer(syntaxOf('a.js'));
      for (let i = 0; i < text.length; i += size) a.write(text.slice(i, i + size));
      expect(a.end()).toEqual(whole);
    }
  });
});

describe('non-empty lines (§4.3)', () => {
  test('Unicode whitespace (NBSP, BOM, ideographic space) is blank', () => {
    const r = analyzeText(' 　\t \n﻿\nx\n', null);
    expect(r.physicalLines).toBe(3);
    expect(r.nonEmptyLines).toBe(1);
  });

  test('8-bit fallback: only space, tab, FF and VT are blank', () => {
    const r = analyzeText(' \n \t\f\v\nx', null, true);
    expect(r.nonEmptyLines).toBe(2);
    expect(r.blankLines).toBe(1);
  });

  test('unknown formats give null comment/code lines', () => {
    const r = analyzeText('a\n\nb\n', null);
    expect(r).toEqual({ physicalLines: 3, nonEmptyLines: 2, blankLines: 1, commentLines: null, codeLines: null });
  });
});

describe('comments (§5.6)', () => {
  test('C-style: line, block, mixed line counts as code', () => {
    const src = ['// header', 'const x = 1; // note', '/* block', '   still */', '', 'f(); /* inline */'].join('\n');
    expect(counts(src, 'a.ts')).toEqual({ codeLines: 2, commentLines: 3, blankLines: 1 });
  });

  test('comment markers inside strings are code', () => {
    const src = ['const url = "http://example.com";', "const s = '/* not a comment */';", 'const t = `// tpl', '// still in template`;'].join('\n');
    expect(counts(src, 'a.js')).toEqual({ codeLines: 4, commentLines: 0, blankLines: 0 });
  });

  test('escaped quotes do not end strings', () => {
    expect(counts('const s = "a \\" // b";\n// c', 'a.js')).toEqual({ codeLines: 1, commentLines: 1, blankLines: 0 });
  });

  test('code after a closing block comment is code', () => {
    expect(counts('/* a\n*/ x = 1;', 'a.c')).toEqual({ codeLines: 1, commentLines: 1, blankLines: 0 });
  });

  test('blank lines inside block comments are blank', () => {
    expect(counts('/*\n\n*/', 'a.c')).toEqual({ codeLines: 0, commentLines: 2, blankLines: 1 });
  });

  test('nested block comments in Rust', () => {
    expect(counts('/* a /* b */ still\n*/\nfn main() {}', 'a.rs')).toEqual({ codeLines: 1, commentLines: 2, blankLines: 0 });
  });

  test('block comments do not nest in C', () => {
    expect(counts('/* a /* b */ x();', 'a.c')).toEqual({ codeLines: 1, commentLines: 0, blankLines: 0 });
  });

  test('Haskell nested comments and line comments', () => {
    expect(counts('{- a {- b -} c -}\n-- d\nmain = print 1', 'a.hs')).toEqual({ codeLines: 1, commentLines: 2, blankLines: 0 });
  });

  test('CSS has block comments only', () => {
    expect(counts('/* a */\na { b: c; } // not a comment\n', 'a.css')).toEqual({ codeLines: 1, commentLines: 1, blankLines: 0 });
  });

  test('Python docstrings are comments, assigned strings are code', () => {
    const src = ['"""Module', 'doc."""', 'def f():', '    """Doc."""', '    x = """not', '    doc"""', '    # c', '    return x'].join('\n');
    expect(counts(src, 'a.py')).toEqual({ codeLines: 4, commentLines: 4, blankLines: 0 });
  });

  test('Python # inside strings is code', () => {
    expect(counts('s = "# no"\n# yes', 'a.py')).toEqual({ codeLines: 1, commentLines: 1, blankLines: 0 });
  });

  test('Ruby =begin/=end', () => {
    expect(counts('=begin\nanything\n=end\nputs 1 # c', 'a.rb')).toEqual({ codeLines: 1, commentLines: 3, blankLines: 0 });
  });

  test('Lua long comments win over line comments', () => {
    expect(counts('--[[ a\nb ]]\n-- c\nprint(1)', 'a.lua')).toEqual({ codeLines: 1, commentLines: 3, blankLines: 0 });
  });

  test('PowerShell block comments', () => {
    expect(counts('<# a\nb #>\n# c\nWrite-Host 1', 'a.ps1')).toEqual({ codeLines: 1, commentLines: 3, blankLines: 0 });
  });

  test('SQL', () => {
    expect(counts("-- a\nSELECT '--x' FROM t; /* b */\n/* c */", 'a.sql')).toEqual({ codeLines: 1, commentLines: 2, blankLines: 0 });
  });

  test('Batch REM and ::', () => {
    expect(counts('@echo off\nREM a\n:: b\nrem\necho remark', 'a.bat')).toEqual({ codeLines: 2, commentLines: 3, blankLines: 0 });
  });

  test('HTML containers: only <!-- --> is a comment', () => {
    const src = ['<!-- a -->', '<script>', '// counted as code', '</script>', '<!--', 'b', '-->'].join('\n');
    expect(counts(src, 'a.vue')).toEqual({ codeLines: 3, commentLines: 4, blankLines: 0 });
  });

  test('formats without comments give 0 comment lines', () => {
    expect(counts('{\n\n  "a": "// b"\n}', 'a.json')).toEqual({ codeLines: 3, commentLines: 0, blankLines: 1 });
  });

  test('Dockerfile and Makefile by file name', () => {
    expect(counts('# c\nFROM node', 'Dockerfile')).toEqual({ codeLines: 1, commentLines: 1, blankLines: 0 });
    expect(counts('# c\nall:\n\techo', 'Makefile')).toEqual({ codeLines: 2, commentLines: 1, blankLines: 0 });
  });

  test('a very long line is processed in slices with exact results', () => {
    const long = 'x'.repeat(3_000_000);
    const text = `${long} // tail\n/* ${long} */\n${long}`;
    const r = analyzeText(text, syntaxOf('a.js'));
    expect(r).toEqual({ physicalLines: 3, nonEmptyLines: 3, blankLines: 0, commentLines: 1, codeLines: 2 });
  });
});
