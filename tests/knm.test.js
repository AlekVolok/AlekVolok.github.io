import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as knm from '../src/lib/knm.js';

const { questions } = JSON.parse(fs.readFileSync(new URL('../src/data/knm-oefenexamens.json', import.meta.url)));

test('question bank holds 26 complete tests of 40 questions with a valid key', () => {
  assert.equal(questions.length, 26 * 40);
  for (let t = 1; t <= 26; t++) assert.equal(questions.filter(item => item.test === t).length, 40, `test ${t}`);
  for (const item of questions) {
    assert.ok(item.prompt && item.options.length >= 2, item.id);
    assert.ok(item.options.some(option => option.id === item.correct), item.id);
    assert.ok(item.options.every(option => option.text && !/Sleutel|oefenmateriaal/.test(option.text)), item.id);
  }
});

test('a random exam has 40 distinct questions and keeps the correct answer', () => {
  const exam = knm.buildExam(questions);
  assert.equal(exam.length, knm.examLength);
  assert.equal(new Set(exam.map(item => item.id)).size, 40);
  for (const item of exam) {
    const original = questions.find(source => source.id === item.id);
    const correctText = original.options.find(option => option.id === original.correct).text;
    assert.equal(item.options.find(option => option.id === item.correct).text, correctText);
    assert.deepEqual(item.options.map(option => option.id), 'ABCDEF'.slice(0, item.options.length).split(''));
  }
});

test('a chosen test keeps its original order and true/false answers stay in place', () => {
  const exam = knm.buildExam(questions, { test: 1 });
  assert.deepEqual(exam.map(item => item.number), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.deepEqual(exam[1].options.map(option => option.text), ['Waar.', 'Niet waar.']);
});

test('28 of 40 correct is the pass mark', () => {
  const exam = knm.buildExam(questions, { test: 2 });
  const answers = exam.map((item, i) => (i < 28 ? item.correct : null));
  assert.deepEqual(knm.scoreExam(exam, answers), { correct: 28, total: 40, passed: true });
  answers[0] = null;
  assert.equal(knm.scoreExam(exam, answers).passed, false);
});

const topics = JSON.parse(fs.readFileSync(new URL('../src/data/knm-topics.json', import.meta.url)));

test('matched topics point at existing sections with Dutch and Russian text', () => {
  const ids = new Set(topics.sections.map(section => section.id));
  assert.ok(Object.keys(topics.questionTopics).length > 900);
  for (const [questionId, sectionId] of Object.entries(topics.questionTopics)) {
    assert.ok(questions.some(item => item.id === questionId), questionId);
    assert.ok(ids.has(sectionId), sectionId);
  }
  for (const section of topics.sections) assert.ok(section.nl && section.ru && section.article, section.id);
  assert.equal(knm.topicFor({ id: 'missing' }, topics), null);
});

test('topic markdown renders lists, tables and bold text and escapes HTML', () => {
  const html = knm.renderMarkdown('Een **vet** woord <b>\n\n- een\n- twee\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n1. eerst');
  assert.equal(html, '<p>Een <strong>vet</strong> woord &lt;b&gt;</p><ul><li>een</li><li>twee</li></ul><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><ol><li>eerst</li></ol>');
});
