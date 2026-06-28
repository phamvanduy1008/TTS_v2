import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ensureRuntimeDirectories, uploadsRoot } from './runtime-paths.js';

function sanitizeFilename(filename) {
  const base = path.basename(String(filename || 'upload.txt'));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function saveUploadedFile(file) {
  await ensureRuntimeDirectories();

  const originalFilename = sanitizeFilename(file?.name || 'upload.txt');
  const ext = path.extname(originalFilename) || '.txt';
  const storedFilename = `${randomUUID()}${ext}`;
  const storedPath = path.join(uploadsRoot, storedFilename);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await writeFile(storedPath, buffer);

  return {
    originalFilename,
    size: buffer.byteLength,
    storedPath,
  };
}
