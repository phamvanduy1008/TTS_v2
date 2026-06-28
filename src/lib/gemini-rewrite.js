import { DEFAULT_GEMINI_REWRITE_CONTEXT, GEMINI_REWRITE_API_URL } from '../config.js';

export async function rewriteTextWithAI(text, context = DEFAULT_GEMINI_REWRITE_CONTEXT) {
  const response = await fetch(GEMINI_REWRITE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      context,
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    throw new Error(data?.error || `Khong the sua text bang AI. HTTP ${response.status}`);
  }

  if (!data?.text || typeof data.text !== 'string') {
    throw new Error('AI khong tra ve text hop le.');
  }

  return {
    text: data.text.trim(),
    provider: data?.provider || 'unknown',
  };
}
