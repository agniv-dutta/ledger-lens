import fs from 'node:fs';
import { parse } from 'csv-parse';

function isEmptyRecord(record) {
  return Object.values(record).every((value) => value == null || String(value).trim() === '');
}

function normalizeHeader(header) {
  return String(header ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
}

export async function* parseCsvFile(filePath) {
  const inputStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const parser = inputStream.pipe(
    parse({
      bom: true,
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      relax_column_count: true,
    })
  );

  try {
    for await (const record of parser) {
      if (isEmptyRecord(record)) {
        continue;
      }

      yield record;
    }
  } finally {
    inputStream.destroy();
  }
}
