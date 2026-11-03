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

export function topicFor(item, topics) {
  const id = topics.questionTopics[item.id];
  return id ? topics.sections.find(section => section.id === id) : null;
}

const escapeHtml = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const inline = text => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

// The topic notes only use paragraphs, bullet and numbered lists, tables and bold text.
export function renderMarkdown(markdown) {
  return markdown.trim().split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.every(line => line.startsWith('|'))) {
      const [head, ...rows] = lines.filter(line => !/^\|[\s:|-]+\|$/.test(line));
      const row = (line, tag) => `<tr>${cells(line).map(cell => `<${tag}>${inline(cell)}</${tag}>`).join('')}</tr>`;
      return `<table><thead>${row(head, 'th')}</thead><tbody>${rows.map(line => row(line, 'td')).join('')}</tbody></table>`;
    }
    if (lines.every(line => /^[-*] /.test(line))) return `<ul>${lines.map(line => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
    if (lines.every(line => /^\d+\. /.test(line))) return `<ol>${lines.map(line => `<li>${inline(line.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br />')}</p>`;
  }).join('');
}
