import { PiperTTS } from '../lib/piper-tts.js';
import { getVietnameseModelAssetPaths } from '../config.js';
import { chunkText, processTextForTTS } from '../utils/text-cleaner.js';

let tts = null;
let cancelled = false;

const MODEL_LOAD_PROGRESS = {
  'loading-assets': 14,
  'reading-assets': 42,
  'creating-session': 72,
  'finalizing-model': 94,
};

async function initializeModel(modelName) {
  try {
    cancelled = false;
    postProgress({
      phase: 'loading-model',
      percent: 6,
      message: `Dang khoi tao model ${modelName}`,
    });

    const { modelPath, configPath } = getVietnameseModelAssetPaths(modelName);
    tts = await PiperTTS.from_pretrained(modelPath, configPath, (payload) => {
      postProgress({
        phase: payload.phase,
        percent: MODEL_LOAD_PROGRESS[payload.phase] ?? payload.percent ?? 0,
        message: payload.message,
      });
    });

    self.postMessage({
      status: 'ready',
      voices: tts.getSpeakers(),
    });
  } catch (error) {
    console.error('Error loading model:', error);
    self.postMessage({
      status: 'error',
      data: error instanceof Error ? error.message : 'Khong the tai model.',
    });
  }
}

self.addEventListener('message', async (event) => {
  const { type, text, voice, speed, model } = event.data;

  if (type === 'init') {
    await initializeModel(model);
    return;
  }

  if (type === 'cancel') {
    cancelled = true;
    postProgress({
      phase: 'cancelled',
      percent: 0,
      message: 'Da nhan lenh huy tien trinh',
    });
    return;
  }

  if (!tts) {
    self.postMessage({ status: 'error', data: 'Model chua duoc khoi tao.' });
    return;
  }

  try {
    cancelled = false;

    const rawText = typeof text === 'string' ? text : '';
    const textSections = splitInputIntoSections(rawText);
    const processedChunks = [];

    postProgress({
      phase: 'preprocessing',
      percent: 2,
      message: 'Bat dau tien xu ly van ban',
      stats: {
        totalSections: textSections.length,
        totalCharacters: rawText.length,
      },
    });

    for (let index = 0; index < textSections.length; index += 1) {
      throwIfCancelled();

      const section = textSections[index];
      const processedText = await processTextForTTS(section);
      const sectionChunks = await chunkText(processedText);
      processedChunks.push(...sectionChunks);

      postProgress({
        phase: 'preprocessing',
        percent: 4 + Math.round(((index + 1) / Math.max(textSections.length, 1)) * 18),
        message: `Da tien xu ly phan ${index + 1}/${textSections.length}`,
        stats: {
          currentSection: index + 1,
          totalSections: textSections.length,
          totalChunks: processedChunks.length,
        },
      });
    }

    if (!processedChunks.length) {
      throw new Error('Khong co noi dung hop le de tao audio.');
    }

    const batches = createSentenceBatches(processedChunks);
    const totalChunks = processedChunks.length;
    const speakerId = typeof voice === 'number' ? voice : parseInt(voice, 10) || 0;
    const lengthScale = 1.0 / (speed || 1.0);
    const pcmSegments = [];
    let totalSamples = 0;
    let sampleRate = 22050;
    let processedCount = 0;

    postProgress({
      phase: 'chunking',
      percent: 24,
      message: `Da tach ${totalChunks} cau thanh ${batches.length} batch`,
      stats: {
        totalChunks,
        totalBatches: batches.length,
      },
    });

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      throwIfCancelled();

      const batchChunks = batches[batchIndex];
      postProgress({
        phase: 'generating',
        percent: 25 + Math.round((processedCount / Math.max(totalChunks, 1)) * 58),
        message: `Dang tao audio batch ${batchIndex + 1}/${batches.length}`,
        stats: {
          currentBatch: batchIndex + 1,
          totalBatches: batches.length,
          processedChunks: processedCount,
          totalChunks,
        },
      });

      const stream = tts.stream(createChunkStream(batchChunks), { speakerId, lengthScale });

      for await (const { audio } of stream) {
        throwIfCancelled();

        sampleRate = audio.sampling_rate;
        pcmSegments.push(float32ToInt16(audio.audio));
        totalSamples += audio.audio.length;
        processedCount += 1;

        postProgress({
          phase: 'generating',
          percent: 25 + Math.round((processedCount / Math.max(totalChunks, 1)) * 58),
          message: `Da tao ${processedCount}/${totalChunks} cau`,
          stats: {
            currentBatch: batchIndex + 1,
            totalBatches: batches.length,
            processedChunks: processedCount,
            totalChunks,
            estimatedAudioSeconds: Math.round(totalSamples / sampleRate),
          },
        });
      }
    }

    throwIfCancelled();

    postProgress({
      phase: 'encoding',
      percent: 90,
      message: 'Dang ghep PCM va tao file WAV',
      stats: {
        processedChunks: processedCount,
        totalChunks,
      },
    });

    const audio = createWavBlobFromSegments(pcmSegments, totalSamples, sampleRate);
    self.postMessage({ status: 'complete', audio });
  } catch (error) {
    if (error instanceof Error && error.message === 'cancelled') {
      self.postMessage({ status: 'cancelled' });
      return;
    }

    console.error('Error during generation:', error);
    self.postMessage({
      status: 'error',
      data: error instanceof Error ? error.message : 'Khong the tao audio.',
    });
  }
});

function postProgress(payload) {
  self.postMessage({
    status: 'progress',
    ...payload,
  });
}

function throwIfCancelled() {
  if (cancelled) {
    throw new Error('cancelled');
  }
}

function splitInputIntoSections(text, maxChars = 3200) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const sections = [];
  let buffer = '';

  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;

    if (next.length <= maxChars) {
      buffer = next;
      continue;
    }

    if (buffer) {
      sections.push(buffer);
      buffer = '';
    }

    if (paragraph.length <= maxChars) {
      buffer = paragraph;
      continue;
    }

    const sentences = paragraph.match(/[^.!?\n]+[.!?]*/g)?.map((item) => item.trim()).filter(Boolean) || [paragraph];
    let sentenceBuffer = '';

    for (const sentence of sentences) {
      const candidate = sentenceBuffer ? `${sentenceBuffer} ${sentence}` : sentence;
      if (candidate.length <= maxChars) {
        sentenceBuffer = candidate;
      } else {
        if (sentenceBuffer) {
          sections.push(sentenceBuffer);
        }
        sentenceBuffer = sentence;
      }
    }

    if (sentenceBuffer) {
      buffer = sentenceBuffer;
    }
  }

  if (buffer) {
    sections.push(buffer);
  }

  return sections.length ? sections : [normalized];
}

function createSentenceBatches(chunks, maxBatchChars = 900, maxBatchSentences = 12) {
  const batches = [];
  let currentBatch = [];
  let currentChars = 0;

  for (const chunk of chunks) {
    const chunkLength = chunk.length;
    const shouldSplit =
      currentBatch.length > 0 &&
      (currentBatch.length >= maxBatchSentences || currentChars + chunkLength > maxBatchChars);

    if (shouldSplit) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(chunk);
    currentChars += chunkLength;
  }

  if (currentBatch.length) {
    batches.push(currentBatch);
  }

  return batches;
}

async function* createChunkStream(chunks) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function float32ToInt16(input) {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

function createWavBlobFromSegments(segments, totalSamples, sampleRate) {
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  let offset = 44;
  for (const segment of segments) {
    for (let i = 0; i < segment.length; i += 1) {
      view.setInt16(offset, segment[i], true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
