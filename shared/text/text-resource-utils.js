export function parseCsvRecords(csvText) {
  return String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildSortedReplacementMap(csvText, { lowercaseKeys = true } = {}) {
  const lines = parseCsvRecords(csvText);
  const replacementMap = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^([^,]+),(.+)$/);
    if (!match) {
      continue;
    }

    const rawKey = match[1].trim();
    const value = match[2].trim();
    const key = lowercaseKeys ? rawKey.toLowerCase() : rawKey;

    if (key && value) {
      replacementMap.set(key, value);
    }
  }

  return new Map(
    Array.from(replacementMap.entries()).sort((a, b) => b[0].length - a[0].length),
  );
}
