# Nauka i powtórki — sesja 4

Rozszerzenie istniejących pul `mode: "deck"` w module Quiz. Stare quizy,
format `quiz.json`, Media Manager i uprawnienia pozostają zgodne.
Nie trzeba dodawać zmiennych ENV ani wykonywać migracji bazy.

## Tworzenie materiałów

1. Studio → Quiz → **Nowa pula fiszek**. Podaj tytuł i wybierz kurs.
2. Wybierz **Fiszka — przód i tył** albo inny dostępny typ pytania.
3. Wpisz pytanie w sekcji **Przód**, a odpowiedź w sekcji **Tył**.
   **fx** otwiera dotychczasowy kreator równań. **Dodaj obraz** otwiera
   ten sam Media Manager co dotychczas; miniatury widać w edytorze.
4. Przycisk **Podgląd** przy karcie pokazuje właśnie tę kartę w panelu ucznia.
   Rozwijany podgląd wewnątrz fiszki aktualizuje tekst podczas pisania.
5. W pytaniach wyboru wpisuj odpowiedzi w osobnych polach i zaznacz poprawną
   kółkiem lub poprawne kwadratami. Wyróżnienie „Poprawna odpowiedź” pomaga
   sprawdzić klucz. Dodatkowe ustawienia porównania tekstu są rozwijane.
6. **Zapisz szkic** zachowuje materiał do dalszej pracy; **Opublikuj** go udostępnia.

Nowa karta otwiera się od razu, również jako czwarta i kolejna w długiej puli.
Na szerokim ekranie obie strony fiszki mieszczą się obok siebie; na telefonie
układają się jedna pod drugą. Nie zmieniono mechanizmu punktacji egzaminów.

## Dashboard i lekcje

- Na dashboardzie sekcja **Nauka / Fiszki** pokazuje rozpoczęte pule, liczbę
  kart oczekujących na powtórkę, nowych i trudnych oraz podstawowe liczniki.
  Nie skanuje wszystkich definicji kursów. Nowa pula trafia na tę listę po jej
  pierwszym otwarciu przez ucznia. **Pokaż kolejne pule** pobiera następne 12.
  Suma dotyczy pul już wczytanych na listę.
- Lesson Builder → **Powtórka / Fiszki** → wybierz bibliotekę i materiał.
  Lista obejmuje quizy i pule, ponieważ istniejący indeks nie zawiera ich typu.
  Po wybraniu sprawdzana jest tylko wybrana definicja: musi być aktywną,
  opublikowaną pulą. Zwykły quiz jest odrzucany; służy do niego element **Quiz**.
- Po publikacji lekcji przycisk ucznia otwiera naukę w **nowej karcie**.
  Lekcja pozostaje na dotychczasowym kroku. Oba miejsca używają tego samego
  postępu konta. Przykład: `Examples/lessons/lekcja-chemia-organiczna.md`
  i `Examples/quizzes/pula-chemia/quiz.json` (przypisanie kursu należy dostosować).

W lekcji zachowano dyrektywę `:::quiz`, dodając `study: true`.
Nie skopiowano pytań ani obrazów do pliku lekcji. Automatycznego importowania
wybranych pytań z puli do innego quizu/egzaminu ta sesja nie dodaje: lokalne
referencje mediów i odmienne modele egzaminu wymagają osobnej obsługi.

## Scheduler

Własna, prosta drabina interwałów NextMed, bez kodu schedulera Anki:

| Ocena | Pierwsza powtórka | Kolejne powtórki |
| --- | --- | --- |
| Nie pamiętam | 1 minuta | powrót do 1 minuty |
| Trudne | 4 godziny | 60% poprzedniego odstępu, minimum 4 h, maksimum 2 dni |
| Dobre | 1 dzień | wzrost według poprzedniego odstępu i współczynnika łatwości |
| Łatwe | 3 dni | większy wzrost niż dla „Dobre” |

Maksymalny odstęp to 365 dni. Współczynnik `ease` zaczyna od 1, zmienia się
o −0,15 / −0,05 / +0,03 / +0,08 i mieści się w zakresie 0,65–1,6.
„Dobre”: `max(1 dzień, interval × (1,5 + ease × 0,35))`.
„Łatwe”: `max(3 dni, interval × (2 + ease × 0,6))`.

Tryby: **Wszystkie**, **Do powtórzenia dzisiaj**, **Nowe**, **Błędne**, **Trudne**.
„Na dziś” oznacza karty, których termin już nadszedł, także zaległe; nie włącza
kart z terminem późniejszym tego dnia. Zapomniana karta wraca do kolejki po
nadejściu terminu podczas dalszej nauki. Gdy kolejka jest już pusta, użyj
**Odśwież kolejkę** — nie ma odpytywania serwera w pętli.

