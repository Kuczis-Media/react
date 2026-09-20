# Moduł nauki — sesja 5: wdrożenie, obsługa i testowanie

Dokument opisuje końcowy stan lokalnego kodu, łącznie z importerem i raportami
z wcześniejszej pracy. Zastępuje opis przechowywania postępu z sesji 4.
Zmiany nie wymagają nowych zmiennych ENV, tabel ani ręcznej migracji bazy.
Nie wykonano publikacji na produkcję ani operacji na rzeczywistych postępach uczniów.

## Co zmieniono

- Dashboard ma krótkie podsumowanie, wejście do osobnego menadżera i dwie akcje
  przy puli: nauka oraz przeglądanie. Usunięto stary menadżer wbudowany w sesję,
  pozorne statystyki retencji i serie dni liczone z samego ostatniego stanu kart.
- Menadżer `/members/module/flashcards/` pokazuje po 25 kart, wyszukiwanie,
  filtry, rozwijane treści, obrazy pobierane po rozwinięciu i jasny/ciemny motyw.
  Ma układ na telefon i komputer. Otwiera tylko jedną definicję puli naraz.
- Można zaznaczać pojedyncze karty, zakres przez Shift + klik, bieżącą stronę
  lub wszystkie wyniki filtra na wszystkich stronach. Zmiana strony nie gubi wyboru.
  Zaznaczenie pozostaje także przy zmianie filtra; licznik pokazuje cały wybór.
- Reset pojedynczej karty, wybranych kart oraz całej puli jest osobną operacją
  potwierdzaną w UI. W trybie osobnych masek można resetować konkretną maskę.
  Nowe karty bez postępu są pomijane, aby nie zapisywać zbędnych zdarzeń.
- Limit kart dotyczy **jednej sesji**: całej puli albo zaznaczonego zestawu.
  Puste pole / „Bez limitu” usuwa limit. Nie jest to dzienny limit nowych kart,
  nie zmienia interwałów i nie resetuje postępu. Zmiana limitu nie zapisuje Blobów.
- Poprawiono zachowanie wyboru kart podczas pierwszego renderowania, zmiany
  kolejności oraz losowania masek. Wybór wielu kart przechodzi przez ograniczony,
  przypisany do konta zapis `sessionStorage`, ważny 30 minut, zamiast ogromnego URL.
- W Google/NotebookLM edytor pokazuje sprawdzany link, a rozmiary podglądu tylko
  dla materiałów, które mają ramkę. Odmowa dostępu z backendu blokuje moduł Google.
- Import CSV ma czytelniejsze, przewijane okno z widocznymi przyciskami na telefonie.
  Naprawiono wyścig między wyborem pliku a pobieraniem docelowej puli.

## Typy pytań i modele

Wspólny format pozostaje `quiz.json` (`mode: "quiz"` albo `mode: "deck"`).
Metadata zawierają m.in. `title`, `description`, `status`, `active`, `courseId`.
Definicje są przechowywane w istniejącym repozytorium treści:
`quizzes/<quizId>/quiz.json`; lokalne obrazy w `quizzes/<quizId>/photos/`.

| Typ | Zastosowanie | Pula nauki |
| --- | --- | --- |
| `flashcard` | przód i tył: Markdown/LaTeX i tablice obrazów | tak |
| `single` | jedna poprawna opcja, np. ABCD | tak |
| `multiple` | wiele poprawnych opcji | tak |
| `text` | porównanie z dopuszczonymi odpowiedziami tekstowymi | tak |
| `image_occlusion` | obraz źródłowy i maski | tak |
| `true_false` | prawda/fałsz | tylko zwykły quiz |
| `open` | odpowiedź otwarta i dotychczasowe ustawienia oceny | tylko zwykły quiz |

Pula może mieć maksymalnie 200 pytań. Jedno pytanie z maskami może rozwinąć się
w wiele kart; maksymalnie 50 masek na pytanie. Fiszka ma `front` i `back`, każde
z `text` i `images` (maks. 8 obrazów na stronę). Referencje obrazów są lokalne
`photos/...` albo współdzielone `assets/shared/...`.

Maska ma trwałe `maskId`, `name`, `answer`, `explanation` oraz względne współrzędne
`x`, `y`, `width`, `height` w zakresie obrazu. `occlusion` zawiera `mode`, `color`,
`masks`. Dzięki współrzędnym względnym maski skalują się razem z obrazem.

