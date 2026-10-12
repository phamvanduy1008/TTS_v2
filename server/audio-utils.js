import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

export function float32ToInt16Buffer(float32Array) {
  const buffer = Buffer.allocUnsafe(float32Array.length * 2);
  for (let i = 0; i < float32Array.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    buffer.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, i * 2);
  }
  return buffer;
}

export function createWavHeader(dataBytes, sampleRate, numChannels = 1, bitsPerSample = 16) {
  if (dataBytes > 0xffff_ffff - 36) {
    throw new Error('WAV data qua lon cho dinh dang RIFF 32-bit. Hay xuat RF64 hoac chia thanh part nho hon.');
  }

  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);

  return buffer;
}

export function createRf64Header(dataBytes, sampleRate, numChannels = 1, bitsPerSample = 16) {
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const headerBytes = 80;
  const buffer = Buffer.alloc(headerBytes);
  const riffSize = BigInt(headerBytes - 8) + BigInt(dataBytes);
  const sampleCount = BigInt(Math.floor(dataBytes / blockAlign));

  buffer.write('RF64', 0);
  buffer.writeUInt32LE(0xffff_ffff, 4);
  buffer.write('WAVE', 8);

  buffer.write('ds64', 12);
  buffer.writeUInt32LE(28, 16);
  buffer.writeBigUInt64LE(riffSize, 20);
  buffer.writeBigUInt64LE(BigInt(dataBytes), 28);
  buffer.writeBigUInt64LE(sampleCount, 36);
  buffer.writeUInt32LE(0, 44);

  buffer.write('fmt ', 48);
  buffer.writeUInt32LE(16, 52);
  buffer.writeUInt16LE(1, 56);
  buffer.writeUInt16LE(numChannels, 58);
  buffer.writeUInt32LE(sampleRate, 60);
  buffer.writeUInt32LE(byteRate, 64);
  buffer.writeUInt16LE(blockAlign, 68);
  buffer.writeUInt16LE(bitsPerSample, 70);

  buffer.write('data', 72);
  buffer.writeUInt32LE(0xffff_ffff, 76);

  return buffer;
}

export async function writeWavFromFloat32(filePath, float32Array, sampleRate) {
  const pcmData = float32ToInt16Buffer(float32Array);
  const header = createWavHeader(pcmData.byteLength, sampleRate);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.concat([header, pcmData]));
}

export async function mergeWavFiles(inputPaths, outputPath, sampleRate) {
  await mkdir(path.dirname(outputPath), { recursive: true });

  let totalDataBytes = 0;
  for (const inputPath of inputPaths) {
    const fileStats = await stat(inputPath);
    totalDataBytes += Math.max(0, fileStats.size - 44);
  }

  const output = createWriteStream(outputPath);
  output.setMaxListeners(Math.max(output.getMaxListeners(), inputPaths.length + 2));
  const header = totalDataBytes > 0xffff_ffff - 36
    ? createRf64Header(totalDataBytes, sampleRate)
    : createWavHeader(totalDataBytes, sampleRate);
  output.write(header);

  for (const inputPath of inputPaths) {
    await pipeWavData(inputPath, output);
  }

  output.end();
  await once(output, 'finish');

  return {
    dataBytes: totalDataBytes,
    format: header.subarray(0, 4).toString('ascii') === 'RF64' ? 'rf64' : 'wav',
    path: outputPath,
  };
}