Czas następnej powtórki wyznacza serwer. Klient koryguje swój zegar względem
czasu otrzymanego przy otwarciu puli. Pytania wyboru/tekstowe są dodatkowo
sprawdzane deterministycznie przy zapisie, bez AI: błędna odpowiedź otrzymuje
ocenę „Nie pamiętam”. Dla fiszek i masek poprawność jest samooceną ucznia.

## Postęp, bezpieczeństwo i koszt odczytów

Rozszerzono istniejący store **chemdisk-progress** i endpoint **progress**:

- `GET ?view=study&repo=…&deck=…` — jednorazowe wczytanie bieżącego stanu puli.
- `POST` pod ten adres — paczka maksymalnie 20 ocen.
- `GET ?view=study-summary&cursor=…` — stronicowane podsumowania dashboardu.

Identyfikator użytkownika pochodzi z sesji, nie z żądania. Obowiązują aktywacja
puli, role platformy, blokady sekwencji i ustawienia śledzenia postępu.
Podgląd autora nie zapisuje ocen ani terminów.

Stan jest podzielony na 16 małych plików na użytkownika/pulę/generację:
`study/<user>/<hash-repo-deck>/<generation>/<bucket>.json`.
`study-index/<user>/<hash-repo-deck>.json` zawiera tylko liczniki i terminy,
bez odpowiedzi. Zapis czyta wyłącznie dotknięte fragmenty; otwarcie puli czyta
16 fragmentów. Dashboard czyta indeksy, nie stany kart ani historię.

Każda karta ma `repetitions`, `interval` (dni), `ease`, `dueAt`,
`lastReviewedAt`, `lastGrade`, `attempts`, `correct`, `incorrect`,
`lastAnswer` i `lastCorrect`. Kluczem jest `questionId`; dla osobnych masek
`questionId/maskId`, a dla obrazu odsłanianego w całości `questionId/all`.
Przechowywany jest stan bieżący, **nie rosnąca historia wszystkich działań**.
Fragment ma limit 1200 stanów / 1 MiB i 512 ostatnich identyfikatorów paczek
(dokładniej: zdarzeń) do wykrywania ponowień. Zapisy warunkowe chronią przed
utratą równoległych zmian. Ta krótka lista identyfikatorów nie jest archiwum.

Oceny są wysyłane po 15 sekundach, po zebraniu 20, na końcu sesji lub ręcznie
przez **Zapisz teraz**; podejmowana jest też próba zapisu przy opuszczaniu karty.
Nie ma funkcji Netlify na każde odsłonięcie odpowiedzi. Błąd pozostawia oceny
w pamięci i pokazuje **Ponów zapis**. Nie zamykaj strony przed potwierdzeniem:
kolejka nie jest trwałym trybem offline, a zapis przy zamknięciu nie jest gwarantowany.

Główny rekord postępu quizu przechowuje procent przejrzanych kart i liczniki.
100% oznacza obejrzenie i ocenę każdej karty, nie trwałe opanowanie materiału.
Reset puli z jej kafelka albo reset postępu konta unieważnia generację powtórek
i oczekujące oceny. Stare fragmenty nie wracają do wyników, ale nie są fizycznie
usuwane — automatyczne sprzątanie osieroconych generacji nie jest częścią tej sesji.

## Najważniejsze pliki

- Scheduler: `public/assets/js/study-scheduler.js`.
- Serwer i rozszerzenie postępu: `netlify/study-progress.js`, `netlify/progress-common.js`,
  `netlify/functions/progress.js`, `netlify/functions/admin-progress.js`.
- Klient/tryb nauki/dashboard: `public/assets/js/study-{client,view,dashboard}.js`,
  `public/assets/js/progress.js`, `public/members/module/quiz/{index.html,script.js}`,
  `public/members/index.html`, `public/assets/css/study.css`.
- Lesson Builder i renderer: `public/members/module/studio/{script.js,lesson-model.js,index.html}`,
  `public/members/module/lesson/{lesson-parser.js,style.css}`.
- Kreator i podgląd: `public/members/module/studio/quiz-builder.js`,
  `app/studio/builders.jsx`, `public/assets/js/quiz-flashcards.js`,
  `public/assets/css/{quiz-preview,quiz-flashcards}.css`.
- Regresje: `tests/study-progress.test.js`, `tests/platform-react.test.js`,
  istniejące testy przykładów oraz całego Quiz/Exam/Studio.

Repozytorium nie definiuje skryptów `lint` i `typecheck`. Ich wywołanie zgłasza
brak skryptu; kontrolę składni JS przeprowadzono przez `node --check`, a JSX
kompiluje istniejący esbuild. Nie jest to pełny statyczny typecheck projektu.