Klucz stanu karty to `questionId`, dla osobnych/losowych masek
`questionId/maskId`, a dla całego obrazu `questionId/all`. Stan zawiera
`repetitions`, `interval`, `ease`, `dueAt`, `lastReviewedAt`, `lastGrade`,
`attempts`, `correct`, `incorrect`, `hardMarks`, `lastAnswer`, `lastCorrect`
oraz zgodnościowe `status`, `easeFactor`, `dueDate`. To stan bieżący i liczniki,
nie pełna historia wszystkich odpowiedzi.

## Tworzenie fiszek, obrazów, wzorów i masek

1. Studio → Quiz → **Nowa pula fiszek**. Nadaj tytuł, identyfikator i przypisz kurs.
2. Dodaj pytanie typu fiszka. Uzupełnij **Przód** i **Tył**. Markdown i LaTeX
   działają w obu polach. Podgląd ucznia pokazuje aktualną kartę bez zapisu postępu.
3. **Dodaj obraz** otwiera Media Manager. Wybierz istniejący plik albo prześlij
   nowy do lokalnych zdjęć puli lub biblioteki współdzielonej. Dodaj tekst alternatywny.
   Upload: maks. 4 MiB, PNG/JPEG/GIF/WebP lub bezpieczny SVG; backend sprawdza
   sygnaturę, rozszerzenie, MIME, ścieżkę i niedozwolone elementy SVG.
4. Przycisk **fx** otwiera kreator LaTeX przy danym polu. Wybierz szablon, uzupełnij
   wzór i wstaw go do treści. Można też wpisać `$H_2O$`, `$\alpha$`,
   `$\frac{a}{b}$` ręcznie. Import nie interpretuje ukośników jak sekwencji escape.
5. Dla image occlusion wybierz odpowiedni typ, obraz źródłowy i narysuj prostokąty.
   Maski można przesuwać, skalować oraz opisać nazwą, odpowiedzią i wyjaśnieniem.
   Wybierz: jedna karta na maskę, wszystkie maski na obrazie lub losowa maska.
   Sprawdź zaznaczoną maskę i odsłanianie w podglądzie ucznia.
6. Dla ABCD uzupełnij opcje i zaznacz jedną poprawną; dla multiple choice zaznacz
   wszystkie poprawne. Text compare korzysta z dopuszczonych odpowiedzi i ustawień
   normalizacji/tolerancji, bez modelu AI.
7. **Zapisz szkic** zachowuje pracę; **Opublikuj** udostępnia aktywny materiał uczniom.

Dodatkowy tryb ABCD generowany z fiszek wymaga co najmniej czterech różnych
odpowiedzi tekstowych. Nie tworzy fikcyjnych opcji ani nowej puli na serwerze.

## CSV: import i duplikaty

Studio → Quiz → otwórz lub utwórz pulę → **Import CSV**. Wybierz plik lub wklej
tekst UTF-8. Ustal pulę, separator i domyślny typ. Bez zaznaczenia opcji nagłówka
pierwszy rekord jest danymi; domyślnie kolumna 1 to pytanie, a 2 odpowiedź.

```csv
Jak nazywa się wiązanie między aminokwasami?,Wiązanie peptydowe.
Jaki produkt uboczny powstaje podczas tworzenia wiązania peptydowego?,Cząsteczka wody ($H_2O$).
```

Dla pliku z nagłówkiem samodzielnie zaznacz **Pierwszy rekord jest nagłówkiem**.
Importer proponuje mapowanie rozpoznanych nazw, które można zmienić:

```csv
question,answer,explanation,type,tags
"Wzór wody, inaczej tlenku wodoru?",$H_2O$,Przykład wzoru,flashcard,chemia|podstawy
```

```csv
question,answer,optionA,optionB,optionC,optionD,correct,type
Wybierz wzór wody,,$H_2O$,$CO_2$,$O_2$,$N_2$,A,single
```

Obsługiwane są przecinek, średnik i tabulator, cytowane przecinki, podwojone
cudzysłowy oraz nowe linie wewnątrz cytowanego pola. Typy CSV: `flashcard`, `single`,
`multiple`, `text` (także ich aliasy). Dla wyboru można mapować opcje A–F;
klucz `correct` to np. `A` lub `A|C`. Tagi rozdziela `;` albo `|`.

Duplikat to para znormalizowanego pytania i odpowiedzi: NFC, małe litery,
przycięte i ujednolicone białe znaki. Normalizacja służy tylko porównaniu,
nie przepisuje treści. Porównywane są istniejące pytania oraz rekordy z tego importu.
Administrator wybiera pomijanie lub importowanie duplikatów.

