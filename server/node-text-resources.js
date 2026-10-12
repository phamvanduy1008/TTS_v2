import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTextCleaner } from '../shared/text/text-cleaner-core.js';
import { buildSortedReplacementMap } from '../shared/text/text-resource-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let acronymMapCache = null;
let configCache = null;

function resolveProjectPath(...parts) {
  return path.join(projectRoot, ...parts);
}

function resolveDataPath(...parts) {
  return resolveProjectPath('public', 'data', ...parts);
}

async function loadNodeConfig() {
  if (configCache !== null) {
    return configCache;
  }

  try {
    const raw = await readFile(resolveDataPath('config.json'), 'utf8');
    configCache = JSON.parse(raw);
    configCache.debug = process.env.TTS_LOCAL_DEBUG === 'true';
    return configCache;
  } catch (error) {
    console.warn('Failed to load config, using defaults:', error);
    configCache = { enableTransliteration: false, debug: false };
    return configCache;
  }
}

async function loadNodeAcronymMap() {
  if (acronymMapCache !== null) {
    return acronymMapCache;
  }

  const raw = await readFile(resolveDataPath('acronyms.csv'), 'utf8');
  acronymMapCache = buildSortedReplacementMap(raw);
  return acronymMapCache;
}

const nodeTextCleaner = createTextCleaner({
  loadAcronymMap: loadNodeAcronymMap,
  loadConfig: loadNodeConfig,
});

export { loadNodeAcronymMap, loadNodeConfig, nodeTextCleaner, projectRoot, resolveProjectPath };
