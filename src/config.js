export const MODEL_MANIFEST_URL = `${import.meta.env.BASE_URL}tts-model/vi/models.json`;
export const DEFAULT_MODEL = 'ngochuyen';

export function getVietnameseModelAssetPaths(modelName) {
  const encodedModel = encodeURIComponent(modelName);
  const base = `${import.meta.env.BASE_URL}tts-model/vi/`;

  return {
    modelPath: `${base}${encodedModel}.onnx`,
    configPath: `${base}${encodedModel}.onnx.json`,
  };
}
