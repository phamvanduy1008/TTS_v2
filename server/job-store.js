import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ensureRuntimeDirectories,
  getJobDirectory,
  getJobManifestPath,
  getJobResultPath,
  jobsRoot,
} from './runtime-paths.js';

function nowIso() {
  return new Date().toISOString();
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export class JobStore {
  async init() {
    await ensureRuntimeDirectories();
  }

  async createJob({
    inputPath,
    inputMode = 'path',
    modelName = 'ngochuyen',
    originalFilename = null,
    speed = 1,
  }) {
    await this.init();

    const id = randomUUID();
    const jobDirectory = getJobDirectory(id);
    await mkdir(jobDirectory, { recursive: true });

    const manifest = {
      id,
      type: 'document-preprocess',
      inputPath: path.resolve(inputPath),
      inputMode,
      modelName,
      originalFilename,
      speed,
      status: 'queued',
      stage: 'queued',
      progress: {
        completedChunks: 0,
        completedSegments: 0,
        percent: 0,
        totalChunks: 0,
        totalSegments: 0,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      error: null,
      resultPath: null,
    };

    await writeJson(getJobManifestPath(id), manifest);
    return manifest;
  }

  async getJob(jobId) {
    await this.init();
    return readJson(getJobManifestPath(jobId));
  }

  async updateJob(jobId, updater) {
    const current = await this.getJob(jobId);
    const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
    next.updatedAt = nowIso();
    await writeJson(getJobManifestPath(jobId), next);
    return next;
  }

  async writeResult(jobId, result) {
    const resultPath = getJobResultPath(jobId);
    await writeJson(resultPath, result);
    await this.updateJob(jobId, (job) => ({
      ...job,
      resultPath,
    }));
    return resultPath;
  }

  async getResult(jobId) {
    return readJson(getJobResultPath(jobId));
  }

  async listJobs(limit = 20) {
    await this.init();
    const entries = await readdir(jobsRoot, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const jobs = await Promise.all(
      directories.map(async (jobId) => {
        try {
          return await this.getJob(jobId);
        } catch {
          return null;
        }
      }),
    );

    return jobs
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }
}
