<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { DownloadIcon, FileUpIcon, FolderOpenIcon, LoaderCircleIcon, PlayIcon } from 'lucide-vue-next';
import ModelSelector from '../components/ModelSelector.vue';
import SpeedControl from '../components/SpeedControl.vue';
import TextStatistics from '../components/TextStatistics.vue';
import { DEFAULT_MODEL } from '../config.js';
import { importTextFromFile, importTextPreviewFromFile } from '../lib/file-text-import.js';
import { fetchAvailableModels } from '../utils/model-detector.js';

const HUGE_FILE_BYTES = 1 * 1024 * 1024;
const HUGE_TEXT_CHARS = 500_000;
const HUGE_PREVIEW_BYTES = 96 * 1024;
const runtimeParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const LOCAL_API_HOST = runtimeParams.get('ttsApiHost') || import.meta.env.VITE_TTS_LOCAL_HOST || '127.0.0.1';
const LOCAL_API_PORT = Number(runtimeParams.get('ttsApiPort') || import.meta.env.VITE_TTS_LOCAL_PORT || 3030);
const LOCAL_INFERENCE_BACKEND = runtimeParams.get('ttsInferenceBackend') || import.meta.env.VITE_TTS_INFERENCE_BACKEND || 'cpu';
const LOCAL_API_BASE = `http://${LOCAL_API_HOST}:${LOCAL_API_PORT}`;

const text = ref('Xin chao, day la ban TTS toi gian chay bang model local.');
const speed = ref(1.0);
const status = ref('idle');
const error = ref('');
const modelsLoading = ref(false);
const availableModels = ref([]);
const selectedModel = ref('None');
const worker = ref(null);
const result = ref(null);
const audioUrl = ref('');
const lastGeneration = ref(null);
const loadingProgress = ref(0);
const processingProgress = ref(0);
const progressMessage = ref('');
const progressPhase = ref('idle');
const progressStats = ref({});
const progressLogs = ref([]);
const fileInput = ref(null);
const activeInputTab = ref('scan');
const selectedSourceFile = ref(null);
const importedTextSnapshot = ref('');
const sourceMode = ref('text');
const hugeFilePreview = ref(false);
const completedJobResult = ref(null);
const pendingDownloadFilename = ref('');
const localServerAvailable = ref(false);
const localServerBackend = ref(LOCAL_INFERENCE_BACKEND);
const localServerRuntimeError = ref('');
const localServerRuntimeReady = ref(true);
const localServerChecking = ref(false);
const activeJobId = ref('');
const batchInputDirectory = ref('');
const batchOutputDirectory = ref('');
const batchState = ref(null);
const batchActionLoading = ref(false);
const batchError = ref('');
const importState = ref({
  loading: false,
  message: '',
  error: '',
});
let logSequence = 0;
let jobPollTimer = 0;
let batchPollTimer = 0;
let missingJobRetryCount = 0;

const hasModel = computed(() => selectedModel.value !== 'None');
const isScanTab = computed(() => activeInputTab.value === 'scan');
const isUploadTab = computed(() => activeInputTab.value === 'upload');
const hasSourceInput = computed(() => sourceMode.value === 'file' ? Boolean(selectedSourceFile.value) : text.value.trim().length > 0);
const requiresLocalServer = computed(() => sourceMode.value === 'file' && hugeFilePreview.value);
const canGenerate = computed(() => (
  hasModel.value
  && (isScanTab.value ? hasBatchDirectory.value : hasSourceInput.value)
  && status.value !== 'loading'
  && status.value !== 'generating'
  && !batchActionLoading.value
  && !batchIsRunning.value
  && (isScanTab.value
    ? localServerAvailable.value && localServerRuntimeReady.value
    : (!requiresLocalServer.value || (localServerAvailable.value && localServerRuntimeReady.value)))
));
const canDownload = computed(() => Boolean(result.value) && status.value === 'ready');
const hasPartOutputs = computed(() => (completedJobResult.value?.audio?.partAudioPaths?.length || 0) > 1);
const modelReady = computed(() => hasModel.value && status.value === 'ready');
const canResumeLocalJob = computed(() => localServerAvailable.value && activeJobId.value && status.value === 'error');
const canRunLatestLocalJob = computed(() => (
  localServerAvailable.value
  && status.value !== 'loading'
  && status.value !== 'generating'
));
const progressPercent = computed(() => (status.value === 'loading' ? loadingProgress.value : processingProgress.value));
const canPlay = computed(() => Boolean(audioUrl.value) && status.value === 'ready');
const batchItems = computed(() => batchState.value?.items || []);
const currentBatchItem = computed(() => batchItems.value.find((item) => item.status === 'PROCESSING') || null);
const currentBatchRemainingTime = computed(() => {
  const item = currentBatchItem.value;
  if (!item) {
    return '';
  }

  const elapsedMs = Number(item.elapsedMs);
  const completedSegments = Number(item.progress?.completedSegments);
  const totalSegments = Number(item.progress?.totalSegments);
  const currentChunk = Number(item.progress?.currentChunkInSegment);
  const chunksInSegment = Number(item.progress?.totalChunksInSegment);

  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !Number.isFinite(totalSegments) || totalSegments <= 0) {
    return 'Dang tinh...';
  }

  if (completedSegments >= totalSegments) {
    return 'Dang hoan tat';
  }

  // A finished segment keeps its last chunk counters until the next segment starts.
  const segmentFraction = Number.isFinite(currentChunk) && Number.isFinite(chunksInSegment) && chunksInSegment > 0 && currentChunk < chunksInSegment
    ? Math.min(1, Math.max(0, currentChunk / chunksInSegment))
    : 0;
  const progress = (Math.max(0, completedSegments || 0) + segmentFraction) / totalSegments;
  if (progress < 0.05) {
    return 'Dang tinh...';
  }

  const remainingMs = elapsedMs * (1 - progress) / progress;
  return Number.isFinite(remainingMs) ? `~${formatDuration(Math.ceil(remainingMs / 1000) * 1000)}` : 'Dang tinh...';
});
const hasBatchDirectory = computed(() => batchInputDirectory.value.trim().length > 0);
const batchIsRunning = computed(() => ['running', 'stopping'].includes(batchState.value?.status));
const canScanBatch = computed(() => (
  localServerAvailable.value
  && localServerRuntimeReady.value
  && hasBatchDirectory.value
  && !batchActionLoading.value
  && !batchIsRunning.value
));
const canStartBatch = computed(() => (
  localServerAvailable.value
  && localServerRuntimeReady.value
  && hasBatchDirectory.value
  && !batchActionLoading.value
  && !batchIsRunning.value
));

