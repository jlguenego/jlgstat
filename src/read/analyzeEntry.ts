import { classify } from '../classify/category.js';
import { extensionOf } from '../classify/extension.js';
import type { Category, Encoding } from '../report/model.js';
import { detectLanguage } from '../syntax/languages.js';
import type { LineCounts } from '../syntax/lineAnalyzer.js';
import { analyzeFile } from './fileAnalyzer.js';

/** Content-derived facts about one file; serializable (sent by workers). */
export interface EntryAnalysis {
  bytes: number;
  binary: boolean;
  encoding: Encoding | null;
  counts: LineCounts | null;
  category: Category;
}

/** Reads, counts and classifies one file. Throws fs errors (with `code`). */
export async function analyzeEntry(abs: string, rel: string, name: string): Promise<EntryAnalysis> {
  const extension = extensionOf(name);
  const language = detectLanguage(name, extension);
  const a = await analyzeFile(abs, language?.syntax ?? null);
  return {
    bytes: a.bytes,
    binary: a.binary,
    encoding: a.encoding,
    counts: a.counts,
    category: classify({ path: rel, extension, kind: a.binary ? 'binary' : 'text', language, header: a.header }),
  };
}
