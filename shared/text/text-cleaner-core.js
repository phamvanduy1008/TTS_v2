import { processVietnameseText } from '../../src/utils/vietnamese-processor.js';
import { transliterateWord } from '../../src/utils/transliterator.js';
import { isVietnameseWord } from '../../src/utils/vietnamese-detector.js';

const TRANSLITERATION_SKIP_WORDS = new Set(['mc']);
const CSV_REPLACEMENT_SKIP_WORDS = new Set(['dua', 'kia', 'muon', 'ria']);

export function createTextCleaner({ loadAcronymMap, loadConfig, loadWordReplacementMap }) {
  function isDebugEnabled(config) {
    return config && config.debug === true;
  }

  function debugLog(config, step, data) {
    if (isDebugEnabled(config)) {
      console.log(`[DEBUG] ${step}:`, data);
    }
  }

  function applyTransliteration(text, replacementMap, config = null) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    const wordBoundaryRegex = /(?:^|[^\w\u00C0-\u1EFF])([\w\u00C0-\u1EFF]+)(?=[^\w\u00C0-\u1EFF]|$)/g;
    let result = text;
    const processedWords = new Set();
    const transliteratedWords = [];
    let match;

    while ((match = wordBoundaryRegex.exec(text)) !== null) {
      const word = match[1];
      const wordLower = word.toLowerCase();

      if (processedWords.has(wordLower)) {
        continue;
      }
      processedWords.add(wordLower);

      if (replacementMap.has(wordLower)) {
        if (isDebugEnabled(config)) {
          debugLog(config, 'Transliteration', {
            word,
            action: 'SKIPPED (in CSV map)',
          });
        }
        continue;
      }

      const isVietnamese = isVietnameseWord(word) || isVietnameseWord(wordLower);
      if (isVietnamese) {
        if (isDebugEnabled(config)) {
          debugLog(config, 'Transliteration', {
            word,
            action: 'SKIPPED (Vietnamese)',
            hasDiacritics: /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(word),
          });
        }
        continue;
      }

      if (word.length === 1) {
        if (isDebugEnabled(config)) {
          debugLog(config, 'Transliteration', { word, action: 'SKIPPED (single character)' });
        }
        continue;
      }

      if (TRANSLITERATION_SKIP_WORDS.has(wordLower)) {
        continue;
      }

      const transliterated = transliterateWord(word);
      transliteratedWords.push({ word, transliterated });

      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const notWordChar = '[^\\w\\u00C0-\\u1EFF]';
      const regex = new RegExp(`(?:^|(${notWordChar}))(${escapedWord})(?=${notWordChar}|$)`, 'gi');

      result = result.replace(regex, (_fullMatch, boundary, wordPart) => {
        const replacement = wordPart && wordPart[0] === wordPart[0].toUpperCase()
          ? transliterated.charAt(0).toUpperCase() + transliterated.slice(1)
          : transliterated;
        return `${boundary || ''}${replacement}`;
      });
    }

    if (isDebugEnabled(config) && transliteratedWords.length > 0) {
      debugLog(config, 'Transliteration', {
        totalWords: transliteratedWords.length,
        words: transliteratedWords,
      });
    }

    return result;
  }

  async function convertAcronyms(text, acronymMap, config = null) {
    if (!text || typeof text !== 'string' || !acronymMap || acronymMap.size === 0) {
      return text;
    }

    let result = text;
    const convertedAcronyms = [];

    for (const [acronym, transliteration] of acronymMap) {
      const escapedAcronym = acronym.replace(/[+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedAcronym}\\b`, 'gi');
      const beforeReplace = result;
      result = result.replace(regex, transliteration);

      if (isDebugEnabled(config) && beforeReplace !== result) {
        convertedAcronyms.push({ acronym, transliteration });
      }
    }

    if (isDebugEnabled(config) && convertedAcronyms.length > 0) {
      debugLog(config, 'Acronym Conversion', {
        totalConversions: convertedAcronyms.length,
        acronyms: convertedAcronyms,
      });
    }

    return result;
  }

  async function replaceNonVietnameseWords(text, replacementMap, config = null) {
    if (!text || typeof text !== 'string' || !replacementMap || replacementMap.size === 0) {
      return text;
    }

    let result = text;
    const replacedWords = [];

    for (const [original, transliteration] of replacementMap) {
      if (CSV_REPLACEMENT_SKIP_WORDS.has(original)) {
        continue;
      }

      const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedOriginal}\\b`, 'gi');
      const beforeReplace = result;
      result = result.replace(regex, (match) => (
        match[0] === match[0].toUpperCase()
          ? transliteration.charAt(0).toUpperCase() + transliteration.slice(1)
          : transliteration
      ));

      if (isDebugEnabled(config) && beforeReplace !== result) {
        replacedWords.push({ original, transliteration });
      }
    }

    if (isDebugEnabled(config) && replacedWords.length > 0) {
      debugLog(config, 'CSV Word Replacement', {
        totalReplacements: replacedWords.length,
        words: replacedWords.slice(0, 20),
      });
    }

    return result;
  }

  function cleanTextForTTS(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F018}-\u{1F270}]|[\u{238C}-\u{2454}]|[\u{20D0}-\u{20FF}]|[\u{FE0F}]|[\u{200D}]/gu;

    return text
      .replace(emojiRegex, '')
      .replace(/[\\()Â¯]/g, '')
      .replace(/["""]/g, '')
      .replace(/\sâ€”/g, '.')
      .replace(/\b_\b/g, ' ')
      .replace(/(?<!\d)-(?!\d)/g, ' ')
      .replace(/[^\u0000-\u024F\u1E00-\u1EFF]/g, '')
      .trim();
  }

  async function processTextForTTS(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    const config = await loadConfig();

    if (isDebugEnabled(config)) {
      debugLog(config, 'Preprocessing Start', { originalText: text });
    }

    const cleanedText = cleanTextForTTS(text);
    if (isDebugEnabled(config)) {
      debugLog(config, 'Step 1: Text Cleaning', { before: text, after: cleanedText });
    }

    const vietnameseProcessedText = processVietnameseText(cleanedText, config);
    if (isDebugEnabled(config)) {
      debugLog(config, 'Step 2: Vietnamese Processing', {
        before: cleanedText,
        after: vietnameseProcessedText,
      });
    }

    const mappingInput = vietnameseProcessedText.toLowerCase();
    if (isDebugEnabled(config)) {
      debugLog(config, 'Step 2.5: Lowercase Normalization', {
        before: vietnameseProcessedText,
        after: mappingInput,
      });
    }

    const acronymMap = await loadAcronymMap();
    if (isDebugEnabled(config)) {
      debugLog(config, 'Acronym Map Loaded', { totalEntries: acronymMap.size });
    }
    const textAfterAcronymConversion = await convertAcronyms(mappingInput, acronymMap, config);

    const replacementMap = await loadWordReplacementMap();
    if (isDebugEnabled(config)) {
      debugLog(config, 'CSV Map Loaded', { totalEntries: replacementMap.size });
    }
    const textAfterWordReplacement = await replaceNonVietnameseWords(
      textAfterAcronymConversion,
      replacementMap,
      config,
    );

    let processedText = textAfterWordReplacement;
    if (config.enableTransliteration) {
      processedText = applyTransliteration(textAfterWordReplacement, replacementMap, config);
      if (isDebugEnabled(config)) {
        debugLog(config, 'Step 4.5: Transliteration', {
          before: textAfterWordReplacement,
          after: processedText,
          enabled: true,
        });
      }
    } else if (isDebugEnabled(config)) {
      debugLog(config, 'Step 4.5: Transliteration', {
        enabled: false,
        skipped: true,
      });
    }

    if (isDebugEnabled(config)) {
      debugLog(config, 'Preprocessing Complete', { original: text, final: processedText });
    }

    return processedText;
  }

  async function chunkText(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const config = await loadConfig();
    if (isDebugEnabled(config)) {
      debugLog(config, 'Step 5: Text Chunking Start', {
        inputText: text,
        inputLength: text.length,
      });
    }

    const lines = text.split('\n');
    const chunks = [];

    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }

      const processedLine = /[.!?]$/.test(line.trim()) ? line : `${line.trim()}.`;
      const sentences = processedLine.split(/(?<=[.!?])(?=\s+|$)/);

      for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();
        if (trimmedSentence) {
          chunks.push(trimmedSentence);
        }
      }
    }

    if (isDebugEnabled(config)) {
      debugLog(config, 'Step 5: Text Chunking Complete', {
        totalChunks: chunks.length,
        chunks: chunks.map((chunk, idx) => ({
          index: idx + 1,
          text: chunk,
          length: chunk.length,
        })),
      });
    }

    return chunks;
  }

  return {
    applyTransliteration,
    chunkText,
    cleanTextForTTS,
    convertAcronyms,
    debugLog,
    isDebugEnabled,
    processTextForTTS,
    replaceNonVietnameseWords,
  };
}
