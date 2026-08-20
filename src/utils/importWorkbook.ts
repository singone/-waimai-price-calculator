import * as XLSX from 'xlsx';
import { readWorkbook } from './workbook';

function arrayBufferToBinaryString(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return chunks.join('');
}

export type WorkbookHeaderScore = (workbook: XLSX.WorkBook) => number;

export async function readImportWorkbook(file: File, headerScore: WorkbookHeaderScore) {
  const isCsv = /\.csv|\.txt$/i.test(file.name);
  if (!isCsv) return readWorkbook(file);

  const buffer = await file.arrayBuffer();
  const candidates: XLSX.WorkBook[] = [];
  const addCandidate = (data: string, options: XLSX.ParsingOptions) => {
    try {
      candidates.push(XLSX.read(data, { ...options, cellDates: false, raw: true }));
    } catch {
      return;
    }
  };

  ['utf-8', 'gb18030', 'gbk'].forEach(encoding => {
    try {
      addCandidate(new TextDecoder(encoding, { fatal: true }).decode(buffer), { type: 'string' });
    } catch {
      return;
    }
  });
  addCandidate(arrayBufferToBinaryString(buffer), { type: 'binary', codepage: 936 });
  if (!candidates.length) addCandidate(new TextDecoder().decode(buffer), { type: 'string' });

  return candidates
    .map((workbook, index) => ({ workbook, index, score: headerScore(workbook) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.workbook || XLSX.utils.book_new();
}
