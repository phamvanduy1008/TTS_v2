import { createTextCleaner } from '../../shared/text/text-cleaner-core.js';
import { buildSortedReplacementMap } from '../../shared/text/text-resource-utils.js';

let acronymMapCache = null;
let configCache = null;

async function loadAcronymMap() {
  if (acronymMapCache !== null) {
    return acronymMapCache;
  }

  try {
    const response = await fetch('/data/acronyms.csv');
    if (!response.ok) {
      console.warn('Failed to load acronym CSV:', response.statusText);
      acronymMapCache = new Map();
      return acronymMapCache;
    }

    acronymMapCache = buildSortedReplacementMap(await response.text());
    return acronymMapCache;
  } catch (error) {
    console.error('Error loading acronym CSV:', error);
    acronymMapCache = new Map();
    return acronymMapCache;
  }
}

export async function loadConfig() {
  if (configCache !== null) {
    return configCache;
  }

  try {
    const response = await fetch('/data/config.json');
    if (!response.ok) {
      console.warn('Failed to load config JSON:', response.statusText);
      configCache = { enableTransliteration: false, debug: false };
      return configCache;
    }

    configCache = await response.json();
    return configCache;
  } catch (error) {
    console.warn('Failed to load config, using defaults:', error);
    configCache = { enableTransliteration: false, debug: false };
    return configCache;
  }
}

const browserTextCleaner = createTextCleaner({
  loadAcronymMap,
  loadConfig,
});

export const {
  chunkText,
  cleanTextForTTS,
  convertAcronyms,
  debugLog,
  isDebugEnabled,
  processTextForTTS,
} = browserTextCleaner;
