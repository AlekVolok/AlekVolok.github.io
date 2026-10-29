import { writeFileSync } from 'node:fs';

// Spreken A2 grading workflow:
// Groq Whisper transcribes. Paid xAI Grok via OpenRouter grades and verifies;
// Groq is the backup grader. Bind existing credentials when deploying.

const GRADE_MODEL = 'x-ai/grok-4.3';
const VERIFY_MODEL = 'x-ai/grok-4.3';
const BACKUP_MODEL = 'openai/gpt-oss-120b';
const WHISPER_MODEL = 'whisper-large-v3';

const GRADE_SYSTEM = `You are an examiner for the Dutch Inburgering A2 speaking exam (Spreken). You grade ONE answer of a candidate.

INPUT: block type (pictureCount), instruction, question (Dutch), key points, picture description, reference answer and the TRANSCRIPT of what the candidate said. The transcript comes from speech recognition: ignore punctuation, capitalisation and obvious recognition errors, but judge the Dutch the candidate actually produced. Never invent words that are not in the transcript.

BLOCKS: pictureCount 0 = the candidate listens to a question and answers in one or two sentences. 1 = describe at least three things on one picture. 2 = choose one of two pictures and explain why. 3 = name what is on all three pictures and say what you can do with them. The picture description tells you what is really on the pictures.

VERDICT:
- "no-answer": the transcript is empty.
- "answered": the candidate addressed the task (every part of the question, or the required picture items / a choice with a reason). Grammar may be imperfect; the answer must still be understandable.
- "incorrect": the candidate answered but missed part of the task, talked about something else, or the answer is not understandable.

STRATEGIES THE CANDIDATE IS ALLOWED TO USE (do NOT penalise them if the task is still addressed):
1. Clever parrot: repeat the question's words and answer in parallel, e.g. "Wat toevallig! Ik ook ...".
2. Denial: deny one part of a question, e.g. "Ik kijk geen tv, ik kijk alleen TikTok." (at most twice in the exam).
3. Makhmud: say something plausible even if it is not true.
4. Universal answers: "Ik vind dat normaal / prima / belangrijk." "want het is belangrijk voor mij", "want dat is gezond", "want dat is gratis / niet duur", "want ik heb niet genoeg geld voor ...". Wanneer? -> "vaak", "regelmatig", "soms". Past questions may be answered as a routine. Hoe lang? -> "sinds september". Teacher or school questions: "Ik heb geen leraar want dat is duur. Ik studeer met chat gpt en tiktok want dat is gratis."
5. Picture templates: "Ik zie [X] op het eerste / tweede / derde plaatje. Die / Dat is voor [situatie]."
6. Topic clusters: broken things ("Y is kapot. X kan dat repareren. Of X kan een nieuwe Y kopen."), public problems ("Ik moet de gemeente / de politie bellen."), work ("X praat met collega's, X helpt andere mensen, X werkt op de computer."), study, choices ("Ik vind X beter. Dat is niet duur. Dat is modern. Dat is lekker. Dat helpt mij."), home ("Ik houd van natuur."), animals, activities, people ("... is mooi en sportief."), health ("X heeft pijn. X moet de dokter bellen.").

MISTAKES: at most 6 real grammar or word-choice mistakes, most important first. "original" is an exact fragment of the transcript, "correction" the corrected Dutch fragment, "explanation" a short English rule. Do not list recognition artifacts. Remember: after "want" the main-clause word order stays (want + subject + verb); after "omdat" the verb goes to the end. Do not "correct" correct Dutch.

PROPOSED ANSWER: ALWAYS provide a short example of a good A2 Dutch answer, including when the candidate already answered correctly. Use simple natural Dutch, answer the actual question and match the picture description. Usually 1-3 short sentences; use more only if the task explicitly needs more items. This is one valid example, not a mandatory wording or a higher standard for grading the candidate. Keep it separate from the transcript and never change the transcript to match it.

SCORE: integer 0-10. "answered" scores 6 or more, "no-answer" scores 0.

Reply with JSON only, in this exact shape:
{"transcript": "<the transcript as given>", "verdict": "answered" | "incorrect" | "no-answer", "score": <integer>, "completed": <true or false>, "strengths": ["<English>"], "missingPoints": ["<English>"], "mistakes": [{"original": "<exact fragment>", "correction": "<Dutch>", "explanation": "<English>"}], "proposedAnswer": "<short correct A2 Dutch example, always provided>", "feedback": "<2-3 sentences in English with the most useful advice>"}`;

