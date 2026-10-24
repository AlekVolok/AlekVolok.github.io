/**
 * Pure helpers for the Spreken exam: building the 16-question exam, the webhook
 * payload, parsing the reply and rendering the report. No DOM access, so they
 * can run in node.
 *
 * The LLM call lives in n8n (n8n/spreken-evaluate.workflow.json), so the
 * OpenRouter key never reaches the browser.
 */

import { Mp3Encoder } from '@breezystack/lamejs';

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
      title: item.title || item.question.split(/[.?!]/)[0].slice(0, 60),
      blockId: block.id,
      blockTitle: block.title,
      instruction: block.instruction,
      seconds: block.seconds,
      pictureCount: block.source === 'audio' ? 0 : block.pictureCount,
    }));
  });
}

/**
 * Encodes mono float samples (-1..1) as MP3. The n8n server rejects request bodies
 * over about 1 MB, and a 90-second WAV is several MB; 32 kbps MP3 keeps it near 360 KB.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {number} [kbps]
 * @returns {Uint8Array}
 */
export function encodeMp3(samples, sampleRate, kbps = 32) {
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const chunks = [];
  for (let start = 0; start < pcm.length; start += 1152) {
    const chunk = encoder.encodeBuffer(pcm.subarray(start, start + 1152));
    if (chunk.length) chunks.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(tail);
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
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
    images: recording.images || [],
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
  if (!raw.error && (!['answered', 'incorrect', 'no-answer'].includes(raw.verdict)
    || !Number.isFinite(Number(raw.score)) || raw.score === null || raw.score === '')) {
    throw new Error('Onvolledige beoordeling ontvangen. Probeer opnieuw te beoordelen.');
  }
  const asList = (value) => (Array.isArray(value) ? value.map(String) : []);
  const verdicts = ['answered', 'incorrect', 'no-answer'];
  const transcript = String(raw.transcript || '');
  let verdict = verdicts.includes(raw.verdict) ? raw.verdict : 'incorrect';
  // An off-topic answer is still an answer: "no-answer" is only for silence.
  if (verdict === 'no-answer' && transcript.trim()) verdict = 'incorrect';
  return {
    error: String(raw.error || ''),
    transcript,
    verdict,
    proposedAnswer: String(raw.proposedAnswer || ''),
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
 * Estimates whether the candidate would pass, from the number of answers judged "answered".
 * @param {{ result: object | null }[]} entries
 * @param {{ answeredRequired: number, note: string }} passRule
 * @returns {{ answered: number, total: number, required: number, pending: number, passed: boolean | null, note: string }}
 */
export function assessPass(entries, passRule) {
  const answered = entries.filter((entry) => entry.result && !entry.result.error && entry.result.verdict === 'answered').length;
  const pending = entries.filter((entry) => !entry.result || entry.result.error).length;
  return {
    answered,
    total: entries.length,
    required: passRule.answeredRequired,
    pending,
    passed: pending ? null : answered >= passRule.answeredRequired,
    note: passRule.note,
  };
}

export const verdictLabels = {
  answered: 'goed beantwoord',
  incorrect: 'niet goed genoeg — zie de verbeterpunten',
  'no-answer': 'geen antwoord — zie het voorstel',
};

/**
 * @param {{ item: object, transcript: string, result: object | null, error: string }[]} entries
 * @param {Date} [date]
 * @returns {string} Markdown report
 */
export function buildReportMarkdown(entries, passRule, date = new Date()) {
  const lines = ['# Spreken A2 — rapport', '', `Datum: ${date.toISOString().slice(0, 10)}`, ''];
  const scored = entries.filter((entry) => entry.result && !entry.result.error);
  if (scored.length) {
    const average = scored.reduce((sum, entry) => sum + entry.result.score, 0) / scored.length;
    lines.push(`Gemiddelde score: ${average.toFixed(1)} / 10`, '');
  }
  const pass = assessPass(entries, passRule);
  lines.push(
    `## Inschatting slagen`,
    '',
    `${pass.pending ? `Nog geen volledige uitslag (${pass.pending} niet beoordeeld)` : (pass.passed ? 'Mogelijk geslaagd' : 'Mogelijk niet geslaagd')}: ${pass.answered} van ${pass.total} antwoorden goed (nodig: ${pass.required}).`,
    '',
    `> ${pass.note}`,
    '',
  );

  entries.forEach((entry, index) => {
    const { item, result } = entry;
    lines.push(`## ${index + 1}. ${item.blockTitle}`, '', `Vraag: ${item.question}`, '');
    if (result) lines.push(`Score: ${result.score} / 10 — ${verdictLabels[result.verdict]}`, '');
    if (entry.error) lines.push(`Let op: ${entry.error}`, '');

    lines.push('### Transcript', '');
    const transcript = (result?.transcript || entry.transcript || '').trim();
    lines.push(transcript ? `> ${transcript}` : '> (geen antwoord opgenomen)', '');

    if (result?.proposedAnswer) lines.push('### Voorstel voor het antwoord', '', `> ${result.proposedAnswer}`, '');
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
