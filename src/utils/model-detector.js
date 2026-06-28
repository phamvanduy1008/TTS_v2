import { MODEL_MANIFEST_URL } from '../config.js';

export async function fetchAvailableModels() {
  const response = await fetch(MODEL_MANIFEST_URL, { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error(`Khong the doc danh sach model. HTTP ${response.status}`);
  }

  const data = await response.json();
  const models = Array.isArray(data?.models) ? data.models : [];

  return models.filter((model) => typeof model === 'string' && model.trim().length > 0);
}