const VERIFY_SYSTEM = `You are a second examiner doing the final check of a grading for the Dutch Inburgering A2 speaking exam. You receive the question context, the transcript and a DRAFT grading in JSON.

Return a corrected version in the same JSON shape, JSON only:
- verdict: "no-answer" only when the transcript is empty; otherwise "answered" or "incorrect", matching the transcript and the task.
- mistakes: keep only real grammar or word-choice errors. Each "original" must be an exact fragment of the transcript and each "correction" correct, minimal Dutch. Remove items that are not errors (for example: "want" + main-clause word order is correct). Add missing important errors.
- proposedAnswer: ALWAYS preserve or improve a short, correct A2 Dutch example, also for an "answered" verdict. Answer the actual question using simple natural Dutch and the picture description. This is one valid example, not required wording and not a reason to downgrade a different valid answer. Never return an empty example for a correct answer.
- score: 0 for "no-answer", 6 or more for "answered", otherwise consistent with the mistakes.
- Strategies (parrot, denial, Makhmud, universal answers, picture templates) are valid when the task is still addressed.
Keep the transcript unchanged and the feedback in English. Fields: transcript, verdict, score, completed, strengths, missingPoints, mistakes, proposedAnswer, feedback.`;

const WHISPER_PROMPT = 'Letterlijke transcriptie van een A2-examenkandidaat. Schrijf precies wat er gezegd wordt, ook grammaticale fouten.';

const buildCode = [
  "const p = $input.first().json.body;",
  "const hasAudio = Boolean(p.audio && p.audio.base64);",
  "const contextText = ['Block pictureCount: ' + p.pictureCount + ' (0 = audio-only question)', 'Instruction (Dutch): ' + p.instruction, 'Question (Dutch): ' + (p.question || ''), 'Key points: ' + (p.keyPoints || []).join('; '), 'Picture description: ' + (p.pictureDescription || 'none'), 'Reference answer (Dutch): ' + (p.referenceAnswer || 'none')].join('\\n');",
  "const item = { json: { hasAudio, hint: (p.transcriptHint || '').trim(), contextText } };",
  "if (hasAudio) item.binary = { audio: { data: p.audio.base64, mimeType: p.audio.mimeType || 'audio/mpeg', fileName: 'answer.' + (/mp4|m4a/.test(p.audio.mimeType) ? 'm4a' : /webm/.test(p.audio.mimeType) ? 'webm' : /ogg/.test(p.audio.mimeType) ? 'ogg' : /wav/.test(p.audio.mimeType) ? 'wav' : 'mp3') } };",
  "return [item];",
].join('\n');

