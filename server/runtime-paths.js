import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { projectRoot } from './node-text-resources.js';

export const runtimeRoot = path.join(projectRoot, 'runtime');
export const jobsRoot = path.join(runtimeRoot, 'jobs');
export const outputsRoot = path.join(runtimeRoot, 'outputs');
export const tempRoot = path.join(runtimeRoot, 'temp');
export const uploadsRoot = path.join(runtimeRoot, 'uploads');

export async function ensureRuntimeDirectories() {
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true }),
    mkdir(jobsRoot, { recursive: true }),
    mkdir(outputsRoot, { recursive: true }),
    mkdir(tempRoot, { recursive: true }),
    mkdir(uploadsRoot, { recursive: true }),
  ]);
}

export function getJobDirectory(jobId) {
  return path.join(jobsRoot, jobId);
}

export function getJobManifestPath(jobId) {
  return path.join(getJobDirectory(jobId), 'job.json');
}

export function getJobResultPath(jobId) {
  return path.join(getJobDirectory(jobId), 'result.json');
}
