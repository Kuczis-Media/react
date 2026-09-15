# Migracja dashboardu do React — stan prac

Aktualizacja 2026-09-11: kontynuacja obejmuje także egzaminy, quizy, Studio, landing oraz podział raportów Blobs. Pełny zakres i ograniczenia opisuje [PLATFORM_REACT_MIGRATION.md](PLATFORM_REACT_MIGRATION.md).

Cel: przyspieszyć duże dashboardy, zachowując edycję i publikowanie w Studio.

## Pierwszy etap — zaimplementowany i przetestowany lokalnie

- React przejmuje tylko drzewo materiałów w `#markdown-sections`: działy, organizery, kafelki, wyszukiwanie i paski postępu.
- Studio i `dashboard-parser.js` zachowują obecny format Markdown oraz identyfikatory materiałów. Nie zmieniamy endpointów publikowania, uprawnień, repozytoriów ani Blobs.
- Zawartość zamkniętych organizerów nie powstaje w DOM. Długie listy pokazują porcje po 24 kafelki przez „Pokaż kolejne”. Wyszukiwanie obejmuje cały model, nie tylko widoczne elementy; wpisywanie jest scalane przez 120 ms. Wyczyszczenie filtra działa od razu, także po kliknięciu nawigacji.
- Kolejność zadań jest wyliczana w czasie liniowym z pełnej listy, a nie z aktualnie zamontowanych kart. Zachowane są dane dostępu serwera oraz ostrożny fallback przy nieaktualnym katalogu.
- React jest lokalnym statycznym plikiem produkcyjnym, bez SSR, dodatkowych Functions i runtime CDN.
- Dotychczasowy renderer zostaje na czas migracji jako tryb awaryjny. Panel konta zachowuje dotychczasowy kontroler. Narzędzia administratora przeniesiono do Studio; nie ma już ich dialogu w dashboardzie kursanta.

## Pliki i uruchamianie

- `app/dashboard/dashboard.jsx`: komponenty React i kontroler montowania.
- `app/dashboard/model.cjs`: indeks wyszukiwania i reguły sekwencji bez operacji sieciowych.
- `app/platform-entry.jsx`: wspólny punkt wejścia dla dashboardu, egzaminów, quizów, Studio i landingu. `app/dashboard/entry.jsx` to starszy, nieużywany przez build most.
- `public/members/dashboard.js`: sesja, pobranie aktywnego dashboardu, nawigacja, adapter postępów oraz stary renderer awaryjny. Wersjonowanie odpowiedzi postępu zapobiega nadpisaniu nowszego stanu przez opóźnioną odpowiedź.
- `scripts/build-dashboard.cjs`: lokalny bundle React 19.3.0 + React DOM; esbuild nie wstawia do pliku zmiennych serwera.
- `tests/dashboard-react.test.js`: 13 testów modelu, DOM oraz kompletnej strony z symulowanym API/sesją.

```sh
npm ci
npm run build                         # produkcyjny JS, następnie wszystkie testy
npm test -- tests/dashboard-react.test.js
npm run dev                           # buduje JS, następnie netlify dev
npm run watch:dashboard               # osobny terminal przy edycji komponentów
```

Plik `public/assets/build/dashboard-react.js` jest generowany i ignorowany przez Git. Netlify tworzy go podczas `npm run build`. Przy ręcznym przesyłaniu katalogu `public` należy wcześniej wykonać build. Wspólny bundle z Reactem ma około 276 KiB (85 KiB gzip), jest statyczny, bez pobierania Reacta z zewnętrznego CDN. Nowy JS to dodatkowy zasób statyczny, nie wywołanie Function.

## Wynik weryfikacji

- `npm run build`: 706/706 testów zaliczonych i poprawnie utworzony bundle (2026-09-11).
- 1500 materiałów w zamkniętym organizerze: 0 kafelków w DOM; wyszukanie ostatniego materiału nadal działa.
- 1200 materiałów w płaskiej liście: początkowo 24 kafelki; kolejne dostępne przyciskiem.
- Sprawdzone: publikowany model Studio, linki i ID, zagnieżdżenia, sekwencje przy filtrowaniu i paginacji, ręczne otwieranie grup, ukończenie prezentacji, paski i przyciski resetu, bezpieczne URL, powrót z modułu, opóźnione odpowiedzi postępu, nawigacja podczas wyszukiwania oraz brak nowych zapytań przy filtrowaniu.
- To testy Node/jsdom z symulowanym API, nie pomiar szybkości ani test zalogowanej produkcji. Niczego nie wdrożono i nie zmieniano produkcyjnych materiałów.

## Tryb awaryjny

Otwórz `/members/?dashboardRenderer=legacy`, aby użyć starego renderera. Brak bundle'a lub błąd Reacta również uruchamia starą wersję. Parametr zmienia tylko widok, nie uprawnienia użytkownika. Nie usuwaj tego fallbacku przed weryfikacją produkcji.

## Co pozostaje do kolejnego etapu

1. Sprawdzić dashboard w zalogowanej przeglądarce: publikację ze Studio, powrót z lekcji, reset postępu, filtry, nawigację, klawiaturę i mobile. Nie traktować mocków jako testu produkcji.
2. Zmierzyć rzeczywisty czas renderowania i płynność na dużym dashboardzie użytkownika. Jeżeli koszt dotyczy setek osobnych działów, dodać odroczone montowanie zawartości działów z zachowaniem kotwic.
3. Szczegółowe formularze konta i część edytorów nadal korzystają z istniejących, izolowanych kontrolek DOM. Ich ewentualna dalsza migracja nie wymaga zmiany formatów materiałów. Stary renderer usuwać dopiero po weryfikacji produkcji.

## Dlaczego

Dotychczasowy renderer tworzy wszystkie kafelki, również w zamkniętych listach. Hydratacja sekwencji dla każdej karty ponownie wyszukuje i sortuje wszystkie karty. Samo użycie Reacta bez ograniczenia DOM i tej pracy nie rozwiązałoby problemu.

Integracja stopniowa jest zgodna z [dokumentacją React](https://react.dev/learn/add-react-to-an-existing-project). Nie dodajemy Next.js ani serwera renderującego stronę.
