import { shuffle } from './quiz.js';

export const examLength = 40;
export const examDurationMinutes = 45;
export const passMark = 28;

const letters = 'ABCDEF';
const plain = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isTrueFalse = item => /^waar\b/i.test(plain(item.options[0].text)) && item.options.length === 2;

// The source tests reuse some questions; the same prompt with the same answers counts once.
export function uniqueQuestions(questions) {
  const seen = new Set();
  return questions.filter(item => {
    const key = plain(item.prompt + ' ' + item.options.map(option => option.text).sort().join(' '));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Most keys in the paper tests are A, so answer order is shuffled (except "Waar / Niet waar").
export function shuffleOptions(item, random = Math.random) {
  if (isTrueFalse(item)) return item;
  const options = shuffle(item.options, random);
  const correct = letters[options.findIndex(option => option.id === item.correct)];
  return { ...item, options: options.map((option, i) => ({ id: letters[i], text: option.text })), correct };
}

export function buildExam(questions, { test = null, random = Math.random } = {}) {
  const pool = test ? questions.filter(item => item.test === test) : shuffle(uniqueQuestions(questions), random);
  return pool.slice(0, examLength).map(item => shuffleOptions(item, random));
}

export function scoreExam(questions, answers) {
  const correct = questions.filter((item, i) => answers[i] === item.correct).length;
  return { correct, total: questions.length, passed: correct >= passMark };
}
