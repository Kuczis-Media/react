# Quiz i pule nauki — sesja 2

Rozszerzenie istniejącego Quiz Buildera, modelu v1 i widoku ucznia z sesji 1. Bez nowej bazy, storage, endpointów, ENV i migracji. Nie zmienia mechanizmu oceniania egzaminów.

## Obsługa

1. **Studio → Quiz**: wczytaj quiz/pulę lub wybierz **Nowa pula fiszek**, wpisz tytuł, opis i wybierz kurs. Pula może teraz łączyć fiszki i pytania ćwiczeniowe.
2. **Jedna odpowiedź**: treść, 2–6 opcji, jedna prawidłowa oznaczona kółkiem. **Wiele odpowiedzi**: checkboxami oznacz wszystkie poprawne. Oba typy mają wyjaśnienie, opcjonalny obraz pytania i obraz każdej opcji.
3. **Odpowiedź tekstowa**: podaj wzorzec i alternatywne warianty. W sekcji **Porównywanie tekstu — bez AI** ustaw tolerancje. Domyślnie ignorujemy wielkość liter i nadmiarowe spacje, ale nie końcową kropkę ani literówki.
4. **fx · Dodaj równanie** przy treści pytania, odpowiedziach, wyjaśnieniu i obu stronach fiszki otwiera istniejący kreator egzaminów. Tryb Matematyka: ręczny kod, ułamki, potęgi, indeksy, pierwiastki, greckie litery, strzałki, sumy, całki i skróty H₂O, CO₂, Na⁺, Ca²⁺. Tryb Chemia: substraty, produkty, strzałka i warunki reakcji.
5. Kreator pokazuje podgląd podczas pisania. **Wstaw do wybranego pola** zastępuje zaznaczenie lub wstawia w miejscu kursora kod `\(...\)`. Nie zmienia pozostałych pól. Niebezpieczne polecenia i przekroczenie długości są blokowane. Wzory można wstawiać też w polach tekstowych odpowiedzi ucznia.
6. **Dodaj obraz / Wybierz obraz**: ten sam Media Manager, wybór pliku, przeciąganie i wklejenie w oknie biblioteki. Podmiana, opis alternatywny i odpięcie obrazu nie wymagają nowego storage. Usunięcie z pytania nie usuwa pliku. Obrazy opcji mają podgląd przed zapisem.
7. **Zapisz szkic / Opublikuj**. Pula jest dostępna przez kafelek **Quiz** w dashboardzie, pod dotychczasową trasą `/members/module/quiz/?repo=ID_BIBLIOTEKI&quiz=ID_PULI`. Obowiązują istniejące uprawnienia, przypisanie kursu i aktywacja puli.

## Uczeń i porównania

Zwykły quiz zachowuje zbiorcze sprawdzanie i dotychczasową punktację. Pula nauki wyświetla jedną kartę naraz, bez punktacji: uczeń wybiera/wpisuje odpowiedź, klika **Sprawdź odpowiedź**, czyta feedback i przechodzi dalej. Fiszki nadal mają odsłanianie i cztery przyciski samooceny. Nawigacja zachowuje odpowiedzi do końca sesji; odświeżenie strony je zeruje.

- Wybór: osobne oznaczenia poprawnie zaznaczonych, błędnie zaznaczonych i poprawnych pominiętych opcji. Markdown, LaTeX i obrazy działają też w feedbacku.
- Tekst: deterministyczny Levenshtein wybiera najbliższy wariant i pokazuje zielone zgodne fragmenty, czerwone przekreślone błędy, podkreślone brakujące znaki, wzorzec i procent podobieństwa.
- `tkanki nabłonkowe` względem `tkanka nabłonkowa`: 2 zmiany, 88%. Tolerancja 0/1 odrzuca, 2 akceptuje z informacją o literówce.
- Maksymalnie 2 wstawienia/usunięcia/zamiany znaków i co najmniej 80% podobieństwa; pusta odpowiedź nie jest poprawna. Przy symbolach chemicznych warto rozróżniać wielkość liter i nie tolerować literówek.
- To porównanie zapisu, nie znaczenia, synonimów ani równoważności zapisów matematycznych/chemicznych. Nie uruchamia AI.