export async function mergeWavFilesInParts(inputPaths, outputDirectory, {
  baseName = 'part',
  maxDataBytes = 512 * 1024 * 1024,
  sampleRate,
} = {}) {
  await mkdir(outputDirectory, { recursive: true });

  const parts = [];
  let currentPaths = [];
  let currentBytes = 0;

  async function flushPart() {
    if (!currentPaths.length) {
      return;
    }

    const partIndex = parts.length + 1;
    const outputPath = path.join(outputDirectory, `${baseName}-${String(partIndex).padStart(4, '0')}.wav`);
    await mergeWavFiles(currentPaths, outputPath, sampleRate);
    parts.push({
      dataBytes: currentBytes,
      path: outputPath,
      segmentCount: currentPaths.length,
    });
    currentPaths = [];
    currentBytes = 0;
  }

  for (const inputPath of inputPaths) {
    const fileStats = await stat(inputPath);
    const dataBytes = Math.max(0, fileStats.size - 44);

    if (currentPaths.length && currentBytes + dataBytes > maxDataBytes) {
      await flushPart();
    }

    currentPaths.push(inputPath);
    currentBytes += dataBytes;
  }

  await flushPart();
  return parts;
}

export async function readWavSampleRate(filePath) {
  const buffer = await readFile(filePath);
  return buffer.readUInt32LE(24);
}

async function pipeWavData(inputPath, output) {
  await new Promise((resolve, reject) => {
    const input = createReadStream(inputPath, { start: 44 });
    input.on('error', reject);
    output.on('error', reject);
    input.on('end', resolve);
    input.pipe(output, { end: false });
  });
}

export function mergeFloat32Chunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

export function mergeFloat32ChunksWithPauses(chunks, sampleRate, options = {}) {
  const {
    fadeSeconds = 0.008,
    includeTrailingPause = false,
  } = options;
  const normalizedChunks = chunks
    .map((chunk) => {
      if (chunk && typeof chunk === 'object' && chunk.samples) {
        return {
          samples: chunk.samples,
          pause: chunk.pause || chunk.pauseType || '',
          text: chunk.text || '',
        };
      }

      return {
        pause: '',
        samples: chunk,
        text: '',
      };
    })
    .filter(({ samples }) => samples?.length);

  const pauseLengths = normalizedChunks.map((chunk, index) => {
    if (!includeTrailingPause && index === normalizedChunks.length - 1) {
      return 0;
    }

    return Math.round(sampleRate * getPauseSecondsForText(chunk));
  });
  const totalLength = normalizedChunks.reduce((sum, { samples }, index) => (
    sum + samples.length + pauseLengths[index]
  ), 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (let index = 0; index < normalizedChunks.length; index += 1) {
    const samples = applyEdgeFade(normalizedChunks[index].samples, sampleRate, fadeSeconds);
    merged.set(samples, offset);
    offset += samples.length + pauseLengths[index];
  }

  return merged;
}

function applyEdgeFade(samples, sampleRate, fadeSeconds) {
  const faded = new Float32Array(samples);
  const fadeSamples = Math.min(
    Math.floor(sampleRate * fadeSeconds),
    Math.floor(faded.length / 2),
  );

  if (fadeSamples <= 1) {
    return faded;
  }

  for (let index = 0; index < fadeSamples; index += 1) {
    const gain = index / fadeSamples;
    faded[index] *= gain;
    faded[faded.length - 1 - index] *= gain;
  }

  return faded;
}

function getPauseSecondsForText(chunk) {
  const value = typeof chunk === 'string'
    ? chunk.trim()
    : String(chunk?.text || '').trim();
  const pause = typeof chunk === 'object' ? chunk.pause : '';

  if (pause === 'ellipsis' || /…|\.\.\.\s*$/.test(value)) {
    return 0.48;
  }

  if (pause === 'paragraph') {
    return 0.36;
  }

  if (pause === 'expressive') {
    return 0.28;
  }

  if (pause === 'short-sentence') {
    return 0.13;
  }

  if (pause === 'sentence') {
    return 0.2;
  }

  if (pause === 'clause') {
    return 0.09;
  }

  if (!value) {
    return 0.07;
  }

  if (/[?!]\s*$/.test(value)) {
    return 0.28;
  }

  if (/[.?!]\s*$/.test(value)) {
    return value.length <= 34 ? 0.13 : 0.2;
  }

  if (/[,;:]\s*$/.test(value)) {
    return 0.09;
  }

  return 0.07;
}
