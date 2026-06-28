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
let wordReplacementMapCache = null;

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
    configCache = { enableTransliteration: true, debug: false };
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

async function loadNodeWordReplacementMap() {
  if (wordReplacementMapCache !== null) {
    return wordReplacementMapCache;
  }

  const raw = await readFile(resolveDataPath('non-vietnamese-words.csv'), 'utf8');
  wordReplacementMapCache = buildSortedReplacementMap(raw);
  return wordReplacementMapCache;
}

const nodeTextCleaner = createTextCleaner({
  loadAcronymMap: loadNodeAcronymMap,
  loadConfig: loadNodeConfig,
  loadWordReplacementMap: loadNodeWordReplacementMap,
});

export { loadNodeAcronymMap, loadNodeConfig, loadNodeWordReplacementMap, nodeTextCleaner, projectRoot, resolveProjectPath };
