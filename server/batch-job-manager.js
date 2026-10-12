import { randomUUID } from 'node:crypto';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runDocumentJob } from './document-job-runner.js';
import { sanitizeOutputBaseName } from './output-name.js';

const FINAL_OUTPUT_DIRECTORY_ENV = 'TTS_FINAL_OUTPUT_DIR';
const COMPLETED_MARKER_FILENAME = 'tts-completed.json';

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function normalizeDirectory(value) {
  const directory = String(value || '').trim();
  if (!directory) {
    throw new Error('inputDirectory is required');
  }

  return path.resolve(directory);
}

function extractSortNumbers(filename) {
  return Array.from(String(filename || '').matchAll(/\d+/g), (match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));
}

function compareInputFiles(left, right) {
  return compareBatchNames(left.filename, right.filename);
}

function compareBatchNames(leftName, rightName) {
  const leftNumbers = extractSortNumbers(leftName);
  const rightNumbers = extractSortNumbers(rightName);
  const length = Math.max(leftNumbers.length, rightNumbers.length);

  for (let index = 0; index < length; index += 1) {
    const leftNumber = leftNumbers[index];
    const rightNumber = rightNumbers[index];

    if (leftNumber === undefined && rightNumber !== undefined) {
      return -1;
    }

    if (leftNumber !== undefined && rightNumber === undefined) {
      return 1;
    }

    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
  }

  return String(leftName || '').localeCompare(String(rightName || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function getConfiguredOutputRoot() {
  const configuredDirectory = String(process.env[FINAL_OUTPUT_DIRECTORY_ENV] || '').trim();
  return configuredDirectory ? path.resolve(configuredDirectory) : '';
}

function resolveOutputRoot(outputDirectory) {
  const directory = String(outputDirectory || '').trim();
  return directory ? path.resolve(directory) : getConfiguredOutputRoot();
}

function getBatchOutputPaths(filename, outputDirectory = '') {
  const outputRoot = resolveOutputRoot(outputDirectory);
  if (!outputRoot) {
    return {
      configured: false,
      markerPath: '',
      outputDirectory: '',
      wavPath: '',
      rf64Path: '',
    };
  }

  const baseName = sanitizeOutputBaseName(filename, path.parse(filename).name || 'batch');
  const batchOutputDirectory = path.join(outputRoot, baseName);

  return {
    configured: true,
    markerPath: path.join(batchOutputDirectory, COMPLETED_MARKER_FILENAME),
    outputDirectory: batchOutputDirectory,
    wavPath: path.join(batchOutputDirectory, 'chuong.wav'),
    rf64Path: path.join(batchOutputDirectory, 'chuong.rf64.wav'),
  };
}

async function hasUsableAudio(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile() && fileStats.size > 44;
  } catch {
    return false;
  }
}

async function isBatchCompleted(filename, outputDirectory = '') {
  const output = getBatchOutputPaths(filename, outputDirectory);
  if (!output.configured) {
    return false;
  }

  return (await hasUsableAudio(output.wavPath)) || (await hasUsableAudio(output.rf64Path));
}

async function markBatchCompleted(filename, jobId, outputDirectory = '') {
  const output = getBatchOutputPaths(filename, outputDirectory);
  if (!output.configured || !output.markerPath) {
    return;
  }

  await writeFile(output.markerPath, JSON.stringify({
    completedAt: nowIso(),
    filename,
    jobId,
  }, null, 2), 'utf8').catch(() => {});
}

async function scanInputDirectory(inputDirectory, outputDirectory = '') {
  const resolvedDirectory = normalizeDirectory(inputDirectory);
  const outputRoot = resolveOutputRoot(outputDirectory);
  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map((entry) => ({
      filename: entry.name,
      inputPath: path.join(resolvedDirectory, entry.name),
      output: getBatchOutputPaths(entry.name, outputRoot),
    }))
    .sort(compareInputFiles);

  return {
    inputDirectory: resolvedDirectory,
    files,
    outputDirectory: outputRoot,
    outputDirectoryConfigured: Boolean(outputRoot),
  };
}

async function findLatestOutputFolderName(outputDirectory = '') {
  const outputRoot = resolveOutputRoot(outputDirectory);
  if (!outputRoot) {
    return '';
  }

  try {
    const entries = await readdir(outputRoot, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => extractSortNumbers(name).length > 0)
      .sort(compareBatchNames);

    return directories.at(-1) || '';
  } catch {
    return '';
  }
}

function isBeforeOrSameLatestOutput(filename, latestOutputFolderName) {
  if (!latestOutputFolderName) {
    return false;
  }

  const inputBaseName = sanitizeOutputBaseName(filename, '');
  return compareBatchNames(inputBaseName, latestOutputFolderName) <= 0;
}

function summarizeItems(items) {
  const summary = {
    completed: 0,
    failed: 0,
    ignored: 0,
    processing: 0,
    queued: 0,
    skipped: 0,
    total: items.length,
  };

  for (const item of items) {
    if (item.status === 'COMPLETED') {
      summary.completed += 1;
    } else if (item.status === 'FAILED') {
      summary.failed += 1;
    } else if (item.status === 'PROCESSING') {
      summary.processing += 1;
    } else if (item.status === 'SKIPPED') {
      summary.skipped += 1;
    } else if (item.status === 'IGNORED') {
      summary.ignored += 1;
    } else {
      summary.queued += 1;
    }
  }

  const processingItem = items.find((item) => item.status === 'PROCESSING');
  const currentFraction = Number(processingItem?.progress?.percent || 0) / 100;
  summary.done = summary.completed + summary.skipped + summary.ignored;
  summary.percent = summary.total > 0 ? Math.round(((summary.done + currentFraction) / summary.total) * 100) : 0;
  return summary;
}

function getCurrentAndNext(items) {
  const current = items.find((item) => item.status === 'PROCESSING') || null;
  const next = items.find((item) => item.status === 'QUEUED') || null;
  return {
    currentFile: current?.filename || '',
    nextFile: next?.filename || '',
  };
}

export class BatchJobManager {
  constructor(jobStore) {
    this.jobStore = jobStore;
    this.batches = new Map();
    this.runningBatchId = null;
  }

  async scan({
    inputDirectory,
    modelName = 'ngochuyen',
    outputDirectory = '',
    speed = 1,
  }) {
    const resolvedOutputDirectory = resolveOutputRoot(outputDirectory);
    const scanned = await scanInputDirectory(inputDirectory, resolvedOutputDirectory);
    const latestOutputFolderName = await findLatestOutputFolderName(resolvedOutputDirectory);
    const scannedItems = [];

    for (const file of scanned.files) {
      const completed = await isBatchCompleted(file.filename, resolvedOutputDirectory);
      scannedItems.push({
        completed,
        error: '',
        filename: file.filename,
        inputPath: file.inputPath,
        jobId: '',
        outputDirectory: file.output.outputDirectory,
        elapsedMs: 0,
        endedAt: null,
        startedAt: null,
        startedAtMs: null,
      });
    }

    const runnableItems = latestOutputFolderName
      ? scannedItems.filter((item) => !isBeforeOrSameLatestOutput(item.filename, latestOutputFolderName))
      : scannedItems;
    const items = runnableItems.map((item) => {
      let status = 'QUEUED';
      if (item.completed) {
        status = 'SKIPPED';
      }

      return {
        error: item.error,
        filename: item.filename,
        inputPath: item.inputPath,
        jobId: item.jobId,
        outputDirectory: item.outputDirectory,
        elapsedMs: item.elapsedMs,
        endedAt: item.endedAt,
        startedAt: item.startedAt,
        startedAtMs: item.startedAtMs,
        status,
      };
    });

    const batch = {
      id: randomUUID(),
      createdAt: nowIso(),
      currentFile: '',
      inputDirectory: scanned.inputDirectory,
      modelName,
      nextFile: '',
      outputDirectory: scanned.outputDirectory,
      outputDirectoryConfigured: scanned.outputDirectoryConfigured,
      resumeAfterFolder: latestOutputFolderName,
      speed,
      status: 'scanned',
      stopRequested: false,
      summary: summarizeItems(items),
      updatedAt: nowIso(),
      warning: scanned.outputDirectoryConfigured
        ? ''
        : `${FINAL_OUTPUT_DIRECTORY_ENV} is not configured; completed batch detection is limited.`,
      items,
    };

    Object.assign(batch, getCurrentAndNext(items));
    this.batches.set(batch.id, batch);
    return batch;
  }

  get(batchId) {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new Error('Batch not found');
    }

    return batch;
  }

  async getSnapshot(batchId) {
    const batch = this.get(batchId);
    const processingItem = batch.items.find((item) => item.status === 'PROCESSING' && item.jobId);

    if (processingItem) {
      if (processingItem.startedAtMs) {
        processingItem.elapsedMs = Math.max(0, nowMs() - processingItem.startedAtMs);
      }

      try {
        const job = await this.jobStore.getJob(processingItem.jobId);
        processingItem.stage = job.stage || processingItem.stage || '';
        processingItem.progress = job.progress || processingItem.progress || {};
        processingItem.error = job.error || processingItem.error || '';
      } catch {
        processingItem.progress = processingItem.progress || {};
      }
    }

    batch.summary = summarizeItems(batch.items);
    Object.assign(batch, getCurrentAndNext(batch.items));
    return batch;
  }

  async start(options) {
    const batch = options.batchId ? this.get(options.batchId) : await this.scan(options);

    if (this.runningBatchId && this.runningBatchId !== batch.id) {
      throw new Error('Another batch is already running');
    }

    if (batch.status === 'running') {
      return batch;
    }

    batch.stopRequested = false;
    batch.status = 'running';
    batch.updatedAt = nowIso();
    Object.assign(batch, getCurrentAndNext(batch.items));
    void this.pump(batch.id);
    return batch;
  }

  stop(batchId) {
    const batch = this.get(batchId);
    batch.stopRequested = true;
    batch.status = batch.status === 'running' ? 'stopping' : batch.status;
    batch.updatedAt = nowIso();
    return batch;
  }

  async pump(batchId) {
    if (this.runningBatchId) {
      return;
    }

    const batch = this.get(batchId);
    this.runningBatchId = batchId;

    try {
      for (const item of batch.items) {
        if (batch.stopRequested) {
          break;
        }

        if (await isBatchCompleted(item.filename, batch.outputDirectory)) {
          item.status = 'SKIPPED';
          item.error = '';
          item.endedAt = nowIso();
          item.elapsedMs = 0;
          batch.updatedAt = nowIso();
          batch.summary = summarizeItems(batch.items);
          Object.assign(batch, getCurrentAndNext(batch.items));
          continue;
        }

        if (item.status !== 'QUEUED' && item.status !== 'FAILED') {
          continue;
        }

        item.status = 'PROCESSING';
        item.error = '';
        item.endedAt = null;
        item.startedAt = nowIso();
        item.startedAtMs = nowMs();
        item.elapsedMs = 0;
        batch.updatedAt = nowIso();
        batch.summary = summarizeItems(batch.items);
        Object.assign(batch, getCurrentAndNext(batch.items));

        try {
          const job = await this.jobStore.createJob({
            inputMode: 'path',
            inputPath: item.inputPath,
            modelName: batch.modelName,
            originalFilename: item.filename,
            outputDirectory: batch.outputDirectory || null,
            speed: batch.speed,
          });
          item.jobId = job.id;
          item.stage = job.stage;
          item.progress = job.progress;

          await runDocumentJob(this.jobStore, job.id);
          const completedJob = await this.jobStore.getJob(job.id);
          if (completedJob.status === 'completed' && await isBatchCompleted(item.filename, batch.outputDirectory)) {
            item.status = 'COMPLETED';
            await markBatchCompleted(item.filename, job.id, batch.outputDirectory);
          } else {
            item.status = 'FAILED';
            item.error = completedJob.error || 'Batch finished without a usable output audio file.';
          }
        } catch (error) {
          item.status = 'FAILED';
          item.error = error instanceof Error ? error.message : String(error);
        }

        item.endedAt = nowIso();
        item.elapsedMs = item.startedAtMs ? Math.max(0, nowMs() - item.startedAtMs) : item.elapsedMs;
        batch.updatedAt = nowIso();
        batch.summary = summarizeItems(batch.items);
        Object.assign(batch, getCurrentAndNext(batch.items));
      }

      batch.status = batch.stopRequested ? 'stopped' : 'completed';
      batch.updatedAt = nowIso();
      batch.summary = summarizeItems(batch.items);
      Object.assign(batch, getCurrentAndNext(batch.items));
    } finally {
      this.runningBatchId = null;
    }
  }
}
