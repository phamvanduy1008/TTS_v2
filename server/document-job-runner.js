import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  mergeFloat32ChunksWithPauses,
  mergeWavFiles,
  readWavSampleRate,
  writeWavFromFloat32,
} from './audio-utils.js';
import { importTextFromPath } from './import-text-node.js';
import { segmentDocumentText } from './document-segmenter.js';
import { getVietnameseModelPaths } from './model-paths.js';
import { NodePiperTTS } from './node-piper-tts.js';
import { nodeTextCleaner } from './node-text-resources.js';
import { sanitizeOutputBaseName } from './output-name.js';
import { getJobDirectory } from './runtime-paths.js';

const DEFAULT_MODEL_RELOAD_SEGMENT_INTERVAL = 0;
const HUGE_BROWSER_DOWNLOAD_CHARS = 500_000;
const WAV_MAX_DATA_BYTES = 0xffff_ffff - 36;
const MAX_CHUNK_FALLBACK_DEPTH = 5;
const MIN_CHUNK_FALLBACK_CHARS = 120;
const DEFAULT_CHUNK_SYNTHESIS_TIMEOUT_MS = 120_000;
const FINAL_OUTPUT_DIRECTORY_ENV = 'TTS_FINAL_OUTPUT_DIR';
const FINAL_OUTPUT_FILENAME = 'chuong';
const COMPLETED_MARKER_FILENAME = 'tts-completed.json';

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

function nowMs() {
  return Date.now();
}

function getModelReloadSegmentInterval() {
  const configured = Number(process.env.TTS_MODEL_RELOAD_SEGMENT_INTERVAL);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MODEL_RELOAD_SEGMENT_INTERVAL;
}