Sprawdź podgląd, mapowanie i liczniki: dodane, pominięte, błędy, duplikaty.
**Zatwierdź import do szkicu** zmienia lokalny szkic; nie publikuje materiału.
Dopiero **Zapisz szkic** / **Opublikuj** zapisuje całą definicję. Walidacja błędnego
rekordu blokuje cały import. Zapis serwera waliduje model i stosuje `expectedSha`
do wykrywania równoczesnej edycji. Nie jest to transakcja obejmująca inne pule.

Limity: 2 MiB CSV, 2000 rekordów wejściowych, 32 kolumny, 10 000 znaków pola,
200 pytań i 2 MiB finalnej definicji. Krótsze limity obowiązują pola wybranych typów.
CSV nie przesyła obrazów ani geometrii masek; dodaje się je później w edytorze.

## Dashboard, lekcje i Google / NotebookLM

W edytorze dashboardu przełącznik **Fiszki** w konfiguracji Bento włącza lub
wyłącza cały panel nauki. Opublikuj dashboard, aby zmiana dotarła do ucznia.
Wyłączony panel nie pobiera podsumowań. Przełącznik planera steruje prezentacją
terminów i domyślnymi akcjami; nie usuwa postępu. Sam przełącznik widoczności
nie zastępuje uprawnień ani dezaktywacji puli.

Lesson Builder → **Powtórka / Fiszki** → biblioteka i opublikowana pula.
Pozostaje dyrektywa `:::quiz` z `study: true`; lekcja przechowuje referencję,
nie kopię pytań lub obrazów. Uczeń otwiera naukę w nowej karcie, a bezpieczny
`lesson_return` pozwala wrócić do lekcji także po przejściu przez menadżer.
Kafelki fiszek zachowują powiązanie repozytorium/puli w katalogu postępu,
więc blokady kolejności i reset odnoszą się do właściwego materiału.

Dla Google: w lekcji lub kafelku Google zmień pole **Link Google / NotebookLM**,
sprawdź **Sprawdź link ↗**, zapisz i opublikuj materiał. Link notatnika generuje
jeden przycisk **Otwórz notatnik ↗** w nowej karcie, bez pustej ramki i regulatorów
rozmiaru. Drive/Docs zachowują podgląd ładowany po kliknięciu i opcję zamknięcia
ramki. Rozmiary są dostępne tylko dla tego podglądu.

Adresy są sprawdzane: HTTPS, rozpoznane hosty Google i dozwolone ścieżki.
Nie można wkleić dowolnego HTML/iframe. Samodzielny moduł Google czeka na sesję
oraz wynik kontroli dostępu; odmowa 409 nie jest połykana przez klienta postępu.
Nie zapisuje dwa razy automatycznego otwarcia tego samego modułu.

