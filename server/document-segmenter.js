function estimateWordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function splitLongParagraph(paragraph, maxChars) {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }

  const sentences = paragraph.match(/[^.!?\n]+[.!?]*/g)?.map((item) => item.trim()).filter(Boolean) || [paragraph];
  const parts = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      parts.push(current);
      current = '';
    }

    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }

    const words = sentence.split(/\s+/);
    let wordBuffer = '';
    for (const word of words) {
      const wordCandidate = wordBuffer ? `${wordBuffer} ${word}` : word;
      if (wordCandidate.length <= maxChars) {
        wordBuffer = wordCandidate;
      } else {
        if (wordBuffer) {
          parts.push(wordBuffer);
        }
        wordBuffer = word;
      }
    }

    if (wordBuffer) {
      current = wordBuffer;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

export function segmentDocumentText(text, options = {}) {
  const {
    maxChars = 6000,
    minChars = 1500,
    targetChars = 4500,
  } = options;

  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongParagraph(paragraph, maxChars));

  const segments = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;

    if ((candidate.length <= targetChars || buffer.length < minChars) && candidate.length <= maxChars) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      segments.push(buffer);
    }
    buffer = paragraph;
  }

  if (buffer) {
    segments.push(buffer);
  }

  return segments.map((segment, index) => ({
    index,
    text: segment,
    chars: segment.length,
    words: estimateWordCount(segment),
  }));
}
