import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { mergeFloat32Chunks, mergeWavFiles, mergeWavFilesInParts, readWavSampleRate, writeWavFromFloat32 } from './audio-utils.js';
import { importTextFromPath } from './import-text-node.js';
import { segmentDocumentText } from './document-segmenter.js';
import { getVietnameseModelPaths } from './model-paths.js';
import { NodePiperTTS } from './node-piper-tts.js';
import { nodeTextCleaner } from './node-text-resources.js';
import { getJobDirectory } from './runtime-paths.js';

const MODEL_RELOAD_SEGMENT_INTERVAL = 12;
const PART_MAX_DATA_BYTES = 512 * 1024 * 1024;
const HUGE_BROWSER_DOWNLOAD_CHARS = 500_000;
const WAV_MAX_DATA_BYTES = 0xffff_ffff - 36;
const MAX_CHUNK_FALLBACK_DEPTH = 5;
const MIN_CHUNK_FALLBACK_CHARS = 120;

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

async function hasAudioData(filePath) {
  try {
    const fileStats = await stat(filePath);
    return fileStats.size > 44;
  } catch {
    return false;
  }
}

function formatJobError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (typeof error === 'number') {
    return `Native/WASM error code: ${error}`;
  }

  return String(error);
}

function sanitizeProblemChunk(text) {
  return String(text || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\uFFFD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitChunkForFallback(text) {
  const value = String(text || '').trim();
  if (value.length < MIN_CHUNK_FALLBACK_CHARS * 2) {
    return [];
  }

  const midpoint = Math.floor(value.length / 2);
  const windowStart = Math.max(0, midpoint - 160);
  const windowEnd = Math.min(value.length, midpoint + 160);
  const splitWindow = value.slice(windowStart, windowEnd);
  const punctuationMatches = Array.from(splitWindow.matchAll(/[.!?;:,]\s+/g));
  const punctuationMatch = punctuationMatches.findLast((match) => windowStart + match.index < midpoint)
    || punctuationMatches[0];
  const punctuationIndex = punctuationMatch ? windowStart + punctuationMatch.index + punctuationMatch[0].length : -1;
  const spaceBefore = value.lastIndexOf(' ', midpoint);
  const spaceAfter = value.indexOf(' ', midpoint);
  const splitIndex = punctuationIndex > 0
    ? punctuationIndex
    : (spaceBefore > MIN_CHUNK_FALLBACK_CHARS ? spaceBefore : spaceAfter);

  if (splitIndex <= MIN_CHUNK_FALLBACK_CHARS || splitIndex >= value.length - MIN_CHUNK_FALLBACK_CHARS) {
    return [];
  }

  return [value.slice(0, splitIndex).trim(), value.slice(splitIndex).trim()].filter(Boolean);
}

export async function runDocumentJob(jobStore, jobId) {
  const job = await jobStore.getJob(jobId);
  let tts = null;

  await jobStore.updateJob(jobId, (current) => ({
    ...current,
    status: 'running',
    stage: 'loading-input',
    error: null,
  }));

  try {
    const rawText = await importTextFromPath(job.inputPath);
    const segments = segmentDocumentText(rawText);
    const modelName = job.modelName || 'ngochuyen';
    const speed = Number(job.speed) > 0 ? Number(job.speed) : 1;
    const modelPaths = getVietnameseModelPaths(modelName);
    tts = await NodePiperTTS.fromFiles(modelPaths);
    const jobDirectory = getJobDirectory(jobId);
    const segmentRows = ['index,chars,words,processedChars,chunkCount,skippedChunkCount,audioPath'];
    const failedChunkRows = ['segmentIndex,chunkIndex,depth,chars,error,preview'];

    async function reloadTts() {
      if (tts) {
        await tts.dispose().catch(() => {});
      }
      tts = await NodePiperTTS.fromFiles(modelPaths);
    }

    async function synthesizeChunkWithFallback(chunk, context, depth = 0) {
      const normalizedChunk = sanitizeProblemChunk(chunk);
      const attemptTexts = Array.from(new Set([String(chunk || '').trim(), normalizedChunk].filter(Boolean)));
      let lastError = null;

      for (const attemptText of attemptTexts) {
        try {
          return await tts.synthesizeChunk(attemptText, {
            lengthScale: 1.0 / speed,
          });
        } catch (error) {
          lastError = error;

          try {
            await reloadTts();
            return await tts.synthesizeChunk(attemptText, {
              lengthScale: 1.0 / speed,
            });
          } catch (retryError) {
            lastError = retryError;
          }
        }
      }

      const fallbackParts = depth < MAX_CHUNK_FALLBACK_DEPTH
        ? splitChunkForFallback(normalizedChunk || chunk)
        : [];

      if (fallbackParts.length > 1) {
        const renderedParts = [];
        let fallbackSampleRate = sampleRate;

        for (let partIndex = 0; partIndex < fallbackParts.length; partIndex += 1) {
          const renderedPart = await synthesizeChunkWithFallback(fallbackParts[partIndex], {
            ...context,
            chunkIndex: `${context.chunkIndex}.${partIndex + 1}`,
          }, depth + 1);

          fallbackSampleRate = renderedPart.sampleRate || fallbackSampleRate;
          if (!renderedPart.skipped && renderedPart.samples?.length) {
            renderedParts.push(renderedPart.samples);
          }
        }

        if (renderedParts.length) {
          return {
            reason: 'fallback-split',
            sampleRate: fallbackSampleRate || 22050,
            samples: mergeFloat32Chunks(renderedParts),
            skipped: false,
          };
        }
      }

      const preview = sanitizeProblemChunk(chunk).slice(0, 160).replace(/"/g, '""');
      failedChunkRows.push([
        context.segmentIndex,
        context.chunkIndex,
        depth,
        String(chunk || '').length,
        `"${formatJobError(lastError).slice(0, 240).replace(/"/g, '""')}"`,
        `"${preview}"`,
      ].join(','));

      return {
        reason: `fallback-failed: ${formatJobError(lastError)}`,
        sampleRate: sampleRate || 22050,
        samples: null,
        skipped: true,
      };
    }

    await jobStore.updateJob(jobId, (current) => ({
      ...current,
      stage: 'segmenting',
      progress: {
        ...current.progress,
        percent: 5,
        totalSegments: segments.length,
      },
    }));

    const processedSegments = [];
    let totalChunks = 0;
    let completedChunks = 0;
    let skippedChunks = 0;
    const segmentAudioPaths = [];
    let sampleRate = null;

    for (const segment of segments) {
      const audioFileName = `segment-${String(segment.index + 1).padStart(4, '0')}.wav`;
      const audioPath = path.join(jobDirectory, audioFileName);

      if (await hasAudioData(audioPath)) {
        sampleRate = sampleRate || await readWavSampleRate(audioPath);
        segmentAudioPaths.push(audioPath);
        processedSegments.push({
          index: segment.index,
          chars: segment.chars,
          words: segment.words,
          processedChars: segment.text.length,
          chunkCount: 0,
          audioPath,
          skippedChunkCount: 0,
          resumed: true,
        });
        segmentRows.push([
          segment.index,
          segment.chars,
          segment.words,
          segment.text.length,
          0,
          0,
          audioPath,
        ].join(','));

        await jobStore.updateJob(jobId, (current) => ({
          ...current,
          stage: 'resuming',
          progress: {
            ...current.progress,
            completedSegments: segment.index + 1,
            percent: Math.min(95, 5 + Math.round(((segment.index + 1) / Math.max(segments.length, 1)) * 90)),
            totalSegments: segments.length,
          },
        }));
        continue;
      }

      const processedText = await nodeTextCleaner.processTextForTTS(segment.text);
      const chunks = await nodeTextCleaner.chunkText(processedText);
      totalChunks += chunks.length;
      const renderedChunks = [];
      let skippedInSegment = 0;

      await jobStore.updateJob(jobId, (current) => ({
        ...current,
        stage: 'synthesizing',
        progress: {
          ...current.progress,
          completedSegments: segment.index,
          completedChunks,
          percent: Math.min(95, 5 + Math.round((segment.index / Math.max(segments.length, 1)) * 90)),
          totalChunks,
          totalSegments: segments.length,
        },
      }));

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const rendered = await synthesizeChunkWithFallback(chunk, {
          chunkIndex: chunkIndex + 1,
          segmentIndex: segment.index + 1,
        });
        sampleRate = rendered.sampleRate;

        if (rendered.skipped || !rendered.samples || rendered.samples.length === 0) {
          skippedChunks += 1;
          skippedInSegment += 1;
          continue;
        }

        renderedChunks.push(rendered.samples);
      }

      completedChunks += chunks.length;

      if (renderedChunks.length === 0) {
        const fallbackSampleRate = sampleRate || 22050;
        renderedChunks.push(new Float32Array(Math.round(fallbackSampleRate * 0.2)));
        sampleRate = fallbackSampleRate;
      }

      const mergedSamples = mergeFloat32Chunks(renderedChunks);
      await writeWavFromFloat32(audioPath, mergedSamples, sampleRate);
      segmentAudioPaths.push(audioPath);

      processedSegments.push({
        index: segment.index,
        chars: segment.chars,
        words: segment.words,
        processedChars: processedText.length,
        chunkCount: chunks.length,
        audioPath,
        skippedChunkCount: skippedInSegment,
        processedPreview: processedText.slice(0, 240),
        firstChunkPreview: chunks[0]?.slice(0, 240) || '',
      });
      segmentRows.push([
        segment.index,
        segment.chars,
        segment.words,
        processedText.length,
        chunks.length,
        skippedInSegment,
        audioPath,
      ].join(','));

      await jobStore.updateJob(jobId, (current) => ({
        ...current,
        stage: 'synthesizing',
        progress: {
          ...current.progress,
          completedChunks,
          completedSegments: segment.index + 1,
          percent: Math.min(95, 5 + Math.round(((segment.index + 1) / Math.max(segments.length, 1)) * 90)),
          totalChunks,
          totalSegments: segments.length,
        },
      }));

      if ((segment.index + 1) % MODEL_RELOAD_SEGMENT_INTERVAL === 0 && segment.index + 1 < segments.length) {
        await tts.dispose();
        tts = await NodePiperTTS.fromFiles(modelPaths);
      }
    }

    if (segmentAudioPaths.length === 0) {
      throw new Error('Khong tao duoc audio hop le tu tai lieu nay sau khi loc cac chunk rong.');
    }

    await jobStore.updateJob(jobId, (current) => ({
      ...current,
      stage: 'merging-parts',
      progress: {
        ...current.progress,
        percent: 97,
      },
    }));

    const outputDirectory = path.join(jobDirectory, 'audio-parts');
    const audioParts = await mergeWavFilesInParts(segmentAudioPaths, outputDirectory, {
      baseName: 'part',
      maxDataBytes: PART_MAX_DATA_BYTES,
      sampleRate: sampleRate || 22050,
    });
    const partAudioPaths = audioParts.map((part) => part.path);
    const totalPartDataBytes = audioParts.reduce((sum, part) => sum + part.dataBytes, 0);
    const mergedAudioPath = path.join(
      jobDirectory,
      totalPartDataBytes > WAV_MAX_DATA_BYTES ? 'merged-full.rf64.wav' : 'merged-full.wav',
    );
    const mergedAudio = await mergeWavFiles(segmentAudioPaths, mergedAudioPath, sampleRate || 22050);
    const finalAudioPath = mergedAudio.path;
    await writeFile(path.join(jobDirectory, 'segments.csv'), `${segmentRows.join('\n')}\n`, 'utf8');
    if (failedChunkRows.length > 1) {
      await writeFile(path.join(jobDirectory, 'failed-chunks.csv'), `${failedChunkRows.join('\n')}\n`, 'utf8');
    }

    const result = {
      jobId,
      summary: {
        totalChars: rawText.length,
        totalWords: countWords(rawText),
        totalSegments: segments.length,
        totalChunks,
        failedChunks: failedChunkRows.length - 1,
        skippedChunks,
      },
      audio: {
        finalAudioPath,
        finalAudioFormat: mergedAudio.format,
        finalAudioDataBytes: mergedAudio.dataBytes,
        modelName,
        outputDirectory,
        partAudioPaths,
        parts: audioParts,
        sampleRate: sampleRate || 22050,
        segmentAudioPaths,
        skipBrowserDownload: rawText.length > HUGE_BROWSER_DOWNLOAD_CHARS || partAudioPaths.length > 1,
        speed,
      },
      segments: processedSegments,
      generatedAt: new Date().toISOString(),
    };

    await jobStore.writeResult(jobId, result);
    await jobStore.updateJob(jobId, (current) => ({
      ...current,
      status: 'completed',
      stage: 'completed',
      progress: {
        completedChunks,
        completedSegments: segments.length,
        percent: 100,
        totalChunks,
        totalSegments: segments.length,
      },
    }));
    await tts.dispose();
    tts = null;
  } catch (error) {
    await jobStore.updateJob(jobId, (current) => ({
      ...current,
      status: 'failed',
      stage: 'failed',
      error: formatJobError(error),
    }));
  } finally {
    if (tts) {
      await tts.dispose();
    }
  }
}

export class DocumentJobManager {
  constructor(jobStore) {
    this.jobStore = jobStore;
    this.queue = [];
    this.running = false;
  }

  enqueue(jobId) {
    this.queue.push(jobId);
    void this.pump();
  }

  async pump() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        await runDocumentJob(this.jobStore, jobId);
      }
    } finally {
      this.running = false;
    }
  }
}
