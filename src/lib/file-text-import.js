const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const DEFAULT_PREVIEW_BYTES = 64 * 1024;

export async function importTextFromFile(file) {
  validateFile(file);

  const extension = getFileExtension(file.name);

  if (extension === 'txt') {
    return normalizeImportedText(await file.text());
  }

  if (extension === 'docx') {
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return normalizeImportedText(result.value);
  }

  if (extension === 'pdf') {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableWorker: true,
    }).promise;

    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (text) {
        pages.push(text);
      }
    }

    return normalizeImportedText(pages.join('\n\n'));
  }

  throw new Error('Chi ho tro file .txt, .docx va .pdf.');
}

export async function importTextPreviewFromFile(file, maxBytes = DEFAULT_PREVIEW_BYTES) {
  if (!file) {
    throw new Error('Khong tim thay file de nhap.');
  }

  const extension = getFileExtension(file.name);

  if (extension === 'txt') {
    const previewBlob = file.slice(0, Math.min(file.size, maxBytes));
    return normalizeImportedText(await previewBlob.text());
  }

  return importTextFromFile(file);
}

function validateFile(file) {
  if (!file) {
    throw new Error('Khong tim thay file de nhap.');
  }

  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('File vuot qua gioi han 10MB.');
  }
}

function getFileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
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
