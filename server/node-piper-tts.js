import { readFile } from 'node:fs/promises';

import { phonemize } from 'phonemizer';

import { loadNodeConfig } from './node-text-resources.js';

const CUDA_BACKENDS = new Set(['cuda']);
const DML_BACKENDS = new Set(['dml', 'directml']);
const GPU_BACKENDS = new Set(['gpu']);

export function getRequestedInferenceBackend() {
  return String(process.env.TTS_INFERENCE_BACKEND || 'cpu').trim().toLowerCase() || 'cpu';
}

function normalizeInferenceBackend(value) {
  if (GPU_BACKENDS.has(value)) {
    return process.platform === 'win32' ? 'dml' : 'cuda';
  }

  if (DML_BACKENDS.has(value)) {
    return 'dml';
  }

  if (CUDA_BACKENDS.has(value)) {
    return 'cuda';
  }

  return 'cpu';
}

async function loadOrtRuntime() {
  const requestedBackend = normalizeInferenceBackend(getRequestedInferenceBackend());

  if (requestedBackend === 'dml') {
    const ort = await import('onnxruntime-node');
    return {
      backend: 'dml',
      executionProviders: ['dml', 'cpu'],
      ort,
    };
  }

  if (requestedBackend === 'cuda') {
    try {
      const ort = await import('onnxruntime-node-gpu');
      return {
        backend: 'cuda',
        executionProviders: ['cuda'],
        ort,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        'TTS_INFERENCE_BACKEND=cuda requires the onnxruntime-node-gpu package and a working NVIDIA CUDA setup. '
        + `Install/configure the GPU runtime first, or run this instance with TTS_INFERENCE_BACKEND=cpu. Details: ${message}`,
      );
    }
  }

  const ort = await import('onnxruntime-node');
  return {
    backend: 'cpu',
    executionProviders: ['cpu'],
    ort,
  };
}

export async function getInferenceRuntimeStatus() {
  const requestedBackend = normalizeInferenceBackend(getRequestedInferenceBackend());

  if (requestedBackend === 'cpu') {
    return {
      backend: 'cpu',
      error: null,
      ready: true,
    };
  }

  if (requestedBackend === 'dml') {
    try {
      await import('onnxruntime-node');
      return {
        backend: 'dml',
        error: null,
        ready: true,
      };
    } catch (error) {
      return {
        backend: 'dml',
        error: error instanceof Error ? error.message : String(error),
        ready: false,
      };
    }
  }

  try {
    await import('onnxruntime-node-gpu');
    return {
      backend: 'cuda',
      error: null,
      ready: true,
    };
  } catch (error) {
    return {
      backend: 'cuda',
      error: error instanceof Error ? error.message : String(error),
      ready: false,
    };
  }
}

function mergePhonemizerOutputPreservePunct(text, phonemes) {
  if (typeof phonemes === 'string') {
    return phonemes;
  }

  if (phonemes && typeof phonemes === 'object' && !Array.isArray(phonemes)) {
    const maybeText = phonemes.text || phonemes.phonemes;
    return typeof maybeText === 'string' ? maybeText : String(maybeText ?? phonemes);
  }

  if (!Array.isArray(phonemes)) {
    return String(phonemes ?? '');
  }

  const separators = Array.from(text.matchAll(/[,;:]/g), (match) => match[0]);
  let result = '';
  let separatorIndex = 0;

  for (const rawPart of phonemes) {
    const part = String(rawPart || '').trim();
    if (!part) {
      continue;
    }

    if (result) {
      result += `${separators[separatorIndex] || ','} `;
      separatorIndex += 1;
    }

    result += part;
  }

  return result;
}

function extractPhonemeId(value) {
  if (Array.isArray(value)) {
    return Number(value[0]);
  }
  return Number(value);
}

export class NodePiperTTS {
  constructor(voiceConfig, session, modelName, ort, inferenceBackend) {
    this.voiceConfig = voiceConfig;
    this.session = session;
    this.modelName = modelName;
    this.ort = ort;
    this.inferenceBackend = inferenceBackend;
  }