Notatnik musi być udostępniony docelowym uczniom na ich kontach Google.
Samo opublikowanie linku w NextMed nie nadaje uprawnień w Google.
[Instrukcja udostępniania Google](https://support.google.com/gemininotebook/answer/16322204?hl=en).
Integrację sprawdzono na lokalnych danych testowych, bez logowania do prywatnego
notatnika Google lub konta rzeczywistego ucznia.

## Scheduler, reset i koszty

To własna drabina interwałów NextMed, nie FSRS ani pełny algorytm Anki.

| Ocena | Pierwszy termin | Następne terminy |
| --- | --- | --- |
| Nie pamiętam | 1 minuta | ponownie 1 minuta |
| Trudne | 4 godziny | 60% poprzedniego odstępu, od 4 h do 2 dni |
| Dobre | 1 dzień | co najmniej dzień, wzrost zależny od odstępu i `ease` |
| Łatwe | 3 dni | co najmniej 3 dni, szybszy wzrost |

Maksimum to 365 dni. Backend wyznacza wiążący czas i sprawdza odpowiedzi
`single`, `multiple`, `text`; błędna odpowiedź wymusza „Nie pamiętam”.
Fiszki i maski opierają się na samoocenie. 100% postępu oznacza ocenienie
wszystkich kart, a nie gwarancję zapamiętania materiału. Reset pojedynczych kart
zmniejsza ten procent i usuwa oznaczenie ukończenia, gdy pula jest niepełna.

Nie ma crona, codziennych kopii pul, wywołań AI ani odpytywania w nieskończoność.
Kolejka jest wyliczana z istniejących kart i ich `dueAt` przy otwarciu/odświeżeniu.
W trakcie nauki zapomniana karta może wrócić po minucie; gdy sesja jest zakończona,
uczeń sam odświeża kolejkę. Nie uruchamia to automatycznej funkcji w tle.

Odczyty i zapisy:

- Dashboard pobiera podsumowania po pojawieniu się panelu, po odświeżeniu lub
  kliknięciu kolejnej strony. Jedna strona ma najwyżej 12 wpisów. Nie czyta
  wszystkich definicji, zdjęć ani fragmentów stanu ucznia.
- Menadżer pobiera katalog i podsumowania, następnie tylko wybraną pulę.
  `GET view=study&inspect=1` sprawdza uprawnienia i czyta stan, ale nie zakłada
  generacji, indeksu ani nie zapisuje ocen. Obrazy wiersza pobiera po rozwinięciu.
- Otwarcie nauki czyta do 16 fragmentów stanu i podsumowanie. Pierwsze otwarcie
  zakłada generację; starsze dane mogą wymagać migracji lub naprawy podsumowania.
- Oceny są buforowane: paczka do 20, po 15 sekundach od oczekujących zmian,
  na końcu sesji, po ręcznym zapisie lub przy ukryciu/opuszczeniu strony.
  Pusty bufor nie uruchamia cyklicznych żądań. Samo odsłonięcie odpowiedzi nie zapisuje.
- Zapis dotyka tylko odpowiednich fragmentów, indeksu i rekordu postępu.
  Reset zbiorczy wysyła kolejne paczki po 20. Każde zdarzenie ma ID do ponowienia
  bez podwójnego naliczenia. Brak sieci wymaga **Ponów zapis**; nie ma pętli retry.
- Google/NotebookLM jest linkiem lub ramką z domeny Google, bez proxy treści
  i wywołań AI przez moduł fiszek. Używanie samego Google podlega jego zasadom.

Operacje Netlify Functions/Blobs i transfer nadal mogą kosztować. Nie sprawdzano
rachunku, planu hostingowego ani rzeczywistego ruchu. Powyższe ogranicza zbędne
operacje; nie stanowi zapewnienia o zerowym koszcie. Osobne funkcje AI lekcji
lub pytań otwartych nie są schedulerem i mogą mieć własne zużycie.

## Blobs i migracja

Używany jest dotychczasowy store `chemdisk-progress`:

```text
users/<user>.json                                      # dotychczasowy postęp konta
study/<user>/<sha256(repo:deck)>/current/<0..15>.json   # stałe fragmenty stanu
study-index/<user>/<sha256(repo:deck)>.json              # jedno podsumowanie puli
```

Fragment wersji 2 zawiera generację, rewizję, `records`, `resetVersions` i do
512 ostatnich identyfikatorów zdarzeń. Limit fragmentu: 1200 stanów / 1 MiB.
Podsumowanie zawiera liczniki, terminy oraz statystyki pytań. Użytkownik ma
`details.studyGeneration` i `details.studyStorageVersion: 2`.

Reset całej puli unieważnia generację; kolejne zapisy korzystają z tych samych
16 kluczy `current/`, a nie z kolejnego katalogu. Reset jednej karty zwiększa
jej `resetVersion`. Spóźniona ocena ze starej karty/generacji jest odrzucana
409 i wymaga odświeżenia, aby nie przywrócić skasowanego postępu.

Starszy układ `<generation>/<bucket>.json` jest migrowany przy zwykłym otwarciu
nauki lub zapisie: kopia przez warunkowe zapisy, następnie znacznik wersji w
rekordzie użytkownika. Dopiero po powodzeniu można usunąć stare pliki.
Sprzątanie obejmuje wyłącznie tę samą pulę i konto: do 64 sprawdzonych kluczy,
do 32 usuniętych plików na otwarcie. Klucze `current/` nie są usuwane.
Błąd sprzątania nie blokuje nauki; próba wraca przy kolejnym otwarciu.

Nie ma globalnego zadania czyszczącego. Starsze dane pul, do których nikt już
nie wraca, pozostaną do przyszłego kontrolowanego sprzątania. Nie powstaje
nowa nieograniczona historia generacji podczas kolejnych resetów.

## Statystyki administratora

Studio → Quiz → otwórz pulę → raport → **Odśwież raport**.
Widać liczbę uczniów, którzy rozpoczęli, średnią skuteczność ucznia, procent
poprawnych odpowiedzi, liczbę oznaczeń „Trudne” i 10 najtrudniejszych pytań.

Średnia ucznia jest średnią procentów uczniów z odpowiedziami. Procent poprawnych
to suma poprawnych / suma wszystkich odpowiedzi, więc te dwie wartości mogą się
różnić. Dla masek statystyka pytania sumuje jego karty. Konta oznaczone w indeksie
jako administrator nie są liczone jako uczestnicy. Reset usuwa stan i powiązane
liczniki; raport nie jest trwałym dziennikiem zdarzeń.

Raport pobiera strony po 25 kont i istniejące podsumowania, bez skanowania
fragmentów kart. Przycisk **Wczytaj kolejne konta do statystyk** dołącza następne
wyniki; UI oznacza częściowe dane. Starsze indeksy bez podziału na pytania są
jawnie opisane; zostaną uzupełnione po ponownym otwarciu puli. Historycznych
kliknięć „Trudne”, których nie zapisano, nie można odtworzyć.

## Uprawnienia i walidacja

Backend wymaga sesji i dostępu do kursu; identyfikator konta bierze z sesji.
Odczyt/zapis nauki sprawdza aktywną opublikowaną pulę i blokady materiału, kursu
oraz przodków w sekwencji. Raporty, upload i zapis definicji wymagają admina.
Podgląd autora nie zapisuje nauki. Ukrycie przycisków nie jest zabezpieczeniem.

Walidowane są schematy pytań, obrazy, maski, identyfikatory, wielkości żądań,
liczba ocen, oceny 1–4, dane odpowiedzi i jawna akcja resetu. Niedozwolone pola,
nieznane typy i nieprawidłowe maski są odrzucane. Konto nie może wskazać cudzego
`userId` w żądaniu nauki. Zmiana konta usuwa prywatny stan z widoku i bufora.

## Scenariusz administratora

1. Utwórz pulę zawierającą tekstową fiszkę, obraz, LaTeX, single, multiple, text
   oraz obraz z co najmniej dwiema maskami. Sprawdź edytor i podgląd ucznia.
2. Zaimportuj przykłady CSV bez nagłówka, z nagłówkiem, duplikatem, cytowanym
   przecinkiem, wielowierszowym polem oraz `$\alpha$`.
   Sprawdź podgląd, ręczny mapping i obie polityki duplikatów.
3. Wprowadź błędny rekord: import powinien zatrzymać cały zestaw. Zatwierdzenie
   poprawnego zestawu zmienia szkic; zapis/publikacja zapisuje go na serwerze.
4. Opublikuj pulę, dodaj ją do lekcji przez **Powtórka / Fiszki** i do kafelka
   fiszek. Włącz panel Bento, opublikuj dashboard, następnie sprawdź wyłączenie.
5. Dodaj NotebookLM i Drive. Zmień link bez odświeżania edytora: podgląd oraz
   **Sprawdź link** muszą wskazywać nowy adres; rozmiary znikają dla notatnika.
6. Po odpowiedziach ucznia odśwież raport, sprawdź procenty i „Trudne”. Jeżeli
   raport ma kolejną stronę, dołącz ją jawnie. Konto ucznia ma otrzymać odmowę
   na endpoint raportu i uploadu.
7. Sprawdź w narzędziach sieciowych, że bezczynny dashboard nie odpytuje postępu,
   a wejście do menadżera nie wysyła zdarzenia rozpoczęcia puli.

## Scenariusz ucznia

1. Zaloguj się na konto z dostępem; otwórz lekcję, potem powtórkę. Sprawdź powrót
   do lekcji i zgodność puli z kafelkiem dashboardu.
2. Oceń kilka kart różnymi ocenami, odpowiedz na ABCD/multiple/text, odsłoń maski.
   Zaczekaj na zapis, odśwież stronę i sprawdź zachowanie postępu oraz terminów.
3. Otwórz osobny menadżer. Rozwiń kartę z obrazem i wzorem. Wyszukaj treść,
   zaznacz stronę, potem wszystkie pasujące karty i zakres Shift + klik.
4. Wpisz limit np. 10 i rozpocznij naukę wybranych. W sesji powinny znaleźć się
   wyłącznie wybrane karty, do tego limitu. Usuń limit i sprawdź pełny zestaw.
5. Zresetuj jedną maskę: druga zachowuje swój stan. Zresetuj grupę kart,
   następnie całą pulę. Sprawdź spadek procentu oraz nowe karty.
6. W drugiej, wcześniej otwartej karcie przeglądarki spróbuj wysłać starą ocenę
   po resecie: serwer odmawia i prosi o odświeżenie.
7. Zasymuluj brak sieci przy zapisie, przywróć ją i kliknij **Ponów zapis**.
   Wynik nie powinien naliczyć się dwa razy. Nie zamykaj strony z niezapisanymi ocenami.
8. Sprawdź telefon, klawiaturę, jasny i ciemny motyw. Otwórz Google z lekcji;
   NotebookLM ma otworzyć nową kartę, a zablokowany materiał nie ma się załadować.
9. Wyloguj się / zmień konto: poprzednie karty i oczekujące zmiany nie mogą
   pojawić się na nowym koncie. Sprawdź też konto bez aktywnego dostępu.

## Najważniejsze pliki

| Obszar | Pliki |
| --- | --- |
| Menadżer | `public/members/module/flashcards/{index.html,script.js,style.css}` |
| Dashboard | `public/assets/js/study-dashboard.js`, `public/assets/css/study.css` |
| Nauka i scheduler | `public/assets/js/study-{client,view,scheduler}.js` |
| Trwały postęp | `netlify/study-progress.js`, `netlify/{progress-common,progress-storage,study-access}.js`, `netlify/functions/progress.js` |
| Modele/walidacja | `public/members/module/studio/quiz-model.js`, `public/assets/js/{quiz-practice,quiz-occlusion-model}.js`, `netlify/quiz-common.js` |
| Renderowanie | `public/assets/js/{quiz-flashcards,quiz-occlusion,assessment-text}.js`, `app/shared/runtime.jsx` |
| CSV i edytor | `public/members/module/studio/{quiz-csv,quiz-builder,script}.js`, `public/members/module/studio/{index.html,style.css}` |
| Katalog/lekcje | `public/members/dashboard-parser.js`, `public/members/module/studio/{dashboard-model,lesson-model}.js`, `public/members/module/lesson/lesson-parser.js` |
| Raport | `netlify/study-report.js`, `netlify/functions/admin-quizzes.js`, `public/members/module/studio/quiz-builder.js` |
| Media | `public/assets/js/media-manager.js`, `netlify/content-repository.js`, `netlify/functions/{content-library,content-media}.js` |
| Google | `public/assets/js/google-media.js`, `public/members/module/google/script.js`, edytor Studio |
| Regresje | `tests/{flashcards-manager,study-progress,quiz-flashcards,platform-react,google-media,studio-dashboard,studio-integration}.test.js` i istniejące testy CSV, obrazów, masek, quizów, lekcji oraz uprawnień |

## Walidacja i ograniczenia

`npm test`: **857/857 testów zaliczonych**.
`npm run build`: **kompilacja i 857/857 testów zaliczonych**.
Build kompiluje frontend przez esbuild. Repozytorium nie ma skryptów `lint` ani `typecheck` —
ich uruchomienie zgłasza brak skryptu. Dodatkowo sprawdzono składnię zmienionych
plików JavaScript przez `node --check`; to nie zastępuje pełnego typechecka.
Przy walidacji usunięto niestabilny pomiar milisekund w istniejącym teście
`tests/exam-offline-idb.test.js`: sprawdza on teraz synchroniczną dostępność
pamięci przed rozstrzygnięciem IndexedDB i faktyczne odtworzenie po przeładowaniu.
Kod produkcyjny egzaminów nie został przy tym zmieniony.

Lokalny podgląd Chrome używa danych testowych i odizolowanego profilu: menadżer,
dashboard, kreator z podglądem ucznia i CSV, szerokości 1440 i 390 px, jasny/ciemny
motyw. Uprawnienia i zapisy sprawdzają testy endpointów z magazynem w pamięci.
Nie sprawdzano rzeczywistego rachunku, produkcyjnych Blobs, publikacji do zdalnej
biblioteki ani prywatnych uprawnień notatników. Po wdrożeniu wykonaj powyższe
scenariusze na testowym kursie i kontach admina/ucznia.

Na przyszłość: dzienne limity z trwałą konfiguracją, ewentualny FSRS, trwały bufor
offline, kontrolowane sprzątanie nieaktywnych starych pul oraz rozróżnienie quizu
od puli w lekkim katalogu. Obecny katalog może pokazywać zwykły quiz na liście
menadżera; po wybraniu definicja jest sprawdzana i zwykły quiz kierowany opisem
do właściwego modułu. Nie pobieramy wszystkich definicji tylko po to, by to rozpoznać.