function resetAudio() {
  result.value = null;
  lastGeneration.value = null;
  completedJobResult.value = null;

  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value);
    audioUrl.value = '';
  }
}

function buildDownloadFilename() {
  const uploadedName = selectedSourceFile.value?.name?.trim();
  if (uploadedName) {
    const cleanedName = uploadedName.replace(/[\\/]/g, '');
    const extensionIndex = cleanedName.lastIndexOf('.');
    const baseName = extensionIndex > 0 ? cleanedName.slice(0, extensionIndex) : cleanedName;
    const safeBaseName = baseName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
    if (safeBaseName) {
      return `${safeBaseName}.wav`;
    }
  }

  return `${selectedModel.value || 'tts'}.wav`;
}

function extractFilenameFromDisposition(disposition) {
  if (!disposition) {
    return '';
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/[\\/]/g, '');
    } catch {
      return utf8Match[1].replace(/[\\/]/g, '');
    }
  }

  const basicMatch = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i);
  const filename = basicMatch?.[1] || basicMatch?.[2] || '';
  return filename.trim().replace(/^["']|["']$/g, '').replace(/[\\/]/g, '');
}

function resetRunProgress() {
  processingProgress.value = 0;
  progressMessage.value = '';
  progressPhase.value = 'idle';
  progressStats.value = {};
  progressLogs.value = [];
  logSequence = 0;
}

function addLog(message, phase = progressPhase.value, stats = null) {
  const entry = {
    id: `${Date.now()}-${logSequence += 1}`,
    time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    phase,
    message,
    stats: stats ? { ...stats } : null,
  };

  progressLogs.value = [...progressLogs.value, entry].slice(-120);
}

function normalizeBatchPayload(payload) {
  return payload?.batch || payload || null;
}

function clearBatchPolling() {
  if (batchPollTimer) {
    window.clearTimeout(batchPollTimer);
    batchPollTimer = 0;
  }
}

function handleBatchDirectoryInput() {
  clearBatchPolling();
  batchState.value = null;
  batchError.value = '';
}

async function scanBatchDirectory() {
  if (!canScanBatch.value) {
    if (localServerAvailable.value && !localServerRuntimeReady.value) {
      batchError.value = `Runtime ${localServerBackend.value.toUpperCase()} chua san sang: ${localServerRuntimeError.value || 'missing runtime'}`;
    }
    return;
  }

  batchActionLoading.value = true;
  batchError.value = '';
  clearBatchPolling();

  try {
    const response = await fetch(`${LOCAL_API_BASE}/batch/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputDirectory: batchInputDirectory.value.trim(),
        modelName: selectedModel.value,
        outputDirectory: batchOutputDirectory.value.trim(),
        speed: speed.value,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Khong the scan thu muc. HTTP ${response.status}`);
    }

    batchState.value = normalizeBatchPayload(payload);
  } catch (err) {
    batchError.value = err instanceof Error ? err.message : 'Khong the scan thu muc TXT.';
  } finally {
    batchActionLoading.value = false;
  }
}