## Model, zgodność i koszt

Typy SINGLE_CHOICE, MULTIPLE_CHOICE i TEXT_COMPARE używają istniejących wartości `single`, `multiple`, `text`. FLASHCARD to `flashcard`. `mode: "deck"` dopuszcza te cztery typy; zwykły Quiz nadal także `true_false` i `open`.

Opcjonalne pole pytania `text`: `textCompare: {ignoreCase: true, collapseWhitespace: true, ignoreFinalPeriod: false, maxTypos: 0}`. Opcjonalne pole `options[]`: `image: {ref: "assets/shared/obraz.png", alt: "Opis"}` lub lokalne `photos/*`. Treść opcji zachowuje nowe linie i LaTeX. Stare zwykłe quizy z 7–12 opcjami pozostają czytelne i możliwe do zapisania; nowe opcje dodaje się w UI do limitu 6. Nie zmieniają się identyfikatory pytań ani zasada pełnej punktacji za poprawny wybór.

Jedna implementacja porównania obsługuje Studio, ucznia i backend Quiz. Zamknięty quiz/pula nie wywołuje funkcji ani AI przy każdym pytaniu; zapis postępu dotyczy rozpoczęcia/ukończenia. Stare otwarte quizy zachowują swój mechanizm oceniania. Różnice znakowe zapisanych wyników są obliczane przy odczycie, nie dopisywane jako rozbudowane logi do Blobs. Porównanie jest ograniczone do 500 znaków i 20 wariantów. Długie quizy oddają sterowanie przeglądarce co 8 pytań. Pule używają istniejącego ograniczonego cache obrazów.

## Zmienione pliki

- Nowy `public/assets/js/quiz-practice.js`: porównania i logika odpowiedzi.
- `public/members/module/studio/quiz-model.js`, `netlify/quiz-common.js`, `netlify/functions/quiz.js`: model, walidacja, ocenianie i odczyt wyniku.
- `public/members/module/studio/assessment-editor.js`, `answer-fields.js`, `quiz-builder.js`, `index.html`, `app/studio/builders.jsx`: fx, pola, obrazy i mieszane pule; ograniczenie ponawiania nieudanego odczytu kursów.
- `public/assets/js/quiz-flashcards.js`, `public/assets/css/quiz-flashcards.css`, `public/assets/css/assessment-text.css`: renderer i responsywny układ.
- `public/members/module/quiz/index.html`, `script.js`, `app/assessment/quiz.jsx`: widok ucznia i lokalne sprawdzanie.
- Nowy `tests/quiz-practice.test.js`; rozszerzone `tests/platform-react.test.js`, `tests/quiz-flashcards.test.js`.
- `tests/google-media.test.js` i zachowana poprawka `studio/dashboard-model.js`: błędy z logu Netlify. Procenty, podgląd po autoryzacji i zachowanie linku/ID nieedytowanego starego kafelka. Nie cofnięto działania do pikseli wyłącznie dla starych testów.

## Weryfikacja i zakres

Komendy: `npm test`, `npm run build`, `node --check` dla zmienionych JS, `git diff --check`. Projekt nie definiuje `lint` ani `typecheck` — obie komendy sprawdzono, zwracają „Missing script”. JSX kompiluje istniejący esbuild; nie dodano pozornych poleceń.

Końcowy wynik: `npm run build` — **743/743 testy, 0 błędów**. Sprawdzanie składni 14 zmienionych/nowych plików JS i `git diff --check` — poprawne. Wcześniejsze `npm test` również przeszło; końcowy build obejmuje dodatkowy test regresji identyfikatorów materiałów Google.

Izolowany Chrome: 1440/390 px, mieszana pula, feedback, obrazy, kreator z podglądem indeksów, wstawianie do pola i ukończenie puli. Naprawiono rozszerzanie kart Studio poza ekran telefonu. Konta, repozytorium i postęp były zastąpione danymi testowymi; MathJax był atrapą, sprawdzono istniejący lokalny podgląd równań. Nie jest to test produkcyjnego połączenia GitHub/Gitea ani wdrożenie.

Nie dodano image occlusion, spaced repetition, CSV ani rozbudowanych statystyk.
