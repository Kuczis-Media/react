const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const lessonRoot = path.join(root, 'public', 'members', 'module', 'lesson');
const parser = require(path.join(lessonRoot, 'lesson-parser.js'));
const exampleMarkdown = [
  '# Izotopy węgla',
  '',
  'Krótka lekcja pokazująca, jak działa prezentacja i zadanie w pliku Markdown.',
  '',
  '---',
  '',
  '## Co oznacza zapis ^13^C?',
  '',
  'Liczba masowa to **13**, a liczba atomowa to **6**.',
  '',
  '---',
  '',
  '## Zadanie',
  '',
  ':::task',
  'type: number',
  'answer: 7',
  ':::',
  '',
  '---',
  '',
  '## Quiz ABCD',
  '',
  ':::task',
  'type: abcd',
  'options: 4 | 6 | 12 | 13',
  'answer: B',
  ':::',
  '',
  '---',
  '',
  '## Podsumowanie',
  '',
  'Liczba neutronów to A − Z.'
].join('\n');

test('lesson application exposes a repository selector for the live library', () => {
  const html = fs.readFileSync(path.join(lessonRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(lessonRoot, 'script.js'), 'utf8');
  const mathJaxConfig = fs.readFileSync(
    path.join(root, 'public', 'members', 'module', 'mathjax-config.js'),
    'utf8'
  );

  assert.match(html, /id=["']lesson-library-repository["']/);
  assert.match(html, /\/members\/module\/mathjax-config\.js/);
  assert.match(mathJaxConfig, /\[tex\]\/mhchem/);
  assert.match(html, /mathjax@3\.2\.2/);
  assert.match(script, /ChemContentLibrary\.repositories\(\)/);
  assert.match(script, /readLesson\(filename,\s*\{\s*repositoryId\s*\}\)/);
  assert.match(script, /searchParams\.set\(['"]repo['"],\s*asset\.repositoryId\)/);
});

test('lesson player ignores stale asynchronous lesson and progress loads', () => {
  const script = fs.readFileSync(path.join(lessonRoot, 'script.js'), 'utf8');

  assert.match(script, /loadRequestId:\s*0/);
  assert.match(script, /const requestId = \+\+state\.loadRequestId/);
  assert.match(
    script,
    /const markdown = await fetchLessonMarkdown\(filename, repositoryId\);\s*if \(!isCurrentLessonLoad\(requestId\)\) return;/
  );
  assert.match(script, /const progressLoaded = await loadProgress\(requestId\);/);
  assert.match(
    script,
    /await progressApi\.load\(\);\s*if \(!isCurrentLessonLoad\(requestId\)\) return false;/
  );
  assert.match(
    script,
    /catch \(error\) \{\s*if \(!isCurrentLessonLoad\(requestId\)\) return;\s*console\.error\('Nie udało się wczytać lekcji'/
  );
});

test('lesson library is admin-only and the player layout can be collapsed', () => {
  const html = fs.readFileSync(path.join(lessonRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(lessonRoot, 'script.js'), 'utf8');
  const styles = fs.readFileSync(path.join(lessonRoot, 'style.css'), 'utf8');

  assert.match(html, /id=["']lesson-library-button["'][^>]*\shidden(?:\s|>)/);
  assert.match(script, /roles\.includes\(['"]admin['"]\)/);
  assert.match(script, /elements\.libraryButton\.hidden\s*=\s*!state\.isAdmin/);
  assert.match(script, /async function openLessonLibrary\(\)\s*\{\s*if\s*\(!state\.isAdmin\)\s*return;/);

  assert.match(html, /id=["']topbar-toggle["']/);
  assert.match(html, /id=["']outline-toggle["']/);
  assert.match(html, /id=["']sequence-toggle["'][^>]*role=["']switch["'][^>]*checked/);
  assert.match(html, /id=["']sequence-toggle-hint["']/);
  assert.match(html, /id=["']completion-message["']/);
  assert.match(html, /id=["']reset-progress-button["'][^>]*\bdisabled\b/);
  assert.match(script, /classList\.toggle\(['"]is-topbar-collapsed['"]/);
  assert.match(script, /classList\.toggle\(['"]is-outline-collapsed['"]/);
  assert.match(script, /sequential:\s*true/);
  assert.match(script, /saved\.sequential\s*!==\s*false/);
  assert.match(script, /const taskBlocked\s*=\s*Boolean\(slide\.task\s*&&\s*!isSolved\)/);
  assert.match(script, /state\.sequential\s*&&\s*\(taskBlocked\s*\|\|\s*!examGate\.satisfied\)/);
  assert.match(script, /studentResultVisible\s*===\s*false/);
  assert.match(script, /wynik dostępny administratorowi/);
  assert.match(script, /!state\.sequential\s*\|\|\s*index\s*<=\s*state\.maxReached/);
  assert.match(script, /function confirmResetProgress\(\)/);
  assert.match(script, /window\.confirm\(/);
  assert.match(script, /sessionStorage\.removeItem\(progressKey\(\)\)/);
  assert.match(script, /elements\.resetProgress\.addEventListener\(['"]click['"],\s*confirmResetProgress\)/);
  assert.match(styles, /\.app-shell\.is-topbar-collapsed \.topbar/);
  assert.match(styles, /\.app-shell\.is-outline-collapsed \.lesson-layout/);
  assert.match(styles, /\.sequence-toggle/);
  assert.match(styles, /\.reset-progress-button/);
  assert.match(styles, /grid-template-columns:\s*210px minmax\(0,\s*1fr\)/);
  assert.match(styles, /width:\s*min\(1480px,\s*calc\(100% - 32px\)\)/);
});

test('lesson parser builds a wizard from repository Markdown', () => {
  const lesson = parser.parseLesson(exampleMarkdown, 'izotopy-wegla.md');

  assert.equal(lesson.title, 'Izotopy węgla');
  assert.equal(lesson.slides.length, 5);
  assert.match(lesson.signature, /^\d+-[a-z0-9]+$/);
  assert.equal(lesson.slides[2].task.type, 'number');
  assert.equal(parser.checkAnswer(lesson.slides[2].task, '7'), true);
  assert.equal(parser.checkAnswer(lesson.slides[2].task, '7,0'), true);
  assert.equal(parser.checkAnswer(lesson.slides[2].task, '6'), false);
  assert.equal(lesson.slides[3].task.choiceStyle, 'abcd');
  assert.equal(parser.checkAnswer(lesson.slides[3].task, 'B'), true);
  assert.equal(parser.checkAnswer(lesson.slides[3].task, '6'), true);
  assert.equal(parser.checkAnswer(lesson.slides[3].task, 'A'), false);
  assert.match(lesson.slides[1].html, /<sup>13<\/sup>C/);
});

test('a slide separator inside a fenced code block remains lesson content', () => {
  const lesson = parser.parseLesson([
    '# Kod',
    '```md',
    '---',
    '```',
    '---',
    '# Drugi slajd'
  ].join('\n'), 'kod.md');

  assert.equal(lesson.slides.length, 2);
  assert.match(lesson.slides[0].html, /---/);
});

test('lesson tasks support text aliases and multiple-choice answers', () => {
  const lesson = parser.parseLesson([
    '# Powtórka',
    '',
    ':::zadanie',
    'typ: tekst',
    'odpowiedź: atom | ATOM',
    'wielkość liter: nie',
    ':::',
    '',
    '---',
    '',
    '## Wybór',
    '',
    ':::task',
    'type: choice',
    'answer: 7',
    'options: 6 | 7 | 13',
    ':::'
  ].join('\n'), 'quiz.md');

  assert.equal(parser.checkAnswer(lesson.slides[0].task, '  ATOM  '), true);
  assert.equal(parser.checkAnswer(lesson.slides[1].task, '7'), true);
  assert.equal(parser.checkAnswer(lesson.slides[1].task, '13'), false);
});

test('lesson tasks support an ABCD quiz with a letter or option as the answer', () => {
  const lesson = parser.parseLesson([
    '# Quiz',
    '',
    ':::task',
    'type: abcd',
    'label: Wybierz poprawny symbol tlenu',
    'options: H | O | N | C',
    'answer: B',
    ':::'
  ].join('\n'), 'abcd.md');
  const task = lesson.slides[0].task;

  assert.equal(task.type, 'choice');
  assert.equal(task.choiceStyle, 'abcd');
  assert.deepEqual(task.options, ['H', 'O', 'N', 'C']);
  assert.equal(parser.checkAnswer(task, 'B'), true);
  assert.equal(parser.checkAnswer(task, 'O'), true);
  assert.equal(parser.checkAnswer(task, 'A'), false);
  const singleLetterOptions = parser.parseLesson([
    '# Symbole',
    ':::task',
    'type: abcd',
    'options: C | O | N | H',
    'answer: A',
    ':::'
  ].join('\n'), 'symbole.md').slides[0].task;
  assert.equal(parser.checkAnswer(singleLetterOptions, 'A'), true);
  assert.equal(parser.checkAnswer(singleLetterOptions, 'C'), true);
  assert.equal(parser.checkAnswer(singleLetterOptions, 'B'), false);
  assert.throws(
    () => parser.parseLesson('# Quiz\n\n:::task\ntype: abcd\noptions: A | B | C\nanswer: B\n:::', 'blad.md'),
    /dokładnie czterech opcji/i
  );
});

test('lesson tasks support manually typed gaps checked separately or together', () => {
  const lesson = parser.parseLesson([
    '# Luki tekstowe',
    '',
    'Uzupełnij zdanie.',
    '',
    ':::task',
    'type: gaps-text',
    'text: Woda ma wzór {{wzór}}, a jej masa molowa wynosi {{masa}} g/mol.',
    'answer: H2O | 18',
    'check_mode: each',
    'case_sensitive: true',
    'hint: Sprawdź zapis wzoru i masę molową.',
    ':::'
  ].join('\n'), 'luki-tekstowe.md');
  const task = lesson.slides[0].task;

  assert.equal(task.type, 'gaps-text');
  assert.equal(task.checkMode, 'each');
  assert.equal(task.caseSensitive, true);
  assert.equal(parser.checkGapAnswer(task, 'H2O', 0), true);
  assert.equal(parser.checkGapAnswer(task, 'h2o', 0), false);
  assert.equal(parser.checkGapAnswer(task, '18', 1), true);
  assert.equal(parser.checkAnswer(task, ['H2O', '18']), true);
  assert.equal(parser.checkAnswer(task, ['H2O', '16']), false);

  const together = parser.parseLesson([
    '# Bez wielkości liter',
    ':::task',
    'type: luki_tekstowe',
    'tekst: Symbol tlenu to {{symbol}}.',
    'odpowiedź: O',
    'tryb sprawdzania: all',
    ':::'
  ].join('\n'), 'luki-razem.md').slides[0].task;
  assert.equal(together.checkMode, 'all');
  assert.equal(parser.checkGapAnswer(together, 'o', 0), true);
});

test('inline gap controls create rows only for author-entered line breaks', () => {
  const playerStyles = fs.readFileSync(path.join(lessonRoot, 'style.css'), 'utf8');
  const studioStyles = fs.readFileSync(
    path.join(root, 'public', 'members', 'module', 'studio', 'style.css'),
    'utf8'
  );

  assert.match(playerStyles, /\.gap-exercise\s*\{[\s\S]*?display:\s*grid/);
  assert.match(playerStyles, /\.gap-exercise-line\s*\{[\s\S]*?display:\s*block/);
  assert.doesNotMatch(playerStyles, /\.gap-exercise\s*\{[\s\S]*?line-height:\s*calc\(42px \+ 1rem\)/);
  assert.match(playerStyles, /\.text-gap-control input\s*\{[\s\S]*?line-height:\s*1\.2/);
  assert.match(playerStyles, /\.gap-check-one\s*\{[\s\S]*?line-height:\s*1/);
  assert.match(studioStyles, /\.preview-gap-exercise\s*\{[\s\S]*?display:\s*grid/);
  assert.match(studioStyles, /\.preview-gap-exercise-line\s*\{[\s\S]*?display:\s*block/);
  assert.match(studioStyles, /\.preview-text-gap\s*\{[\s\S]*?align-items:\s*center/);
});

test('lesson renderer supports allowlisted typography, colors and accordions without executing HTML', () => {
  const lesson = parser.parseLesson([
    '# Stylowana lekcja',
    '',
    ':::style font=georgia color=#0e665a bold=true size=large align=center',
    '## Kolorowy nagłówek',
    '',
    'Tekst zapisany bez surowego HTML.',
    ':::',
    '',
    ':::accordion Dodatkowe wyjaśnienie open=true',
    'Treść **harmonijki**.',
    ':::',
    '',
    ':::style font=evil color=red size=huge align=justify',
    '<script>alert(1)</script>',
    ':::'
  ].join('\n'), 'style.md');

  const html = lesson.slides[0].html;
  assert.match(html, /lesson-font-georgia/);
  assert.match(html, /lesson-weight-bold/);
  assert.match(html, /lesson-size-large/);
  assert.match(html, /lesson-size-large/);
  assert.match(html, /lesson-align-center/);
  assert.match(html, /--lesson-rich-color:#0e665a/);
  assert.match(html, /<details class="lesson-accordion" open>/);
  assert.match(html, /<summary>Dodatkowe wyjaśnienie<\/summary>/);
  assert.match(html, /Treść <strong>harmonijki<\/strong>/);
  assert.match(html, /lesson-font-sans/);
  assert.doesNotMatch(html, /color:red|font-evil|size-huge|align-justify/);
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('lesson renderer supports chemistry arrows, reaction conditions and mathematical notation', () => {
  const lesson = parser.parseLesson([
    '# Wzory',
    '',
    ':::formula',
    'mode: chemistry',
    'title: Synteza amoniaku',
    'left: N2 + 3 H2',
    'arrow: <=>',
    'above: 450 °C',
    'below: kat. Fe',
    'right: 2 NH3',
    ':::',
    '',
    ':::formula',
    'mode: math',
    'title: Równanie kwadratowe',
    'expression: x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}',
    ':::'
  ].join('\n'), 'wzory.md');

  assert.equal(lesson.slides.length, 1);
  assert.match(lesson.slides[0].html, /lesson-formula-chemistry/);
  assert.match(lesson.slides[0].html, /lesson-formula-math/);
  assert.ok(lesson.slides[0].html.includes('\\(\\ce{N2 + 3 H2 &lt;=&gt;[450 °C][kat. Fe] 2 NH3}\\)'));
  assert.ok(lesson.slides[0].html.includes('\\(\\displaystyle x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}\\)'));

  const unsafe = parser.renderMarkdown([
    ':::formula',
    'mode: math',
    'expression: \\href{javascript:alert(1)}{kliknij}',
    ':::'
  ].join('\n'));
  assert.match(unsafe, /Nieprawidłowy wzór matematyczny/);
  assert.doesNotMatch(unsafe, /javascript:/);
});

test('lesson renderer shows safe link tiles and preserves per-slide transitions', () => {
  const lesson = parser.parseLesson([
    '# Linki',
    '',
    ':::slide',
    'transition: zoom',
    'background: grid',
    'decoration: molecules',
    'text_tone: dark',
    ':::',
    '',
    ':::linkcard',
    'title: Otwórz tablicę wzorów',
    'description: Materiał pomocniczy do zadania.',
    'url: /members/module/board/',
    'icon: chemistry',
    'color: #7c3aed',
    'new_tab: false',
    ':::',
    '',
    '---',
    '',
    '## Bez ruchu',
    '',
    ':::slide',
    'transition: none',
    'background: custom',
    'background_color: #123456',
    'text_tone: light',
    ':::',
    '',
    'Treść drugiego slajdu.'
  ].join('\n'), 'linki.md');

  assert.equal(lesson.slides[0].transition, 'zoom');
  assert.equal(lesson.slides[1].transition, 'none');
  assert.equal(lesson.slides[0].background, 'grid');
  assert.equal(lesson.slides[0].decoration, 'molecules');
  assert.equal(lesson.slides[0].textTone, 'dark');
  assert.equal(lesson.slides[1].background, 'custom');
  assert.equal(lesson.slides[1].backgroundColor, '#123456');
  assert.equal(lesson.slides[1].textTone, 'light');
  assert.match(lesson.slides[0].html, /class="lesson-link-card"/);
  assert.match(lesson.slides[0].html, /href="\/members\/module\/board\/"/);
  assert.match(lesson.slides[0].html, /--link-card-color:#7c3aed/);
  assert.doesNotMatch(lesson.slides[0].html, /target="_blank"/);

  const unsafe = parser.renderMarkdown([
    ':::linkcard',
    'title: Zły link',
    'url: javascript:alert(1)',
    ':::'
  ].join('\n'));
  assert.match(unsafe, /Nieprawidłowy kafelek z linkiem/);
  assert.doesNotMatch(unsafe, /javascript:/);
});

test('lesson renderer builds responsive tables and escapes unsafe cell HTML', () => {
  const html = parser.renderMarkdown([
    ':::table',
    'caption: Porównanie **substancji**',
    'align: right',
    'headers: Nazwa | Wzór',
    'row: Woda | H~2~O',
    'row: <img src=x onerror=alert(1)> | CO~2~',
    ':::'
  ].join('\n'));

  assert.match(html, /class="lesson-table lesson-table-align-right"/);
  assert.match(html, /<caption>Porównanie <strong>substancji<\/strong><\/caption>/);
  assert.match(html, /<th scope="col">Nazwa<\/th>/);
  assert.match(html, /H<sub>2<\/sub>O/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);

  const invalid = parser.renderMarkdown([
    ':::table',
    'headers: A | B',
    'row: tylko jedna komórka',
    ':::'
  ].join('\n'));
  assert.match(invalid, /Nieprawidłowa tabela/);
  assert.doesNotMatch(invalid, /<table/);
});

test('lesson renderer creates AI help and allowlisted interactive board cards', () => {
  const lesson = parser.parseLesson([
    '# Narzędzia',
    '',
    'Treść slajdu dla asystenta.',
    '',
    ':::aihelp',
    'title: Zapytaj o slajd',
    'description: Otwórz pomoc AI.',
    'button: Zapytaj',
    'repository: glowne',
    'prompt: nauczyciel.txt',
    'point: 2',
    `context_json: ${JSON.stringify('Na obrazie po lewej znajduje się wykres.\nSlajd Google pokazuje reakcję <A → B>.')}`,
    'include_slide: true',
    'include_task: true',
    ':::',
    '',
    ':::board',
    'title: Biała tablica',
    'variant: whiteboard',
    'new_tab: false',
    ':::',
    '',
    ':::board',
    'title: Plansza ćwiczeń',
    'variant: bitpaper',
    'path: redoks.json',
    'new_tab: true',
    ':::',
    '',
    ':::contactform',
    'title: Zapytaj prowadzącego',
    'description: Napisz, czego nie rozumiesz.',
    'button: Otwórz formularz',
    'internal: Pytanie do slajdu o redoks',
    'new_tab: false',
    ':::'
  ].join('\n'), 'narzedzia.md');

  const html = lesson.slides[0].html;
  assert.match(html, /class="lesson-support-card lesson-ai-help"/);
  assert.match(html, /data-ai-prompt="nauczyciel\.txt"/);
  assert.match(html, /data-ai-repository="glowne"/);
  assert.match(html, /data-ai-point="2"/);
  assert.match(html, /data-ai-author-context="&quot;Na obrazie po lewej znajduje się wykres\.[\s\S]*Slajd Google pokazuje reakcję &lt;A → B&gt;\.&quot;"/);
  assert.match(html, /data-ai-include-slide="true"/);
  assert.match(html, /data-ai-include-task="true"/);
  assert.match(html, /data-lesson-ai-open/);
  assert.match(html, /href="\/members\/module\/whiteboard\/"/);
  assert.match(html, /href="\/members\/module\/bitpaper\/\?path=redoks\.json"/);
  assert.match(html, /class="lesson-support-card lesson-contact-card"/);
  assert.match(html, /href="\/members\/module\/contact\/\?internal=Pytanie%20do%20slajdu%20o%20redoks"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);

  const unsafeAi = parser.renderMarkdown([
    ':::aihelp',
    'prompt: ../sekret.txt',
    ':::'
  ].join('\n'));
  assert.match(unsafeAi, /Nieprawidłowy klocek pomocy AI/);
  assert.doesNotMatch(unsafeAi, /\.\.\/sekret/);

  const brokenAiContext = parser.renderMarkdown([
    ':::aihelp',
    'context_json: {to nie jest JSON}',
    ':::'
  ].join('\n'));
  assert.match(brokenAiContext, /Nieprawidłowy klocek pomocy AI/);

  const unsafeBoard = parser.renderMarkdown([
    ':::board',
    'variant: bitpaper',
    'path: ../plansza.json',
    ':::'
  ].join('\n'));
  assert.match(unsafeBoard, /Nieprawidłowy klocek tablicy/);
  assert.doesNotMatch(unsafeBoard, /\.\.\/plansza/);
});

test('lesson AI context describes every task type without exposing the answer key', () => {
  const gaps = parser.taskAiContext({
    type: 'gaps',
    label: 'Uzupełnij zdanie.',
    text: 'Woda ma wzór {{wzór}}, a jej masa molowa to {{masa}}.',
    options: ['H2O', 'CO2', '18 g/mol'],
    answers: ['TAJNY-KLUCZ', '18 g/mol'],
    hint: 'TAJNA-PODPOWIEDŹ',
    success: 'TAJNY-SUKCES'
  }, ['H2O', '']);
  assert.match(gaps, /Zadanie \(luki z listy\)/);
  assert.match(gaps, /\[luka 1: wzór\]/);
  assert.match(gaps, /A\. H2O/);
  assert.match(gaps, /Luka 1: H2O/);
  assert.doesNotMatch(gaps, /TAJNY-KLUCZ|TAJNA-PODPOWIEDŹ|TAJNY-SUKCES/);

  const abcd = parser.taskAiContext({
    type: 'choice',
    choiceStyle: 'abcd',
    label: 'Wybierz pierwiastek.',
    options: ['Wodór', 'Tlen', 'Azot', 'Węgiel'],
    answers: ['B']
  }, 'B — Tlen');
  assert.match(abcd, /Zadanie \(wybór ABCD\)/);
  assert.match(abcd, /D\. Węgiel/);
  assert.match(abcd, /Aktualna odpowiedź ucznia: B — Tlen/);
  assert.doesNotMatch(abcd, /Poprawna odpowiedź/);

  const fakeSlide = {
    querySelectorAll: (selector) => {
      if (selector === '[data-lesson-media-alt]') {
        return [{ dataset: { lessonMediaAlt: 'Wykres energii aktywacji z maksimum pośrodku.' } }];
      }
      if (selector === '.lesson-google-slides') {
        return [{
          querySelector: (nested) => nested === 'figcaption'
            ? { textContent: 'Mechanizm reakcji SN2' }
            : null
        }];
      }
      if (selector === '.lesson-flashcard') {
        return [{
          querySelector: (nested) => nested.includes('front')
            ? { textContent: 'Utleniacz' }
            : { textContent: 'Przyjmuje elektrony' }
        }];
      }
      if (selector === '[data-lesson-ai-formula]') {
        return [{ dataset: { lessonAiFormula: '2 H2 + O2 -> 2 H2O' } }];
      }
      return [];
    },
    cloneNode: () => ({
      textContent: 'Widoczna treść o wiązaniach chemicznych.',
      querySelectorAll: () => []
    })
  };
  const composed = parser.buildLessonAiContext({
    root: fakeSlide,
    task: { type: 'text', label: 'Wyjaśnij zjawisko.', options: [], answers: ['sekret'] },
    currentResponse: 'Moja próba',
    authorContext: 'Najważniejszy opis autora.',
    includeSlide: true,
    includeTask: true
  });
  assert.match(composed, /^Dodatkowy kontekst autora:/);
  assert.match(composed, /Wyjaśnij zjawisko/);
  assert.match(composed, /Moja próba/);
  assert.match(composed, /Widoczna treść o wiązaniach/);
  assert.match(composed, /Wykres energii aktywacji/);
  assert.match(composed, /Mechanizm reakcji SN2/);
  assert.match(composed, /Utleniacz → Przyjmuje elektrony/);
  assert.match(composed, /2 H2 \+ O2 -> 2 H2O/);
  assert.doesNotMatch(composed, /sekret/);
  assert.ok(composed.length <= parser.MAX_AI_CONTEXT_CHARS);
});

test('lesson filename and Markdown rendering reject path traversal and active HTML', () => {
  assert.equal(parser.validateFilename('dzial-1.md'), 'dzial-1.md');
  assert.equal(parser.validateFilename('../sekret.md'), '');
  assert.equal(parser.validateFilename('lekcja.html'), '');

  const html = parser.renderMarkdown([
    '# Test',
    '<script>alert(1)</script>',
    '[zły link](javascript:alert(1))',
    '![zły obraz](data:text/html,boom)',
    '![bezpieczny obraz](https://example.com/schemat.png)'
  ].join('\n'));
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /src="data:/i);
  assert.match(
    html,
    /<img src="https:\/\/example\.com\/schemat\.png" alt="bezpieczny obraz" loading="lazy" decoding="async" referrerpolicy="no-referrer">/
  );
  const migratedFilmLink = parser.renderMarkdown(
    '[Stare nagranie](/members/module/filmv1/?id=CH50zuS8DD0&type=1)'
  );
  assert.match(migratedFilmLink, /href="\/members\/module\/film\/\?id=CH50zuS8DD0&amp;type=1"/);
  assert.doesNotMatch(migratedFilmLink, /filmv1/i);

  const fencedDirective = parser.renderMarkdown([
    '```text',
    ':::youtube',
    'id: M7lc1UVf-VE',
    ':::',
    '```'
  ].join('\n'));
  assert.doesNotMatch(fencedDirective, /<iframe/);
  assert.match(fencedDirective, /:::youtube/);

  const unsafeSlides = parser.renderMarkdown([
    ':::googleslides',
    'id: https://evil.example/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz',
    'title: Niebezpieczna prezentacja',
    ':::'
  ].join('\n'));
  assert.match(unsafeSlides, /Nieprawidłowa prezentacja Google Slides/);
  assert.doesNotMatch(unsafeSlides, /<iframe/);

  const publishedSlides = parser.renderMarkdown([
    ':::googleslides',
    'id: 2PACX-1vPublishedPresentation12345',
    'published: true',
    'title: Opublikowana prezentacja',
    ':::'
  ].join('\n'));
  assert.match(publishedSlides, /presentation\/d\/e\/2PACX-1vPublishedPresentation12345\/embed/);
});

test('lesson parser reports authoring errors instead of silently skipping tasks', () => {
  assert.throws(
    () => parser.parseLesson('# Zadanie\n\n:::task\ntype: number\n:::', 'blad.md'),
    /nie zawiera pola answer/i
  );
  assert.throws(
    () => parser.parseLesson('# A\n\n---\n\n---\n\n# B', 'blad.md'),
    /jest pusty/i
  );
});

test('lesson parser renders linked open-answer controls without invoking AI automatically', () => {
  const question = 'Dlaczego **węgiel-14** jest izotopem?\n\nPorównaj protony i neutrony.';
  const answerKey = [
    '### Klucz autora',
    '',
    'Węgiel-14 ma **6 protonów** i 8 neutronów.',
    '',
    ':::formula',
    'mode: math',
    'title: Liczba neutronów',
    'expression: 14 - 6 = 8',
    ':::'
  ].join('\n');
  const markdown = [
    '# Odpowiedź własna',
    '',
    ':::studentanswer',
    'question_id: q_chem_001',
    `question_json: ${JSON.stringify(question)}`,
    'label: Twoja odpowiedź',
    `placeholder_json: ${JSON.stringify('Napisz kilka zdań…')}`,
    'min_height: 210',
    'multiline: true',
    'max_length: 1200',
    'required: true',
    'save_progress: true',
    'allow_edit: true',
    'button: Zapisz odpowiedź',
    ':::',
    '',
    '---',
    '',
    '# Omówienie',
    '',
    ':::answerreview',
    'question_id: q_chem_001',
    `question_json: ${JSON.stringify(question)}`,
    'show_student_answer: true',
    'ai_enabled: true',
    `ai_instruction_json: ${JSON.stringify('Oceniaj sens, nie identyczność słów.\nOdpowiadaj krótko.')}`,
    'order: student-first',
    `key_json: ${JSON.stringify(answerKey)}`,
    ':::'
  ].join('\n');

  const lesson = parser.parseLesson(markdown, 'odpowiedz-wlasna.md');
  assert.equal(lesson.slides.length, 2);
  assert.match(lesson.slides[0].html, /class="lesson-student-answer"/);
  assert.match(lesson.slides[0].html, /data-question-id="q_chem_001"/);
  assert.match(lesson.slides[0].html, /data-required="true"/);
  assert.match(lesson.slides[0].html, /data-persist="true"/);
  assert.match(lesson.slides[0].html, /data-max-length="1200"/);
  assert.match(lesson.slides[0].html, /data-min-height="210"/);
  assert.match(lesson.slides[0].html, /<textarea[^>]*data-student-answer-input[^>]*maxlength="1200"[^>]*required/);
  assert.match(lesson.slides[0].html, /data-student-answer-save/);
  assert.match(lesson.slides[0].html, /data-student-answer-status/);
  assert.match(lesson.slides[0].html, /data-student-answer-count[^>]*>0 \/ 1200</);

  const reviewHtml = lesson.slides[1].html;
  assert.match(reviewHtml, /class="lesson-answer-review"/);
  assert.match(reviewHtml, /data-show-student-answer="true"/);
  assert.match(reviewHtml, /data-ai-enabled="true"/);
  assert.match(reviewHtml, /data-review-order="student-first"/);
  assert.match(reviewHtml, /data-student-answer-display/);
  assert.match(reviewHtml, /class="lesson-answer-key"/);
  assert.match(reviewHtml, /Klucz autora/);
  assert.match(reviewHtml, /class="lesson-formula lesson-formula-math"/);
  assert.match(reviewHtml, /data-answer-review-ai/);
  assert.match(reviewHtml, /data-answer-review-status/);
  assert.match(reviewHtml, /data-answer-review-result hidden/);
  assert.doesNotMatch(reviewHtml, /fetch\s*\(|XMLHttpRequest|sendBeacon/);

  const structuralQuestion = parser.renderMarkdown([
    ':::studentanswer',
    'question_id: q_safe_question',
    `question_json: ${JSON.stringify(':::studentanswer\nquestion_id: q_nested\n:::')}`,
    ':::'
  ].join('\n'));
  assert.equal((structuralQuestion.match(/class="lesson-student-answer"/g) || []).length, 1);
  assert.match(structuralQuestion, /<code>:::studentanswer<\/code>/);
});

test('answer review respects key-first, hidden student answer and disabled AI settings', () => {
  const singleLine = parser.renderMarkdown([
    ':::studentanswer',
    'question_id: q_single_line',
    `question_json: ${JSON.stringify('Odpowiedz jednym zdaniem.')}`,
    'multiline: false',
    ':::'
  ].join('\n'));
  assert.match(singleLine, /<input[^>]*data-student-answer-input[^>]*type="text"/);
  assert.doesNotMatch(singleLine, /<textarea/);

  const html = parser.renderMarkdown([
    ':::answerreview',
    'question_id: q_optional_1',
    `question_json: ${JSON.stringify('Opcjonalne pytanie?')}`,
    'show_student_answer: false',
    'ai_enabled: false',
    'order: key-first',
    `key_json: ${JSON.stringify('**Klucz bez AI.**')}`,
    ':::'
  ].join('\n'));

  assert.match(html, /data-review-order="key-first"/);
  assert.match(html, /class="lesson-answer-review-student" hidden/);
  assert.ok(html.indexOf('lesson-answer-key') < html.indexOf('lesson-answer-review-student'));
  assert.doesNotMatch(html, /data-answer-review-ai/);
  assert.match(html, /data-ai-enabled="false"/);

  const missingQuestion = parser.renderMarkdown([
    ':::answerreview',
    'question_id: q_without_snapshot',
    `key_json: ${JSON.stringify('Klucz bez treści pytania.')}`,
    ':::'
  ].join('\n'));
  assert.match(missingQuestion, /Nieprawidłowe omówienie odpowiedzi/);
  assert.doesNotMatch(missingQuestion, /class="lesson-answer-review"/);
});
