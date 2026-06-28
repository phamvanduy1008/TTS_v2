import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DocumentJobManager } from './document-job-runner.js';
import { JobStore } from './job-store.js';
import { saveUploadedFile } from './upload-store.js';

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function notFound(response) {
  sendJson(response, 404, { error: 'Not found' });
}

function methodNotAllowed(response) {
  sendJson(response, 405, { error: 'Method not allowed' });
}

function sendCorsNoContent(response) {
  response.writeHead(204, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
  });
  response.end();
}

function extractJobId(urlPath) {
  const match = urlPath.match(/^\/jobs\/([^/]+)$/);
  return match?.[1] || null;
}

function extractResultJobId(urlPath) {
  const match = urlPath.match(/^\/jobs\/([^/]+)\/result$/);
  return match?.[1] || null;
}

function extractAudioJobId(urlPath) {
  const match = urlPath.match(/^\/jobs\/([^/]+)\/audio$/);
  return match?.[1] || null;
}

function extractResumeJobId(urlPath) {
  const match = urlPath.match(/^\/jobs\/([^/]+)\/resume$/);
  return match?.[1] || null;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

async function parseMultipartBody(request, url) {
  const req = new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request,
    duplex: 'half',
  });

  return req.formData();
}

function getModelName(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'ngochuyen';
}

function getSpeed(value) {
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function getDownloadFilename(job, jobId, partIndex = null) {
  const originalFilename = typeof job?.originalFilename === 'string' ? job.originalFilename.trim() : '';
  const baseName = originalFilename ? path.parse(originalFilename).name : jobId;
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_') || jobId;
  if (Number.isInteger(partIndex) && partIndex > 0) {
    return `${safeBaseName}-part-${String(partIndex).padStart(4, '0')}.wav`;
  }
  return `${safeBaseName}.wav`;
}

export async function createApiServer({ host = '127.0.0.1', port = 3030 } = {}) {
  const jobStore = new JobStore();
  await jobStore.init();
  const jobManager = new DocumentJobManager(jobStore);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);

    try {
      if (request.method === 'OPTIONS') {
        sendCorsNoContent(response);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/jobs') {
        const jobs = await jobStore.listJobs();
        sendJson(response, 200, { jobs });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/jobs') {
        const contentType = String(request.headers['content-type'] || '');
        let job = null;

        if (contentType.includes('multipart/form-data')) {
          const formData = await parseMultipartBody(request, url.toString());
          const file = formData.get('file');
          const modelName = getModelName(formData.get('modelName'));

          if (!(file instanceof File)) {
            sendJson(response, 400, { error: 'file is required' });
            return;
          }

          const uploaded = await saveUploadedFile(file);
          job = await jobStore.createJob({
            inputPath: uploaded.storedPath,
            inputMode: 'upload',
            modelName,
            originalFilename: uploaded.originalFilename,
            speed: getSpeed(formData.get('speed')),
          });
        } else {
          const body = await readJsonBody(request);
          if (!body?.inputPath || typeof body.inputPath !== 'string') {
            sendJson(response, 400, { error: 'inputPath is required' });
            return;
          }

          job = await jobStore.createJob({
            inputPath: body.inputPath,
            inputMode: 'path',
            modelName: getModelName(body.modelName),
            originalFilename: typeof body.originalFilename === 'string' ? body.originalFilename : null,
            speed: getSpeed(body.speed),
          });
        }

        jobManager.enqueue(job.id);
        sendJson(response, 202, { job });
        return;
      }

      const resultJobId = extractResultJobId(url.pathname);
      if (resultJobId) {
        if (request.method !== 'GET') {
          methodNotAllowed(response);
          return;
        }

        try {
          const result = await jobStore.getResult(resultJobId);
          sendJson(response, 200, { result });
        } catch {
          sendJson(response, 404, { error: 'Result not ready' });
        }
        return;
      }

      const resumeJobId = extractResumeJobId(url.pathname);
      if (resumeJobId) {
        if (request.method !== 'POST') {
          methodNotAllowed(response);
          return;
        }

        try {
          const job = await jobStore.getJob(resumeJobId);
          if (job.status === 'running' || job.status === 'queued') {
            sendJson(response, 409, { error: 'Job is already running or queued' });
            return;
          }

          const resumedJob = await jobStore.updateJob(resumeJobId, (current) => ({
            ...current,
            status: 'queued',
            stage: 'queued',
            error: null,
          }));
          jobManager.enqueue(resumeJobId);
          sendJson(response, 202, { job: resumedJob });
        } catch {
          sendJson(response, 404, { error: 'Job not found' });
        }
        return;
      }

      const audioJobId = extractAudioJobId(url.pathname);
      if (audioJobId) {
        if (request.method !== 'GET') {
          methodNotAllowed(response);
          return;
        }

        try {
          const job = await jobStore.getJob(audioJobId);
          const result = await jobStore.getResult(audioJobId);
          const requestedPart = Number(url.searchParams.get('part') || 0);
          const partAudioPaths = Array.isArray(result?.audio?.partAudioPaths) ? result.audio.partAudioPaths : [];
          const finalAudioPath = requestedPart > 0
            ? partAudioPaths[requestedPart - 1]
            : result?.audio?.finalAudioPath;

          if (!finalAudioPath) {
            sendJson(response, 404, { error: 'Audio not ready' });
            return;
          }

          const fileStats = await stat(finalAudioPath);
          const downloadFilename = getDownloadFilename(job, audioJobId, requestedPart || null);

          response.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'audio/wav',
            'Content-Disposition': `attachment; filename="${downloadFilename}"`,
            'Content-Length': String(fileStats.size),
          });
          createReadStream(finalAudioPath).pipe(response);
        } catch {
          sendJson(response, 404, { error: 'Audio not ready' });
        }
        return;
      }

      const jobId = extractJobId(url.pathname);
      if (jobId) {
        if (request.method !== 'GET') {
          methodNotAllowed(response);
          return;
        }

        try {
          const job = await jobStore.getJob(jobId);
          sendJson(response, 200, { job });
        } catch {
          sendJson(response, 404, { error: 'Job not found' });
        }
        return;
      }

      notFound(response);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  });

  return {
    host,
    jobManager,
    jobStore,
    port,
    server,
    async start() {
      await new Promise((resolve, reject) => {
        function onError(error) {
          server.off('listening', onListening);
          reject(error);
        }

        function onListening() {
          server.off('error', onError);
          resolve();
        }

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return { host, port };
    },
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (entryPath) {
  const api = await createApiServer({
    host: process.env.TTS_LOCAL_HOST || '127.0.0.1',
    port: Number(process.env.TTS_LOCAL_PORT || 3030),
  });
  await api.start();
  console.log(`Local TTS job server listening at http://${api.host}:${api.port}`);
}
