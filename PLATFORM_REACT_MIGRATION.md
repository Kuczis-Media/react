# NextMed — kontynuacja migracji i raporty Blobs

Stan lokalny: 2026-09-11. Zmiany przygotowane do standardowego builda; bez wdrożenia, zmiany ENV ani operacji na produkcyjnych repozytoriach/Blobs.

## Co jest gotowe

- Quizy: nowe pytanie otwarte domyślnie ma ocenę ręczną. Publikacja dopuszcza pytania ręczne i bez punktacji bez klucza odpowiedzi; punktowane pytanie z jawnie wybraną oceną AI wymaga klucza. Szkic AI można zapisać przed jego uzupełnieniem. Nieudany zapis nie zmienia lokalnego statusu na „Opublikowany”. Po publikacji raport jest dostępny bez przełączania edytora.
- Dashboard: React renderuje materiały, organizery, filtry i postępy; duże listy montowane partiami po 24. Wyszukiwanie i sekwencja uwzględniają także niewidoczne jeszcze materiały.
- Egzaminy: React renderuje pytania, nawigator, historię i wyniki. Zachowane blokady, timery, typy odpowiedzi i istniejący mechanizm scalania zapisu. Szybka nawigacja nie czeka z wyświetleniem pytania na każdą odpowiedź serwera.
- Quiz ucznia: kontrolowane odpowiedzi, listy po 24, zachowanie odpowiedzi przy dokładaniu pytań, blokada podczas sprawdzania i poprawny reset próby. AI nie jest uruchamiane przez renderowanie ani zmianę strony raportu.
- Studio: React obsługuje wybór narzędzi, wyszukiwanie, biblioteki, płótna dashboardu/lekcji, listy pytań egzaminów i quizów, slajdy prezentacji, punkty promptów, listę sekcji landingu, pola ENV, wybrane widoki postępów/limitów i pola cen. Długie lekcje i quizy mają zwijane treści. Aktualizacja podglądu quizu po pisaniu jest scalana przez 180 ms, zapis szkicu przez 200 ms; opuszczenie strony i `flush()` zapisują od razu.
- Administracja: dialog usunięty z `/members/index.html`. Ustawienia dostępne wyłącznie w Studio, z dotychczasową ochroną roli administratora na CDN, w kliencie i API. Lista użytkowników renderuje się po 24; wyszukiwanie obejmuje całą pobraną listę. Otwarcie ustawień nie pobiera treści kursu ani postępów dashboardu. Starsze linki `?admin=...` przekierowują do właściwej części Studio.
- Landing: React uzgadnia sekcje z publikowanym modelem, ich kolejność, widoczność, teksty, kolory i obrazy. Zachowane formularz, CAPTCHA, cennik, animacje i instancja modelu 3D. Tło pól kontaktu jest niezależne od tła sekcji. Link logowania nadal reaguje na sesję. Animacje ponownie obserwują nowe elementy po montowaniu Reacta.

To migracja stopniowa: rozbudowane inspektory, kreator równań, część podglądów, edytory odpowiedzi i szczegółowe formularze administracyjne pozostają istniejącymi widgetami DOM. React nie uzgadnia wnętrza tych widgetów. Kontrolery sesji, publikacji, punktacji i płatności nie zostały zastąpione nowym backendem.

## Blobs — mniej dużych odczytów

`netlify/exam-storage.js` zapisuje teraz zbiorcze podsumowania egzaminów i quizów jako osobne małe rekordy:

- `attempts/...`: pełne odpowiedzi i szczegóły pojedynczej próby — dotychczasowy format.
- `report-entries/<egzamin>/<czas>-<próba>.json`: jedno podsumowanie próby, aktualizowane wraz z oceną. Quizy mają odrębną przestrzeń `quiz:<id>`.
- `reports/<egzamin>.json`: mały znacznik formatu `entries-v2`, zamiast stale powiększanego zestawu wszystkich prób.

Starszy raport pozostaje czytelny bez zapisu podczas GET. Przy pierwszej synchronizacji próby jego podsumowania są kopiowane partiami (maks. 12 zapisów równolegle). Dopiero po ich zapisaniu znacznik zastępuje stary indeks, z kontrolą ETag. Przerwaną migrację można wznowić; test obejmuje także równoległą zmianę starego indeksu. Pełne próby nie są usuwane. Starsza synchronizacja nie może nadpisać nowszej oceny w raporcie ani indeksie ucznia.

API raportów zwraca domyślnie 25 prób, maksymalnie 50 na stronę, z `cursor`. Studio pokazuje „Następna część” i „Od początku”, zastępując bieżące wiersze. Przy wielu stronach statystyki i analiza dotyczą wyłącznie wyświetlanej części — interfejs oznacza to wprost. Analiza egzaminu czyta pełne próby maksymalnie po 4 równolegle i zachowuje tylko skrócone dane potrzebne do statystyk. Szczegółowe odpowiedzi nie są skracane w zapisanej próbie.

## Koszty i ograniczenia

