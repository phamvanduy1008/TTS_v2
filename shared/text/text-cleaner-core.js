import { processVietnameseText } from '../../src/utils/vietnamese-processor.js';

export function createTextCleaner({ loadAcronymMap, loadConfig }) {
  const SHORT_SENTENCE_CHARS = 34;
  const SMART_GROUP_MAX_CHARS = 145;
  const WORD_BOUNDARY = '[^\\w\\u00C0-\\u1EFF]';
  const INITIALISM_READINGS = {
    A: 'ây',
    B: 'bi',
    C: 'si',
    D: 'đi',
    E: 'i',
    F: 'ép',
    G: 'gi',
    H: 'hát',
    I: 'ai',
    J: 'giây',
    K: 'kây',
    L: 'eo',
    M: 'em',
    N: 'en',
    O: 'ô',
    P: 'pi',
    Q: 'kiu',
    R: 'a',
    S: 'ét',
    T: 'ti',
    U: 'u',
    V: 'vi',
    W: 'đắp liu',
    X: 'ích',
    Y: 'wai',
    Z: 'dét',
  };

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isDebugEnabled(config) {
    return config && config.debug === true;
  }

  function debugLog(config, step, data) {
    if (isDebugEnabled(config)) {
      console.log(`[DEBUG] ${step}:`, data);
    }
  }

  async function convertAcronyms(text, acronymMap, config = null) {
    if (!text || typeof text !== 'string' || !acronymMap || acronymMap.size === 0) {
      return text;
    }

    let result = text;
    const convertedAcronyms = [];

    for (const [acronym, transliteration] of acronymMap) {
      const escapedAcronym = escapeRegex(acronym);
      const regex = new RegExp(`(^|${WORD_BOUNDARY})(${escapedAcronym})(?=${WORD_BOUNDARY}|$)`, 'gi');
      const beforeReplace = result;
      result = result.replace(regex, (_match, boundary) => `${boundary || ''}${transliteration}`);

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

  function spellInitialisms(text, config = null) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    const convertedInitialisms = [];
    const initialismRegex = new RegExp(`(^|${WORD_BOUNDARY})([A-Z]{2,}(?:[./][A-Z0-9]{1,})*)(?=${WORD_BOUNDARY}|$)`, 'g');

    const result = text.replace(initialismRegex, (match, boundary, token) => {
      const letters = Array.from(token.replace(/[^A-Z]/g, ''));
      if (letters.length < 2) {
        return match;
      }

      const reading = letters
        .map((letter) => INITIALISM_READINGS[letter])
        .filter(Boolean)
        .join(' ');

      if (!reading) {
        return match;
      }

      convertedInitialisms.push({ token, reading });
      return `${boundary || ''}${reading}`;
    });

    if (isDebugEnabled(config) && convertedInitialisms.length > 0) {
      debugLog(config, 'Initialism Spelling', {
        totalInitialisms: convertedInitialisms.length,
        initialisms: convertedInitialisms,
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
      .replace(/[\\()]/g, '')
      .replace(/[\u201C\u201D"]/g, '')
      .replace(/\s[\u2014\u2013]\s/g, '. ')
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

    const vietnameseProcessedText = cleanedText
      .split(/\n{2,}/)
      .map((paragraph) => processVietnameseText(paragraph, config))
      .filter(Boolean)
      .join('\n\n');
    if (isDebugEnabled(config)) {
      debugLog(config, 'Step 2: Vietnamese Processing', {
        before: cleanedText,
        after: vietnameseProcessedText,
      });
    }

    const acronymMap = await loadAcronymMap();
    if (isDebugEnabled(config)) {
      debugLog(config, 'Acronym Map Loaded', { totalEntries: acronymMap.size });
    }

    const knownAcronymText = await convertAcronyms(vietnameseProcessedText, acronymMap, config);
    const initialismText = spellInitialisms(knownAcronymText, config);
    const mappingInput = initialismText.toLowerCase();
    if (isDebugEnabled(config)) {
      debugLog(config, 'Step 2.5: Lowercase Normalization', {
        before: initialismText,
        after: mappingInput,
      });
    }

    const processedText = await convertAcronyms(mappingInput, acronymMap, config);

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

    const paragraphs = text
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    const chunks = [];

    for (const paragraph of paragraphs) {
      chunks.push(...createSmartChunksForParagraph(paragraph));
    }

    markParagraphPauses(chunks);

    if (isDebugEnabled(config)) {
      debugLog(config, 'Step 5: Text Chunking Complete', {
        totalChunks: chunks.length,
        chunks: chunks.map((chunk, idx) => ({
          index: idx + 1,
          text: chunk.text,
          length: chunk.text.length,
          pause: chunk.pause,
        })),
      });
    }

    return chunks;
  }

  function createSmartChunksForParagraph(paragraph) {
    const processedParagraph = /[.!?…]$/.test(paragraph.trim())
      ? paragraph
      : `${paragraph.trim()}.`;
    const sentences = processedParagraph
      .split(/(?<=[.!?…])(?=\s+|$)/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const chunks = [];
    let buffer = '';

    for (const sentence of sentences) {
      const candidate = buffer ? `${buffer} ${sentence}` : sentence;
      const canGroup = buffer
        && shouldGroupSentence(buffer, sentence)
        && candidate.length <= SMART_GROUP_MAX_CHARS;

      if (!buffer || canGroup) {
        buffer = candidate;
        continue;
      }

      chunks.push(createChunk(buffer));
      buffer = sentence;
    }

    if (buffer) {
      chunks.push(createChunk(buffer));
    }

    if (chunks.length) {
      chunks[chunks.length - 1].pause = upgradePause(chunks[chunks.length - 1].pause, 'paragraph');
    }

    return chunks;
  }

  function shouldGroupSentence(previousText, nextSentence) {
    if (/[?!…]\s*$/.test(previousText)) {
      return false;
    }

    if (/[?!]\s*$/.test(nextSentence)) {
      return false;
    }

    return previousText.length <= SHORT_SENTENCE_CHARS || nextSentence.length <= SHORT_SENTENCE_CHARS;
  }

  function createChunk(text) {
    return {
      pause: inferPauseType(text),
      text,
    };
  }

  function inferPauseType(text) {
    const value = String(text || '').trim();

    if (/…|\.\.\.\s*$/.test(value)) {
      return 'ellipsis';
    }

    if (/[?!]\s*$/.test(value)) {
      return 'expressive';
    }

    if (/[.]\s*$/.test(value)) {
      return value.length <= SHORT_SENTENCE_CHARS ? 'short-sentence' : 'sentence';
    }

    if (/[,;:]\s*$/.test(value)) {
      return 'clause';
    }

    return 'boundary';
  }

  function markParagraphPauses(chunks) {
    for (let index = 0; index < chunks.length - 1; index += 1) {
      if (chunks[index].pause === 'paragraph') {
        continue;
      }

      if (chunks[index + 1].pause === 'paragraph' && chunks[index].text.length <= SHORT_SENTENCE_CHARS) {
        chunks[index].pause = upgradePause(chunks[index].pause, 'short-sentence');
      }
    }
  }

  function upgradePause(current, next) {
    const order = ['boundary', 'clause', 'short-sentence', 'sentence', 'expressive', 'ellipsis', 'paragraph'];
    return order.indexOf(next) > order.indexOf(current) ? next : current;
  }

  return {
    chunkText,
    cleanTextForTTS,
    convertAcronyms,
    debugLog,
    isDebugEnabled,
    processTextForTTS,
    spellInitialisms,
  };
}