const setTranscriptCode = [
  "const built = $('Build request').first().json;",
  "const reply = $input.first().json;",
  "const whisper = (reply && typeof reply.text === 'string') ? reply.text.trim() : '';",
  "const transcript = whisper || built.hint;",
  "const answerLine = transcript ? 'Transcript of the candidate: ' + JSON.stringify(transcript) : 'The candidate gave NO answer (empty transcript).';",
  "const transcriptionError = built.hasAudio && !transcript ? 'Audio kon niet betrouwbaar worden uitgeschreven. Probeer opnieuw te beoordelen of vul het transcript in.' : '';",
  "const user = built.contextText + '\\n' + answerLine;",
  "const messages = [{ role: 'system', content: " + JSON.stringify(GRADE_SYSTEM) + " }, { role: 'user', content: user }];",
  "messages[0].content += \"\\n\\nA2 COMMUNICATIVE RUBRIC (takes priority over stricter wording elsewhere): Judge whether a listener can understand a relevant response to the actual question. The reference answer and key points are examples, NOT a mandatory script or vocabulary checklist. Accept synonyms, simple vocabulary, short sentences, reasonable alternative interpretations and personal choices with any understandable relevant reason. Do not require details or reasons not asked for in the question. Apply the generic block instruction only where compatible with the specific question. Minor omissions reduce the score proportionately; they do not automatically make a relevant understandable answer incorrect. Reserve incorrect for mostly off-topic, largely missing essential requested information, or unintelligible answers. Missing articles, wrong gender, tense or word order, accent, repetition and pauses are normal at A2 when meaning is clear; give learning tips without turning them into a failed answer. Never infer pronunciation or fluency problems from text. Do not penalise obvious speech-recognition artifacts. Score 6-7 for an understandable relevant A2 answer with some gaps, 8-9 for a clear answer covering the task, 10 for a fully effective simple A2 answer; do not demand B1/B2 complexity for high marks. Scores 1-5 are for insufficient communication. No-answer and score 0 are ONLY for genuinely absent input, never a technical transcription failure. Mark completed true when the essential communicative task is achieved. List only missing essential information requested by the actual question, and at most three unambiguous useful language corrections. In doubt about a plausible recognition error, give the candidate the benefit of the doubt.\";",
  "messages[0].content += \"\\n\\nSPOKEN ANSWER CALIBRATION: Spelling, capitalization, compound-word spacing and spelling of proper names in an automatic transcript are NOT spoken-language mistakes. Never ask a speaker to double-check spelling. For example, Alia versus Ayla and kleur uit potloden versus kleurpotloden can be recognition artifacts; do not count them as independent language errors without audio evidence. Do not require exact vocabulary such as knutselen when a broader relevant verb such as werken communicates a plausible use; suggest the more specific word as optional advice, not a condition for passing. If asked what is in the pictures and to say something about all of them, naming every pictured item in a single sentence addresses them all. Do not invent a requirement to mention grass, color, location, picture numbering or one sentence per picture. Small article mistakes may receive a brief correction but must not by themselves cause incorrect or a score below 6 when the task is understandable.\\nCALIBRATION EXAMPLE 1: Question: Wat ziet u op deze plaatjes? Vertel ook wat Ayla met deze spullen kan doen? Pictures: kleurpotloden, lijm, schaar. Transcript: Ik zie de kleur uit potloden, het lijm en het schaar. Alia kan met deze spullen werken. Expected: answered, at least 6/10; all objects and a broadly relevant use are communicated. Optionally suggest hiermee knutselen for precision. Do not penalise name spelling or compound-word transcription.\\nCALIBRATION EXAMPLE 2: Question: wat zie je op deze plaatjes? Vertel iets over alle plaatjes. Pictures: kat, konijn, hond on grass. Transcript: Ik zie de kat, de konijn en de hond. Expected: answered, at least 6/10; all three pictures are addressed. One minor article correction (het konijn) is useful. Grass and separate sentences per picture are optional. These examples do not excuse answers which fail to identify the objects or omit an explicitly requested use entirely.\";",
  "return [{ json: { transcript, transcriptionError, source: whisper ? 'whisper' : (built.hint ? 'browser' : 'none'), user, messages } }];",
].join('\n');

