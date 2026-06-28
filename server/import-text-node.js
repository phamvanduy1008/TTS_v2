import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export async function importTextFromPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  const extension = path.extname(resolvedPath).toLowerCase();
  const fileBuffer = await readFile(resolvedPath);

  if (fileBuffer.byteLength > MAX_IMPORT_BYTES) {
    throw new Error('File vuot qua gioi han 100MB cho local document pipeline.');
  }

  if (extension === '.txt') {
    return normalizeImportedText(fileBuffer.toString('utf8'));
  }

  if (extension === '.docx') {
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return normalizeImportedText(result.value);
  }

  throw new Error('Local runner hien tai moi ho tro file .txt va .docx.');
}

function normalizeImportedText(value) {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    throw new Error('Khong doc duoc noi dung van ban tu file nay.');
  }

  return text;
}
