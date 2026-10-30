export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const plain = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildQuizCards(vocabulary, pictures) {
  const scenes = pictures.flatMap(item => {
    const description = item.pictureDescription || '';
    const marks = [...description.matchAll(/Plaatje\s+(\d+):\s*/gi)];
    const prefix = marks.length ? description.slice(0, marks[0].index) : '';
    return item.pictures.map((src, i) => {
      const markIndex = marks.findIndex(mark => Number(mark[1]) === i + 1);
      const mark = marks[markIndex];
      // Several source files are collages: one image can contain all three pictures.
      const text = mark && marks.length === item.pictures.length
        ? prefix + description.slice(mark.index + mark[0].length, marks[markIndex + 1]?.index)
        : description;
      return { src, context: text.trim(), slideId: item.id };
    });
  });
  return vocabulary.map(word => {
    const forms = word.forms.map(form => escape(plain(form)).replaceAll('%', '[\\p{L}]*').replaceAll(' ', '\\s+'));
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(?:${forms.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'u');
    return { ...word, sources: scenes.filter(scene => pattern.test(plain(scene.context))) };
  }).filter(word => word.sources.length);
}

export function normalizeAnswer(value) {
  return plain(value).trim().replace(/[.,!?;:()"']/g, '').replace(/^(de|het|een)\s+/, '').replace(/\s+/g, ' ').trim();
}

export function checkAnswer(value, term) {
  return normalizeAnswer(value.trim()) === normalizeAnswer(term);
}

export function makeChoices(card, pool, reverse = false, random = Math.random) {
  const field = reverse ? 'translation' : 'term';
  const unique = [...new Map(pool.filter(other => other[field] !== card[field]).map(other => [other[field], other])).values()];
  return shuffle([card, ...shuffle(unique, random).slice(0, 3)], random);
}

export function makeSession(pool, progress, count, random = Math.random) {
  // Shuffle within each mastery group; practise difficult words before familiar ones.
  return shuffle(pool, random).sort((a, b) => (progress[a.id]?.level || 0) - (progress[b.id]?.level || 0)).slice(0, count);
}

export function updateProgress(progress, id, correct) {
  const previous = progress[id] || { level: 0, correct: 0, wrong: 0 };
  return { ...progress, [id]: {
    level: correct ? Math.min(3, previous.level + 1) : 0,
    correct: previous.correct + Number(correct),
    wrong: previous.wrong + Number(!correct),
  } };
}
