import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vocabulary from '../src/data/quiz-vocabulary.js';
import * as quiz from '../src/lib/quiz.js';

const pictures = JSON.parse(fs.readFileSync(new URL('../src/data/spreken-pictures.json', import.meta.url)));
const cards = quiz.buildQuizCards(vocabulary, pictures);

test('vocabulary covers every source image, including multi-picture collages', () => {
  assert.equal(new Set(vocabulary.map(card => card.id)).size, vocabulary.length);
  assert.equal(cards.length, vocabulary.length, 'Every word needs a relevant source context');
  const used = new Set(cards.flatMap(card => card.sources.map(source => source.src)));
  const expected = new Set(pictures.flatMap(item => item.pictures));
  assert.deepEqual(used, expected);
  for (const src of used) assert.ok(fs.existsSync(new URL('../public' + src, import.meta.url)), src);
  for (const id of ['kat','konijn','hond']) {
    assert.ok(cards.find(card => card.id === id).sources.some(source => source.slideId === 'p059'), id);
  }
  assert.ok(cards.every(card => card.term && card.translation && card.category));
});

test('choices are distinct and contain the correct answer once in either direction', () => {
  for (const reverse of [false, true]) for (const card of cards) {
    const options = quiz.makeChoices(card, cards, reverse);
    const field = reverse ? 'translation' : 'term';
    assert.equal(options.length, 4);
    assert.equal(options.filter(option => option.id === card.id).length, 1);
    assert.equal(new Set(options.map(option => option[field])).size, 4);
  }
  assert.equal(quiz.makeChoices(cards[0], [cards[0]]).length, 1);
});

test('typed answers tolerate case, spacing, punctuation, accents and optional articles', () => {
  assert.ok(quiz.checkAnswer('  FIETS! ', 'de fiets'));
  assert.ok(quiz.checkAnswer('het konijn', 'het konijn'));
  assert.ok(quiz.checkAnswer('creme', 'de crème'));
  assert.equal(quiz.checkAnswer('hond', 'het konijn'), false);
  assert.equal(quiz.checkAnswer('', 'de fiets'), false);
});

test('sessions favour unfamiliar words and progress resets only the missed word', () => {
  let progress = {};
  for (let i = 0; i < 3; i++) progress = quiz.updateProgress(progress, cards[0].id, true);
  assert.equal(progress[cards[0].id].level, 3);
  const session = quiz.makeSession(cards.slice(0, 4), progress, 3, () => .5);
  assert.equal(session.length, 3);
  assert.ok(session.every(card => card.id !== cards[0].id));
  const previous = progress;
  progress = quiz.updateProgress(progress, cards[0].id, false);
  assert.equal(progress[cards[0].id].level, 0);
  assert.equal(previous[cards[0].id].level, 3);
  assert.equal(progress[cards[0].id].correct, 3);
  assert.equal(progress[cards[0].id].wrong, 1);
});

