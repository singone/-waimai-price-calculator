import * as XLSX from 'xlsx';

export function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  return file.arrayBuffer().then(buffer => XLSX.read(buffer, { type: 'array', cellDates: false }));
}
