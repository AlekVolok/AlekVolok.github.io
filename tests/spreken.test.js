import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as helpers from '../src/lib/spreken.js';
import { createRecording, requestMicrophone } from '../src/lib/spreken-recording.js';
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
  assert.equal(stream.track.stopped, true);
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

test('a missing browser stop event cannot leave the record button waiting forever', async () => {
  const stream = microphone();
  const recording = createRecording(stream, Recorder, 10);
  const outcome = await recording.stop();
  assert.equal(stream.track.stopped, true);
  assert.equal(outcome.blob, null);
  assert.match(outcome.error.message, /niet afronden/);
});

test('recorder initialization failure releases the microphone', () => {
  const stream = microphone();
  class Unsupported { constructor() { throw new Error('unsupported'); } }
  assert.throws(() => createRecording(stream, Unsupported));
  assert.equal(stream.track.stopped, true);
});

test('a stalled microphone prompt times out and releases a late stream', async () => {
  let grant;
  const pending = new Promise(resolve => { grant = resolve; });
  const request = requestMicrophone(() => pending, 10);
  await assert.rejects(request, /microfoon reageert niet/);
  const stream = microphone();
  grant(stream);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stream.track.stopped, true);
});

test('microphone permission errors are preserved and a retry can succeed', async () => {
  const denied = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
  await assert.rejects(requestMicrophone(() => Promise.reject(denied)), error => error === denied);
  const stream = microphone();
  assert.equal(await requestMicrophone(() => Promise.resolve(stream)), stream);
});

test('recorder selects the supported mobile format without periodic chunks', async () => {
  let options;
  let startArguments;
  class MobileRecorder extends Recorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor(stream, configuration) { super(stream); options = configuration; this.mimeType = configuration.mimeType; }
    start(...args) { super.start(); startArguments = args; }
  }
  const recording = createRecording(microphone(), MobileRecorder);
  assert.deepEqual(options, { mimeType: 'audio/mp4' });
  assert.deepEqual(startArguments, []);
  recording.stop();
  Recorder.instances.at(-1).finish('audio data');
  assert.equal((await recording.done).blob.type, 'audio/mp4');
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
test('workflow generator reproduces the deployed template', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'spreken-workflow-'));
  const output = path.join(folder, 'workflow.json');
  try {
    execFileSync(process.execPath, [new URL('../n8n/build-workflow.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), output]);
    assert.deepEqual(JSON.parse(fs.readFileSync(output)), workflow);
  } finally {
    fs.rmSync(output, { force: true });
    fs.rmdirSync(folder);
  }
});

test('paid Grok grades and verifies with Groq backup and valid graph connections', () => {
  for (const name of ['Grade (Grok via OpenRouter)', 'Verify (Grok via OpenRouter)']) {
    const node = workflow.nodes.find(node => node.name === name);
    assert.equal(node.parameters.nodeCredentialType, 'openRouterApi');
    assert.equal(node.parameters.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.match(node.parameters.jsonBody, /x-ai\/grok-4\.3/);
    assert.doesNotMatch(node.parameters.jsonBody, /:free/);
    assert.match(node.parameters.jsonBody, /reasoning: \{ effort: "none" \}/);
    assert.equal(node.parameters.options.timeout, 20000);
  }
  assert.equal(workflow.nodes.find(node => node.name === 'Grade backup (Groq)').parameters.nodeCredentialType, 'groqApi');
  const names = new Set(workflow.nodes.map(node => node.name));
  for (const [from, connection] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), `Missing source ${from}`);
    for (const edge of connection.main.flat()) assert.ok(names.has(edge.node), `Missing target ${edge.node}`);
  }
});

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

function examPage(getUserMedia = async () => microphone(), gradeResult = null, options = {}) {
  const elements = new Map();
  const element = () => ({
    hidden: false, value: '', textContent: '', dataset: {}, style: {}, disabled: false,
    classList: { toggle() {}, add() {}, remove() {} },
    replaceChildren() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {}, append() {}, pause() {},
  });
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement: element,
  };
  let recognitionStarts = 0;
  class BrokenPreview { start() { recognitionStarts += 1; throw new Error('speech recognition unavailable'); } stop() {} }
  const count = options.count || 1;
  const config = { blocks: [{ id: 'audio', source: 'audio', count, seconds: 30 }], examMinutes: 45, passRule: { answeredRequired: Math.ceil(count * .8), note: '' } };
  const source = fs.readFileSync(new URL('../src/pages/spreken.astro', import.meta.url), 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/gm, '');
  let remoteCalls = 0;
  const bindings = {
    ...helpers, createRecording: stream => createRecording(stream, Recorder), requestMicrophone,
    testEvaluate: async (item, answer) => {
      remoteCalls += 1;
      const outcome = options.evaluate
        ? await options.evaluate(item, answer)
        : gradeResult || { result: null, error: 'offline' };
      if (outcome.result) return { ...outcome, result: helpers.parseEvaluation(JSON.stringify(outcome.result)) };
      return outcome;
    },
    config, audioPool: Array.from({length: count}, (_, i) => ({ id: `test-${i}`, question: 'Wat doe je?' })), picturePool: [], document,
    window: { MediaRecorder: Recorder, SpeechRecognition: BrokenPreview, scrollTo() {} },
    navigator: { mediaDevices: { getUserMedia } },
    setInterval: () => 1, clearInterval() {},
  };
  // Replace the external grading boundary; execute the actual page event logic.
  const page = new Function(...Object.keys(bindings), source + `
    gradeWithRetry = testEvaluate;
    return { startExam, toggleRecording, completeExam, navigateTo,
      answer: () => answers[index], allAnswers: () => answers, currentIndex: () => index,
      seedAnswer: (i, values) => Object.assign(answers[i], values) };
  `)(...Object.values(bindings));
  return { page, elements, recognitionStarts: () => recognitionStarts, remoteCalls: () => remoteCalls };
}

