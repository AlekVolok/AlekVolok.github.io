import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as helpers from '../src/lib/spreken.js';
import { createRecording } from '../src/lib/spreken-recording.js';
import { assessPass, buildReportMarkdown, parseEvaluation } from '../src/lib/spreken.js';

function microphone() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
}

class Recorder {
  static instances = [];
  mimeType = 'audio/webm';
  state = 'inactive';
  constructor() { Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
  finish(text) {
    this.ondataavailable({ data: new Blob([text]) });
    this.onstop();
  }
}

test('stop waits for final audio event, even beyond the old 400 ms delay', async () => {
  const stream = microphone();
  const recording = createRecording(stream, Recorder);
  let saved = false;
  const done = recording.stop().then(result => { saved = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(saved, false);
  assert.equal(stream.track.stopped, false);
  Recorder.instances.at(-1).finish('final audio');
  assert.equal(await (await done).blob.text(), 'final audio');
  assert.equal(stream.track.stopped, true);
});

test('overlapping stop events keep each recording and microphone separate', async () => {
  const streamA = microphone();
  const a = createRecording(streamA, Recorder);
  const recorderA = Recorder.instances.at(-1);
  const doneA = a.stop();
  const streamB = microphone();
  const b = createRecording(streamB, Recorder);
  const recorderB = Recorder.instances.at(-1);
  recorderA.finish('first');
  assert.equal(await (await doneA).blob.text(), 'first');
  assert.equal(streamB.track.stopped, false);
  const doneB = b.stop();
  recorderB.finish('second');
  assert.equal(await (await doneB).blob.text(), 'second');
});

test('empty recording and recorder errors are technical failures', async () => {
  const empty = createRecording(microphone(), Recorder);
  empty.stop();
  Recorder.instances.at(-1).finish('');
  assert.equal((await empty.done).blob, null);
  assert.match((await empty.done).error.message, /Geen audio/);
  const failed = createRecording(microphone(), Recorder);
  const recorder = Recorder.instances.at(-1);
  recorder.onerror();
  failed.stop();
  recorder.finish('partial');
  assert.equal((await failed.done).blob, null);
  assert.ok((await failed.done).error);
});

test('recorder initialization failure releases the microphone', () => {
  const stream = microphone();
  class Unsupported { constructor() { throw new Error('unsupported'); } }
  assert.throws(() => createRecording(stream, Unsupported));
  assert.equal(stream.track.stopped, true);
});

test('technical errors cannot produce a failed exam or lower the average', () => {
  const entries = [
    { item: {}, result: { verdict: 'answered', score: 8 }, transcript: '' },
    { item: {}, result: null, error: 'transcription failed', transcript: '' },
  ];
  const rule = { answeredRequired: 2, note: 'practice estimate' };
  const pass = assessPass(entries, rule);
  assert.equal(pass.pending, 1);
  assert.equal(pass.passed, null);
  entries[0].result.mistakes = [];
  entries[0].result.missingPoints = [];
  const report = buildReportMarkdown(entries, rule);
  assert.match(report, /8.0 \/ 10/);
  assert.match(report, /Nog geen volledige uitslag/);
  assert.doesNotMatch(report, /Mogelijk niet geslaagd/);
  assert.equal(assessPass([{ result: { verdict: 'no-answer', score: 0 } }], rule).passed, false);
});

test('malformed grading replies are rejected instead of becoming zero scores', () => {
  assert.throws(() => parseEvaluation('{}'));
  assert.throws(() => parseEvaluation('{"verdict":"answered","score":null}'));
  assert.equal(parseEvaluation('{"error":"Whisper failed"}').error, 'Whisper failed');
});

const workflow = JSON.parse(fs.readFileSync(new URL('../n8n/spreken-evaluate.workflow.json', import.meta.url)));
function runNode(name, input, outputs) {
  const code = workflow.nodes.find(node => node.name === name).parameters.jsCode;
  return new Function('$input', '$', code)(
    { first: () => ({ json: input }) },
    key => ({ first: () => ({ json: outputs[key] }) }),
  )[0].json;
}

test('workflow distinguishes failed transcription from absent input', () => {
  for (const reply of [{ error: 'quota' }, { text: '' }]) {
    const transcript = runNode('Set transcript', reply, {
      'Build request': { hasAudio: true, hint: '', contextText: 'test' },
    });
    assert.ok(transcript.transcriptionError);
    const parsed = runNode('Parse evaluation', {}, { 'Set transcript': transcript });
    assert.ok(parsed.error);
    assert.equal(parsed.score, undefined);
  }
  const typed = runNode('Set transcript', {}, {
    'Build request': { hasAudio: false, hint: 'Ik fiets want dat is gezond.', contextText: 'test' },
  });
  assert.equal(typed.transcriptionError, '');
  assert.equal(typed.transcript, 'Ik fiets want dat is gezond.');
  const absent = runNode('Set transcript', {}, {
    'Build request': { hasAudio: false, hint: '', contextText: 'test' },
  });
  assert.equal(absent.transcriptionError, '');
});

test('both grading and verification receive the same communicative A2 rubric', () => {
  const transcript = runNode('Set transcript', { text: 'Ik fiets want het is gezond.' }, {
    'Build request': { hasAudio: true, hint: '', contextText: 'test' },
  });
  const verified = runNode('Prepare verify', { choices: [{ message: { content: '{}' } }] }, {
    'Set transcript': transcript,
  });
  for (const result of [transcript, verified]) {
    assert.match(result.messages[0].content, /A2 COMMUNICATIVE RUBRIC/);
    assert.match(result.messages[0].content, /NOT a mandatory script/);
    assert.match(result.messages[0].content, /Minor omissions reduce the score proportionately/);
    assert.match(result.messages[0].content, /Never ask a speaker to double-check spelling/);
    assert.match(result.messages[0].content, /CALIBRATION EXAMPLE 1/);
    assert.match(result.messages[0].content, /CALIBRATION EXAMPLE 2/);
    assert.match(result.messages[0].content, /Grass and separate sentences per picture are optional/);
  }
});

function examPage(getUserMedia = async () => microphone()) {
  const elements = new Map();
  const element = () => ({
    hidden: false, value: '', textContent: '', dataset: {}, style: {}, disabled: false,
    classList: { toggle() {}, add() {}, remove() {} },
    replaceChildren() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {}, append() {},
  });
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement: element,
  };
  class BrokenPreview { start() { throw new Error('speech recognition unavailable'); } stop() {} }
  const config = { blocks: [{ id: 'audio', source: 'audio', count: 1, seconds: 30 }], examMinutes: 45, passRule: { answeredRequired: 1, note: '' } };
  const source = fs.readFileSync(new URL('../src/pages/spreken.astro', import.meta.url), 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/gm, '');
  const bindings = {
    ...helpers, createRecording: stream => createRecording(stream, Recorder),
    config, audioPool: [{ id: 'test', question: 'Wat doe je?' }], picturePool: [], document,
    window: { MediaRecorder: Recorder, SpeechRecognition: BrokenPreview, scrollTo() {} },
    navigator: { mediaDevices: { getUserMedia } },
    setInterval: () => 1, clearInterval() {},
  };
  // Replace the external grading boundary; execute the actual page event logic.
  const page = new Function(...Object.keys(bindings), source + `
    enqueueGrade = () => Promise.resolve({ result: null, error: 'offline' });
    return { startExam, toggleRecording, completeExam, navigateTo,
      answer: () => answers[index], currentIndex: () => index };
  `)(...Object.values(bindings));
  return { page, elements };
}

test('page still captures audio when live speech recognition throws; finish awaits audio', async () => {
  const { page, elements } = examPage();
  page.startExam();
  await page.toggleRecording();
  const recorder = Recorder.instances.at(-1);
  assert.equal(recorder.state, 'recording');
  let finished = false;
  const completion = page.completeExam().then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(finished, false);
  recorder.finish('Dutch speech');
  await completion;
  assert.equal(await page.answer().audioBlob.text(), 'Dutch speech');
  assert.match(elements.get('#resultSummary').textContent, /geen volledige uitslag/);
});

test('microphone permission failure is retained as a technical recording error', async () => {
  const { page } = examPage(async () => { throw new Error('denied'); });
  page.startExam();
  await page.toggleRecording();
  assert.match(page.answer().recordingError, /microfoon/);
  assert.equal(page.answer().audioBlob, null);
});
