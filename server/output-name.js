import path from 'node:path';

export function sanitizeOutputBaseName(value, fallback) {
  const baseName = path.parse(String(value || '')).name.trim() || fallback;
  return baseName
    .replace(/^(?:chuong|chương)-(?=\d)/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[ .]+$/g, '')
    || fallback;
}