async function startBatchTts() {
  if (!canStartBatch.value) {
    if (localServerAvailable.value && !localServerRuntimeReady.value) {
      batchError.value = `Runtime ${localServerBackend.value.toUpperCase()} chua san sang: ${localServerRuntimeError.value || 'missing runtime'}`;
    }
    return;
  }

  batchActionLoading.value = true;
  batchError.value = '';
  clearBatchPolling();

  try {
    const existingBatchId = batchState.value?.id;
    const response = await fetch(
      existingBatchId ? `${LOCAL_API_BASE}/batch/${encodeURIComponent(existingBatchId)}/start` : `${LOCAL_API_BASE}/batch/start`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: existingBatchId ? undefined : JSON.stringify({
          inputDirectory: batchInputDirectory.value.trim(),
          modelName: selectedModel.value,
          outputDirectory: batchOutputDirectory.value.trim(),
          speed: speed.value,
        }),
      },
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Khong the bat dau batch. HTTP ${response.status}`);
    }

    batchState.value = normalizeBatchPayload(payload);
    await pollBatchStatus();
  } catch (err) {
    batchError.value = err instanceof Error ? err.message : 'Khong the bat dau TTS hang loat.';
  } finally {
    batchActionLoading.value = false;
  }
}

async function pollBatchStatus() {
  if (!batchState.value?.id) {
    return;
  }

  try {
    const response = await fetch(`${LOCAL_API_BASE}/batch/${encodeURIComponent(batchState.value.id)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Khong the doc trang thai batch. HTTP ${response.status}`);
    }

    batchState.value = normalizeBatchPayload(payload);
    if (batchIsRunning.value) {
      batchPollTimer = window.setTimeout(() => {
        void pollBatchStatus();
      }, 1000);
    }
  } catch (err) {
    clearBatchPolling();
    batchError.value = err instanceof Error ? err.message : 'Khong the cap nhat tien trinh batch.';
  }
}

function getBatchStatusMeta(status) {
  switch (status) {
    case 'COMPLETED':
      return { label: 'Da hoan thanh', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-950/35 dark:text-emerald-200' };
    case 'SKIPPED':
      return { label: 'Da ton tai', className: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-300/20 dark:bg-teal-950/35 dark:text-teal-200' };
    case 'IGNORED':
      return { label: 'Bo qua', className: 'border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400' };
    case 'PROCESSING':
      return { label: 'Dang xu ly', className: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-300/20 dark:bg-orange-950/35 dark:text-orange-200' };
    case 'FAILED':
      return { label: 'Loi', className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-300/20 dark:bg-red-950/35 dark:text-red-200' };
    default:
      return { label: 'Cho xu ly', className: 'border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300' };
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function checkLocalServer() {
  localServerChecking.value = true;
  try {
    const response = await fetch(`${LOCAL_API_BASE}/health`);
    localServerAvailable.value = response.ok;
    if (response.ok) {
      const health = await response.json();
      localServerBackend.value = health?.inferenceBackend || LOCAL_INFERENCE_BACKEND;
      localServerRuntimeReady.value = health?.runtimeReady !== false;
      localServerRuntimeError.value = typeof health?.runtimeError === 'string' ? health.runtimeError : '';
    }
  } catch {
    localServerAvailable.value = false;
    localServerRuntimeReady.value = false;
    localServerRuntimeError.value = '';
  } finally {
    localServerChecking.value = false;
  }
}

function restartWorker(modelName) {
  if (worker.value) {
    worker.value.terminate();
  }

  resetAudio();
  error.value = '';
  status.value = 'loading';
  loadingProgress.value = 4;
  progressPhase.value = 'loading-model';
  progressMessage.value = `Dang khoi tao model ${modelName}`;
  progressStats.value = {};
  addLog(progressMessage.value, 'loading-model');

  worker.value = new Worker(new URL('../workers/tts-worker.js', import.meta.url), {
    type: 'module',
  });

  worker.value.addEventListener('message', onMessageReceived);
  worker.value.addEventListener('error', onWorkerError);
  worker.value.postMessage({ type: 'init', model: modelName });
}

async function fetchModels() {
  modelsLoading.value = true;
  error.value = '';

  try {
    const models = await fetchAvailableModels();
    availableModels.value = models;

    if (!models.length) {
      selectedModel.value = 'None';
      error.value = 'Khong tim thay model local trong public/tts-model/vi/.';
      return;
    }

    const defaultModel = models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models[0];
    selectedModel.value = defaultModel;
    if (localServerAvailable.value) {
      status.value = 'ready';
      progressPhase.value = 'ready';
      progressMessage.value = `Local server san sang voi model ${defaultModel}`;
      addLog(progressMessage.value, 'ready');
    } else {
      restartWorker(defaultModel);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Khong the tai danh sach model.';
  } finally {
    modelsLoading.value = false;
  }
}

function handleModelChange(modelName) {
  if (modelName === selectedModel.value) {
    return;
  }

  selectedModel.value = modelName;

  if (modelName === 'None') {
    if (worker.value) {
      worker.value.terminate();
      worker.value = null;
    }

    resetAudio();
    status.value = 'idle';
    error.value = '';
    return;
  }

  if (localServerAvailable.value) {
    resetAudio();
    status.value = 'ready';
    progressPhase.value = 'ready';
    progressMessage.value = `Da chuyen sang model ${modelName}`;
    addLog(progressMessage.value, 'ready');
  } else {
    restartWorker(modelName);
  }
}

async function generateAudio() {
  if (!canGenerate.value) {
    return;
  }

  if (isScanTab.value) {
    await startBatchTts();
    return;
  }

  resetRunProgress();
  resetAudio();
  error.value = '';
  status.value = 'generating';
  processingProgress.value = 1;
  progressPhase.value = 'queued';
  progressMessage.value = 'Da dua yeu cau vao worker';
  lastGeneration.value = {
    text: sourceMode.value === 'file' ? selectedSourceFile.value?.name || '' : text.value,
    speed: speed.value,
    model: selectedModel.value,
  };
  pendingDownloadFilename.value = buildDownloadFilename();
  addLog(`Bat dau tao audio voi model ${selectedModel.value}`, 'queued', {
    textLength: sourceMode.value === 'file' ? selectedSourceFile.value?.size || text.value.length : text.value.length,
    speed: speed.value,
  });

  if (localServerAvailable.value) {
    await generateAudioWithLocalServer();
    return;
  }

  worker.value?.postMessage({
    text: text.value,
    voice: 0,
    speed: speed.value,
  });
}

function clearJobPolling() {
  if (jobPollTimer) {
    window.clearTimeout(jobPollTimer);
    jobPollTimer = 0;
  }

  missingJobRetryCount = 0;
}

async function generateAudioWithLocalServer() {
  try {
    const form = new FormData();
    form.set('modelName', selectedModel.value);
    form.set('speed', String(speed.value));

    const selectedFile = selectedSourceFile.value;
    const extension = selectedFile?.name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    const canSendOriginalFile = sourceMode.value === 'file'
      && selectedFile instanceof File
      && ['txt', 'docx'].includes(extension)
      && (hugeFilePreview.value || importedTextSnapshot.value === text.value);

    const uploadFile = canSendOriginalFile
      ? selectedFile
      : new File([text.value], 'inline-input.txt', { type: 'text/plain' });

    form.set('file', uploadFile);

    const response = await fetch(`${LOCAL_API_BASE}/jobs`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Khong the tao job local. HTTP ${response.status}`);
    }

    const payload = await response.json();
    const createdJobId = String(payload?.job?.id || '').trim();
    if (!createdJobId) {
      throw new Error('Local server khong tra ve job id hop le.');
    }

    activeJobId.value = createdJobId;
    missingJobRetryCount = 0;
    progressPhase.value = 'queued';
    progressMessage.value = `Da tao local job ${activeJobId.value}`;
    addLog(progressMessage.value, 'queued');

    clearJobPolling();
    await pollLocalJob();
  } catch (err) {
    status.value = 'error';
    processingProgress.value = 0;
    error.value = err instanceof Error ? err.message : 'Khong the tao audio tu local server.';
    addLog(error.value, 'error');
  }
}

async function pollLocalJob() {
  if (!activeJobId.value) {
    return;
  }

  try {
    const jobId = encodeURIComponent(String(activeJobId.value).trim());
    const response = await fetch(`${LOCAL_API_BASE}/jobs/${jobId}`);
    if (!response.ok) {
      if (response.status === 404 && missingJobRetryCount < 5) {
        missingJobRetryCount += 1;
        progressMessage.value = `Dang doi local job xuat hien (${missingJobRetryCount}/5)`;
        addLog(progressMessage.value, 'queued');
        jobPollTimer = window.setTimeout(() => {
          void pollLocalJob();
        }, 800);
        return;
      }

      throw new Error(`Khong the doc tien trinh job. HTTP ${response.status}`);
    }

    missingJobRetryCount = 0;
    const payload = await response.json();
    const job = payload.job;
    progressPhase.value = job.stage || progressPhase.value;
    progressMessage.value = `Local job ${job.status} - ${job.stage}`;
    processingProgress.value = Math.max(processingProgress.value, job.progress?.percent || 0);
    progressStats.value = {
      processedChunks: job.progress?.completedChunks || 0,
      totalChunks: job.progress?.totalChunks || 0,
      currentBatch: job.progress?.completedSegments || 0,
      totalBatches: job.progress?.totalSegments || 0,
      totalSections: job.progress?.totalSegments || 0,
      currentSection: job.progress?.completedSegments || 0,
    };
    addLog(progressMessage.value, job.stage, progressStats.value);

    if (job.status === 'completed') {
      clearJobPolling();
      await finalizeLocalJob();
      return;
    }

    if (job.status === 'failed') {
      clearJobPolling();
      throw new Error(job.error || 'Local job bi loi.');
    }

    jobPollTimer = window.setTimeout(() => {
      void pollLocalJob();
    }, 1000);
  } catch (err) {
    clearJobPolling();
    status.value = 'error';
    processingProgress.value = 0;
    error.value = err instanceof Error ? err.message : 'Khong the theo doi local job.';
    addLog(error.value, 'error');
  }
}