const prepareVerifyCode = [
  "const grade = $input.first().json;",
  "const draft = grade.choices && grade.choices[0] && grade.choices[0].message ? grade.choices[0].message.content : '';",
  "const context = $('Set transcript').first().json.user;",
  "if (!draft) return [{ json: { draft: '', messages: [], error: 'Both grading providers failed. Try again later.' } }];",
  "const messages = [{ role: 'system', content: " + JSON.stringify(VERIFY_SYSTEM) + " }, { role: 'user', content: context + '\\n\\nDraft grading (JSON):\\n' + draft }];",
  "messages[0].content += \"\\n\\nA2 COMMUNICATIVE RUBRIC (takes priority over stricter wording elsewhere): Judge whether a listener can understand a relevant response to the actual question. The reference answer and key points are examples, NOT a mandatory script or vocabulary checklist. Accept synonyms, simple vocabulary, short sentences, reasonable alternative interpretations and personal choices with any understandable relevant reason. Do not require details or reasons not asked for in the question. Apply the generic block instruction only where compatible with the specific question. Minor omissions reduce the score proportionately; they do not automatically make a relevant understandable answer incorrect. Reserve incorrect for mostly off-topic, largely missing essential requested information, or unintelligible answers. Missing articles, wrong gender, tense or word order, accent, repetition and pauses are normal at A2 when meaning is clear; give learning tips without turning them into a failed answer. Never infer pronunciation or fluency problems from text. Do not penalise obvious speech-recognition artifacts. Score 6-7 for an understandable relevant A2 answer with some gaps, 8-9 for a clear answer covering the task, 10 for a fully effective simple A2 answer; do not demand B1/B2 complexity for high marks. Scores 1-5 are for insufficient communication. No-answer and score 0 are ONLY for genuinely absent input, never a technical transcription failure. Mark completed true when the essential communicative task is achieved. List only missing essential information requested by the actual question, and at most three unambiguous useful language corrections. In doubt about a plausible recognition error, give the candidate the benefit of the doubt.\\nDo not downgrade a sufficient A2 answer merely to add more corrections. Re-evaluate any draft incorrect verdict using this communicative rubric.\";",
  "messages[0].content += \"\\n\\nSPOKEN ANSWER CALIBRATION: Spelling, capitalization, compound-word spacing and spelling of proper names in an automatic transcript are NOT spoken-language mistakes. Never ask a speaker to double-check spelling. For example, Alia versus Ayla and kleur uit potloden versus kleurpotloden can be recognition artifacts; do not count them as independent language errors without audio evidence. Do not require exact vocabulary such as knutselen when a broader relevant verb such as werken communicates a plausible use; suggest the more specific word as optional advice, not a condition for passing. If asked what is in the pictures and to say something about all of them, naming every pictured item in a single sentence addresses them all. Do not invent a requirement to mention grass, color, location, picture numbering or one sentence per picture. Small article mistakes may receive a brief correction but must not by themselves cause incorrect or a score below 6 when the task is understandable.\\nCALIBRATION EXAMPLE 1: Question: Wat ziet u op deze plaatjes? Vertel ook wat Ayla met deze spullen kan doen? Pictures: kleurpotloden, lijm, schaar. Transcript: Ik zie de kleur uit potloden, het lijm en het schaar. Alia kan met deze spullen werken. Expected: answered, at least 6/10; all objects and a broadly relevant use are communicated. Optionally suggest hiermee knutselen for precision. Do not penalise name spelling or compound-word transcription.\\nCALIBRATION EXAMPLE 2: Question: wat zie je op deze plaatjes? Vertel iets over alle plaatjes. Pictures: kat, konijn, hond on grass. Transcript: Ik zie de kat, de konijn en de hond. Expected: answered, at least 6/10; all three pictures are addressed. One minor article correction (het konijn) is useful. Grass and separate sentences per picture are optional. These examples do not excuse answers which fail to identify the objects or omit an explicitly requested use entirely.\";",
  "return [{ json: { draft, messages } }];",
].join('\n');

const parseCode = [
  "const transcriptionError = $('Set transcript').first().json.transcriptionError;",
  "if (transcriptionError) return [{ json: { error: transcriptionError } }];",
  "const reply = $input.first().json;",
  "const fromModel = reply.choices && reply.choices[0] && reply.choices[0].message ? reply.choices[0].message.content : '';",
  "const prepared = $('Prepare verify').first().json;",
  "const transcript = $('Set transcript').first().json.transcript;",
  "const pick = (raw) => { const start = raw.indexOf('{'); const end = raw.lastIndexOf('}'); if (start === -1 || end <= start) throw new Error('no JSON'); return JSON.parse(raw.slice(start, end + 1)); };",
  "let result;",
  "try { result = pick(fromModel); } catch (error) { try { result = pick(prepared.draft || ''); } catch (error2) { result = { error: prepared.error || 'The model returned no usable answer.', verdict: 'incorrect', score: 0, completed: false, strengths: [], missingPoints: [], mistakes: [], proposedAnswer: '', feedback: '' }; } }",
  "result.transcript = transcript;",
  "if (!transcript) { result.verdict = 'no-answer'; result.score = 0; result.completed = false; }",
  "return [{ json: result }];",
].join('\n');

const chatNode = (name, position, credentialType, url, model, messagesExpr, extra = '') => ({
  parameters: {
    method: 'POST',
    url,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: credentialType,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ model: ' + JSON.stringify(model) + ', messages: ' + messagesExpr + ', temperature: 0.2, max_tokens: 1600'
      + (model.startsWith('x-ai/') ? ', reasoning: { effort: "none" }' : '') + extra + ' }) }}',
    options: { timeout: 20000 },
  },
  id: name.replace(/\W/g, ''),
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
  onError: 'continueRegularOutput',
});

const ifNode = (name, position, leftValue, operator) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{ id: name.replace(/\W/g, ''), leftValue, rightValue: '', operator }],
      combinator: 'and',
    },
    options: {},
  },
  id: name.replace(/\W/g, ''),
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  position,
});