function getChunkSynthesisTimeoutMs() {
  const configured = Number(process.env.TTS_CHUNK_SYNTHESIS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_CHUNK_SYNTHESIS_TIMEOUT_MS;
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function getFinalOutputPath(job, jobId, fallbackDirectory, format) {
  const jobOutputDirectory = typeof job.outputDirectory === 'string' ? job.outputDirectory.trim() : '';
  const configuredDirectory = jobOutputDirectory || String(process.env[FINAL_OUTPUT_DIRECTORY_ENV] || '').trim();
  const sourceFilename = job.originalFilename || path.basename(job.inputPath || '');
  const outputBaseName = sanitizeOutputBaseName(sourceFilename, jobId);
  const outputExtension = format === 'rf64' ? '.rf64.wav' : '.wav';
  const outputDirectory = configuredDirectory
    ? path.join(path.resolve(configuredDirectory), outputBaseName)
    : fallbackDirectory;

  return {
    configured: Boolean(configuredDirectory),
    outputDirectory,
    outputPath: path.join(outputDirectory, `${FINAL_OUTPUT_FILENAME}${outputExtension}`),
  };
}

async function cleanupTemporaryAudioFiles(segmentPaths) {
  const cleanupTargets = segmentPaths.map((filePath) => ({ filePath, type: 'segment' }));
  const results = await Promise.allSettled(
    cleanupTargets.map(({ filePath }) => rm(filePath, { force: true, recursive: true })),
  );

  const failed = results
    .map((result, index) => ({ result, target: cleanupTargets[index] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, target }) => ({
      path: target.filePath,
      type: target.type,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    }));

  return {
    cleaned: failed.length === 0,
    deletedTargets: cleanupTargets.length - failed.length,
    failed,
  };
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

function getChunkText(chunk) {
  return typeof chunk === 'string' ? chunk : String(chunk?.text || '');
}

export async function runDocumentJob(jobStore, jobId) {
  const job = await jobStore.getJob(jobId);
  let tts = null;
  const jobStartedAtMs = nowMs();
  const timing = {
    cleanupMs: 0,
    inputMs: 0,
    mergeMs: 0,
    modelLoadMs: 0,
    modelReloadMs: 0,
    preprocessingMs: 0,
    segmentWriteMs: 0,
    synthesizeMs: 0,
  };

  await jobStore.updateJob(jobId, (current) => ({
    ...current,
    status: 'running',
    stage: 'loading-input',
    error: null,
  }));

  try {
    const inputStartedAtMs = nowMs();
    const rawText = await importTextFromPath(job.inputPath);
    const segments = segmentDocumentText(rawText);
    timing.inputMs += nowMs() - inputStartedAtMs;
    const modelName = job.modelName || 'ngochuyen';
    const speed = Number(job.speed) > 0 ? Number(job.speed) : 1;
    const modelPaths = getVietnameseModelPaths(modelName);
    const modelReloadSegmentInterval = getModelReloadSegmentInterval();
    const chunkSynthesisTimeoutMs = getChunkSynthesisTimeoutMs();
    const modelLoadStartedAtMs = nowMs();
    tts = await NodePiperTTS.fromFiles(modelPaths);
    timing.modelLoadMs += nowMs() - modelLoadStartedAtMs;
    const jobDirectory = getJobDirectory(jobId);
    const segmentRows = ['index,chars,words,processedChars,chunkCount,skippedChunkCount,audioPath'];
    const failedChunkRows = ['segmentIndex,chunkIndex,depth,chars,error,preview'];

    async function reloadTts() {
      if (tts) {
        await tts.dispose().catch(() => {});
      }
      const reloadStartedAtMs = nowMs();
      tts = await NodePiperTTS.fromFiles(modelPaths);
      timing.modelReloadMs += nowMs() - reloadStartedAtMs;
    }

    async function synthesizeChunkWithFallback(chunk, context, depth = 0) {
      const normalizedChunk = sanitizeProblemChunk(chunk);
      const attemptTexts = Array.from(new Set([String(chunk || '').trim(), normalizedChunk].filter(Boolean)));
      let lastError = null;

      for (const attemptText of attemptTexts) {
        try {
          return await withTimeout(
            tts.synthesizeChunk(attemptText, {
              lengthScale: 1.0 / speed,
            }),
            chunkSynthesisTimeoutMs,
            `Qua thoi gian tao audio chunk ${context.segmentIndex}.${context.chunkIndex} sau ${chunkSynthesisTimeoutMs}ms`,
          );
        } catch (error) {
          lastError = error;

          try {
            await reloadTts();
            return await withTimeout(
              tts.synthesizeChunk(attemptText, {
                lengthScale: 1.0 / speed,
              }),
              chunkSynthesisTimeoutMs,
              `Qua thoi gian retry audio chunk ${context.segmentIndex}.${context.chunkIndex} sau ${chunkSynthesisTimeoutMs}ms`,
            );
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
            renderedParts.push({
              samples: renderedPart.samples,
              text: fallbackParts[partIndex],
            });
          }
        }

        if (renderedParts.length) {
          return {
            reason: 'fallback-split',
            sampleRate: fallbackSampleRate || 22050,
            samples: mergeFloat32ChunksWithPauses(renderedParts, fallbackSampleRate || 22050),
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

      const preprocessingStartedAtMs = nowMs();
      const processedText = await nodeTextCleaner.processTextForTTS(segment.text);
      const chunks = await nodeTextCleaner.chunkText(processedText);
      timing.preprocessingMs += nowMs() - preprocessingStartedAtMs;
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
        const chunkText = getChunkText(chunk);
        const synthesizeStartedAtMs = nowMs();
        const rendered = await synthesizeChunkWithFallback(chunkText, {
          chunkIndex: chunkIndex + 1,
          segmentIndex: segment.index + 1,
        });
        timing.synthesizeMs += nowMs() - synthesizeStartedAtMs;
        sampleRate = rendered.sampleRate;

        await jobStore.updateJob(jobId, (current) => ({
          ...current,
          stage: 'synthesizing',
          progress: {
            ...current.progress,
            completedChunks: completedChunks + chunkIndex + 1,
            completedSegments: segment.index,
            currentChunkInSegment: chunkIndex + 1,
            totalChunks,
            totalChunksInSegment: chunks.length,
            totalSegments: segments.length,
          },
        }));

        if (rendered.skipped || !rendered.samples || rendered.samples.length === 0) {
          skippedChunks += 1;
          skippedInSegment += 1;
          continue;
        }

        renderedChunks.push({
          pause: chunk.pause,
          samples: rendered.samples,
          text: chunkText,
        });
      }

      completedChunks += chunks.length;

      if (renderedChunks.length === 0) {
        const fallbackSampleRate = sampleRate || 22050;
        renderedChunks.push({
          samples: new Float32Array(Math.round(fallbackSampleRate * 0.2)),
          text: '',
        });
        sampleRate = fallbackSampleRate;
      }

      const mergedSamples = mergeFloat32ChunksWithPauses(renderedChunks, sampleRate, {
        includeTrailingPause: true,
      });
      const segmentWriteStartedAtMs = nowMs();
      await writeWavFromFloat32(audioPath, mergedSamples, sampleRate);
      timing.segmentWriteMs += nowMs() - segmentWriteStartedAtMs;
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
        firstChunkPreview: getChunkText(chunks[0]).slice(0, 240),
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

      if (
        modelReloadSegmentInterval > 0
        && (segment.index + 1) % modelReloadSegmentInterval === 0
        && segment.index + 1 < segments.length
      ) {
        await tts.dispose();
        const reloadStartedAtMs = nowMs();
        tts = await NodePiperTTS.fromFiles(modelPaths);
        timing.modelReloadMs += nowMs() - reloadStartedAtMs;
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

    const mergeStartedAtMs = nowMs();
    let totalSegmentDataBytes = 0;
    for (const audioPath of segmentAudioPaths) {
      const fileStats = await stat(audioPath);
      totalSegmentDataBytes += Math.max(0, fileStats.size - 44);
    }

    const finalAudioFormat = totalSegmentDataBytes > WAV_MAX_DATA_BYTES ? 'rf64' : 'wav';
    const finalOutput = getFinalOutputPath(job, jobId, jobDirectory, finalAudioFormat);
    await mkdir(finalOutput.outputDirectory, { recursive: true });
    const mergedAudioPath = finalOutput.outputPath;
    const mergedAudio = await mergeWavFiles(segmentAudioPaths, mergedAudioPath, sampleRate || 22050);
    const finalAudioPath = mergedAudio.path;
    timing.mergeMs += nowMs() - mergeStartedAtMs;
    const cleanupStartedAtMs = nowMs();
    const temporaryAudioCleanup = await cleanupTemporaryAudioFiles(segmentAudioPaths);
    timing.cleanupMs += nowMs() - cleanupStartedAtMs;
    await writeFile(path.join(jobDirectory, 'segments.csv'), `${segmentRows.join('\n')}\n`, 'utf8');
    if (failedChunkRows.length > 1) {
      await writeFile(path.join(jobDirectory, 'failed-chunks.csv'), `${failedChunkRows.join('\n')}\n`, 'utf8');
    }
    await writeFile(path.join(finalOutput.outputDirectory, COMPLETED_MARKER_FILENAME), JSON.stringify({
      completedAt: new Date().toISOString(),
      finalAudioPath,
      jobId,
      originalFilename: job.originalFilename || null,
    }, null, 2), 'utf8').catch(() => {});

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
      timing: {
        ...timing,
        audioSeconds: Math.round((mergedAudio.dataBytes / 2 / (sampleRate || 22050)) * 10) / 10,
        modelReloadSegmentInterval,
        realtimeFactor: Math.round((timing.synthesizeMs / 1000 / Math.max(mergedAudio.dataBytes / 2 / (sampleRate || 22050), 1)) * 100) / 100,
        totalMs: nowMs() - jobStartedAtMs,
      },
      audio: {
        finalAudioPath,
        finalAudioFormat: mergedAudio.format,
        finalAudioDataBytes: mergedAudio.dataBytes,
        finalOutputDirectory: finalOutput.outputDirectory,
        finalOutputDirectoryConfigured: finalOutput.configured,
        modelName,
        outputDirectory: finalOutput.outputDirectory,
        partAudioPaths: [],
        parts: [],
        sampleRate: sampleRate || 22050,
        segmentAudioPaths: temporaryAudioCleanup.cleaned ? [] : segmentAudioPaths,
        skipBrowserDownload: rawText.length > HUGE_BROWSER_DOWNLOAD_CHARS,
        speed,
        temporaryAudioCleanup,
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
    this.activeJobId = null;
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
        this.activeJobId = jobId;
        await runDocumentJob(this.jobStore, jobId);
        this.activeJobId = null;
      }
    } finally {
      this.activeJobId = null;
      this.running = false;
    }
  }

  hasQueuedOrRunning(jobId) {
    return this.activeJobId === jobId || this.queue.includes(jobId);
  }
}