async function resumeLocalJob() {
  if (!canResumeLocalJob.value) {
    return;
  }

  try {
    const jobId = encodeURIComponent(String(activeJobId.value).trim());
    error.value = '';
    status.value = 'generating';
    progressPhase.value = 'queued';
    progressMessage.value = `Dang tiep tuc local job ${activeJobId.value}`;
    addLog(progressMessage.value, 'queued');

    const response = await fetch(`${LOCAL_API_BASE}/jobs/${jobId}/resume`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Khong the tiep tuc local job. HTTP ${response.status}`);
    }

    clearJobPolling();
    await pollLocalJob();
  } catch (err) {
    status.value = 'error';
    error.value = err instanceof Error ? err.message : 'Khong the tiep tuc local job.';
    addLog(error.value, 'error');
  }
}

async function runLatestLocalJob() {
  if (!canRunLatestLocalJob.value) {
    return;
  }

  try {
    resetRunProgress();
    resetAudio();
    error.value = '';
    status.value = 'generating';
    processingProgress.value = 1;
    progressPhase.value = 'loading-latest-job';
    progressMessage.value = 'Dang tim local job moi nhat';
    addLog(progressMessage.value, progressPhase.value);

    const jobsResponse = await fetch(`${LOCAL_API_BASE}/jobs`);
    if (!jobsResponse.ok) {
      throw new Error(`Khong the doc danh sach local job. HTTP ${jobsResponse.status}`);
    }

    const payload = await jobsResponse.json();
    const latestJob = Array.isArray(payload?.jobs) ? payload.jobs[0] : null;
    const latestJobId = String(latestJob?.id || '').trim();
    if (!latestJobId) {
      throw new Error('Chua co local job nao de chay tiep.');
    }

    activeJobId.value = latestJobId;
    selectedModel.value = latestJob.modelName || selectedModel.value;
    speed.value = Number(latestJob.speed) > 0 ? Number(latestJob.speed) : speed.value;
    pendingDownloadFilename.value = latestJob.originalFilename
      ? `${latestJob.originalFilename.replace(/\.[^.]+$/, '')}.wav`
      : pendingDownloadFilename.value;

    progressPhase.value = latestJob.stage || 'queued';
    progressMessage.value = `Da chon job moi nhat ${activeJobId.value}`;
    processingProgress.value = Math.max(processingProgress.value, latestJob.progress?.percent || 1);
    addLog(progressMessage.value, progressPhase.value, {
      processedChunks: latestJob.progress?.completedChunks || 0,
      totalChunks: latestJob.progress?.totalChunks || 0,
      currentBatch: latestJob.progress?.completedSegments || 0,
      totalBatches: latestJob.progress?.totalSegments || 0,
    });

    clearJobPolling();

    if (latestJob.status === 'completed') {
      await finalizeLocalJob();
      return;
    }

    const jobId = encodeURIComponent(activeJobId.value);
    const resumeResponse = await fetch(`${LOCAL_API_BASE}/jobs/${jobId}/resume`, {
      method: 'POST',
    });

    if (!resumeResponse.ok && resumeResponse.status !== 409) {
      throw new Error(`Khong the chay tiep job moi nhat. HTTP ${resumeResponse.status}`);
    }

    await pollLocalJob();
  } catch (err) {
    clearJobPolling();
    status.value = 'error';
    processingProgress.value = 0;
    error.value = err instanceof Error ? err.message : 'Khong the chay tiep local job moi nhat.';
    addLog(error.value, 'error');
  }
}

async function finalizeLocalJob() {
  if (!activeJobId.value) {
    return;
  }

  const jobId = encodeURIComponent(String(activeJobId.value).trim());
  const resultResponse = await fetch(`${LOCAL_API_BASE}/jobs/${jobId}/result`);
  let resultPayload = null;
  if (resultResponse.ok) {
    resultPayload = await resultResponse.json();
    completedJobResult.value = resultPayload?.result || null;
  }

  status.value = 'ready';
  processingProgress.value = 100;
  progressPhase.value = 'complete';
  progressMessage.value = hasPartOutputs.value
    ? 'Da tao xong audio theo tung part trong thu muc job'
    : 'Da tao xong audio tren local server';

  if (completedJobResult.value) {
    const summary = resultPayload?.result?.summary || {};
    progressStats.value = {
      processedChunks: summary.totalChunks || 0,
      totalChunks: summary.totalChunks || 0,
      currentBatch: summary.totalSegments || 0,
      totalBatches: summary.totalSegments || 0,
      totalSections: summary.totalSegments || 0,
      currentSection: summary.totalSegments || 0,
    };
  }

  addLog(progressMessage.value, 'complete', progressStats.value);

  if (hasPartOutputs.value || completedJobResult.value?.audio?.skipBrowserDownload) {
    result.value = null;
    audioUrl.value = '';
    activeJobId.value = '';
    return;
  }

  const audioResponse = await fetch(`${LOCAL_API_BASE}/jobs/${jobId}/audio`);
  if (!audioResponse.ok) {
    throw new Error(`Khong the tai audio tu local server. HTTP ${audioResponse.status}`);
  }

  const serverFilename = extractFilenameFromDisposition(audioResponse.headers.get('content-disposition'));
  const audioBlob = await audioResponse.blob();
  result.value = audioBlob;
  pendingDownloadFilename.value = selectedSourceFile.value?.name
    ? (pendingDownloadFilename.value || buildDownloadFilename())
    : (serverFilename || pendingDownloadFilename.value || buildDownloadFilename());

  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value);
  }
  audioUrl.value = URL.createObjectURL(audioBlob);
  downloadAudio();
  activeJobId.value = '';
}

function playAudio() {
  const audio = document.getElementById('tts-preview');
  if (audioUrl.value && audio) {
    audio.currentTime = 0;
    audio.play().catch((err) => console.error('Playback error:', err));
  }
}

function downloadAudio() {
  if (!result.value) return;

  const downloadUrl = URL.createObjectURL(result.value);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = pendingDownloadFilename.value || buildDownloadFilename();
  // If a browser ignores the download attribute, open the blob in a new tab
  // instead of replacing the current SPA view.
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
}

function triggerFilePicker() {
  activeInputTab.value = 'upload';
  fileInput.value?.click();
}

function handleTextPaste(event) {
  const pastedText = event.clipboardData?.getData('text') || '';
  if (pastedText.length <= HUGE_TEXT_CHARS) {
    return;
  }

  event.preventDefault();
  selectedSourceFile.value = null;
  sourceMode.value = 'text';
  hugeFilePreview.value = false;
  importState.value = {
    loading: false,
    message: '',
    error: `Text qua lon (${pastedText.length} ky tu). Hay luu thanh file .txt va chon file de dung Huge File Mode.`,
  };
}

function handleTextInput() {
  if (hugeFilePreview.value) {
    return;
  }

  sourceMode.value = 'text';
  selectedSourceFile.value = null;
  importedTextSnapshot.value = '';
}

async function handleFileSelection(event) {
  const [file] = Array.from(event.target?.files || []);
  event.target.value = '';

  if (!file) {
    return;
  }

  selectedSourceFile.value = file;
  activeInputTab.value = 'upload';
  sourceMode.value = 'file';
  const isHugeFile = file.size > HUGE_FILE_BYTES;
  hugeFilePreview.value = isHugeFile;

  importState.value = {
    loading: true,
    message: isHugeFile ? `Dang doc preview ${file.name}...` : `Dang doc ${file.name}...`,
    error: '',
  };

  try {
    text.value = isHugeFile
      ? await importTextPreviewFromFile(file, HUGE_PREVIEW_BYTES)
      : await importTextFromFile(file);
    importedTextSnapshot.value = isHugeFile ? '' : text.value;
    importState.value = {
      loading: false,
      message: isHugeFile
        ? `Huge File Mode: chi hien preview, job se xu ly truc tiep file ${file.name}.`
        : `Da nap noi dung tu ${file.name}.`,
      error: '',
    };
  } catch (err) {
    selectedSourceFile.value = null;
    importedTextSnapshot.value = '';
    sourceMode.value = 'text';
    hugeFilePreview.value = false;
    importState.value = {
      loading: false,
      message: '',
      error: err instanceof Error ? err.message : 'Khong the doc file da chon.',
    };
  }
}

function onMessageReceived({ data }) {
  if (data.status === 'progress') {
    progressPhase.value = data.phase || progressPhase.value;
    progressMessage.value = data.message || progressMessage.value;
    progressStats.value = data.stats ? { ...data.stats } : {};

    if (status.value === 'loading') {
      loadingProgress.value = Math.max(loadingProgress.value, data.percent || 0);
    } else {
      processingProgress.value = Math.max(processingProgress.value, data.percent || 0);
    }

    addLog(progressMessage.value, data.phase, data.stats);
    return;
  }

  if (data.status === 'ready') {
    loadingProgress.value = 100;
    progressPhase.value = 'ready';
    progressMessage.value = `Model ${selectedModel.value} da san sang`;
    progressStats.value = {};
    addLog(progressMessage.value, 'ready');
    window.setTimeout(() => {
      status.value = 'ready';
      loadingProgress.value = 0;
    }, 120);
    return;
  }

  if (data.status === 'cancelled') {
    addLog('Tien trinh da duoc worker dung lai.', 'cancelled');
    return;
  }

  if (data.status === 'error') {
    loadingProgress.value = 0;
    processingProgress.value = 0;
    status.value = 'error';
    error.value = data.data;
    addLog(error.value, 'error');
    return;
  }

  if (data.status === 'complete') {
    status.value = 'ready';
    processingProgress.value = 100;
    result.value = data.audio || null;
    progressPhase.value = 'complete';
    progressMessage.value = 'Da tao xong file WAV';
    addLog(progressMessage.value, 'complete', progressStats.value);

    if (audioUrl.value) {
      URL.revokeObjectURL(audioUrl.value);
    }

    audioUrl.value = data.audio ? URL.createObjectURL(data.audio) : '';

    if (audioUrl.value) {
      downloadAudio();
    }
  }
}

function onWorkerError(event) {
  loadingProgress.value = 0;
  processingProgress.value = 0;
  status.value = 'error';
  error.value = event.message || 'Loi worker.';
  addLog(error.value, 'error');
}

onMounted(async () => {
  await checkLocalServer();
  await fetchModels();
});

onUnmounted(() => {
  clearJobPolling();
  clearBatchPolling();
  if (worker.value) {
    worker.value.terminate();
  }
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value);
  }
});
</script>

<template>
  <section class="studio-panel p-5 sm:p-6">
    <div class="space-y-6">
      <div class="space-y-4">
        <div class="rounded-[24px] border border-stone-200/80 bg-stone-50/90 p-4 dark:border-stone-800 dark:bg-stone-900/70">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="space-y-1">
              <p class="mono-ui text-[10px] uppercase tracking-[0.28em] text-stone-500 dark:text-stone-400">Nguon Van Ban</p>
              <p class="text-sm leading-6 text-stone-600 dark:text-stone-300">
                Chon workflow scan thu muc TXT hoac upload file/input van ban nhu cu.
              </p>
              <p class="text-xs text-stone-500 dark:text-stone-400">
                Mode:
                <span class="font-semibold text-teal-700 dark:text-teal-300" v-if="localServerAvailable">Local Node Server</span>
                <span class="font-semibold text-stone-700 dark:text-stone-200" v-else>Browser Worker</span>
                <span v-if="localServerChecking">(dang kiem tra...)</span>
              </p>
            </div>

            <div class="inline-flex rounded-2xl border border-stone-200 bg-white p-1 shadow-[0_2px_8px_rgba(15,23,42,0.04)] dark:border-stone-700 dark:bg-stone-950">
              <button
                class="rounded-xl px-4 py-2 text-sm font-semibold transition"
                :class="isScanTab ? 'bg-stone-950 text-amber-100 dark:bg-orange-500 dark:text-stone-950' : 'text-stone-600 hover:text-stone-950 dark:text-stone-300 dark:hover:text-stone-100'"
                type="button"
                @click="activeInputTab = 'scan'"
              >
                Scan thu muc
              </button>
              <button
                class="rounded-xl px-4 py-2 text-sm font-semibold transition"
                :class="isUploadTab ? 'bg-stone-950 text-amber-100 dark:bg-orange-500 dark:text-stone-950' : 'text-stone-600 hover:text-stone-950 dark:text-stone-300 dark:hover:text-stone-100'"
                type="button"
                @click="activeInputTab = 'upload'"
              >
                Upload file
              </button>
            </div>
          </div>

          <input
            ref="fileInput"
            type="file"
            accept=".txt,.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            class="hidden"
            @change="handleFileSelection"
          />

          <div v-if="isScanTab" class="mt-5 border-t border-stone-200 pt-4 dark:border-stone-800">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="mono-ui text-[10px] uppercase tracking-[0.28em] text-stone-500 dark:text-stone-400">Chon thu muc TXT dau vao</p>
                <p class="mt-1 text-sm text-stone-600 dark:text-stone-300">
                  Nhap duong dan thu muc chua cac file TXT batch.
                </p>
              </div>
            </div>

            <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div class="space-y-3">
                <label class="block">
                  <span class="mono-ui mb-1 block text-[10px] uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">Input directory</span>
                  <input
                    v-model="batchInputDirectory"
                    type="text"
                    spellcheck="false"
                    placeholder="Input"
                    class="min-h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition placeholder:text-stone-400 focus:border-teal-300 focus:shadow-[0_0_0_4px_rgba(45,212,191,0.12)] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500"
                    @input="handleBatchDirectoryInput"
                  />
                </label>

                <label class="block">
                  <span class="mono-ui mb-1 block text-[10px] uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">Output directory</span>
                  <input
                    v-model="batchOutputDirectory"
                    type="text"
                    spellcheck="false"
                    placeholder="Output"
                    class="min-h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition placeholder:text-stone-400 focus:border-orange-300 focus:shadow-[0_0_0_4px_rgba(251,146,60,0.12)] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500"
                    @input="handleBatchDirectoryInput"
                  />
                </label>
              </div>

              <button
                class="inline-flex min-h-12 items-center justify-center gap-2 self-end rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:border-stone-900 hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-teal-300/60 dark:hover:bg-stone-800 dark:hover:text-teal-100"
                type="button"
                :disabled="!canScanBatch"
                @click="scanBatchDirectory"
              >
                <LoaderCircleIcon v-if="batchActionLoading" class="h-4 w-4 animate-spin" />
                <FolderOpenIcon v-else class="h-4 w-4" />
                <span>Scan thu muc</span>
              </button>
            </div>

            <p v-if="batchState?.warning" class="mt-3 text-sm text-amber-700 dark:text-amber-200">
              {{ batchState.warning }}
            </p>
            <p v-if="batchError" class="mt-3 text-sm text-red-700 dark:text-red-300">
              {{ batchError }}
            </p>
          </div>

          <div v-else class="mt-5 space-y-4 border-t border-stone-200 pt-4 dark:border-stone-800">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p class="mono-ui text-[10px] uppercase tracking-[0.28em] text-stone-500 dark:text-stone-400">Upload file / input cu</p>
                <p class="mt-1 text-sm text-stone-600 dark:text-stone-300">
                  Dan text truc tiep hoac nap file <span class="mono-ui">.txt</span>, <span class="mono-ui">.docx</span>, <span class="mono-ui">.pdf</span> toi da 10MB.
                </p>
              </div>

              <button
                class="inline-flex items-center gap-2 rounded-[16px] border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:border-stone-900 hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-teal-300/60 dark:hover:bg-stone-800 dark:hover:text-teal-100"
                type="button"
                :disabled="importState.loading"
                @click="triggerFilePicker"
              >
                <LoaderCircleIcon v-if="importState.loading" class="h-4 w-4 animate-spin" />
                <FileUpIcon v-else class="h-4 w-4" />
                <span>{{ importState.loading ? 'Dang nap file...' : 'Chon file' }}</span>
              </button>
            </div>

            <p v-if="importState.message" class="text-sm text-teal-700 dark:text-teal-300">
              {{ importState.message }}
            </p>
            <p v-else-if="importState.error" class="text-sm text-red-700 dark:text-red-300">
              {{ importState.error }}
            </p>

            <div class="relative">
              <textarea
                v-model="text"
                placeholder="Nhap hoac dan van ban tieng Viet tai day..."
                :readonly="hugeFilePreview"
                @input="handleTextInput"
                @paste="handleTextPaste"
                class="min-h-[220px] w-full resize-y rounded-[26px] border border-stone-200/80 bg-white px-6 py-5 text-[1.05rem] leading-8 text-stone-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(15,23,42,0.04)] transition placeholder:text-stone-400 focus:border-orange-300 focus:shadow-[0_0_0_4px_rgba(251,146,60,0.12)] focus:outline-none dark:border-stone-700 dark:bg-stone-950/80 dark:text-stone-100 dark:placeholder:text-stone-500 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_2px_rgba(0,0,0,0.18)] dark:focus:border-teal-300 dark:focus:shadow-[0_0_0_4px_rgba(45,212,191,0.12)]"
              ></textarea>
              <div v-if="hugeFilePreview" class="pointer-events-none absolute right-4 top-4 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 dark:border-teal-300/30 dark:bg-teal-950/50 dark:text-teal-200">
                Preview only
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <TextStatistics :text="text" />
              <div
                v-if="hugeFilePreview"
                class="rounded-full border border-teal-200/80 bg-teal-50 px-4 py-2.5 text-sm text-teal-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-teal-300/30 dark:bg-teal-950/40 dark:text-teal-200"
              >
                Huge file: <span class="font-semibold">{{ selectedSourceFile?.name }}</span>
                <span class="mono-ui ml-2">{{ Math.round((selectedSourceFile?.size || 0) / 1024 / 1024) }}MB</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div class="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-1 dark:border-stone-800 dark:bg-stone-900/70">
          <ModelSelector
            :models="availableModels"
            :selected-model="selectedModel"
            @model-change="handleModelChange"
          />
        </div>

        <div class="rounded-2xl border border-stone-200/80 bg-stone-50/80 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/70">
          <SpeedControl :speed="speed" @speed-change="speed = $event" />
        </div>
      </div>

      <div v-if="modelsLoading" class="rounded-2xl border border-amber-200/70 bg-amber-50/90 px-4 py-3.5 text-sm text-amber-700 dark:border-amber-300/20 dark:bg-amber-950/35 dark:text-amber-200">
        Dang tai danh sach model local...
      </div>

      <div v-else-if="error" class="rounded-2xl border border-red-200/70 bg-red-50/90 px-4 py-3.5 text-sm text-red-700 dark:border-red-300/20 dark:bg-red-950/35 dark:text-red-200">
        {{ error }}
      </div>

      <div v-if="requiresLocalServer && !localServerAvailable" class="rounded-2xl border border-red-200/70 bg-red-50/90 px-4 py-3.5 text-sm text-red-700 dark:border-red-300/20 dark:bg-red-950/35 dark:text-red-200">
        Huge File Mode can Local Node Server. Hay chay desktop app hoac npm run server:local truoc khi tao audio.
      </div>

      <div v-else-if="status === 'loading'" class="space-y-3 rounded-2xl border border-stone-200/80 bg-stone-100/90 px-4 py-4 dark:border-stone-800 dark:bg-stone-900/80">
        <div class="flex items-center justify-between text-sm text-stone-600 dark:text-stone-300">
          <span>{{ progressMessage || 'Dang nap model' }}</span>
          <span class="mono-ui">{{ Math.round(loadingProgress) }}%</span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          <div
            class="h-full rounded-full bg-gradient-to-r from-orange-400 via-amber-300 to-teal-400 transition-all duration-300 ease-out"
            :style="{ width: `${loadingProgress}%` }"
          ></div>
        </div>
      </div>

      <div v-else-if="status === 'generating'" class="space-y-3 rounded-2xl border border-teal-200/80 bg-teal-50/90 px-4 py-4 dark:border-teal-300/20 dark:bg-teal-950/30">
        <div class="flex items-center justify-between gap-4 text-sm text-teal-900 dark:text-teal-100">
          <span>{{ progressMessage || 'Dang tao audio...' }}</span>
          <span class="mono-ui">{{ Math.round(progressPercent) }}%</span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-950">
          <div
            class="h-full rounded-full bg-gradient-to-r from-teal-500 via-emerald-400 to-orange-400 transition-all duration-300 ease-out"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>
        <div class="grid gap-2 text-xs text-teal-800 sm:grid-cols-2 xl:grid-cols-4 dark:text-teal-100">
          <div class="rounded-2xl bg-white/70 px-3 py-2 dark:bg-stone-950/50">
            <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">Phase</span>
            <span>{{ progressPhase }}</span>
          </div>
          <div class="rounded-2xl bg-white/70 px-3 py-2 dark:bg-stone-950/50">
            <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">Chunks</span>
            <span>{{ progressStats.processedChunks || 0 }}/{{ progressStats.totalChunks || 0 }}</span>
          </div>
          <div class="rounded-2xl bg-white/70 px-3 py-2 dark:bg-stone-950/50">
            <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">Batch</span>
            <span>{{ progressStats.currentBatch || 0 }}/{{ progressStats.totalBatches || 0 }}</span>
          </div>
          <div class="rounded-2xl bg-white/70 px-3 py-2 dark:bg-stone-950/50">
            <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">Audio est.</span>
            <span>{{ progressStats.estimatedAudioSeconds || 0 }}s</span>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-3 sm:flex-row">
        <button
          class="flex min-w-[170px] items-center justify-center gap-2 rounded-[18px] border border-stone-900 bg-stone-950 px-7 py-4 font-semibold text-amber-100 shadow-[0_8px_18px_rgba(28,25,23,0.16)] transition hover:bg-stone-900 hover:text-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-300/30 dark:bg-orange-500 dark:text-stone-950 dark:hover:bg-orange-400"
          :disabled="!canGenerate"
          @click="generateAudio"
        >
          <LoaderCircleIcon v-if="status === 'generating' || batchIsRunning" class="h-5 w-5 animate-spin" />
          <PlayIcon v-else class="h-5 w-5" />
          <span>{{ status === 'generating' || batchIsRunning ? 'Dang tao audio...' : 'Tao audio' }}</span>
        </button>

        <button
          class="flex min-w-[170px] items-center justify-center gap-2 rounded-[18px] border border-teal-200 bg-teal-50 px-7 py-4 font-semibold text-teal-700 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:border-teal-300 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-teal-300/25 dark:bg-teal-950/50 dark:text-teal-200 dark:hover:bg-teal-900/70"
          :disabled="!canResumeLocalJob"
          @click="resumeLocalJob"
        >
          <span>Tiep tuc</span>
        </button>

        <button
          class="flex min-w-[170px] items-center justify-center gap-2 rounded-[18px] border border-amber-200 bg-amber-50 px-7 py-4 font-semibold text-amber-800 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-300/25 dark:bg-amber-950/45 dark:text-amber-200 dark:hover:bg-amber-900/60"
          :disabled="!canRunLatestLocalJob"
          @click="runLatestLocalJob"
        >
          <span>Run tiếp </span>
        </button>

       

        <button
          v-if="canPlay"
          class="flex min-w-[170px] items-center justify-center gap-2 rounded-[18px] border border-stone-300 bg-white px-7 py-4 font-semibold text-stone-700 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:border-stone-900 hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-teal-300/60 dark:hover:bg-stone-800 dark:hover:text-teal-100"
          @click="playAudio"
        >
          <PlayIcon class="h-4 w-4" />
          <span>Play</span>
        </button>

        <button
          class="flex min-w-[170px] items-center justify-center gap-2 rounded-[18px] border border-stone-300 bg-white px-7 py-4 font-semibold text-stone-700 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition hover:border-stone-900 hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-teal-300/60 dark:hover:bg-stone-800 dark:hover:text-teal-100"
          :disabled="!canDownload"
          @click="downloadAudio"
        >
          <DownloadIcon class="h-4 w-4" />
          <span>Tai WAV</span>
        </button>
      </div>

      <div v-if="modelReady" class="rounded-2xl border border-emerald-200/70 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-950/35 dark:text-emerald-200">
        Model san sang: <span class="mono-ui">{{ selectedModel }}</span>
        <span class="ml-3 rounded-full border border-emerald-300/60 px-2 py-1 text-xs uppercase">{{ localServerBackend }}</span>
      </div>

      <div v-if="localServerAvailable && !localServerRuntimeReady" class="rounded-2xl border border-red-200/70 bg-red-50/90 px-4 py-3 text-sm text-red-700 dark:border-red-300/20 dark:bg-red-950/35 dark:text-red-200">
        Runtime <span class="mono-ui uppercase">{{ localServerBackend }}</span> chua san sang.
        <span class="mono-ui">{{ localServerRuntimeError }}</span>
      </div>

      <div v-if="lastGeneration && canDownload" class="rounded-2xl border border-stone-200/80 bg-stone-50 px-4 py-4 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-300">
        Lan tao gan nhat dung model <span class="mono-ui">{{ lastGeneration.model }}</span> voi toc do
        <span class="mono-ui">{{ lastGeneration.speed }}x</span>.
      </div>

      <div v-if="completedJobResult && !canDownload" class="rounded-2xl border border-teal-200/80 bg-teal-50 px-4 py-4 text-sm text-teal-800 dark:border-teal-300/20 dark:bg-teal-950/35 dark:text-teal-100">
        Da luu file audio tai:
        <span class="mono-ui">{{ completedJobResult.audio?.finalAudioPath }}</span>
      </div>

      <div v-if="isScanTab && batchState" class="rounded-[24px] border border-stone-200/80 bg-stone-50/90 p-5 text-stone-800 shadow-[0_10px_24px_rgba(15,23,42,0.07)] dark:border-stone-800 dark:bg-stone-900/80 dark:text-stone-100">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <span class="mono-ui block text-[10px] uppercase tracking-[0.24em] text-teal-700 dark:text-teal-200">Dang xu ly</span>
            <h3 class="mt-1 truncate text-2xl font-semibold leading-tight">{{ batchState.currentFile || 'Khong co' }}</h3>
            <p v-if="batchState?.nextFile" class="mt-2 text-sm text-stone-600 dark:text-stone-300">
              Tiep theo: <span class="font-semibold text-stone-800 dark:text-stone-100">{{ batchState.nextFile }}</span>
            </p>
          </div>

          <span v-if="currentBatchItem" class="mono-ui rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-semibold text-orange-700 shadow-[0_2px_10px_rgba(251,146,60,0.14)] dark:border-orange-300/30 dark:bg-stone-950 dark:text-orange-200">
            {{ Math.round(currentBatchItem.progress?.percent || 0) }}%
          </span>
        </div>

        <div v-if="currentBatchItem" class="space-y-4">
          <div class="h-2 overflow-hidden rounded-full bg-stone-200 shadow-inner dark:bg-stone-800">
            <div
              class="h-full rounded-full bg-gradient-to-r from-orange-500 via-amber-300 to-teal-400 shadow-[0_0_14px_rgba(251,146,60,0.45)] transition-all duration-300 ease-out"
              :style="{ width: `${currentBatchItem.progress?.percent || 0}%` }"
            ></div>
          </div>

          <div class="grid gap-2 text-sm text-stone-600 dark:text-stone-300">
            <p class="truncate">
              <span class="mono-ui text-stone-400 dark:text-stone-500">Input</span>
              <span class="mono-ui ml-2">{{ currentBatchItem.inputPath }}</span>
            </p>
            <p class="truncate">
              <span class="mono-ui text-stone-400 dark:text-stone-500">Output</span>
              <span class="mono-ui ml-2">{{ currentBatchItem.outputDirectory }}</span>
            </p>
          </div>

          <div class="grid gap-3 text-sm text-stone-800 sm:grid-cols-2 xl:grid-cols-5 dark:text-stone-100">
            <div class="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-stone-800 dark:bg-stone-950/70">
              <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">Chunks</span>
              <span class="font-semibold">{{ currentBatchItem.progress?.completedChunks || 0 }}/{{ currentBatchItem.progress?.totalChunks || 0 }}</span>
            </div>
            <div class="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-stone-800 dark:bg-stone-950/70">
              <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">Batch</span>
              <span class="font-semibold">{{ currentBatchItem.progress?.completedSegments || 0 }}/{{ currentBatchItem.progress?.totalSegments || 0 }}</span>
            </div>
            <div class="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-stone-800 dark:bg-stone-950/70">
              <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">Chunk hien tai</span>
              <span class="font-semibold">{{ currentBatchItem.progress?.currentChunkInSegment || 0 }}/{{ currentBatchItem.progress?.totalChunksInSegment || 0 }}</span>
            </div>
            <div class="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-stone-800 dark:bg-stone-950/70">
              <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">Time</span>
              <span class="font-semibold">{{ formatDuration(currentBatchItem.elapsedMs) }}</span>
            </div>
            <div class="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-stone-800 dark:bg-stone-950/70">
              <span class="mono-ui block text-[10px] uppercase tracking-[0.22em] text-stone-500 dark:text-stone-400">Con lai du kien</span>
              <span class="font-semibold">{{ currentBatchRemainingTime }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isScanTab" class="rounded-[24px] border border-stone-200/80 bg-stone-50/80 p-4 dark:border-stone-800 dark:bg-stone-900/70">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="mono-ui text-[10px] uppercase tracking-[0.28em] text-stone-500 dark:text-stone-400">TIEN TRINH XU LY</p>
            <p class="mt-1 text-sm text-stone-600 dark:text-stone-300">
              Theo doi toan bo file TXT trong input directory theo trang thai batch.
            </p>
          </div>
          <div class="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300">
            {{ batchState?.status || 'chua scan' }}
          </div>
        </div>

        <p v-if="batchState?.resumeAfterFolder" class="mb-4 text-sm text-stone-500 dark:text-stone-400">
          Resume sau folder: <span class="mono-ui font-semibold text-stone-700 dark:text-stone-200">{{ batchState.resumeAfterFolder }}</span>
        </p>

        <div class="max-h-[360px] overflow-y-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950/70">
          <div class="grid grid-cols-[minmax(0,1fr)_120px_180px] border-b border-stone-200 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:border-stone-800 dark:text-stone-400">
            <span>File</span>
            <span>Thoi gian</span>
            <span>Trang thai</span>
          </div>

          <div
            v-for="item in batchItems"
            :key="item.inputPath"
            class="grid grid-cols-[minmax(0,1fr)_120px_180px] items-start gap-3 border-b border-stone-100 px-4 py-3 text-sm last:border-b-0 dark:border-stone-900"
          >
            <div class="min-w-0">
              <p class="truncate font-semibold text-stone-800 dark:text-stone-100">{{ item.filename }}</p>
              <p v-if="item.status === 'PROCESSING'" class="mt-1 text-xs text-orange-600 dark:text-orange-200">
                {{ item.stage || 'processing' }} - {{ Math.round(item.progress?.percent || 0) }}%
              </p>
              <p v-if="item.error" class="mt-1 text-xs text-red-600 dark:text-red-300">{{ item.error }}</p>
            </div>
            <span class="mono-ui text-sm text-stone-600 dark:text-stone-300">
              {{ item.elapsedMs ? formatDuration(item.elapsedMs) : '-' }}
            </span>
            <span
              class="inline-flex justify-center rounded-full border px-3 py-1 text-xs font-semibold"
              :class="getBatchStatusMeta(item.status).className"
            >
              {{ getBatchStatusMeta(item.status).label }}
            </span>
          </div>

          <div v-if="!batchItems.length" class="px-4 py-8 text-center text-sm text-stone-500 dark:text-stone-400">
            Chua co danh sach TXT. Hay nhap input directory va scan truoc khi bat dau.
          </div>
        </div>
      </div>

      <audio v-if="audioUrl" id="tts-preview" :src="audioUrl" class="hidden"></audio>
    </div>
  </section>
</template>
