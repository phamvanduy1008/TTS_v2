import path from 'node:path';

import { projectRoot } from './node-text-resources.js';

export const DEFAULT_LOCAL_MODEL = 'ngochuyen';

export function getVietnameseModelPaths(modelName = DEFAULT_LOCAL_MODEL) {
  const baseDir = path.join(projectRoot, 'public', 'tts-model', 'vi');
  const model = `${modelName}.onnx`;
  const config = `${modelName}.onnx.json`;

  return {
    baseDir,
    configPath: path.join(baseDir, config),
    modelName,
    modelPath: path.join(baseDir, model),
  };
}
