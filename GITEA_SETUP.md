# NextMed: GitHub lub Gitea

Integracja zachowuje formaty lekcji, quizów, egzaminów, prezentacji i mediów oraz istniejące uprawnienia użytkowników. Zmienia się serwer przechowujący pliki, nie sposób korzystania z kursu. Netlify Identity, Blobs, płatności i router AI pozostają bez zmian.

## 1. Repozytoria i token

1. Skopiuj lub zaimportuj materiały z GitHuba do **prywatnego** repozytorium w Gitei. Zachowaj ścieżki, nazwy plików i gałąź. Nie usuwaj jeszcze kopii GitHub.
2. Do logo, favicon i publicznego JSON landingu przygotuj **osobne publiczne** repozytorium. Nie publikuj repo z materiałami kursantów, odpowiedziami ani sekretami.
3. Utwórz token w **Settings → Applications → Generate New Token**: [Gitea NextMed — tokeny](https://gitea.nextmed.edu.pl/user/settings/applications).
4. Do odczytu wystarczy `read:repository`; do publikowania, edycji i usuwania potrzebne jest `write:repository` (obejmuje odczyt). Konto tokenu musi mieć dostęp do właściwych repozytoriów i zapis do gałęzi. Nie dodawaj uprawnień administratora serwera. Najlepiej użyć konta technicznego mającego dostęp tylko do repozytoriów NextMed.
5. Repozytoria powinny być zainicjalizowane, np. plikiem README, a wskazana gałąź musi już istnieć. Nie wyłączaj ochrony gałęzi bez potrzeby — dobierz gałąź publikacji lub uprawnienia konta.

Transport używa API v1 zgodnie z dokumentacją Gitei: [autoryzacja i zakresy](https://docs.gitea.com/1.26/development/api-usage/), [odczyt contents](https://docs.gitea.com/api/1.24/operations/repo-get-contents/), [utworzenie pliku](https://docs.gitea.com/api/1.24/operations/repo-create-file/). Odczyt zwraca JSON z `encoding: base64`, `content` i SHA pliku. Utworzenie to **POST**, aktualizacja **PUT z SHA**, usunięcie **DELETE z SHA** — nie jest to ślepa zamiana domen GitHuba.

## 2. Wymagane ENV

W Netlify dodaj zmienne do konfiguracji projektu, dostępne dla Functions w środowisku produkcyjnym, i wykonaj nowy deploy. Lokalnie możesz użyć `.env` z generatora. Nie commituj pliku z sekretami.

```dotenv
GIT_PROVIDER=gitea
GITEA_BASE_URL=https://gitea.nextmed.edu.pl
GITEA_API_URL=https://gitea.nextmed.edu.pl/api/v1
GITEA_TOKEN=
GITEA_OWNER=
GITEA_REPO=
GITEA_BRANCH=main
```

Wpisz rzeczywistego właściciela/organizację, nazwę repo i token. `GITEA_API_URL` można pozostawić puste: backend wyliczy je jako Base URL + `/api/v1`. Wymagany jest HTTPS; oba URL muszą mieć ten sam origin. Niedozwolone są dane logowania i parametry w URL.

Opcjonalnie:

```dotenv
GITEA_CONTENT_ROOT=
GITEA_CONTENT_REPOSITORIES=
GITEA_SITE_ASSETS_REPOSITORY=
GITEA_SITE_ASSETS_TOKEN=
GITEA_SITE_ASSETS_BRANCH=
GITEA_SITE_ASSETS_DIRECTORY=
LANDING_CONFIG_PATH=landing/config.json
```

- `GITEA_CONTENT_ROOT`: katalog zawierający dotychczasowe foldery `lessons`, `prompts`, `exams`, `quizzes`, `presentations`, `assets` itd.; puste oznacza katalog główny.
- `GITEA_SITE_ASSETS_REPOSITORY`: **pełna nazwa** publicznego repo, np. `TwojaOrganizacja/branding`. Jest potrzebna do publicznej biblioteki obrazów i publikacji repozytoryjnej landingu. Nie ma automatycznego przełączenia na prywatne repo materiałów.
- `GITEA_SITE_ASSETS_TOKEN`: opcjonalny osobny token; puste używa `GITEA_TOKEN`.
- `GITEA_SITE_ASSETS_BRANCH`: puste używa `GITEA_BRANCH`, a następnie `main`.
- `GITEA_SITE_ASSETS_DIRECTORY`: opcjonalny katalog obrazów. Nie zmienia lokalizacji pliku ustawień `landing/route.json`.
- `LANDING_CONFIG_PATH`: początkowa ścieżka JSON. Jeśli istnieje zapisane `landing/route.json`, wybrana tam ścieżka ma pierwszeństwo; zmienisz ją w panelu Landing.
- Alias `GITEA_ASSETS_REPO` jest obsługiwany jako sama nazwa publicznego repo należącego do `GITEA_OWNER`. Zalecane jest jawne `GITEA_SITE_ASSETS_REPOSITORY`.

## 3. Wiele repozytoriów

Zachowano istniejący konfigurator repozytoriów. Po wdrożeniu podstawowych ENV pokaże Giteę, właściwy link do tokenów i nazwy zmiennych. Zapis w panelu dotyczy wybranego dostawcy; jego zmianę oraz adres instancji ustaw przez ENV, nie przez pole nazwy repo.

Przykład wartości `GITEA_CONTENT_REPOSITORIES` (w generatorze wklej JSON jako wartość jednego pola):

```json
[
  {"id":"default","label":"Materiały główne","repository":"TwojaOrganizacja/content","ref":"main","root":"","tokenEnv":"GITEA_TOKEN","default":true},
  {"id":"biologia","label":"Biologia","repository":"TwojaOrganizacja/biology","ref":"main","root":"","tokenEnv":"GITEA_TOKEN_BIOLOGIA","default":false}
]
```

Dodaj również osobną zmienną `GITEA_TOKEN_BIOLOGIA`. `tokenEnv` zawiera **nazwę zmiennej**, nigdy sekret. Można współdzielić `GITEA_TOKEN`. W konfiguracji Gitei dozwolone są tylko nazwy `GITEA_TOKEN` / `GITEA_TOKEN_*`; tokeny GitHuba nie będą wysyłane do Gitei.

Lista zastępuje konfigurację pojedynczego repo. Maksymalnie 20 pozycji, jedna domyślna. Podczas migracji zachowaj dotychczasowe `id`, `root`, gałęzie i wskazanie repo domyślnego — do tych identyfikatorów odwołują się zapisane materiały i dashboard. Nie trzeba tworzyć osobnych zmiennych dla każdego typu materiału.

Automatyczny zapis sekretów przez istniejący panel zachowuje dotychczasowe ograniczenia Netlify. Jeśli plan lub uprawnienia konta na to nie pozwalają, wpisz sekret ręcznie w ENV Netlify, wykonaj deploy i zostaw pole tokenu w konfiguratorze puste. Nie ma obejścia zapisującego PAT jako publiczną zmienną. Generator `.env` działa lokalnie niezależnie od tej opcji API.

## 4. Generator .env

**Studio → Generator .env → Git / Content Provider**:

- wybór GitHub / Gitea oraz wszystkie powyższe pola;
- import istniejącego `.env`, dodawanie własnych zmiennych, kopiowanie i pobieranie;
- podgląd i pola tokenów domyślnie zamaskowane;
- eksport zawiera rzeczywiste wartości **wpisane lub zaimportowane przez administratora lokalnie** — nie maski;
- generator nie pobiera sekretów z serwera, nie zapisuje ich w localStorage i nie wywołuje Functions do generowania pliku;
- walidacja nazw, duplikatów, cudzysłowów oraz adresów Gitei;
- import starego pliku GitHub bez `GIT_PROVIDER` zachowuje GitHuba, także przy użyciu aliasów `GITHUB_OWNER/REPO/BRANCH`.

Pobranie pliku nie wdraża ENV automatycznie. Nie wysyłaj pobranego `.env` innym osobom; po użyciu usuń sekret ze schowka. Pola tokenów panelu repozytoriów służą do podania **nowej** wartości, a zapisany sekret serwera nigdy nie wraca do klienta.

## 5. Publiczne linki, prywatne obrazy i cache

Publiczne pliki Gitei mają linki bez tokenu:

```text
https://TWOJA-GITEA/owner/repo/raw/branch/main/landing/config.json
https://TWOJA-GITEA/owner/repo/raw/commit/SHA/branding/logo.png
```

Link obrazu po publikacji zawiera commit, więc następna wersja nie koliduje ze starą w cache. Gitea nie używa jsDelivr — pliki obsługuje Twoja instancja lub jej reverse proxy/CDN. Publiczny JSON pobierany z innej domeny wymaga odpowiednich nagłówków **CORS** na trasach publicznych raw (np. `Access-Control-Allow-Origin` dla domeny platformy). Zwykłe `<img>` nie wymaga CORS do samego wyświetlenia. Nie udostępniaj przez CORS prywatnego API ani nie dodawaj tokenów do linków. Reguły WAF/logowania muszą pozwalać na anonimowy odczyt publicznych raw.

Prywatne Markdown/JSON/obrazy nadal odczytują istniejące Functions po weryfikacji użytkownika i dostępu do kursu. Backend używa `Authorization: token …`; przeglądarka widzi tylko własne endpointy NextMed i publiczne metadane. Transport nie podąża za przekierowaniami z tokenem.

Zachowano cache list i mediów oraz deduplikację po stronie klienta. Klucze cache backendu uwzględniają dostawcę, instancję, repo, gałąź, katalog i skrót tokenu, dzięki czemu rotacja tokenu nie korzysta z cache innego sekretu. Lista: 20 sekund; prywatne obrazy: 5 minut w ograniczonym pamięciowo cache backendu. Dotychczasowe cache przeglądarki pozostają aktywne. To redukuje odczyty Gitei, ale nie gwarantuje zera wywołań Netlify — cache Functions nie jest trwały między wszystkimi instancjami.

Publiczne ustawienia źródła landingu przechodzą przez **istniejącą** Function `landing?source=route`, bez tokenu repozytorium. Mają cache CDN do 5 minut i przeglądarki 5 minut. Sam publiczny JSON i obrazy są pobierane bezpośrednio z Gitei. Pozostaje istniejący odczyt informacji o publikacji Blobs. Nie dodano nowej Function; odczyt ustawień źródła to dodatkowa ścieżka istniejącej funkcji. Po zmianie ENV lub publikacji uwzględnij czas cache.

## 6. Powrót do GitHuba i istniejące linki

Ustaw `GIT_PROVIDER=github`, zachowaj/uzupełnij dotychczasowe `GITHUB_CONTENT_*` oraz `GITHUB_SITE_ASSETS_TOKEN`, potem wdroż Functions. Bez jawnego providera stare instalacje z ustawionymi zmiennymi GitHub nadal wybierają GitHuba; nowe szablony preferują Giteę.

Obsługiwane są również `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`; dotychczasowe `GITHUB_CONTENT_*` mają pierwszeństwo. Opcjonalne `GITHUB_SITE_ASSETS_REPOSITORY` i `GITHUB_SITE_ASSETS_REF` zastępują historyczne publiczne repo `Kuczis-Media/logo@main`.

Nie zmieniono automatycznie literalnych URL zapisanych w Markdown, JSON, Blobs ani publicznych plikach. Linki `raw.githubusercontent.com` / jsDelivr już wprowadzone przez użytkownika nadal wskazują GitHuba. Po skopiowaniu obrazów podmień je na wygenerowane linki Gitei w bibliotece/edytorze. Względne odwołania do mediów zachowują dotychczasowe działanie, jeśli skopiowano strukturę katalogów.

Pozostawione wystąpienia GitHuba w kodzie mają określoną rolę:

- API/auth/raw: wspólny `netlify/git-provider.js`, aktywne tylko dla odpowiedniego providera;
- jsDelivr w `site-assets.js`: tylko publiczny provider GitHub;
- normalizatory już zapisanych URL w `landing-content.js` i builderze: zgodność starych publicznych linków;
- domyślne historyczne URL w HTML / `site-brand.js` / modelu landingu: zgodność starszych instalacji, nadpisywane odczytanymi ustawieniami źródła; błąd odczytu nowego źródła nie powoduje przełączenia na GitHuba;
- wewnętrzna nazwa trybu `static-github`, pole `githubUrl` i niektóre kody błędów pozostają dla zgodności zapisanych danych; obsługują również repozytoryjną publikację Gitei.

Nie stwierdzono regresji GitHuba w testach lokalnych. Różnice wdrożeniowe to konfiguracja CORS/publicznych raw Gitei, osobne uprawnienia i składnia API; automatyczna migracja plików/linków nie jest wykonywana. Sam przełącznik nie kopiuje repozytoriów i nie synchronizuje późniejszych zmian pomiędzy GitHubem a Giteą.

## 7. Testy i stan weryfikacji

Node co najmniej 20.12.2; zależności z `npm ci`. Testy nie wymagają prawdziwych tokenów:

```sh
npm test -- tests/gitea-provider.test.js tests/admin-content-repositories.test.js tests/env-generator.test.js
npm run build
git diff --check
```

`npm test` i `npm run build` izolują proces testów od produkcyjnych ENV Netlify. Nie trzeba usuwać ani zmieniać `GIT_PROVIDER`, tokenów ani konfiguracji repo w panelu, żeby build przeszedł. Uruchamianie samego `node --test` omija zabezpieczenie — używaj powyższych komend. Jeśli wcześniejszy nieudany test wypisał token w logu, unieważnij go w Gitei, utwórz nowy, podmień wartość w Netlify i wykonaj ponowny deploy z poprawionym kodem.

Lokalnie sprawdzono odpowiedzi API na atrapach: Markdown z parserem lekcji, JSON, katalogi, obrazy i cache, POST/PUT/DELETE/SHA/konflikty, publiczne i prywatne repo, brak sekretów w odpowiedziach, panel repozytoriów (test i zapis ENV), publikację i zmianę ścieżki landingu oraz import/eksport `.env`. Pełny zestaw obejmuje też istniejące kontrole dostępu i regresje GitHuba.

Sprawdzono lokalne pakowanie wszystkich 28 Functions przez `@netlify/zip-it-and-ship-it` z `esbuild` (ten sam pakiet używany przez CLI Netlify). CLI w tym środowisku próbował zapisać globalną konfigurację poza workspace i został zablokowany; dlatego do pakowania wywołano pakiet bezpośrednio, bez zmiany globalnych ustawień.

**Nie wykonano wdrożenia ani operacji na rzeczywistych repozytoriach.** Próba odczytu `https://gitea.nextmed.edu.pl/api/v1/version` zwróciła HTTP 403, więc nie potwierdzono wersji instancji ani jej reguł proxy/CORS. Nie było skonfigurowanego tokenu i wskazanego repo testowego do pełnej weryfikacji. Testy lokalne nie zastępują poniższej próby po wdrożeniu:

1. Otwórz `/api/v1/version` i porównaj API z dokumentacją własnej instancji `/swagger.v1.json` lub `/api/swagger`.
2. W panelu repozytoriów użyj „Testuj”; sprawdź domyślne i dodatkowe repo.
3. W repo testowym opublikuj lekcję z obrazem, quiz i egzamin; edytuj, odśwież i usuń wyłącznie utworzony materiał testowy.
4. Otwórz lekcję jako kursant, a następnie sprawdź brak dostępu anonimowego do prywatnych plików. W Network odpowiedzi i URL nie mogą zawierać tokenu Gitei.
5. Opublikuj logo i landing, sprawdź publiczny JSON/obraz w oknie prywatnym oraz błędy CORS w konsoli.
6. Sprawdź generator: import, zmiana tokenu, kopia/pobranie, odczyt pliku jako `.env`. Nie wysyłaj sekretów w zrzutach ekranu/logach.
7. W osobnym środowisku testowym sprawdź powrót do `GIT_PROVIDER=github`, zanim usuniesz starą kopię materiałów.

401/403 API Gitei są zwracane jako błąd konfiguracji repozytorium, nie jako wygaśnięcie sesji kursanta. Sprawdź wtedy token, konto, zakres `repository`, uprawnienia gałęzi oraz WAF/proxy. 404 oznacza brak repo/pliku/gałęzi lub ukrywanie zasobu przez serwer; 409/422 przy zapisie wymaga odświeżenia wersji, a nie nadpisania cudzych zmian. Timeout kończy próbę bez ujawnienia szczegółów sekretu.

## Pliki objęte zmianą

- Backend: `netlify/git-provider.js` (nowy), `netlify/content-repository.js`, `netlify/site-assets.js`, `netlify/functions/admin-content-repositories.js`, `netlify/functions/landing.js`.
- Odczyt i komunikaty frontendu: `public/assets/js/{admin-landing-settings,content-library,landing-delivery-model,landing-runtime,landing-source,media-manager,site-brand}.js`.
- Panel: `public/members/{index.html,dashboard.js}`; Studio: `public/members/module/studio/{landing/script.js,manage/management.js}`.
- Generator: `public/members/module/studio/env/{env-model.js,index.html,script.js,style.css}`.
- Konfiguracja/dokumentacja: `.env.example`, `GITEA_SETUP.md` (nowy).
- Testy: `tests/gitea-provider.test.js` (nowy), `tests/{admin-content-repositories,env-generator,landing-delivery,site-assets,static-integration}.test.js`.