  static async fromFiles({ modelName, modelPath, configPath }) {
    const configBuffer = await readFile(configPath, 'utf8');

    const voiceConfig = JSON.parse(configBuffer);
    const runtime = await loadOrtRuntime();
    const session = await runtime.ort.InferenceSession.create(modelPath, {
      executionProviders: runtime.executionProviders,
    });

    return new NodePiperTTS(voiceConfig, session, modelName, runtime.ort, runtime.backend);
  }

  async dispose() {
    if (typeof this.session?.release === 'function') {
      await this.session.release();
    }
    this.session = null;
  }

  async textToPhonemes(text) {
    const config = await loadNodeConfig();

    if (this.voiceConfig.phoneme_type === 'text') {
      return [Array.from(text.normalize('NFD'))];
    }

    const voice = this.voiceConfig.espeak?.voice || 'en-us';
    const phonemes = await phonemize(text, voice);
    const mergedPhonemeText = mergePhonemizerOutputPreservePunct(text, phonemes);
    const cleanedPhonemeText = mergedPhonemeText
      .replace(/\(en\)/g, '')
      .replace(/\(vi\)/g, '');

    if (config.debug === true) {
      console.log(`[NODE PHONEMIZER] ${JSON.stringify(cleanedPhonemeText)}`);
    }

    const sentence = cleanedPhonemeText.trim();
    return sentence ? [Array.from(sentence.normalize('NFD'))] : [];
  }

  phonemesToIds(textPhonemes) {
    const idMap = this.voiceConfig.phoneme_id_map || {};
    const BOS = '^';
    const EOS = '$';
    const PAD = '_';

    const phonemeIds = [];
    for (const sentencePhonemes of textPhonemes) {
      phonemeIds.push(extractPhonemeId(idMap[BOS]));
      phonemeIds.push(extractPhonemeId(idMap[PAD]));

      for (const phoneme of sentencePhonemes) {
        if (phoneme in idMap) {
          phonemeIds.push(extractPhonemeId(idMap[phoneme]));
          phonemeIds.push(extractPhonemeId(idMap[PAD]));
        }
      }

      phonemeIds.push(extractPhonemeId(idMap[EOS]));
    }

    return phonemeIds;
  }

  async synthesizeChunk(text, options = {}) {
    const {
      speakerId = 0,
      lengthScale = this.voiceConfig.inference?.length_scale || 1.0,
      noiseScale = this.voiceConfig.inference?.noise_scale || 0.667,
      noiseWScale = this.voiceConfig.inference?.noise_w || 0.8,
    } = options;

    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
      return {
        reason: 'empty-text',
        sampleRate: this.voiceConfig.audio.sample_rate,
        samples: null,
        skipped: true,
      };
    }

    const textPhonemes = await this.textToPhonemes(normalizedText);
    if (!Array.isArray(textPhonemes) || textPhonemes.length === 0) {
      return {
        reason: 'empty-phonemes',
        sampleRate: this.voiceConfig.audio.sample_rate,
        samples: null,
        skipped: true,
      };
    }

    const phonemeIds = this.phonemesToIds(textPhonemes);
    if (!Array.isArray(phonemeIds) || phonemeIds.length === 0) {
      return {
        reason: 'empty-phoneme-ids',
        sampleRate: this.voiceConfig.audio.sample_rate,
        samples: null,
        skipped: true,
      };
    }

    const inputs = {
      input: new this.ort.Tensor('int64', BigInt64Array.from(phonemeIds.map((id) => BigInt(id))), [1, phonemeIds.length]),
      input_lengths: new this.ort.Tensor('int64', BigInt64Array.from([BigInt(phonemeIds.length)]), [1]),
      scales: new this.ort.Tensor('float32', Float32Array.from([noiseScale, lengthScale, noiseWScale]), [3]),
    };

    if (this.voiceConfig.num_speakers > 1) {
      inputs.sid = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(speakerId)]), [1]);
    }

    let results = null;
    try {
      results = await this.session.run(inputs);
      const output = results.output;
      const samples = new Float32Array(output.data);
      return {
        reason: null,
        sampleRate: this.voiceConfig.audio.sample_rate,
        samples,
        skipped: false,
      };
    } finally {
      Object.values(inputs).forEach((tensor) => {
        if (typeof tensor?.dispose === 'function') {
          tensor.dispose();
        }
      });
      Object.values(results || {}).forEach((tensor) => {
        if (typeof tensor?.dispose === 'function') {
          tensor.dispose();
        }
      });
    }
  }
}
