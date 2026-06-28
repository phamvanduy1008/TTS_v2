import { createTextCleaner } from '../../shared/text/text-cleaner-core.js';
import { buildSortedReplacementMap } from '../../shared/text/text-resource-utils.js';

let acronymMapCache = null;
let wordReplacementMapCache = null;
let configCache = null;

async function loadWordReplacementMap() {
  if (wordReplacementMapCache !== null) {
    return wordReplacementMapCache;
  }

  try {
    const response = await fetch('/data/non-vietnamese-words.csv');
    if (!response.ok) {
      console.warn('Failed to load word replacement CSV:', response.statusText);
      wordReplacementMapCache = new Map();
      return wordReplacementMapCache;
    }

    wordReplacementMapCache = buildSortedReplacementMap(await response.text());
    return wordReplacementMapCache;
  } catch (error) {
    console.error('Error loading word replacement CSV:', error);
    wordReplacementMapCache = new Map();
    return wordReplacementMapCache;
  }
}

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
      configCache = { enableTransliteration: true, debug: false };
      return configCache;
    }

    configCache = await response.json();
    return configCache;
  } catch (error) {
    console.warn('Failed to load config, using defaults:', error);
    configCache = { enableTransliteration: true, debug: false };
    return configCache;
  }
}

const browserTextCleaner = createTextCleaner({
  loadAcronymMap,
  loadConfig,
  loadWordReplacementMap,
});

export const {
  applyTransliteration,
  chunkText,
  cleanTextForTTS,
  convertAcronyms,
  debugLog,
  isDebugEnabled,
  processTextForTTS,
  replaceNonVietnameseWords,
} = browserTextCleaner;
