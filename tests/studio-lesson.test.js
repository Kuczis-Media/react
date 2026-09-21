const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const studio = require(path.join(root, 'public', 'members', 'module', 'studio', 'lesson-model.js'));
const lessonParser = require(path.join(root, 'public', 'members', 'module', 'lesson', 'lesson-parser.js'));

test('lesson Enter key survives model, Markdown, student rendering and answer checking for every task type', () => {
  for (const type of studio.TASK_TYPES) {
    const options = ['Pierwsza\nDrugi wiersz', 'Druga', 'Trzecia', 'Czwarta'];
    const source = studio.createLesson({ filename: 'entery.md', slides: [{
      blocks: [{ type: 'heading', text: 'Zadanie', level: 1 }],
      task: { type, question: 'Wiersz **jeden**\nWiersz dwa\n\nOsobny akapit z H~2~O.',
        label: 'Etykieta\nDrugi wiersz', options,
        answers: type === 'abcd' ? ['A'] : type === 'choice' || type === 'gaps' ? [options[0]] : type === 'number' ? ['2'] : ['tak'],
        text: 'Pierwszy wiersz {{luka}}\nDrugi wiersz.', hint: 'Podpowiedź\nDrugi wiersz', feedback: 'Brawo!\nDrugi wiersz' }
    }] });
    const markdown = studio.serializeLesson(source);
    const restored = studio.parseLesson(markdown, 'entery.md');
    assert.equal(restored.slides[0].task.question, source.slides[0].task.question, type);
    for (const field of ['label', 'hint', 'feedback']) assert.equal(restored.slides[0].task[field], source.slides[0].task[field], `${type}.${field}`);
    const student = lessonParser.parseLesson(markdown, 'entery.md').slides[0];
    assert.match(student.html, /<strong>jeden<\/strong><br>Wiersz dwa/);
    assert.match(student.html, /<p>Osobny akapit/);
    if (['abcd', 'choice', 'gaps'].includes(type)) {
      assert.deepEqual(restored.slides[0].task.options, options);
      assert.deepEqual(student.task.options, options);
      if (type !== 'gaps') assert.equal(lessonParser.checkAnswer(student.task, type === 'abcd' ? 'A' : options[0]), true);
    }
  }
  for (const invalid of ['options_json: [1,2]', 'label_json: {}', 'answer_json: "a"']) {
    const source = `# Test\n\n:::task\ntype: text\nanswer: a\n${invalid}\n:::`;
    assert.throws(() => studio.parseLesson(source, 'test.md'));
    assert.throws(() => lessonParser.parseLesson(source, 'test.md'));
  }
  assert.match(lessonParser.renderMarkdown('Tekst\n<script>alert(1)</script>'), /&lt;script&gt;/);
});

