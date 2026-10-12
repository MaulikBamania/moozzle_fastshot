import { AUTH } from '@/lib/phrases/auth';
import { BIOMETRIC } from '@/lib/phrases/biometric';
import { COMMON } from '@/lib/phrases/common';
import { DASHBOARD } from '@/lib/phrases/dashboard';
import { DEMOGRAPHICS } from '@/lib/phrases/demographics';
import { EXTRA } from '@/lib/phrases/extra';
import { RECORDS } from '@/lib/phrases/records';
import { WORKSPACE } from '@/lib/phrases/workspace';

/** [English, Hindi, Gujarati] */
export type Phrase = readonly [en: string, hi: string, gu: string];

/** Each phrase block is one entry per line: `English | Hindi | Gujarati`. */
function parse(block: string): Phrase[] {
  const rows: Phrase[] = [];
  for (const line of block.split('\n')) {
    const cells = line.split(' | ');
    if (cells.length !== 3) continue;
    const [en, hi, gu] = cells.map((cell) => cell.trim());
    if (en && hi && gu) rows.push([en, hi, gu]);
  }
  return rows;
}

export const PHRASES: readonly Phrase[] = [COMMON, DASHBOARD, BIOMETRIC, RECORDS, WORKSPACE, AUTH, EXTRA, DEMOGRAPHICS].flatMap(parse);