const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const jsonFormat = ', response_format: { type: "json_object" }';

const workflow = {
  name: 'Spreken A2 - evaluate',
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'spreken-evaluate', responseMode: 'responseNode', options: { allowedOrigins: 'https://alekvolok.github.io,http://localhost:4321' } },
      id: 'webhook1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 200], webhookId: '6f1c2b1e-spreken-evaluate-0001',
    },
    { parameters: { jsCode: buildCode }, id: 'build1', name: 'Build request', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 200] },
    ifNode('Has audio?', [440, 200], '={{ $json.hasAudio }}', { type: 'boolean', operation: 'true', singleValue: true }),
    {
      parameters: {
        method: 'POST',
        url: 'https://api.groq.com/openai/v1/audio/transcriptions',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'groqApi',
        sendBody: true,
        contentType: 'multipart-form-data',
        bodyParameters: {
          parameters: [
            { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'audio' },
            { parameterType: 'formData', name: 'model', value: WHISPER_MODEL },
            { parameterType: 'formData', name: 'language', value: 'nl' },
            { parameterType: 'formData', name: 'temperature', value: '0' },
            { parameterType: 'formData', name: 'prompt', value: WHISPER_PROMPT },
            { parameterType: 'formData', name: 'response_format', value: 'json' },
          ],
        },
        options: { timeout: 20000 },
      },
      id: 'whisper1', name: 'Transcribe (Groq Whisper)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [660, 100], onError: 'continueRegularOutput',
    },
    { parameters: { jsCode: setTranscriptCode }, id: 'settranscript1', name: 'Set transcript', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 200] },
    chatNode('Grade (Grok via OpenRouter)', [1100, 200], 'openRouterApi', OPENROUTER_CHAT, GRADE_MODEL, '$json.messages', jsonFormat),
    ifNode('Graded?', [1320, 200], '={{ $json.choices?.[0]?.message?.content ?? "" }}', { type: 'string', operation: 'notEmpty', singleValue: true }),
    chatNode('Grade backup (Groq)', [1540, 340], 'groqApi', GROQ_CHAT, BACKUP_MODEL, "$('Set transcript').first().json.messages", jsonFormat),
    { parameters: { jsCode: prepareVerifyCode }, id: 'prepare1', name: 'Prepare verify', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1760, 200] },
    chatNode('Verify (Grok via OpenRouter)', [1980, 200], 'openRouterApi', OPENROUTER_CHAT, VERIFY_MODEL, '$json.messages', jsonFormat),
    { parameters: { jsCode: parseCode }, id: 'parse1', name: 'Parse evaluation', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2200, 200] },
    { parameters: { respondWith: 'json', responseBody: '={{ $json }}', options: {} }, id: 'respond1', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [2420, 200] },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Build request', type: 'main', index: 0 }]] },
    'Build request': { main: [[{ node: 'Has audio?', type: 'main', index: 0 }]] },
    'Has audio?': { main: [[{ node: 'Transcribe (Groq Whisper)', type: 'main', index: 0 }], [{ node: 'Set transcript', type: 'main', index: 0 }]] },
    'Transcribe (Groq Whisper)': { main: [[{ node: 'Set transcript', type: 'main', index: 0 }]] },
    'Set transcript': { main: [[{ node: 'Grade (Grok via OpenRouter)', type: 'main', index: 0 }]] },
    'Grade (Grok via OpenRouter)': { main: [[{ node: 'Graded?', type: 'main', index: 0 }]] },
    'Graded?': { main: [[{ node: 'Prepare verify', type: 'main', index: 0 }], [{ node: 'Grade backup (Groq)', type: 'main', index: 0 }]] },
    'Grade backup (Groq)': { main: [[{ node: 'Prepare verify', type: 'main', index: 0 }]] },
    'Prepare verify': { main: [[{ node: 'Verify (Grok via OpenRouter)', type: 'main', index: 0 }]] },
    'Verify (Grok via OpenRouter)': { main: [[{ node: 'Parse evaluation', type: 'main', index: 0 }]] },
    'Parse evaluation': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  active: false,
};

writeFileSync(process.argv[2], JSON.stringify(workflow, null, 2) + '\n');
console.log('written', process.argv[2]);