test('studio creates an editable starter lesson for a new or empty GitHub file', () => {
  const lesson = studio.parseEditableLesson('', 'lekcja.md');
  const markdown = studio.serializeLesson(lesson);

  assert.equal(lesson.filename, 'lekcja.md');
  assert.equal(lesson.title, 'Lekcja');
  assert.equal(lesson.slides.length, 1);
  assert.ok(lesson.slides[0].blocks.length >= 2);
  assert.equal(studio.validateLesson(lesson).valid, true);
  assert.match(markdown, /^# Lekcja/m);
  assert.match(markdown, /## Wprowadzenie/);
  assert.match(markdown, /Wpisz tutaj treść pierwszego slajdu\./);
  assert.doesNotThrow(() => lessonParser.parseLesson(markdown, lesson.filename));
  assert.equal(
    studio.parseEditableLesson('# Istniejąca\n\nTreść.', 'istniejaca.md').title,
    'Istniejąca'
  );
  assert.throws(() => studio.parseLesson('', 'lekcja.md'), /plik lekcji jest pusty/i);
});

test('studio serializes visual blocks and an ABCD quiz to deterministic lesson Markdown', () => {
  const lesson = studio.createLesson({
    title: 'Wiązania chemiczne',
    filename: 'wiazania.md',
    slides: [
      {
        blocks: [
          { type: 'text', text: 'Poznaj podstawy.' },
          { type: 'list', items: ['wiązanie jonowe', 'wiązanie kowalencyjne'] },
          { type: 'quote', text: 'Elektrony walencyjne decydują o wiązaniach.' }
        ]
      },
      {
        blocks: [
          { type: 'heading', level: 2, text: 'Quiz' },
          { type: 'image', alt: 'Model cząsteczki', url: 'https://example.com/model.png' }
        ],
        task: {
          type: 'abcd',
          question: 'Które wiązanie polega na uwspólnieniu elektronów?',
          options: ['Jonowe', 'Kowalencyjne', 'Metaliczne', 'Wodorowe'],
          correctOption: 1,
          hint: 'Pomyśl o wspólnej parze elektronowej.',
          feedback: 'Brawo — to wiązanie kowalencyjne.'
        }
      }
    ]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.equal(markdown, [
    '# Wiązania chemiczne',
    '',
    'Poznaj podstawy.',
    '',
    '- wiązanie jonowe',
    '- wiązanie kowalencyjne',
    '',
    '> Elektrony walencyjne decydują o wiązaniach.',
    '',
    '---',
    '',
    '## Quiz',
    '',
    '![Model cząsteczki](https://example.com/model.png)',
    '',
    'Które wiązanie polega na uwspólnieniu elektronów?',
    '',
    ':::task',
    'type: abcd',
    'label: Wybierz odpowiedź',
    'options: Jonowe | Kowalencyjne | Metaliczne | Wodorowe',
    'answer: B',
    'hint: Pomyśl o wspólnej parze elektronowej.',
    'success: Brawo — to wiązanie kowalencyjne.',
    ':::',
    ''
  ].join('\n'));

  const published = lessonParser.parseLesson(markdown, lesson.filename);
  assert.equal(published.title, 'Wiązania chemiczne');
  assert.equal(published.slides.length, 2);
  assert.equal(published.slides[1].task.choiceStyle, 'abcd');
  assert.equal(lessonParser.checkAnswer(published.slides[1].task, 'B'), true);
  assert.equal(lessonParser.checkAnswer(published.slides[1].task, 'Kowalencyjne'), true);
  assert.match(published.slides[1].html, /https:\/\/example\.com\/model\.png/);
});

test('studio emits text and numeric questions with hints and positive feedback', () => {
  const markdown = studio.serializeLesson({
    title: 'Krótki sprawdzian',
    filename: 'sprawdzian.md',
    slides: [
      {
        blocks: [{ type: 'heading', level: 2, text: 'Symbol pierwiastka' }],
        task: {
          type: 'text',
          question: 'Podaj symbol tlenu.',
          answers: ['O'],
          caseSensitive: true,
          placeholder: 'Wpisz symbol',
          hint: 'To jedna wielka litera.',
          feedback: 'Poprawnie!'
        }
      },
      {
        blocks: [{ type: 'heading', level: 2, text: 'Liczba atomowa' }],
        task: {
          type: 'number',
          question: 'Ile protonów ma atom tlenu?',
          answer: 8,
          label: 'Liczba protonów',
          hint: 'Sprawdź układ okresowy.',
          feedback: 'Tak — tlen ma 8 protonów.'
        }
      }
    ]
  });

  const lesson = lessonParser.parseLesson(markdown, 'sprawdzian.md');
  assert.equal(lesson.slides[0].task.type, 'text');
  assert.equal(lesson.slides[0].task.caseSensitive, true);
  assert.equal(lessonParser.checkAnswer(lesson.slides[0].task, 'O'), true);
  assert.equal(lessonParser.checkAnswer(lesson.slides[0].task, 'o'), false);
  assert.equal(lesson.slides[0].task.hint, 'To jedna wielka litera.');
  assert.equal(lesson.slides[0].task.success, 'Poprawnie!');
  assert.equal(lesson.slides[1].task.type, 'number');
  assert.equal(lessonParser.checkAnswer(lesson.slides[1].task, '8,0'), true);
  assert.equal(lesson.slides[1].task.success, 'Tak — tlen ma 8 protonów.');
});

test('studio imports the published lesson into editable blocks and preserves task semantics', () => {
  const source = [
    '# Izotopy',
    '',
    'Treść wprowadzenia.',
    '',
    '---',
    '',
    '## Zadanie',
    '',
    'Ile neutronów ma węgiel-13?',
    '',
    ':::task',
    'type: number',
    'label: Liczba neutronów',
    'answer: 7',
    'hint: Oblicz A − Z.',
    'success: Dobrze!',
    ':::'
  ].join('\n');

  const model = studio.parseLesson(source, 'izotopy.md');
  assert.equal(model.title, 'Izotopy');
  assert.equal(model.slides.length, 2);
  assert.equal(model.slides[1].task.question, 'Ile neutronów ma węgiel-13?');
  assert.deepEqual(model.slides[1].task.answers, ['7']);
  assert.equal(model.slides[1].task.feedback, 'Dobrze!');

  const reparsed = lessonParser.parseLesson(studio.serializeLesson(model), 'izotopy.md');
  assert.equal(reparsed.slides[1].task.type, 'number');
  assert.equal(lessonParser.checkAnswer(reparsed.slides[1].task, '7'), true);
});

test('complex task questions keep paragraphs and Markdown structure across export and import', () => {
  const questions = [
    'Pierwszy akapit pytania.\n\nDrugi akapit pytania?',
    '### Wybierz poprawną odpowiedź',
    '- atom\n- cząsteczka',
    '> Zinterpretuj tę wskazówkę.',
    '![Schemat](https://example.com/schemat.png)'
  ];
  const lesson = studio.createLesson({
    title: 'Złożone pytania',
    filename: 'zlozone-pytania.md',
    slides: questions.map((question, index) => ({
      blocks: [{ type: 'heading', level: 2, text: `Krok ${index + 1}` }],
      task: {
        type: 'text',
        question,
        answers: ['tak']
      }
    }))
  });

  const markdown = studio.serializeLesson(lesson);
  assert.equal((markdown.match(/:::question/g) || []).length, questions.length);

  const imported = studio.parseLesson(markdown, lesson.filename);
  assert.deepEqual(imported.slides.map((slide) => slide.task.question), questions);

  const published = lessonParser.parseLesson(markdown, lesson.filename);
  published.slides.forEach((slide) => {
    assert.match(slide.html, /class="lesson-question"/);
    assert.doesNotMatch(slide.html, /:::question/);
  });

  const legacy = studio.parseLesson([
    '# Starszy zapis',
    '',
    '### Pytanie jako nagłówek',
    '',
    ':::task',
    'type: text',
    'answer: tak',
    ':::'
  ].join('\n'), 'starszy.md');
  assert.equal(legacy.slides[0].task.question, '### Pytanie jako nagłówek');
});

test('studio serializes code, callouts, safe style containers and accordions', () => {
  const lesson = studio.createLesson({
    title: 'Materiały interaktywne',
    slides: [{
      blocks: [
        { type: 'callout', tone: 'tip', title: 'Wskazówka', text: 'Zapisz jednostkę.' },
        { type: 'code', language: 'js', code: 'const mol = 6.022e23;' },
        {
          type: 'style',
          font: 'arial',
          bold: true,
          color: '#0F766E',
          size: 'large',
          align: 'center',
          blocks: [{ type: 'text', text: 'Wyróżniona definicja.' }]
        },
        {
          type: 'accordion',
          title: 'Pokaż rozwiązanie',
          open: true,
          blocks: [
            { type: 'heading', level: 3, text: 'Rozwiązanie' },
            { type: 'text', text: 'Najpierw oblicz liczbę moli.' }
          ]
        }
      ]
    }]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /> \*\*Wskazówka:\*\* Zapisz jednostkę\./);
  assert.match(markdown, /```js\nconst mol = 6\.022e23;\n```/);
  assert.match(markdown, /:::style font=arial color=#0f766e bold=true size=large align=center\nWyróżniona definicja\.\n:::/);
  assert.match(markdown, /:::accordion Pokaż rozwiązanie open=true\n### Rozwiązanie\n\nNajpierw oblicz liczbę moli\.\n:::/);

  const imported = studio.parseLesson(markdown, 'materialy.md');
  assert.equal(imported.slides[0].blocks.find((block) => block.type === 'callout').title, 'Wskazówka');
  assert.equal(imported.slides[0].blocks.find((block) => block.type === 'style').font, 'arial');
  assert.equal(imported.slides[0].blocks.find((block) => block.type === 'style').bold, true);
  assert.equal(imported.slides[0].blocks.find((block) => block.type === 'style').color, '#0f766e');
  assert.equal(imported.slides[0].blocks.find((block) => block.type === 'accordion').blocks.length, 2);
  assert.equal(imported.slides[0].blocks.find((block) => block.type === 'accordion').open, true);
  assert.match(lessonParser.parseLesson(markdown, 'materialy.md').slides[0].html, /<details class="lesson-accordion" open>/);
});

test('studio creates, previews and reimports accessible lesson tables', () => {
  const lesson = studio.createLesson({
    title: 'Porównanie substancji',
    filename: 'tabela.md',
    slides: [{
      blocks: [{
        type: 'table',
        caption: 'Właściwości w temperaturze pokojowej',
        align: 'center',
        headers: ['Substancja', 'Wzór', 'Stan skupienia'],
        rows: [
          ['Woda', 'H~2~O', 'ciecz'],
          ['Tlen', 'O~2~', 'gaz']
        ]
      }]
    }]
  });

  assert.equal(studio.validateLesson(lesson).valid, true);
  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::table/);
  assert.match(markdown, /caption: Właściwości w temperaturze pokojowej/);
  assert.match(markdown, /align: center/);
  assert.match(markdown, /headers: Substancja \| Wzór \| Stan skupienia/);
  assert.match(markdown, /row: Woda \| H~2~O \| ciecz/);

  const imported = studio.parseLesson(markdown, lesson.filename);
  const table = imported.slides[0].blocks.find((block) => block.type === 'table');
  assert.equal(table.caption, 'Właściwości w temperaturze pokojowej');
  assert.equal(table.align, 'center');
  assert.deepEqual(table.headers, ['Substancja', 'Wzór', 'Stan skupienia']);
  assert.deepEqual(table.rows, [
    ['Woda', 'H~2~O', 'ciecz'],
    ['Tlen', 'O~2~', 'gaz']
  ]);

  const html = lessonParser.parseLesson(markdown, lesson.filename).slides[0].html;
  assert.match(html, /class="lesson-table lesson-table-align-center"/);
  assert.match(html, /<caption>Właściwości w temperaturze pokojowej<\/caption>/);
  assert.match(html, /<th scope="col">Substancja<\/th>/);
  assert.match(html, /H<sub>2<\/sub>O/);

  const invalid = studio.createLesson({
    title: 'Błędna tabela',
    slides: [{
      blocks: [{
        type: 'table',
        headers: ['A', 'B'],
        rows: [['tylko jedna komórka']]
      }]
    }]
  });
  const validation = studio.validateLesson(invalid);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0].code, 'INVALID_TABLE');
});

test('studio round-trips chemistry reactions and safe mathematical formulas', () => {
  const lesson = studio.createLesson({
    title: 'Wzory i reakcje',
    filename: 'wzory.md',
    slides: [{
      blocks: [
        {
          type: 'formula',
          mode: 'chemistry',
          title: 'Spalanie wodoru',
          left: '2 H2 + O2',
          arrow: '->',
          above: '450 °C',
          below: 'kat. Pt',
          right: '2 H2O'
        },
        {
          type: 'formula',
          mode: 'math',
          title: 'Stężenie molowe',
          expression: 'c = \\frac{n}{V}'
        }
      ]
    }]
  });

  assert.equal(studio.validateLesson(lesson).valid, true);
  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::formula\nmode: chemistry/);
  assert.match(markdown, /above: 450 °C/);
  assert.match(markdown, /below: kat\. Pt/);
  assert.match(markdown, /expression: c = \\frac\{n\}\{V\}/);

  const imported = studio.parseLesson(markdown, lesson.filename);
  const chemistry = imported.slides[0].blocks.find((block) => block.type === 'formula' && block.mode === 'chemistry');
  const math = imported.slides[0].blocks.find((block) => block.type === 'formula' && block.mode === 'math');
  assert.equal(chemistry.arrow, '->');
  assert.equal(chemistry.above, '450 °C');
  assert.equal(math.expression, 'c = \\frac{n}{V}');

  const published = lessonParser.parseLesson(markdown, lesson.filename);
  assert.match(published.slides[0].html, /lesson-formula-chemistry/);
  assert.match(published.slides[0].html, /lesson-formula-math/);
  assert.ok(published.slides[0].html.includes('\\(\\ce{2 H2 + O2 -&gt;[450 °C][kat. Pt] 2 H2O}\\)'));
  assert.ok(published.slides[0].html.includes('\\(\\displaystyle c = \\frac{n}{V}\\)'));

  const unsafe = studio.createLesson({
    title: 'Niebezpieczny wzór',
    slides: [{
      blocks: [{ type: 'formula', mode: 'math', expression: '\\href{javascript:alert(1)}{kliknij}' }]
    }]
  });
  assert.equal(studio.validateLesson(unsafe).valid, false);
  assert.equal(studio.validateLesson(unsafe).errors[0].code, 'INVALID_MATH_FORMULA');
});

test('studio publishes backgrounds, YouTube, Google Slides, ATONOM, flashcards and selectable text gaps', () => {
  const lesson = studio.createLesson({
    title: 'Chemia angażująca',
    filename: 'chemia-angazujaca.md',
    slides: [{
      blocks: [
        {
          type: 'style',
          font: 'rounded',
          color: '#173f35',
          background: '#dff7ed',
          size: 'large',
          align: 'center',
          blocks: [{ type: 'text', text: 'Zapamiętaj grupy funkcyjne.' }]
        },
        { type: 'youtube', video: 'https://youtu.be/M7lc1UVf-VE', title: 'Wprowadzenie' },
        {
          type: 'slides',
          presentation: 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit',
          title: 'Prezentacja do lekcji'
        },
        { type: 'atonom', formula: 'kwas octowy', title: 'Obejrzyj model 3D' },
        {
          type: 'flashcards',
          title: 'Szybka powtórka',
          color: '#7c3aed',
          cards: [
            { front: '–OH', back: 'grupa hydroksylowa' },
            { front: '–COOH', back: 'grupa karboksylowa' }
          ]
        }
      ],
      task: {
        type: 'gaps',
        question: 'Uzupełnij opis.',
        text: 'Etanol jest {{typ związku}}, a zawarta w nim grupa to {{nazwa grupy}}.',
        options: ['alkoholem', 'aldehydem', 'hydroksylowa', 'karboksylowa'],
        answers: ['alkoholem', 'hydroksylowa'],
        feedback: 'Wszystkie luki są poprawne.'
      }
    }]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /background=#dff7ed/);
  assert.match(markdown, /:::youtube\nid: M7lc1UVf-VE\n/);
  assert.match(markdown, /:::googleslides\nid: 1AbCdEfGhIjKlMnOpQrStUvWxYz\npublished: false\n/);
  assert.match(markdown, /published: false\ncontrols: true\n/);
  assert.match(markdown, /:::atonom\nformula: kwas octowy\n/);
  assert.match(markdown, /–OH => grupa hydroksylowa/);
  assert.match(markdown, /type: gaps/);
  assert.match(markdown, /text: Etanol jest \{\{typ związku\}\}/);

  const imported = studio.parseLesson(markdown, lesson.filename);
  assert.deepEqual(
    imported.slides[0].blocks.map((block) => block.type),
    ['heading', 'style', 'youtube', 'slides', 'atonom', 'flashcards']
  );
  assert.equal(imported.slides[0].blocks[1].background, '#dff7ed');
  assert.equal(imported.slides[0].blocks[3].presentation, '1AbCdEfGhIjKlMnOpQrStUvWxYz');
  assert.equal(imported.slides[0].blocks[3].controls, true);
  assert.equal(imported.slides[0].blocks[4].formula, 'kwas octowy');
  assert.equal(imported.slides[0].blocks[5].cards.length, 2);
  assert.equal(imported.slides[0].task.type, 'gaps');

  const published = lessonParser.parseLesson(markdown, lesson.filename);
  const slide = published.slides[0];
  assert.match(slide.html, /youtube-nocookie\.com\/embed\/M7lc1UVf-VE/);
  assert.match(slide.html, /playsinline=1&amp;rel=0/);
  assert.match(slide.html, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.match(slide.html, /docs\.google\.com\/presentation\/d\/1AbCdEfGhIjKlMnOpQrStUvWxYz\/embed/);
  assert.match(slide.html, /class="lesson-embed lesson-google-slides"/);
  assert.match(slide.html, /sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"/);
  assert.doesNotMatch(slide.html, /rm=minimal/);
  const hiddenControls = lessonParser.renderMarkdown(studio.serializeBlock(studio.createBlock('slides', {
    presentation: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
    controls: false,
    title: 'Prezentacja bez kontrolek'
  })));
  assert.match(hiddenControls, /rm=minimal/);
  assert.match(slide.html, /\/members\/module\/atonom\/\?formula=kwas%20octowy/);
  assert.match(slide.html, /class="lesson-atonom-card"/);
  assert.match(slide.html, /class="lesson-atonom-open"/);
  assert.doesNotMatch(slide.html, /<figure class="lesson-embed lesson-atonom"[^>]*><iframe/);
  assert.match(slide.html, /class="lesson-flashcard"/);
  assert.match(slide.html, /--lesson-rich-background:#dff7ed/);
  assert.equal(lessonParser.checkAnswer(slide.task, ['alkoholem', 'hydroksylowa']), true);
  assert.equal(lessonParser.checkAnswer(slide.task, ['aldehydem', 'hydroksylowa']), false);
});

test('selectable true-false gaps preserve Enter line breaks through save and student rendering', () => {
  const taskText = [
    'A. Każde białko ma strukturę trzeciorzędową. {{odpowiedź A}}',
    'B. Struktura czwartorzędowa wymaga kilku łańcuchów. {{odpowiedź B}}',
    'C. Pojedynczy łańcuch może mieć strukturę trzeciorzędową. {{odpowiedź C}}'
  ].join('\n');
  const lesson = studio.createLesson({
    title: 'Prawda czy fałsz',
    filename: 'prawda-falsz.md',
    slides: [{
      task: {
        type: 'gaps',
        question: 'Oceń każde zdanie.',
        text: taskText,
        options: ['Prawda', 'Fałsz'],
        answers: ['Fałsz', 'Prawda', 'Prawda']
      }
    }]
  });

  assert.equal(lesson.slides[0].task.text, taskText);
  const markdown = studio.serializeLesson(lesson);
  assert.ok(markdown.includes(`text_json: ${JSON.stringify(taskText)}`));
  assert.equal(studio.parseLesson(markdown, lesson.filename).slides[0].task.text, taskText);
  assert.equal(lessonParser.parseLesson(markdown, lesson.filename).slides[0].task.text, taskText);
});

test('studio round-trips manually typed gaps and their checking mode', () => {
  const lesson = studio.createLesson({
    title: 'Luki wpisywane przez ucznia',
    filename: 'luki-wpisywane.md',
    slides: [{
      blocks: [{ type: 'heading', level: 2, text: 'Wzór i masa molowa' }],
      task: {
        type: 'gaps-text',
        question: 'Uzupełnij zdanie bez korzystania z listy.',
        text: 'Woda ma wzór {{wzór}}, a jej masa molowa wynosi około {{masa}} g/mol.',
        answers: ['H2O', '18'],
        checkMode: 'each',
        caseSensitive: true,
        hint: 'Sprawdź indeks dolny i masy atomowe.',
        feedback: 'Obie luki są poprawne.'
      }
    }]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /type: gaps-text/);
  assert.match(markdown, /check_mode: each/);
  assert.match(markdown, /case_sensitive: true/);
  assert.match(markdown, /answer: H2O \| 18/);

  const imported = studio.parseLesson(markdown, lesson.filename);
  assert.equal(imported.slides[0].task.type, 'gaps-text');
  assert.equal(imported.slides[0].task.checkMode, 'each');
  assert.deepEqual(imported.slides[0].task.answers, ['H2O', '18']);

  const published = lessonParser.parseLesson(markdown, lesson.filename);
  assert.equal(lessonParser.checkGapAnswer(published.slides[0].task, 'H2O', 0), true);
  assert.equal(lessonParser.checkGapAnswer(published.slides[0].task, 'h2o', 0), false);
  assert.equal(lessonParser.checkAnswer(published.slides[0].task, ['H2O', '18']), true);

  const invalid = studio.validateLesson({
    title: 'Błędne luki',
    slides: [{
      task: {
        type: 'gaps-text',
        text: 'Tylko {{jedna luka}}.',
        answers: ['pierwsza', 'druga']
      }
    }]
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.some((error) => error.code === 'INVALID_GAPS'), true);
});

test('studio round-trips a lesson contact form without exposing active HTML', () => {
  const lesson = studio.createLesson({
    title: 'Kontakt w lekcji',
    filename: 'kontakt-w-lekcji.md',
    slides: [{
      blocks: [{
        type: 'contact',
        title: 'Zapytaj prowadzącego',
        description: 'Napisz, który krok wymaga wyjaśnienia.',
        button: 'Otwórz formularz',
        internal: 'Pytanie do lekcji o wiązaniach',
        newTab: true
      }]
    }]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::contactform/);
  assert.match(markdown, /internal: Pytanie do lekcji o wiązaniach/);

  const imported = studio.parseLesson(markdown, lesson.filename);
  assert.equal(imported.slides[0].blocks[1].type, 'contact');
  assert.equal(imported.slides[0].blocks[1].newTab, true);

  const published = lessonParser.parseLesson(markdown, lesson.filename);
  assert.match(published.slides[0].html, /lesson-contact-card/);
  assert.match(published.slides[0].html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(published.slides[0].html, /<script/i);
});

test('studio round-trips link tiles and a separate transition for every slide', () => {
  const lesson = studio.createLesson({
    title: 'Materiały dodatkowe',
    filename: 'materialy-dodatkowe.md',
    slides: [
      {
        transition: 'rise',
        background: 'grid',
        decoration: 'molecules',
        textTone: 'dark',
        blocks: [
          { type: 'heading', level: 2, text: 'Czytaj dalej' },
          {
            type: 'link',
            title: 'Tablica wzorów',
            description: 'Otwórz pomocniczy materiał w nowej karcie.',
            url: 'https://example.com/wzory',
            icon: 'math',
            color: '#2563eb',
            newTab: true
          }
        ]
      },
      {
        transition: 'none',
        background: 'custom',
        backgroundColor: '#123456',
        textTone: 'light',
        blocks: [{ type: 'text', text: 'Ten slajd pojawia się bez animacji.' }]
      }
    ]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::slide\ntransition: rise\nbackground: grid\ndecoration: molecules\ntext_tone: dark\n:::/);
  assert.match(markdown, /:::slide\ntransition: none\nbackground: custom\nbackground_color: #123456\ntext_tone: light\n:::/);
  assert.match(markdown, /:::linkcard\n[\s\S]*title: Tablica wzorów/);
  assert.match(markdown, /url: https:\/\/example\.com\/wzory/);
  assert.match(markdown, /icon: math/);
  assert.match(markdown, /new_tab: true/);

  const imported = studio.parseLesson(markdown, lesson.filename);
  assert.equal(imported.slides[0].transition, 'rise');
  assert.equal(imported.slides[1].transition, 'none');
  assert.equal(imported.slides[0].background, 'grid');
  assert.equal(imported.slides[0].decoration, 'molecules');
  assert.equal(imported.slides[1].background, 'custom');
  assert.equal(imported.slides[1].backgroundColor, '#123456');
  assert.equal(imported.slides[1].textTone, 'light');
  const link = imported.slides[0].blocks.find((block) => block.type === 'link');
  assert.equal(link.title, 'Tablica wzorów');
  assert.equal(link.icon, 'math');
  assert.equal(link.color, '#2563eb');
  assert.equal(link.newTab, true);

  const published = lessonParser.parseLesson(markdown, lesson.filename);
  assert.equal(published.slides[0].transition, 'rise');
  assert.equal(published.slides[1].transition, 'none');
  assert.equal(published.slides[0].background, 'grid');
  assert.equal(published.slides[0].decoration, 'molecules');
  assert.equal(published.slides[1].backgroundColor, '#123456');
  assert.match(published.slides[0].html, /class="lesson-link-card"/);
  assert.match(published.slides[0].html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(published.slides[0].html, /--link-card-color:#2563eb/);
});

test('studio round-trips slide AI help and both interactive board variants', () => {
  const lesson = studio.createLesson({
    title: 'Pomoc na slajdzie',
    filename: 'pomoc-na-slajdzie.md',
    slides: [{
      blocks: [
        { type: 'heading', level: 2, text: 'Reakcje redoks' },
        {
          type: 'ai',
          title: 'Zapytaj o reakcję',
          description: 'AI otrzyma treść bieżącego slajdu.',
          button: 'Otwórz pomoc',
          repositoryId: 'organiczna',
          promptFile: 'korepetytor.txt',
          promptPoint: 4,
          authorContext: 'Slajd Google pokazuje utlenianie alkoholu.\nPo lewej jest substrat, po prawej produkt; podpis zawiera ::: i <znacznik>.',
          includeSlide: true,
          includeTask: false
        },
        {
          type: 'board',
          title: 'Szybki szkic',
          variant: 'whiteboard',
          newTab: false
        },
        {
          type: 'board',
          title: 'Gotowa plansza',
          variant: 'bitpaper',
          path: 'redoks.json',
          newTab: true
        }
      ]
    }]
  });

  assert.equal(studio.validateLesson(lesson).valid, true);
  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::aihelp[\s\S]*repository: organiczna[\s\S]*prompt: korepetytor\.txt[\s\S]*point: 4/);
  assert.match(markdown, /include_slide: true/);
  assert.match(markdown, /include_task: false/);
  assert.ok(markdown.includes(`context_json: ${JSON.stringify(lesson.slides[0].blocks[1].authorContext)}`));
  assert.match(markdown, /:::board[\s\S]*variant: whiteboard[\s\S]*new_tab: false/);
  assert.match(markdown, /:::board[\s\S]*variant: bitpaper[\s\S]*path: redoks\.json[\s\S]*new_tab: true/);

  const imported = studio.parseLesson(markdown, lesson.filename);
  const ai = imported.slides[0].blocks.find((block) => block.type === 'ai');
  const boards = imported.slides[0].blocks.filter((block) => block.type === 'board');
  assert.equal(ai.repositoryId, 'organiczna');
  assert.equal(ai.promptFile, 'korepetytor.txt');
  assert.equal(ai.promptPoint, 4);
  assert.equal(ai.authorContext, lesson.slides[0].blocks[1].authorContext);
  assert.equal(ai.includeSlide, true);
  assert.equal(ai.includeTask, false);
  assert.deepEqual(boards.map((block) => block.variant), ['whiteboard', 'bitpaper']);
  assert.equal(boards[0].newTab, false);
  assert.equal(boards[1].path, 'redoks.json');

  const published = lessonParser.parseLesson(markdown, lesson.filename);
  assert.match(published.slides[0].html, /class="lesson-support-card lesson-ai-help"/);
  assert.match(published.slides[0].html, /data-ai-prompt="korepetytor\.txt"/);
  assert.match(published.slides[0].html, /data-ai-repository="organiczna"/);
  assert.match(published.slides[0].html, /data-ai-include-slide="true"/);
  assert.match(published.slides[0].html, /data-ai-include-task="false"/);
  assert.match(published.slides[0].html, /data-ai-author-context="&quot;Slajd Google pokazuje utlenianie alkoholu\.[\s\S]*&lt;znacznik&gt;\.&quot;"/);
  assert.match(published.slides[0].html, /href="\/members\/module\/whiteboard\/"/);
  assert.match(published.slides[0].html, /href="\/members\/module\/bitpaper\/\?path=redoks\.json"/);

  const invalid = studio.validateLesson({
    title: 'Błędne narzędzia',
    slides: [{
      blocks: [
        { type: 'ai', promptFile: '../sekret.txt' },
        { type: 'board', variant: 'bitpaper', path: '../plansza.json' }
      ]
    }]
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.some((error) => error.code === 'INVALID_AI_PROMPT'), true);
  assert.equal(invalid.errors.some((error) => error.code === 'INVALID_BOARD_PATH'), true);

  assert.throws(
    () => studio.parseLesson('# AI\n\n:::aihelp\ncontext_json: {broken}\n:::', 'ai.md'),
    (error) => error.code === 'INVALID_AI_CONTEXT'
  );
});

test('studio rejects unsafe image URLs, malformed quizzes and ambiguous code fences', () => {
  const unsafeImage = studio.validateLesson({
    title: 'Obraz',
    slides: [{ blocks: [{ type: 'image', alt: 'XSS', url: 'javascript:alert(1)' }] }]
  });
  assert.equal(unsafeImage.valid, false);
  assert.equal(unsafeImage.errors[0].code, 'UNSAFE_IMAGE_URL');

  assert.throws(
    () => studio.serializeLesson({
      title: 'Quiz',
      slides: [{
        task: {
          type: 'abcd',
          options: ['A', 'B', 'C'],
          correctOption: 1
        }
      }]
    }),
    (error) => error.code === 'INVALID_ABCD_OPTIONS'
  );

  assert.throws(
    () => studio.serializeLesson({
      title: 'Kod',
      slides: [{ blocks: [{ type: 'code', code: 'tekst\n```html\nwięcej' }] }]
    }),
    (error) => error.code === 'CODE_FENCE_COLLISION'
  );

  assert.throws(
    () => studio.serializeLesson({
      title: 'Liczby',
      slides: [{ task: { type: 'number', answer: 'siedem' } }]
    }),
    (error) => error.code === 'INVALID_NUMBER_ANSWER'
  );

  const filename = studio.validateLesson({
    title: 'Plik',
    filename: '../plik.md',
    slides: [{ blocks: [{ type: 'text', text: 'Treść' }] }]
  });
  assert.equal(filename.valid, false);
  assert.equal(filename.errors.some((error) => error.code === 'INVALID_FILENAME'), true);

  const unsafeLink = studio.validateLesson({
    title: 'Link',
    slides: [{
      blocks: [{
        type: 'link',
        title: 'Nie otwieraj',
        url: 'javascript:alert(1)',
        icon: 'link',
        color: '#0e665a'
      }]
    }]
  });
  assert.equal(unsafeLink.valid, false);
  assert.equal(unsafeLink.errors.some((error) => error.code === 'INVALID_LINK_CARD'), true);
});

test('studio exposes renderer extension capabilities and a strict authoring filename policy', () => {
  assert.equal(studio.capabilities.styledContainers, true);
  assert.equal(studio.capabilities.accordions, true);
  assert.equal(studio.capabilities.youtube, true);
  assert.equal(studio.capabilities.googleSlides, true);
  assert.equal(studio.capabilities.atonom, true);
  assert.equal(studio.capabilities.aiHelp, true);
  assert.equal(studio.capabilities.interactiveBoards, true);
  assert.equal(studio.capabilities.linkCards, true);
  assert.equal(studio.capabilities.flashcards, true);
  assert.deepEqual(studio.capabilities.slideTransitions, ['none', 'fade', 'rise', 'slide', 'zoom']);
  assert.ok(studio.capabilities.tasks.includes('gaps'));
  assert.ok(studio.capabilities.tasks.includes('gaps-text'));
  assert.equal(studio.capabilities.nestedContainers, false);
  assert.deepEqual(studio.capabilities.styleFonts, [
    'sans',
    'arial',
    'verdana',
    'serif',
    'georgia',
    'times',
    'rounded',
    'mono',
    'courier'
  ]);
  assert.equal(studio.validateFilename('dzial-1.md'), 'dzial-1.md');
  assert.equal(studio.validateFilename('../sekret.md'), '');
  assert.equal(studio.safeImageUrl('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(studio.safeImageUrl('http://example.com/a.png'), '');
  assert.equal(studio.safeImageUrl('data:image/png;base64,AAA'), '');
  assert.equal(studio.safeLinkUrl('/members/module/lesson/'), '/members/module/lesson/');
  assert.equal(studio.safeLinkUrl('mailto:nauczyciel@example.com'), 'mailto:nauczyciel@example.com');
  assert.equal(studio.safeLinkUrl('javascript:alert(1)'), '');
});

test('lesson export migrates removed FilmV1 links to the supported Film module', () => {
  const markdown = studio.serializeLesson({
    title: 'Nagranie',
    filename: 'nagranie.md',
    slides: [{
      blocks: [{
        type: 'text',
        text: '[Obejrzyj](/members/module/filmv1/?id=CH50zuS8DD0&type=1)'
      }]
    }]
  });

  assert.match(markdown, /\/members\/module\/film\/\?id=CH50zuS8DD0&type=1/);
  assert.doesNotMatch(markdown, /filmv1/i);
});

test('lesson keeps a stable exam reference and derives pass conditions without copying exam JSON', () => {
  const lesson = studio.createLesson({
    title: 'Lekcja z egzaminem',
    filename: 'lekcja-egzamin.md',
    navigation: 'sequential',
    slides: [{
      id: 'exam-step',
      includeInLesson: 'OFF',
      requiredToAdvance: true,
      blocks: [studio.createBlock('exam', {
        repositoryId: 'default', examId: 'alkohole-test', title: 'Sprawdź alkohole',
        description: 'Próba działowa', button: 'Rozpocznij', requirement: 'minimum_score', minimumScore: 75
      })]
    }, { id: 'summary', blocks: [studio.createBlock('text', { text: 'Podsumowanie.' })] }]
  });
  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::exam[\s\S]*repository: default[\s\S]*exam: alkohole-test/);
  assert.match(markdown, /requirement: minimum_score[\s\S]*minimum_score: 75/);
  assert.doesNotMatch(markdown, /correctAnswer|questions\s*:/);

  const editable = studio.parseEditableLesson(markdown, 'lekcja-egzamin.md');
  const examBlock = editable.slides[0].blocks.find((block) => block.type === 'exam');
  assert.equal(examBlock.examId, 'alkohole-test');
  assert.equal(examBlock.minimumScore, 75);
  assert.deepEqual(editable.slides[0].condition, {
    type: 'minimum_score', materialId: 'exam:default:alkohole-test', minimumScore: 75
  });

  const runtime = lessonParser.parseLesson(markdown, 'lekcja-egzamin.md');
  assert.match(runtime.slides[0].html, /class="lesson-support-card lesson-exam-card"/);
  assert.match(runtime.slides[0].html, /\/members\/module\/exam\/\?repo=default&amp;exam=alkohole-test/);
  assert.match(runtime.slides[0].html, /data-exam-requirement="minimum_score"/);
});

test('lesson round-trips quiz, PDF and native presentation references from the material library', () => {
  const lesson = studio.createLesson({
    title: 'Materiały w lekcji',
    filename: 'materialy-w-lekcji.md',
    slides: [{
      blocks: [
        studio.createBlock('presentation', {
          repositoryId: 'organiczna',
          presentationId: 'alkohole-slajdy',
          title: 'Prezentacja o alkoholach'
        }),
        studio.createBlock('quiz', {
          repositoryId: 'organiczna',
          quizId: 'alkohole-quiz',
          title: 'Szybki quiz'
        }),
        studio.createBlock('pdf', {
          pdfId: '1PdfDriveId12345',
          protection: '1',
          title: 'Karta pracy'
        })
      ]
    }]
  });

  assert.equal(studio.validateLesson(lesson).valid, true);
  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::presentation[\s\S]*repository: organiczna[\s\S]*presentation: alkohole-slajdy/);
  assert.match(markdown, /:::quiz[\s\S]*repository: organiczna[\s\S]*quiz: alkohole-quiz/);
  assert.match(markdown, /:::pdf[\s\S]*id: 1PdfDriveId12345[\s\S]*protection: 1/);

  const editable = studio.parseEditableLesson(markdown, lesson.filename);
  const materials = editable.slides[0].blocks.filter((block) => ['presentation', 'quiz', 'pdf'].includes(block.type));
  assert.deepEqual(materials.map((block) => block.type), ['presentation', 'quiz', 'pdf']);
  assert.equal(materials[0].presentationId, 'alkohole-slajdy');
  assert.equal(materials[1].quizId, 'alkohole-quiz');
  assert.equal(materials[2].pdfId, '1PdfDriveId12345');

  const runtime = lessonParser.parseLesson(markdown, lesson.filename);
  assert.match(runtime.slides[0].html, /class="lesson-support-card lesson-presentation-card"/);
  assert.match(runtime.slides[0].html, /\/members\/module\/presentation\/\?repo=organiczna&amp;presentation=alkohole-slajdy/);
  assert.match(runtime.slides[0].html, /class="lesson-support-card lesson-quiz-card"/);
  assert.match(runtime.slides[0].html, /\/members\/module\/quiz\/\?repo=organiczna&amp;quiz=alkohole-quiz&amp;material=quiz%3Aorganiczna%3Aalkohole-quiz/);
  assert.match(runtime.slides[0].html, /class="lesson-support-card lesson-pdf-card"/);
  assert.match(runtime.slides[0].html, /\/members\/module\/pdf\/\?id=1PdfDriveId12345&amp;type=1/);

  const unsafePdf = studio.validateLesson({
    title: 'Niebezpieczny PDF',
    slides: [{ blocks: [{ type: 'pdf', pdfId: 'https://evil.example/file.pdf', protection: '1' }] }]
  });
  assert.equal(unsafePdf.valid, false);
  assert.equal(unsafePdf.errors.some((error) => error.code === 'INVALID_PDF_REFERENCE'), true);
});

test('lesson canvas layout round-trips positioned blocks and remains safe in the student renderer', () => {
  const lesson = studio.createLesson({
    title: 'Swobodny slajd',
    filename: 'swobodny-slajd.md',
    slides: [{
      layout: 'canvas',
      blocks: [
        studio.createBlock('heading', {
          id: 'title-block',
          level: 2,
          text: 'Budowa H~2~O',
          layout: { mode: 'canvas', x: 4, y: 5, width: 52, height: 18 }
        }),
        studio.createBlock('image', {
          id: 'water-image',
          ref: 'assets/shared/woda.png',
          repositoryId: 'default',
          alt: 'Model cząsteczki wody',
          layout: { mode: 'canvas', x: 58, y: 12, width: 36, height: 62 }
        })
      ]
    }]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::slide\ntransition: fade\nlayout: canvas\n:::/);
  assert.match(markdown, /:::layout id=title-block x=4 y=5 width=52 height=18/);
  assert.match(markdown, /:::layout id=water-image x=58 y=12 width=36 height=62/);

  const editable = studio.parseEditableLesson(markdown, lesson.filename);
  assert.equal(editable.slides[0].layout, 'canvas');
  const editableImage = editable.slides[0].blocks.find((block) => block.id === 'water-image');
  assert.deepEqual(editableImage.layout, {
    mode: 'canvas', x: 58, y: 12, width: 36, height: 62
  });

  const runtime = lessonParser.parseLesson(markdown, lesson.filename);
  assert.equal(runtime.slides[0].layout, 'canvas');
  assert.match(runtime.slides[0].html, /class="lesson-canvas-element"/);
  assert.match(runtime.slides[0].html, /--lesson-canvas-x:58%/);
  assert.match(runtime.slides[0].html, /H<sub>2<\/sub>O/);
  assert.doesNotMatch(runtime.slides[0].html, /<script/i);
});

test('open student answers and linked reviews round-trip with stable IDs and nested answer-key blocks', () => {
  const lesson = studio.createLesson({
    title: 'Samodzielne porównanie odpowiedzi',
    filename: 'samodzielne-odpowiedzi.md',
    slides: [
      {
        blocks: [{
          type: 'student-answer',
          questionId: 'q_chem_001',
          question: 'Dlaczego **węgiel-14** jest izotopem węgla?\n\nOdwołaj się do protonów i neutronów.',
          placeholder: 'Wpisz własne wyjaśnienie…',
          minHeight: 220,
          multiline: true,
          maxLength: 1400,
          required: true,
          saveToProgress: true,
          allowEdit: true
        }]
      },
      { blocks: [{ type: 'text', text: 'Slajd można wstawić pomiędzy parę bez zrywania powiązania.' }] },
      {
        blocks: [{
          type: 'answer-review',
          questionId: 'q_chem_001',
          showStudentAnswer: true,
          aiEnabled: true,
          aiInstruction: 'Oceniaj sens merytoryczny.\nNie wymagaj identycznych słów.',
          order: 'student-first',
          answerKeyBlocks: [
            { type: 'heading', level: 3, text: 'Poprawna odpowiedź' },
            { type: 'text', text: 'Izotopy mają tę samą liczbę protonów, ale inną liczbę neutronów.\nWęgiel-14 nadal ma 6 protonów.' },
            { type: 'formula', mode: 'math', expression: '14 - 6 = 8', title: 'Liczba neutronów' },
            {
              type: 'table',
              caption: 'Porównanie',
              headers: ['Cecha', 'Węgiel-14'],
              rows: [['Protony', '6'], ['Neutrony', '8']]
            }
          ]
        }]
      }
    ]
  });

  assert.equal(studio.validateLesson(lesson).valid, true);
  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /:::studentanswer\nquestion_id: q_chem_001/);
  assert.match(markdown, /question_json: "Dlaczego \*\*węgiel-14\*\* jest izotopem węgla\?\\n\\nOdwołaj się/);
  assert.match(markdown, /:::answerreview\nquestion_id: q_chem_001/);
  assert.match(markdown, /ai_instruction_json: "Oceniaj sens merytoryczny\.\\nNie wymagaj identycznych słów\."/);
  assert.match(markdown, /key_json: ".*:::formula\\n.*:::table\\n/);

  const editable = studio.parseLesson(markdown, lesson.filename);
  const question = editable.slides[0].blocks.find((block) => block.type === 'student-answer');
  const review = editable.slides[2].blocks.find((block) => block.type === 'answer-review');
  assert.equal(question.questionId, 'q_chem_001');
  assert.equal(question.maxLength, 1400);
  assert.equal(question.saveToProgress, true);
  assert.equal(review.questionId, question.questionId);
  assert.equal(review.question, question.question);
  assert.equal(review.order, 'student-first');
  assert.deepEqual(review.answerKeyBlocks.map((block) => block.type), ['heading', 'text', 'formula', 'table']);

  const reordered = studio.createLesson({
    ...editable,
    slides: [editable.slides[0], { blocks: [{ type: 'text', text: 'Jeszcze jeden slajd.' }] }, ...editable.slides.slice(1)]
  });
  assert.equal(studio.validateLesson(reordered).valid, true);
  assert.equal(
    reordered.slides[3].blocks.find((block) => block.type === 'answer-review').questionId,
    'q_chem_001'
  );
});

test('open-answer model rejects duplicate, missing and recursively nested question links', () => {
  assert.equal(studio.MAX_OPEN_QUESTION_CHARS, 8000);
  assert.equal(studio.MAX_STUDENT_ANSWER_CHARS, 6000);
  assert.equal(studio.MAX_AI_REVIEW_INSTRUCTION_CHARS, 2000);

  const duplicate = studio.validateLesson({
    title: 'Duplikaty',
    slides: [
      { blocks: [{ type: 'student-answer', questionId: 'q_same', question: 'Pierwsze?' }] },
      { blocks: [{ type: 'student-answer', questionId: 'q_same', question: 'Drugie?' }] }
    ]
  });
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.errors.some((error) => error.code === 'DUPLICATE_OPEN_QUESTION_ID'), true);

  const missing = studio.validateLesson({
    title: 'Brak pytania',
    slides: [{
      blocks: [{
        type: 'answer-review',
        questionId: 'q_missing',
        answerKeyBlocks: [{ type: 'text', text: 'Klucz.' }]
      }]
    }]
  });
  assert.equal(missing.valid, false);
  assert.equal(missing.errors.some((error) => error.code === 'MISSING_OPEN_QUESTION'), true);
  assert.equal(
    missing.errors.some((error) => error.code === 'MISSING_ANSWER_REVIEW_QUESTION'),
    true
  );

  const longInstruction = studio.validateLesson({
    title: 'Za długa instrukcja',
    slides: [
      { blocks: [{ type: 'student-answer', questionId: 'q_limit', question: 'Pytanie?' }] },
      {
        blocks: [{
          type: 'answer-review',
          questionId: 'q_limit',
          aiInstruction: 'x'.repeat(2001),
          answerKeyBlocks: [{ type: 'text', text: 'Klucz.' }]
        }]
      }
    ]
  });
  assert.equal(longInstruction.valid, false);
  assert.equal(
    longInstruction.errors.some((error) => error.code === 'AI_REVIEW_INSTRUCTION_TOO_LONG'),
    true
  );

  assert.throws(
    () => studio.createBlock('answer-review', {
      questionId: 'q_nested',
      answerKeyBlocks: [{ type: 'student-answer', questionId: 'q_inner', question: 'Nie wolno.' }]
    }),
    /nie może zawierać kontenerów ani kolejnego pytania/i
  );
});

test('complete lesson example stays importable and covers every block and task type', () => {
  const filename = 'lekcja-chemia-organiczna.md';
  const source = fs.readFileSync(path.join(root, 'Examples', 'lessons', filename), 'utf8');
  const lesson = studio.parseEditableLesson(source, filename);
  const validation = studio.validateLesson(lesson);
  const blockTypes = new Set();
  const taskTypes = new Set();

  const collectBlocks = (blocks) => {
    (blocks || []).forEach((block) => {
      blockTypes.add(block.type);
      collectBlocks(block.blocks);
      collectBlocks(block.answerKeyBlocks);
    });
  };
  lesson.slides.forEach((slide) => {
    collectBlocks(slide.blocks);
    if (slide.task?.type) taskTypes.add(slide.task.type);
  });

  assert.equal(validation.valid, true, validation.errors.map((error) => error.message).join('\n'));
  assert.deepEqual(studio.BLOCK_TYPES.filter((type) => !blockTypes.has(type)), []);
  assert.deepEqual(studio.TASK_TYPES.filter((type) => !taskTypes.has(type)), []);
  assert.doesNotThrow(() => lessonParser.parseLesson(source, filename));

  const question = lesson.slides
    .flatMap((slide) => slide.blocks)
    .find((block) => block.type === 'student-answer' && block.questionId === 'q_organic_aldehyde_vs_ketone');
  const review = lesson.slides
    .flatMap((slide) => slide.blocks)
    .find((block) => block.type === 'answer-review' && block.questionId === 'q_organic_aldehyde_vs_ketone');
  assert.ok(question);
  assert.ok(review);
  assert.equal(review.question, question.question);
  assert.deepEqual(
    review.answerKeyBlocks.map((block) => block.type),
    ['heading', 'text', 'list', 'text', 'formula', 'table', 'image']
  );
});

test('Faza 4: true-false task preset round-trips correctly and evaluates student answers', () => {
  const lesson = studio.createLesson({
    title: 'Lekcja Prawda / Fałsz',
    filename: 'prawda-falsz.md',
    slides: [{
      blocks: [{ type: 'heading', level: 2, text: 'Zadanie Prawda / Fałsz' }],
      task: {
        type: 'choice',
        question: 'Etanol jest związkiem nasyconym.',
        label: 'Wybierz Prawda lub Fałsz',
        options: ['Prawda', 'Fałsz'],
        answers: ['Prawda'],
        hint: 'Zwróć uwagę na rodzaj wiązań C-C w cząsteczce.',
        feedback: 'Brawo! Etanol zawiera wyłącznie pojedyncze wiązania C-C i C-H.'
      }
    }]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /Etanol jest związkiem nasyconym\./);
  assert.match(markdown, /options: Prawda \| Fałsz/);

  const restored = studio.parseLesson(markdown, 'prawda-falsz.md');
  assert.equal(restored.slides[0].task.type, 'choice');
  assert.deepEqual(restored.slides[0].task.options, ['Prawda', 'Fałsz']);
  assert.deepEqual(restored.slides[0].task.answers, ['Prawda']);

  const student = lessonParser.parseLesson(markdown, 'prawda-falsz.md').slides[0];
  assert.equal(lessonParser.checkAnswer(student.task, 'Prawda'), true);
  assert.equal(lessonParser.checkAnswer(student.task, 'Fałsz'), false);
});

test('Faza 4: Gate Rules (slide condition & requiredToAdvance) round-trip properly', () => {
  const lesson = studio.createLesson({
    title: 'Lekcja z warunkami bramkowania',
    filename: 'bramki.md',
    navigation: 'sequential',
    slides: [
      {
        id: 'step-video',
        progressConfigured: true,
        requiredToAdvance: true,
        condition: { type: 'material_completed', materialId: 'yt:sU6epNBjvzo', minimumScore: 0 },
        blocks: [{ type: 'youtube', video: 'sU6epNBjvzo', title: 'Wideo instruktażowe' }]
      },
      {
        id: 'step-free',
        progressConfigured: true,
        requiredToAdvance: false,
        condition: { type: 'next_click', materialId: '', minimumScore: 0 },
        blocks: [{ type: 'text', text: 'Krok opcjonalny - można pominąć.' }]
      },
      {
        id: 'step-quiz',
        progressConfigured: true,
        requiredToAdvance: true,
        condition: { type: 'correct_answer', materialId: '', minimumScore: 0 },
        blocks: [{ type: 'heading', level: 2, text: 'Sprawdzenie wiedzy' }],
        task: {
          type: 'abcd',
          question: 'Który pierwiastek jest gazem szlachetnym?',
          options: ['Hel', 'Wodór', 'Tlen', 'Azot'],
          correctOption: 'A',
          answers: ['A']
        }
      }
    ]
  });

  const markdown = studio.serializeLesson(lesson);
  assert.match(markdown, /"requiredToAdvance":true/);
  assert.match(markdown, /"requiredToAdvance":false/);
  assert.match(markdown, /"type":"material_completed"/);
  assert.match(markdown, /"type":"correct_answer"/);

  const restored = studio.parseLesson(markdown, 'bramki.md');
  assert.equal(restored.slides[0].requiredToAdvance, true);
  assert.equal(restored.slides[0].condition.type, 'material_completed');
  assert.equal(restored.slides[1].requiredToAdvance, false);
  assert.equal(restored.slides[1].condition.type, 'next_click');
  assert.equal(restored.slides[2].requiredToAdvance, true);
  assert.equal(restored.slides[2].condition.type, 'correct_answer');
});


test('new editor IDs cannot collide with IDs restored from a previous Studio session', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root,'public/members/module/studio/lesson-model.js'),'utf8');
  const fresh = () => { const context={window:{crypto:require('node:crypto').webcrypto}}; vm.runInNewContext(source,context); return context.window.ChemLessonStudioModel; };
  const first=fresh(),second=fresh();
  const old=first.createLesson({filename:'test.md',slides:[{blocks:[{type:'student-answer',questionId:'q1',question:'Treść zadania'}]}]});
  const restored=second.createLesson(JSON.parse(JSON.stringify(old)));
  const newBlock=second.createBlock('student-answer',{questionId:'q2',question:'Nowe pytanie'});
  assert.notEqual(newBlock.id,restored.slides[0].blocks[0].id);
  assert.equal(restored.slides[0].id,old.slides[0].id,'Existing valid progress IDs stay unchanged');
  assert.equal(restored.slides[0].blocks[0].id,old.slides[0].blocks[0].id);
  const legacy=second.createLesson({filename:'old.md',slides:[{id:'slide-1',blocks:[{id:'block-1',type:'text',text:'Stary szkic'}]}]});
  assert.notEqual(second.createBlock('text',{text:'Nowy'}).id,legacy.slides[0].blocks[0].id);
});

test('corrupted duplicate editor IDs are repaired without changing AI question links or unique step IDs', () => {
  const lesson=studio.createLesson({id:'lesson',filename:'repair.md',slides:[
    {id:'original-step',blocks:[{id:'same',type:'student-answer',questionId:'q-original',question:'Wyjaśnij.'}]},
    {id:'original-step',blocks:[{id:'same',type:'answer-review',questionId:'q-original',answerKeyBlocks:[{id:'same',type:'text',text:'Klucz'}]}]},
    {id:'untouched-step',blocks:[{id:'unique',type:'text',text:'Treść'}]}
  ]});
  const ids=[lesson.id,...lesson.slides.flatMap(s=>[s.id,...s.blocks.flatMap(b=>[b.id,...(b.answerKeyBlocks||[]).map(k=>k.id)])])];
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(lesson.slides[0].id,'original-step');assert.equal(lesson.slides[2].id,'untouched-step');
  assert.equal(lesson.slides[2].blocks[0].id,'unique');
  assert.equal(lesson.slides[1].blocks[0].questionId,'q-original');
  assert.equal(lesson.slides[1].blocks[0].question,'Wyjaśnij.');
  assert.equal(studio.validateLesson(lesson).valid,true);
  assert.deepEqual(studio.createLesson(lesson),lesson,'Repair is stable after the first load');
});