- React to jeden lokalny plik statyczny, bez SSR i nowych Functions. Wyszukiwanie, składanie/rozwijanie list oraz renderowanie nie wywołują AI ani serwera. Statyczny transfer nadal podlega rozliczeniu hostingu.
- Obrazy nadal korzystają z istniejącej pamięci podręcznej i odroczonego wczytywania. React nie pobiera ponownie niezmienionego obrazu przy zwykłym uaktualnieniu pytania.
- Zdarzenia audytowe były już osobnymi rekordami; nie tworzyły jednego globalnego JSON. Historia zdarzeń wewnątrz próby egzaminu ma istniejący limit 500. Nie dodano kasowania historii ocen ani automatycznej retencji audytu.
- Pierwsze przeniesienie dużego starego raportu nadal wymaga odczytu jego dawnego JSON i skopiowania podsumowań. Późniejsze synchronizacje zapisują pojedyncze podsumowanie, nie cały raport. Przy wyjątkowo dużym starym indeksie należy sprawdzić czas pierwszej migracji na kopii danych.
- Paginacja SDK listuje metadane; wczytuje JSON tylko wybranych rekordów. Głębokie strony mogą wymagać przejścia przez wcześniejsze strony metadanych. Przy równoległym dopisywaniu prób stronicowanie offsetowe nie jest transakcyjną migawką — odśwież raport, aby zacząć od aktualnego początku.
- Indeks prób jednego ucznia oraz dokument postępu jednego ucznia nadal mają poprzedni format. Liczba prób w indeksie nie została arbitralnie obcięta, bo wpływa na limity podejść i strategię wyniku. Dla kont z bardzo dużą liczbą prób/odpowiedzi kolejny etap to osobna migracja tych dokumentów, a nie kasowanie historii.
- Liczby kredytów i opłat produkcyjnych nie były mierzone. Mniejszy zakres danych i brak zapytań podczas renderowania nie gwarantują określonej obniżki rachunku.

## Pliki i uruchamianie

Punkt wejścia: `app/platform-entry.jsx`. Komponenty: `app/dashboard/`, `app/assessment/`, `app/studio/`, `app/landing/`. Granice widgetów, obsługa błędów i sprzątanie korzeni: `app/shared/runtime.jsx`.

```sh
npm ci
npm run build
npm run dev
# W osobnym terminalu podczas edycji JSX:
npm run watch:dashboard
```

Build najpierw tworzy ignorowany przez Git `public/assets/build/dashboard-react.js`, a dopiero później uruchamia testy sprawdzające obecność zasobów HTML. `npm test` generuje go przez `pretest`, także dla wybranych plików testowych. Bundle ma 282572 bajty, około 276 KiB (85 KiB gzip). Nie wstawia wartości ENV do kodu przeglądarki. Przy ręcznym wysyłaniu `public` należy najpierw wykonać build. Eksport samodzielnego landingu pozostaje statycznym HTML z dotychczasowym runtime, bez obowiązku dołączania Reacta.

Tryby porównawcze: `/members/?dashboardRenderer=legacy` oraz `?uiRenderer=legacy` w pozostałych zintegrowanych widokach. Zmieniają widok, nie uprawnienia. Po migracji zapisów `entries-v2` nie należy cofać całego backendu do wersji nieznającej tego formatu; sam przełącznik starego interfejsu jest niezależny od storage.

## Weryfikacja i przekazanie

`npm run build`: **706/706 testów**, produkcyjny bundle utworzony. `git diff --check`: bez błędów. Testy obejmują rzeczywisty produkcyjny JS i kontrolery stron w jsdom oraz symulowane magazyny/API: typy odpowiedzi, szybką nawigację, publikację i błąd zapisu, raporty i migrację, dostęp administratora, lokalny generator ENV, zachowanie formularza/3D/cennika i linku sesji na landingu.

Po wdrożeniu należy sprawdzić na koncie administratora i ucznia:

1. Opublikować testowy quiz z pytaniem ręcznym, AI z kluczem oraz bez punktów. Oddać próbę, przyznać punkty w Studio i odświeżyć wynik ucznia.
2. W większym egzaminie szybko zmieniać pytania, wracać do odpowiedzi, sprawdzić obrazki, blokady i timer. Na telefonie ocenić płynność przewijania.
3. W Studio otworzyć każde narzędzie; sprawdzić publikację, szkice, eksport ENV oraz odmowę dostępu uczniowi do ustawień.
4. Opublikować zmianę kolejności i kolorów landingu, sprawdzić kontakt, CAPTCHA, cennik i przełączanie przycisku logowania, także z ograniczonymi animacjami.
5. Sprawdzić pierwszą synchronizację starego raportu i kilka stron historii. Potwierdzić w monitoringu rzeczywisty czas Functions i rozmiary rekordów.

To nie są jeszcze testy zalogowanej produkcji ani pomiar FPS/rachunku. Żadne zmiany nie zostały zdalnie wdrożone w tej sesji.