// Exercise the actual client event handlers with a small DOM and storage adapter.
function createPage() {
  const elements = new Map();
  function element(tagName = 'DIV') {
    const classes = new Set();
    return {
      tagName: tagName.toUpperCase(), children: [], dataset: {}, value: '', textContent: '', hidden: false,
      disabled: false, readOnly: false, attributes: {}, events: {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
      addEventListener(name, fn) { this.events[name] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
      replaceChildren(...children) { this.children = children; },
      focus() {}, click() { if (!this.disabled) this.events.click?.({ preventDefault() {} }); },
    };
  }
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const sample = cards.slice(0, 8);
  $('#quizData').textContent = JSON.stringify({ cards: sample.map((card, i) => ({ ...card, sourceIndexes: [i] })), sources: sample.map(card => card.sources[0]) });
  for (const [id, value] of [['category','all'],['scope','all'],['sessionSize','10'],['direction','nl']]) $('#' + id).value = value;
  const modes = ['cards','learn','write','match'].map(mode => { const button = element('button'); button.dataset.mode = mode; return button; });
  const saved = new Map();
  const source = fs.readFileSync(new URL('../src/pages/quiz.astro', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/gm, '');
  const bindings = {
    ...quiz,
    document: { querySelector: $, querySelectorAll: () => modes, createElement: element, addEventListener() {}, activeElement: { tagName: 'BODY' } },
    window: { addEventListener() {} },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
    setTimeout, clearTimeout,
  };
  const api = new Function(...Object.keys(bindings), source + '\nreturn { current:()=>deck[index], deck:()=>deck, setMode:value=>{mode=value;start();}, mistakes:()=>[...missed], stars:()=>[...stars] };')(...Object.values(bindings));
  return { $, api, saved, modes };
}

test('flashcards flip, record a difficult word and repeat only missed words', () => {
  const { $, api, saved } = createPage();
  const id = api.current().id;
  assert.equal($('#again').disabled, false);
  $('#flashcard').click();
  assert.equal($('#cardText').textContent, api.current().term);
  assert.equal($('#again').disabled, false);
  $('#star').click();
  assert.deepEqual(api.stars(), [id]);
  $('#again').click();
  assert.equal(api.mistakes()[0], id);
  assert.equal($('#summary').hidden, true);
  for (let i = 0; i < 7; i++) { $('#flashcard').click(); $('#know').click(); }
  assert.equal($('#summary').hidden, false);
  $('#repeatMistakes').click();
  assert.equal(api.deck().length, 1);
  assert.equal(api.current().id, id);
  assert.ok(saved.get('spreken-quiz-v1'));
});

test('self-rating works without flipping and Know immediately marks a word familiar', () => {
  const { $, api, saved } = createPage();
  const known = api.current().id;
  assert.equal($('#know').disabled, false);
  $('#know').click();
  assert.equal($('#knownCount').textContent, 1);
  assert.equal(JSON.parse(saved.get('spreken-quiz-v1')).progress[known].level, 3);
  const learning = api.current().id;
  $('#again').click();
  assert.ok(api.mistakes().includes(learning));
  const progress = JSON.parse(saved.get('spreken-quiz-v1')).progress;
  assert.equal(progress[learning].level, 0);
  assert.equal(progress[learning].wrong, 1);
  assert.equal($('#weakCount').textContent, 1);
});

test('multiple choice and writing show corrections and cannot score twice', () => {
  const { $, api } = createPage();
  api.setMode('learn');
  const card = api.current();
  const wrong = $('#choices').children.find(button => button.dataset.id !== card.id);
  wrong.click();
  assert.match($('#feedback').textContent, /Запомним/);
  assert.equal($('#next').hidden, false);
  assert.ok($('#choices').children.every(button => button.disabled));
  assert.equal(api.mistakes().length, 1);
  api.setMode('write');
  $('#typed').value = api.current().term;
  $('#writeForm').events.submit({ preventDefault() {} });
  assert.match($('#feedback').textContent, /Верно/);
  assert.equal($('#typed').readOnly, true);
});

test('matching accepts pairs across rounds and finishes the selected deck', () => {
  const { $, api } = createPage();
  api.setMode('match');
  assert.equal($('#study').hidden, true);
  assert.equal($('#matchGrid').children.length, 12);
  for (const roundSize of [6, 2]) {
    const round = api.deck().slice(roundSize === 6 ? 0 : 6, roundSize === 6 ? 6 : 8);
    for (const card of round) {
      $('#matchGrid').children.find(button => button.textContent === card.term).click();
      $('#matchGrid').children.find(button => button.textContent === card.translation).click();
    }
    assert.equal($('#nextRound').hidden, false);
    $('#nextRound').click();
  }
  assert.equal($('#summary').hidden, false);
  assert.match($('#summaryText').textContent, /8 из 8/);
});

test('empty filters show an explicit empty state without breaking mode switching', () => {
  const { $, api } = createPage();
  $('#scope').value = 'starred';
  $('#scope').events.change();
  assert.equal($('#empty').hidden, false);
  assert.equal(api.deck().length, 0);
  api.setMode('write');
  assert.equal($('#study').hidden, true);
});
