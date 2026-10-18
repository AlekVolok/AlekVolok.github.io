/**
 * Pure helpers for the Spreken exam: building the 16-question exam, the webhook
 * payload, parsing the reply and rendering the report. No DOM access, so they
 * can run in node.
 *
 * The LLM call lives in n8n (n8n/spreken-evaluate.workflow.json), so the
 * OpenRouter key never reaches the browser.
 */

/**
 * Picks `count` random items from a pool without repeats.
 * @template T
 * @param {T[]} pool
 * @param {number} count
 * @param {() => number} [random]
 * @returns {T[]}
 */
export function pickRandom(pool, count, random = Math.random) {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

/**
 * Builds the exam from the config blocks and the two pools.
 * Audio blocks draw from the audio pool. Picture blocks draw from slides with exactly
 * `pictureCount` pictures whose question matches the block's `include` regex and not its `exclude` regex.
 * @param {{ blocks: object[] }} config
 * @param {object[]} audioPool
 * @param {object[]} picturePool
 * @param {() => number} [random]
 * @returns {object[]} questions in exam order, each with `blockId`, `blockTitle`, `instruction`, `seconds`
 */
export function buildExam(config, audioPool, picturePool, random = Math.random) {
  return config.blocks.flatMap((block) => {
    const include = block.include ? new RegExp(block.include, 'i') : null;
    const exclude = block.exclude ? new RegExp(block.exclude, 'i') : null;
    const pool = block.source === 'audio'
      ? audioPool
      : picturePool.filter((slide) => slide.pictures.length === block.pictureCount
        && (!include || include.test(slide.question))
        && (!exclude || !exclude.test(slide.question)));
    return pickRandom(pool, block.count, random).map((item) => ({
      ...item,
      blockId: block.id,
      blockTitle: block.title,
      instruction: block.instruction,
      seconds: block.seconds,
      pictureCount: block.source === 'audio' ? 0 : block.pictureCount,
    }));
  });
}

/**
 * Encodes mono or multi-channel float samples as a 16-bit PCM WAV file.
 * OpenRouter accepts WAV for audio input; browsers record webm or mp4 instead.
 * @param {Float32Array[]} channels one array per channel, values between -1 and 1
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
export function encodeWav(channels, sampleRate) {
  const channelCount = channels.length;
  const frameCount = channels[0].length;
  const dataSize = frameCount * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/**
 * @param {object} item one exam question (from buildExam)
 * @param {{ audioBase64: string, mimeType: string, transcriptHint: string }} recording
 */
export function buildEvaluationPayload(item, recording) {
  return {
    questionId: item.id,
    blockId: item.blockId,
    instruction: item.instruction,
    question: item.question,
    keyPoints: item.keyPoints || [],
    pictureCount: item.pictureCount,
    pictureDescription: item.pictureDescription || '',
    referenceAnswer: item.modelAnswer || '',
    language: 'nl',
    audio: { base64: recording.audioBase64, mimeType: recording.mimeType },
    transcriptHint: recording.transcriptHint,
  };
}

/**
 * Parses the webhook reply. The workflow returns the evaluation object directly;
 * JSON wrapped in a code fence or prose is tolerated.
 * Throws when the reply does not contain a usable object.
 */
export function parseEvaluation(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Geen JSON in het antwoord van de webhook.');
  const raw = JSON.parse(text.slice(start, end + 1));
  const asList = (value) => (Array.isArray(value) ? value.map(String) : []);
  return {
    transcript: String(raw.transcript || ''),
    score: Math.max(0, Math.min(10, Math.round(Number(raw.score) || 0))),
    completed: Boolean(raw.completed),
    strengths: asList(raw.strengths),
    missingPoints: asList(raw.missingPoints),
    mistakes: Array.isArray(raw.mistakes)
      ? raw.mistakes.map((mistake) => ({
          original: String(mistake.original || ''),
          correction: String(mistake.correction || ''),
          explanation: String(mistake.explanation || ''),
        }))
      : [],
    feedback: String(raw.feedback || ''),
  };
}

/**
 * @param {{ item: object, transcript: string, result: object | null, error: string }[]} entries
 * @param {Date} [date]
 * @returns {string} Markdown report
 */
export function buildReportMarkdown(entries, date = new Date()) {
  const lines = ['# Spreken A2 — rapport', '', `Datum: ${date.toISOString().slice(0, 10)}`, ''];
  const scored = entries.filter((entry) => entry.result);
  if (scored.length) {
    const average = scored.reduce((sum, entry) => sum + entry.result.score, 0) / scored.length;
    lines.push(`Gemiddelde score: ${average.toFixed(1)} / 10`, '');
  }

  entries.forEach((entry, index) => {
    const { item, result } = entry;
    lines.push(`## ${index + 1}. ${item.blockTitle}`, '', `Vraag: ${item.question}`, '');
    if (result) lines.push(`Score: ${result.score} / 10`, '');
    if (entry.error) lines.push(`Let op: ${entry.error}`, '');

    lines.push('### Transcript', '');
    const transcript = (result?.transcript || entry.transcript || '').trim();
    lines.push(transcript ? `> ${transcript}` : '> (geen antwoord opgenomen)', '');

    if (item.modelAnswer) lines.push('### Voorbeeldantwoord', '', `> ${item.modelAnswer}`, '');

    if (result) {
      if (result.mistakes.length) {
        lines.push('### Fouten om te leren', '');
        result.mistakes.forEach((mistake) => {
          lines.push(`- "${mistake.original}" → **${mistake.correction}**`);
          if (mistake.explanation) lines.push(`  ${mistake.explanation}`);
        });
        lines.push('');
      }
      if (result.missingPoints.length) {
        lines.push('### Ontbrekende punten', '');
        result.missingPoints.forEach((point) => lines.push(`- ${point}`));
        lines.push('');
      }
      if (result.feedback) lines.push('### Feedback', '', result.feedback, '');
    }
  });

  return lines.join('\n');
}