test('page records with one microphone consumer and finish awaits final audio', async () => {
  const { page, elements, recognitionStarts } = examPage();
  page.startExam();
  await page.toggleRecording();
  const recorder = Recorder.instances.at(-1);
  assert.equal(recorder.state, 'recording');
  assert.equal(recognitionStarts(), 0);
  let finished = false;
  const completion = page.completeExam().then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(finished, false);
  recorder.finish('Dutch speech');
  await completion;
  assert.equal(await page.answer().audioBlob.text(), 'Dutch speech');
  assert.match(elements.get('#resultSummary').textContent, /geen volledige uitslag/);
});

test('server transcript becomes visible after recording stops', async () => {
  const result = { transcript: 'Ik fiets naar mijn werk.', verdict: 'answered', score: 8 };
  const { page, elements } = examPage(undefined, { result, error: '' });
  page.startExam();
  await page.toggleRecording();
  const recorder = Recorder.instances.at(-1);
  const stopping = page.toggleRecording();
  recorder.finish('Dutch speech');
  await stopping;
  await Promise.resolve();
  assert.equal(page.answer().transcript, result.transcript);
  assert.equal(elements.get('#transcript').value, result.transcript);
  assert.match(elements.get('#answerFeedback').textContent, /8 \/ 10/);
  assert.equal(elements.get('#answerFeedback').hidden, false);
  assert.match(elements.get('#recordStatus').textContent, /transcript opgeslagen/);
  // A second recording starts independently after the previous stream is released.
  await page.toggleRecording();
  assert.equal(Recorder.instances.at(-1).state, 'recording');
  const finalStop = page.toggleRecording();
  Recorder.instances.at(-1).finish('second answer');
  await finalStop;
});

test('microphone permission failure is retained as a technical recording error', async () => {
  const { page } = examPage(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); });
  page.startExam();
  await page.toggleRecording();
  assert.match(page.answer().recordingError, /microfoon/);
  assert.equal(page.answer().audioBlob, null);
});

test('finishing 16 skipped questions makes no remote grading requests', async () => {
  const { page, elements, remoteCalls } = examPage(undefined, null, { count: 16 });
  page.startExam();
  const started = performance.now();
  await page.completeExam();
  assert.equal(remoteCalls(), 0);
  assert.ok(performance.now() - started < 500, 'Skipped questions should finish locally');
  assert.equal(page.allAnswers().filter(answer => answer.outcome?.result?.verdict === 'no-answer').length, 16);
  assert.equal(elements.get('#averageScore').textContent, '0.0 / 10');
  assert.equal(elements.get('#restart').disabled, false);
});

test('finishing an already graded 16-question exam reuses all results immediately', async () => {
  const { page, elements, remoteCalls } = examPage(undefined, null, { count: 16 });
  page.startExam();
  const result = helpers.parseEvaluation(JSON.stringify({ verdict: 'answered', score: 8, transcript: 'Ik werk.' }));
  for (let i = 0; i < 16; i += 1) {
    const outcome = { result, error: '' };
    page.seedAnswer(i, { transcript: result.transcript, outcome, grading: Promise.resolve(outcome) });
  }
  const started = performance.now();
  const completion = page.completeExam();
  assert.equal(elements.get('#results').hidden, false);
  assert.equal(elements.get('#averageScore').textContent, '8.0 / 10');
  await completion;
  assert.equal(remoteCalls(), 0);
  assert.ok(performance.now() - started < 500, 'Cached results must not wait for a webhook');
  assert.match(elements.get('#resultSummary').textContent, /16 van 16/);
});

test('final results appear while the last answer is still being graded', async () => {
  let resolveGrade;
  const pending = new Promise(resolve => { resolveGrade = resolve; });
  const { page, elements, remoteCalls } = examPage(undefined, null, { count: 16, evaluate: () => pending });
  page.startExam();
  page.seedAnswer(15, { transcript: 'Ik werk.' });
  const completion = page.completeExam();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(remoteCalls(), 1);
  assert.equal(elements.get('#results').hidden, false);
  assert.equal(elements.get('#averageScore').textContent, '0.0 / 10');
  assert.match(elements.get('#resultSummary').textContent, /15 van 16/);
  resolveGrade({ result: { verdict: 'answered', score: 8, transcript: 'Ik werk.' }, error: '' });
  await completion;
  assert.equal(elements.get('#averageScore').textContent, '0.5 / 10');
  assert.doesNotMatch(elements.get('#resultSummary').textContent, /verwerken/);
});

test('typed answers begin grading on navigation and technical errors stay ungraded', async () => {
  const { page, remoteCalls } = examPage(undefined, { result: { verdict: 'answered', score: 8, transcript: 'Ik werk.' }, error: '' }, { count: 16 });
  page.startExam();
  page.answer().transcript = 'Ik werk.';
  await page.navigateTo(1);
  await Promise.resolve();
  assert.equal(remoteCalls(), 1);
  page.seedAnswer(1, { recordingError: 'Microphone failed' });
  await page.completeExam();
  assert.equal(remoteCalls(), 1);
  assert.equal(page.allAnswers()[1].outcome.result, null);
  assert.equal(page.allAnswers()[1].outcome.error, 'Microphone failed');
});
