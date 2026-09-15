# ChemDisk — platforma kursów maturalnych

ChemDisk jest statyczną aplikacją wdrażaną na Netlify. Publiczna strona prowadzi do logowania przez Netlify Identity, a zalogowany kursant otrzymuje panel z materiałami zdefiniowanymi w Markdownzie dashboardu i prywatnych repozytoriach lekcji. Dostęp kontrolują role w `app_metadata`, nadawane automatycznie po płatności Stripe albo ręcznie przez administratora.

Kompletna instrukcja wdrożenia i obsługi dla osoby nietechnicznej znajduje się w [`instrukcja.md`](instrukcja.md).

## Architektura

```text
public/
├── index.html                         # strona startowa, oferta i publiczny formularz
├── 404.html                           # lokalna strona błędu
├── login/                             # logowanie, rejestracja i odzyskiwanie konta
├── purchase/                          # osobny ekran zakupu i przedłużania dostępu
├── payment-success/                   # powrót ze Stripe i kontrolna realizacja zakupu
├── time.html                          # bieżąca rola i termin dostępu
├── assets/js/auth.js                  # wspólna obsługa sesji, ról i profilu
└── members/
    ├── index.html                     # panel kursanta
    ├── dashboard.md                   # działy i materiały widoczne w panelu
    ├── dashboard.js / dashboard.css   # interfejs, motyw, sidebar i wyszukiwarka
    ├── dashboard-parser.js            # bezpieczny parser kart i harmonijek
    ├── dashboard-navigation.js        # aktywna sekcja podczas kliknięcia/przewijania
    ├── favicon.svg                    # starszy lokalny fallback; strony używają wspólnego CDN
    └── module/
        ├── theme.js / theme.css       # wspólna paleta jasna/ciemna aplikacji
        ├── media-*.js / *.css         # wspólne mechanizmy podglądów mediów
        ├── studio/                    # Buildery oraz lokalny generator pliku .env
        ├── exam/                      # wspólny odtwarzacz egzaminów
        ├── presentation/              # natywny odtwarzacz prezentacji ChemDisk
        ├── quiz/                      # odtwarzacz opublikowanych quizów ChemDisk
        ├── lesson/                    # odtwarzacz lekcji z prywatnego repo treści
        ├── atonom/                    # modele cząsteczek z polskich nazw
        └── …                          # kalkulatory, tablice, media, czat i kontakt
netlify/functions/
├── identity-login.js                  # role czasowe i identyfikator sesji
├── identity-signup.js                 # sanitowanie profilu przy rejestracji
├── admin-users.js                     # konta, zaproszenia i role Identity
├── create-checkout.js                 # uwierzytelnione tworzenie Stripe Checkout
├── stripe-webhook.js                  # podpisany webhook i nadawanie dostępu
├── payment-status.js                  # potwierdzenie płatności po powrocie ze Stripe
├── payment-config.js                  # publiczny cennik i administracyjna edycja cen
├── payment-admin.js                   # historia i odebranie płatnego dostępu
├── admin-forms.js                     # odczyt/usuwanie zgłoszeń Netlify Forms
├── admin-dashboard.js                 # aktywny Markdown w Netlify Blobs
├── admin-landing.js / landing.js       # draft, publikacja i cache publicznego landingu
├── admin-site-assets.js                # upload logo i obrazów do publicznego GitHuba
├── content-library.js                 # chroniona lista i odczyt repo treści
├── content-media.js                   # uwierzytelniony odczyt prywatnych obrazów
├── presentation.js                    # opublikowana definicja natywnej prezentacji
├── quiz.js                            # opublikowana definicja natywnego quizu
├── exam.js                            # definicja dla ucznia i cykl życia próby
├── admin-exams.js                     # raporty, analiza pytań i reset prób
└── chat.mjs                           # chroniony chat przez centralny router AI i limit Netlify
netlify/admin-common.js                # wspólna kanoniczna autoryzacja
netlify/content-repository.js           # serwerowy klient GitHub Contents API
netlify/site-assets.js                  # publiczne assety i niezmienne adresy jsDelivr
netlify/presentation-common.js          # walidacja modelu prezentacji i bezpiecznych mediów
netlify/exam-common.js                  # model, losowanie i punktacja egzaminów
netlify/exam-storage.js                 # próby, indeksy i agregaty w Blobs
netlify/exam-progress.js                # adapter do centralnego systemu postępu
netlify/payment-common.js              # pakiety, księga zakupów i synchronizacja Identity
netlify.toml                           # publikacja, nagłówki i ochrona /members/*
tests/                                 # testy auth i Netlify Functions
```

To nie jest aplikacja SPA ani projekt wymagający własnego, stale uruchomionego serwera. Netlify publikuje katalog `public`, a pliki z `netlify/functions` uruchamia na żądanie jako funkcje serverless. Profile i role przechowuje Identity, zgłoszenia — Netlify Forms, aktywny Markdown edytora — Netlify Blobs, a lekcje, prompty i definicje egzaminów — osobne prywatne repozytorium GitHub odczytywane wyłącznie przez Functions.

## Panel kursanta, motyw i nawigacja

Drzewo materiałów dashboardu renderuje teraz React (`app/dashboard/`), zachowując dotychczasowy Markdown i publikowanie ze Studio. Zamknięte organizery nie tworzą kafelków, długie listy pokazują porcje po 24 elementy, a wyszukiwarka nadal przeszukuje całość. React obsługuje też pytania i wyniki egzaminów/quizów, główne widoki Studio oraz sekcje landingu. Złożone edytory i formularze zachowują sprawdzone kontrolery DOM w wydzielonych granicach komponentów — nie jest to pełne przepisanie całego projektu na JSX.

Narzędzia administratora są w Studio: `/members/module/studio/admin/` (użytkownicy, formularze, konfiguracja dashboardu, biblioteki, modele AI, ustawienia publikacji) oraz `/members/module/studio/manage/` (postępy, limity AI, płatności). Dashboard kursanta zawiera wyłącznie odsyłacz widoczny administratorowi. Generator `.env` pozostaje lokalnym narzędziem Studio, bez wysyłania wpisanych sekretów na serwer.

`npm run build` najpierw buduje statyczny `public/assets/build/dashboard-react.js`, a następnie uruchamia testy, również kontrolę obecności zasobów wskazanych w HTML. `npm test` także buduje ten plik przez `pretest`. Plik nie jest commitowany i nie wymaga nowych Functions ani SSR. Przy ręcznym deployu katalogu `public` trzeba go wcześniej zbudować. `npm run dev` wykonuje build przed startem Netlify Dev, a `npm run watch:dashboard` przebudowuje komponenty podczas pracy.

Instrukcja, wyniki testów i dalsze kroki: [PLATFORM_REACT_MIGRATION.md](PLATFORM_REACT_MIGRATION.md), szczegóły dashboardu: [DASHBOARD_REACT_MIGRATION.md](DASHBOARD_REACT_MIGRATION.md). Tymczasowy stary widok można włączyć adresem `/members/?dashboardRenderer=legacy`; inne zintegrowane widoki mają przełącznik `?uiRenderer=legacy`.

Panel buduje działy, harmonijki i karty z aktywnego Markdownu. Wyszukiwarka filtruje nazwy i opisy bez przeładowania strony; klawisz `/` przenosi do pola wyszukiwania. Po kliknięciu działu, ręcznym przewijaniu, zmianie hasha albo dojściu do końca strony właściwa pozycja menu jest zaznaczana od razu. Sekcje ukryte przez wyszukiwanie nie wpływają na wybór aktywnej pozycji.

Na komputerze przycisk menu całkowicie chowa sidebar i zapamiętuje stan w `localStorage` pod kluczem `chem.sidebar`. Sama kolumna pozostaje przewijalna kółkiem, gładzikiem i klawiaturą, ale jej wewnętrzny scrollbar jest wizualnie ukryty. Na ekranach mobilnych ten sam przycisk otwiera menu jako warstwę nad treścią. Motyw jasny lub ciemny jest wspólny dla dashboardu, stron płatności i aplikacji modułów; wybór trafia do `chem.theme`, a bez zapisanego wyboru używane jest ustawienie systemowe. Zmiana w jednej karcie jest przekazywana pozostałym otwartym kartom przez zdarzenie `storage`.

Wspólna paleta obejmuje interfejs należący do ChemDisk. Zawartość zewnętrznego iframe — między innymi tldraw, NumWorks, Google i YouTube — jest dokumentem innego dostawcy i nie może zostać przemalowana przez CSS aplikacji.

Każda chroniona aplikacja modułu czeka na zakończenie pierwszej kontroli `ChemAuth.ready`. Przy chwilowej niedostępności Identity klient może zachować wcześniej aktywny stan lokalny, dlatego ostateczną granicą dostępu pozostają reguły ról CDN oraz ponowna autoryzacja wykonywana przez chronione Functions. Zewnętrzne iframe, odtwarzacze i API nie są uruchamiane, gdy kontrola zwróci brak aktywnej sesji.

## Uruchomienie lokalne

Wymagane są Node.js 20.12.2 lub nowszy oraz npm (zgodnie z wymaganiami aktualnego Netlify CLI).

```bash
npm install
```

Przy pierwszym uruchomieniu zaloguj CLI i połącz katalog wyłącznie z przygotowaną witryną testową:

```bash
npx netlify login
npx netlify link
npm run dev
```

`netlify link` dostarcza lokalnym Functions kontekst witryny i Identity. Bez poprawnie powiązanej witryny zakładki administracyjne mogą zakończyć się bezpiecznym błędem `503`, ponieważ nie otrzymają `clientContext.identity` ani tokena operatora. `npm run dev` uruchamia `netlify dev`, dzięki czemu jednocześnie działają statyczne strony, przekierowania i funkcje. Samo otwarcie pliku `public/index.html` z dysku nie odtworzy zachowania Netlify Identity ani Functions.

Dla lokalnego czatu, zakładek administratora, edytora dashboardu i Stripe skopiuj `.env.example` jako nieśledzony plik `.env`:

```bash
cp .env.example .env
```

```dotenv
GEMINI_API_KEY=klucz_z_Google_AI_Studio
GEMINI_MODEL=gemini-2.5-flash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
NETLIFY_API_TOKEN=osobisty_token_Netlify
SITE_ID=id_witryny_Netlify
GITHUB_CONTENT_TOKEN=github_pat_...
GITHUB_CONTENT_REPOSITORIES=
GITHUB_CONTENT_REPOSITORY=Kuczis-Media/chemdisk-content
GITHUB_CONTENT_REF=main
GITHUB_CONTENT_ROOT=
GITHUB_SITE_ASSETS_TOKEN=github_pat_...
GITHUB_SITE_ASSETS_DIRECTORY=
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Nie umieszczaj kluczy w `public`, plikach JavaScript przeglądarki, `dashboard.md` ani `netlify.toml`. Klucze `GEMINI_API_KEY` i `OPENAI_API_KEY` są opcjonalnym mechanizmem awaryjnym; po pierwszym uruchomieniu dostawców AI konfiguruje się bez deployu w **Panel administratora → AI / Modele**. Tokeny `GITHUB_CONTENT_TOKEN` i `GITHUB_SITE_ASSETS_TOKEN` są używane wyłącznie przez Functions i nigdy nie są zwracane do przeglądarki. `SITE_ID` jest ustawiane automatycznie na wdrożeniu Netlify; ręcznie jest potrzebne tylko lokalnie.

`SITE_ID` i `NETLIFY_API_TOKEN` wskazują konkretną witrynę oraz jej site-wide Blobs. Jeżeli wpiszesz w lokalnym `.env` dane produkcyjne, funkcje uruchomione przez `netlify dev` mogą odczytać lub zmienić prawdziwy dashboard, konfigurację cen i księgi zakupów. Do prób administracyjnych i Stripe używaj osobnej witryny testowej z osobnym Identity, Blobs oraz kluczami Stripe test mode. Samo uruchomienie lokalne nie izoluje magazynów otwieranych z jawnymi poświadczeniami.

## Wdrożenie na Netlify

1. Utwórz witrynę z tego repozytorium. Ustawienia publikacji i funkcji są już zapisane w `netlify.toml` (`public` oraz `netlify/functions`).
2. Włącz Netlify Identity. W ustawieniach rejestracji wybierz rejestrację otwartą albo tylko na zaproszenie, zależnie od sposobu sprzedaży kursu. Jeśli wymagane jest potwierdzenie e-maila, pozostaw włączone wiadomości potwierdzające.
3. Dodaj `NETLIFY_API_TOKEN` w zmiennych środowiskowych witryny. Na Pro/Enterprise ustaw zakres **Functions**; na Free/Personal pozostaje domyślny zakres wszystkich usług. Token umożliwia panelowi administracyjnemu obsługę Forms oraz silnie spójny dostęp do Netlify Blobs, w tym metadanych i sekretów konfiguracji AI; traktuj go jak sekret. Musi należeć do konta mającego dostęp do witryny wskazanej przez automatyczne `SITE_ID`. Opcjonalnie dodaj `GEMINI_API_KEY` lub `OPENAI_API_KEY` jako awaryjny fallback dla chatu.
4. Utwórz i podłącz prywatne repozytorium lub repozytoria materiałów według instrukcji poniżej. Dodaj też token do stałego publicznego repo logo `Kuczis-Media/logo` jako `GITHUB_SITE_ASSETS_TOKEN`. Dla obu grup zmiennych wybierz zakres **Functions** tylko wtedy, gdy plan Pro/Enterprise udostępnia granularne zakresy.
5. Skonfiguruj Stripe według osobnej instrukcji poniżej i dodaj `STRIPE_SECRET_KEY` oraz `STRIPE_WEBHOOK_SECRET` z zakresem **Functions**. Klucze live ogranicz do kontekstu Production; Preview/Branch powinny otrzymywać wyłącznie dane Stripe test mode i poświadczenia osobnej witryny testowej.
6. Pierwszemu administratorowi przypisz ręcznie rolę `admin` w `app_metadata` w panelu Netlify Identity. Kolejnymi kontami można już zarządzać z panelu administratora w dashboardzie.
7. Nowe konto bez roli może się uwierzytelnić i zobaczy cennik, ale nie otworzy `/members/`. Po udanej płatności rola i dokładny termin są nadawane automatycznie. Administrator nadal może przyznać dostęp ręcznie.
8. Udostępnij osadzane pliki Google odbiorcom, którzy mają je oglądać. Aplikacja nie omija uprawnień Dysku, Prezentacji ani Formularzy Google.
9. Jeżeli używasz własnej domeny, ustaw ją jako główną domenę witryny, włącz HTTPS i sprawdź na niej link potwierdzający oraz zaproszenie Identity. Kod korzysta ze ścieżek same-origin i `location.origin`, więc nie wymaga zamiany `chemdisk.netlify.app` na `chemdisk.pl` w plikach.
10. Po pierwszym deployu sprawdź logowanie, zakładki panelu administratora, test połączenia w **AI / Modele**, status biblioteki materiałów, testową płatność, formularz kontaktowy, czat, testowy egzamin oraz po jednym materiale Google i YouTube na docelowej domenie.

Deploy Preview tej samej witryny może widzieć site-wide store `chemdisk-dashboard` oraz `chemdisk-payments`, jeśli udostępnisz mu produkcyjny token i `SITE_ID`. Publikacja dashboardu, edycja cen, usuwanie użytkownika lub test Checkoutu z takiego podglądu mogą zmienić realne dane. Nie wykonuj mutacji administracyjnych na Preview podłączonym do produkcyjnych Blobs.

Po rotacji `NETLIFY_API_TOKEN` zaktualizuj zmienną środowiskową i wykonaj deploy Functions. Token służy również do podpisywania krótkotrwałych uprawnień kasowania zgłoszeń Forms, więc wcześniej otwarta akcja usuwania wygaśnie i trzeba ponownie pobrać listę — nie powoduje to utraty zgłoszenia.

Dodanie `chemdisk.pl` jako domeny własnej do tej samej witryny nie zmienia danych. Utworzenie całkiem nowej witryny Netlify to migracja, nie sama zmiana domeny: użytkownicy Identity, zgłoszenia Forms i site-wide Blobs nie są automatycznie kopiowane między witrynami.

W logu deployu sprawdź również etap post-processingu: Netlify powinien potwierdzić regułę limitu wywołań funkcji `chat`. Platformowy limit per IP jest uzupełniony limitem per konto wewnątrz funkcji.

Formularz kontaktowy jest oznaczony `data-netlify="true"` i korzysta z Netlify Forms oraz reCAPTCHA. Netlify musi przetworzyć stronę podczas deployu, aby formularz pojawił się w panelu witryny.

## Prywatne repozytoria materiałów

Lekcje i prompty AI mają osobne źródło prawdy — jedno lub kilka prywatnych repozytoriów GitHub, niezależnych od kodu i deployu aplikacji. Każde repozytorium ma taką samą strukturę:

```text
chemdisk-content/
├── catalog.json
├── lessons/
│   ├── nazwa-lekcji.md
│   └── nazwa-lekcji/
│       └── photos/
│           └── schemat.webp
├── exams/
│   ├── question-bank.json
│   └── egzamin-alkohole/
│       ├── exam.json
│       └── photos/
│           └── mechanizm.webp
├── presentations/
│   └── alkohole/
│       ├── presentation.json
│       └── photos/
├── quizzes/
│   └── szybka-powtorka/
│       ├── quiz.json
│       └── photos/
├── assets/
│   └── shared/
│       └── logo-kursu.svg
└── prompts/
    ├── nazwa-promptu.json
    └── zestaw-promptow.txt
```

`catalog.json` jest opcjonalny. Pozwala nadać plikom tytuły, opisy i tagi używane przez wyszukiwarki dashboardu, odtwarzacza lekcji i Studio:

```json
{
  "assets": {
    "lessons/izotopy-wegla.md": {
      "title": "Izotopy węgla",
      "description": "Lekcja o zapisie izotopowym i neutronach.",
      "tags": ["atom", "matura"]
    }
  }
}
```

Konfiguracja krok po kroku:

1. Utwórz prywatne repozytorium, np. `Kuczis-Media/chemdisk-content`, z gałęzią `main`. W tym katalogu roboczym gotowy zalążek osobnego repo znajduje się w `chemdisk-content/`; katalog jest ignorowany przez repo aplikacji.

   ```bash
   cd chemdisk-content
   git remote add origin git@github.com:Kuczis-Media/chemdisk-content.git
   git push -u origin main
   ```

2. Na GitHubie otwórz **Settings → Developer settings → Personal access tokens → Fine-grained tokens** i utwórz token ograniczony wyłącznie do repozytoriów materiałów:
   - w **Repository access** wybierz **Only select repositories** i wskaż tylko repozytoria, które mają pojawić się w selektorze;
   - w **Repository permissions** ustaw wyłącznie **Contents: Read and write**;
   - pozostałych uprawnień nie rozszerzaj i nie wybieraj dostępu do wszystkich repozytoriów.

   Jeden fine-grained token może obejmować kilka jawnie wybranych repozytoriów tego samego właściciela zasobów. Uprawnienie zapisu jest potrzebne tylko funkcji serwerowej obsługującej Lesson Builder, Prompt Builder i Exam Builder. Token nadal nie daje dostępu do pozostałych repozytoriów konta.
3. W Netlify otwórz ustawienia witryny i dodaj poniższe site-level zmienne środowiskowe. Zakres **Functions** można wybrać na planie Pro/Enterprise; na Free/Personal Netlify udostępnia zmienną wszystkim zakresom:

   ```dotenv
   GITHUB_CONTENT_TOKEN=github_pat_...
   GITHUB_CONTENT_REPOSITORY=Kuczis-Media/chemdisk-content
   GITHUB_CONTENT_REF=main
   GITHUB_CONTENT_ROOT=
   ```

   `GITHUB_CONTENT_ROOT` pozostaw pusty, jeśli `lessons`, `prompts` i `catalog.json` leżą w katalogu głównym. Dla monorepo można ustawić np. `materials`. Na Free token PAT dodaj ręcznie właśnie jako site-level ENV. Na Personal/Pro/Enterprise możesz dodatkowo oznaczyć go jako **Contains secret values** w Secrets Controller.
4. Dla kilku repozytoriów pozostaw `GITHUB_CONTENT_TOKEN` i zamiast trzech zmiennych opisujących pojedyncze repo ustaw jedną listę JSON:

   ```dotenv
   GITHUB_CONTENT_TOKEN=github_pat_...
   GITHUB_CONTENT_REPOSITORIES=[{"id":"glowne","label":"Materiały główne","repository":"Kuczis-Media/chemdisk-content","ref":"main","root":"","default":true},{"id":"organiczna","label":"Chemia organiczna","repository":"Kuczis-Media/chemia-organiczna","ref":"main","root":""}]
   ```

   `id` jest trwałym identyfikatorem zapisywanym w linkach jako `repo=...`; używaj małych liter, cyfr i myślników. Wartość `default` jest zarezerwowana jako alias repozytorium domyślnego — wpis o takim ID musi mieć `default: true`. `label` to nazwa widoczna w selektorze. Jedna pozycja może mieć `default: true`; bez tego domyślna jest pierwsza. Lista obsługuje najwyżej 20 repozytoriów.

   Jeśli repozytoria należą do różnych właścicieli zasobów, utwórz osobne, równie wąskie tokeny. Drugi zapisz np. jako `GITHUB_CONTENT_TOKEN_SZKOLA`, a w odpowiedniej pozycji listy dodaj `"tokenEnv":"GITHUB_CONTENT_TOKEN_SZKOLA"`. Nazwa wskazanej zmiennej musi zaczynać się od `GITHUB_CONTENT_TOKEN`.
5. Wykonaj jeden deploy Functions po dodaniu lub zmianie zmiennych środowiskowych. Następnie w dashboardzie administratora otwórz zakładkę **Materiały**, wybierz każde repozytorium i sprawdź liczbę znalezionych plików.

### Konfigurator repozytoriów w panelu administratora

Po pierwszym wdrożeniu nie trzeba już ręcznie układać JSON-u. Jednorazowo dodaj w Netlify `NETLIFY_API_TOKEN` należący do konta z dostępem do tej witryny (automatyczny `SITE_ID` wskazuje właściwy projekt), wykonaj deploy, a następnie otwórz **Panel administratora → Materiały → Konfigurator repozytoriów**. Mutacje są dozwolone wyłącznie z produkcyjnego wdrożenia, nie z Deploy Preview ani branch deployu.

W konfiguratorze można:

- dodać do 20 prywatnych repozytoriów i wskazać jedno domyślne;
- na Personal/Pro/Enterprise wkleić osobny fine-grained token dla każdego repozytorium i zapisać go przez Secrets Controller albo pozostawić pole puste, aby zachować już istniejący sekret;
- na Free korzystać z tokenu utworzonego wcześniej ręcznie jako site-level ENV, bez przesyłania PAT do zapisu przez konfigurator;
- sprawdzić odczyt repozytorium, istnienie gałęzi i poprawność katalogu bez zapisywania zmian;
- zapisać `GITHUB_CONTENT_REPOSITORIES`, a na Personal/Pro/Enterprise także tajne `GITHUB_CONTENT_TOKEN_*`, przez serwerowe API Netlify;
- uruchomić deploy osobno albo jednym przyciskiem **Zapisz i uruchom deploy**.

Token wpisany w formularzu jest wysyłany wyłącznie do chronionej funkcji administratora i nie jest zapisywany w `localStorage`, zwracany w odpowiedzi ani pokazywany po ponownym otwarciu panelu. Funkcja najpierw sprawdza wszystkie repozytoria w GitHubie, potem zapisuje sekrety, a listę aktywnych repozytoriów zapisuje na końcu. Zapis sekretu działa fail-closed: jeśli Netlify nie przyjmie `is_secret: true`, funkcja kończy operację błędem i **nigdy nie zapisuje PAT ponownie jako zwykłej zmiennej**. Usunięcie pozycji z listy przestaje jej używać, ale celowo nie kasuje automatycznie dawnej zmiennej sekretnej z Netlify; nieużywany sekret można później usunąć ręcznie po upewnieniu się, że nie korzysta z niego inne repozytorium.

Test w konfiguratorze jest celowo niezmieniający: potwierdza dostęp odczytu, istnienie wskazanej gałęzi oraz to, że `root` jest katalogiem. Nie tworzy próbnego commita, dlatego ostatecznym potwierdzeniem uprawnienia **Contents: Read and write** jest pierwszy rzeczywisty zapis wykonany w Studio. GitHub Contents API zwraca najwyżej 1000 elementów pojedynczego katalogu; bardzo duże biblioteki dziel na podkatalogi lub osobne repozytoria.

Każdy PAT wpisany w konfiguratorze trafia do nowej, wersjonowanej zmiennej `GITHUB_CONTENT_TOKEN_*_R_*`; funkcja sprawdza nią repozytoria i dopiero na końcu przełącza listę. Dzięki temu dwa równoczesne zapisy nie mogą pomieszać konfiguracji z tokenem innej operacji, a jeśli zapis listy się nie powiedzie, działająca konfiguracja nadal wskazuje poprzedni sekret. Puste pole nadal zachowuje deterministyczną zmienną utworzoną ręcznie. Wartości tworzone przez konfigurator mają wyłącznie kontekst **Production**, więc Deploy Preview i branch deploy nie dziedziczą dostępu do prywatnych repozytoriów.

Po zapisaniu ENV formularz blokuje dalszą edycję do czasu deployu, ponieważ aktualnie działające Functions nadal mają poprzednie wartości. Jeśli zapis ENV się uda, ale Netlify nie wystartuje z buildem (np. buildy są zatrzymane), panel zachowuje stan „wymaga deployu”, pokazuje dokładną przyczynę i pozostawia aktywny przycisk **Uruchom tylko deploy**. Po zakończonym deployu odśwież stronę przed kolejną zmianą.

Aktualne zasady planów Netlify:

| Plan | Zapis PAT | Zakres ENV |
| --- | --- | --- |
| Free | utwórz token ręcznie jako site-level `GITHUB_CONTENT_TOKEN` lub `GITHUB_CONTENT_TOKEN_<ID>`; w panelu pozostaw pole tokenu puste | wszystkie zakresy |
| Personal | konfigurator może zapisać PAT jako sekret przez Secrets Controller | wszystkie zakresy |
| Pro / Enterprise | konfigurator może zapisać PAT jako sekret przez Secrets Controller | tylko Functions |

Na Free dla kolejnego repo najpierw wybierz jego ID, utwórz np. `GITHUB_CONTENT_TOKEN_CHEMIA_ORGANICZNA` (myślniki z ID zamień na podkreślenia), wykonaj deploy, a dopiero potem dodaj repo w konfiguratorze z pustym polem tokenu. Panel pokazuje oczekiwaną nazwę ENV nad każdym formularzem. Zasady te wynikają z dostępności [zakresów ENV na Pro/Enterprise](https://docs.netlify.com/build/environment-variables/overview/#scopes) oraz [Secrets Controller](https://docs.netlify.com/build/environment-variables/secrets-controller/).

Późniejsze dodanie, poprawienie lub usunięcie pliku w repo materiałów — przez GitHub albo Studio — nie wymaga deployu ani ponownego commitu aplikacji. Lista jest pobierana na żywo przez GitHub Contents API i trzymana w pamięci funkcji najwyżej przez 20 sekund; administrator może wymusić odświeżenie w zakładce **Materiały**. Odtwarzacz lekcji pobiera wskazany plik przy otwarciu.

Przeglądarka nigdy nie otrzymuje tokenu GitHub. Kursant po sprawdzeniu aktywnego dostępu może pobrać treść lekcji, ponieważ musi ją wyświetlić, ale nie może zapisywać ani usuwać plików. Lista i treść promptów są dostępne w bibliotece tylko administratorowi, aby Prompt Builder mógł je edytować; zwykły moduł czatu nadal pobiera wybrany prompt po stronie funkcji `chat` i nie wysyła go kursantowi.

Dozwolone są lekcje `.md` do 512 KiB, prompty `.txt` i `.json` do 256 KiB, definicje egzaminu, prezentacji i quizu do 2 MiB oraz wspólny `question-bank.json` do 5 MiB. Media Manager przyjmuje PNG, JPG/JPEG, WebP, GIF i konserwatywnie oczyszczony SVG do 4 MiB; chroniony odczyt ma limit 10 MiB. Nazwa pliku nie może zawierać ścieżki, `..` ani niedozwolonych znaków. `catalog.json` ma limit 256 KiB. Przy ręcznej rotacji tokenu zaktualizuj odpowiednią zmienną `GITHUB_CONTENT_TOKEN*` w Netlify i ponownie wdróż Functions. W konfiguratorze wklej nowy PAT przy właściwym repozytorium i użyj **Zapisz i uruchom deploy**.

Te same repozytoria materiałów mogą zasilać inne wdrożenie ChemDisk: skopiuj do niego moduł `netlify/content-repository.js`, funkcję `content-library`, klienta `public/assets/js/content-library.js` i ustaw tę samą konfigurację `GITHUB_CONTENT_*`. Klient domyślnie używa chronionej funkcji w tej samej domenie. Jeśli aplikacja ma własny zgodny endpoint, można wskazać go w `<head>` przez:

```html
<meta name="chemdisk-content-endpoint" content="/.netlify/functions/content-library">
```

Celowo nie ma bezpośrednich zapytań z przeglądarki do prywatnego GitHuba ani domyślnie otwartego endpointu między domenami. Dzięki temu token i kontrola dostępu pozostają po stronie każdej aplikacji.

## Konfiguracja Stripe

Integracja sprzedaje **jednorazowe pakiety czasu**, a nie automatycznie odnawiane subskrypcje Stripe Billing. Administrator może udostępnić godzinę, dzień, tydzień, miesiąc, pół roku albo rok. Zakup odbywa się na osobnej stronie `/purchase/`, otwieranej w panelu kursanta przez **Kup lub przedłuż**.

Checkout jest skonfigurowany dla metody `card`. Kod nie włącza obecnie BLIK-a, przelewów bankowych ani innych asynchronicznych metod płatności, niezależnie od tego, co jest dostępne globalnie na koncie Stripe.

Domyślna konfiguracja:

| Pakiet | Czas | Cena startowa | Domyślnie w ofercie |
| --- | ---: | ---: | --- |
| Godzina | 1 godzina | 5 zł | Nie |
| Dzień | 24 godziny | 15 zł | Nie |
| Tydzień | 7 dni | 30 zł | Tak |
| Miesiąc | 30 dni | 50 zł | Tak |
| Pół roku | 182 dni | 300 zł | Tak |
| Rok | 365 dni | 500 zł | Tak |

### Tryb testowy

1. Otwórz [Stripe Dashboard](https://dashboard.stripe.com/) i przełącz konto na środowisko testowe/sandbox.
2. W **Developers → API keys** skopiuj tajny klucz testowy zaczynający się od `sk_test_`. Nie używaj publishable key `pk_test_` jako `STRIPE_SECRET_KEY`.
3. W Netlify dodaj zmienną `STRIPE_SECRET_KEY=sk_test_...` z zakresem **Functions**.
4. Wykonaj deploy, aby publiczny adres funkcji webhook już istniał.
5. W Stripe, w **Developers → Webhooks / Event destinations**, dodaj endpoint:

   ```text
   https://TWOJA-DOMENA/.netlify/functions/stripe-webhook
   ```

6. Zaznacz zdarzenia:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   ```

7. Otwórz utworzony endpoint, odsłoń signing secret zaczynający się od `whsec_` i zapisz go w Netlify jako `STRIPE_WEBHOOK_SECRET` z zakresem **Functions**.
8. Uruchom ponowny deploy. W panelu administratora otwórz **Płatności**. Komunikat powinien potwierdzić tryb testowy.

Do udanej płatności testowej użyj:

```text
Numer karty: 4242 4242 4242 4242
Data ważności: dowolny przyszły miesiąc i rok
CVC: dowolne 3 cyfry
Kod pocztowy: dowolny poprawny kod
```

Przydatne scenariusze testowe Stripe:

| Karta | Wynik |
| --- | --- |
| `4242 4242 4242 4242` | Płatność udana. |
| `4000 0000 0000 9995` | Odrzucenie z powodu braku środków. |
| `4000 0025 0000 3155` | Przepływ wymagający uwierzytelnienia 3D Secure. |

W trybie testowym nie używaj prawdziwych danych kart. Oficjalne scenariusze są opisane w [dokumentacji testów Stripe](https://docs.stripe.com/testing).

Po udanej próbie sprawdź w Stripe **Event deliveries**, czy właściwe zdarzenie zakończyło się odpowiedzią HTTP `200`, a w logach Netlify Functions — czy `stripe-webhook` nie zgłosił błędu. Następnie potwierdź rolę użytkownika oraz wpis w historii płatności ChemDisk. Odpowiedź `5xx` oznacza, że trzeba usunąć przyczynę i ponowić dostarczenie zdarzenia w Stripe. Nie polegaj wyłącznie na powrocie przeglądarki: `payment-success` jest kontrolnym fallbackiem tylko wtedy, gdy kupujący faktycznie wróci z Checkout.

### Test webhooka lokalnie

Zainstaluj Stripe CLI, zaloguj się i w osobnym terminalu uruchom:

```bash
stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook
```

CLI wyświetli tymczasowy sekret `whsec_...`. Wpisz właśnie ten sekret do lokalnego `.env` jako `STRIPE_WEBHOOK_SECRET` (sekret CLI jest inny niż sekret produkcyjnego endpointu), a potem uruchom:

```bash
npm run dev
```

Lokalny Checkout musi dostać działający kontekst Netlify Identity oraz konfigurację `NETLIFY_API_TOKEN` i `SITE_ID`, ponieważ historia i blokada przed podwójną realizacją są przechowywane w Netlify Blobs.

### Przejście na prawdziwe płatności

Tryb testowy i produkcyjny Stripe mają osobne klucze, webhooki oraz transakcje.

1. Dokończ aktywację konta Stripe i wymagane dane firmy.
2. Przełącz Dashboard Stripe na tryb live.
3. Podmień w Netlify `STRIPE_SECRET_KEY` na `sk_live_...`.
4. Utwórz osobny webhook live dla tego samego adresu funkcji i podmień `STRIPE_WEBHOOK_SECRET` na jego sekret.
5. Wykonaj deploy i przeprowadź małą prawdziwą transakcję kontrolną.

Nigdy nie kopiuj `sk_*` ani `whsec_*` do plików w `public`, kodu przeglądarki, repozytorium lub wiadomości błędu.

### Ceny, księga zakupów i bezpieczeństwo

Ceny i ofertę edytuje administrator w zakładce **Płatności**. Może tam:

- ustawić ceny wszystkich sześciu okresów;
- zaznaczyć, które okresy są aktualnie dostępne;
- wybrać PLN, EUR, USD, GBP, CHF, CZK, CAD albo AUD;
- globalnie wyłączyć i ponownie włączyć rozpoczynanie płatności;
- włączyć blokadę dokupowania przy aktywnym dostępie.

Zmiana waluty nie przelicza automatycznie wpisanych liczb — po wybraniu nowej waluty administrator powinien ustawić odpowiednie ceny i zapisać cały formularz. Aplikacja przekazuje do Stripe `price_data` obliczone wyłącznie na serwerze; kwota, waluta ani dostępność pakietu z przeglądarki nie są przyjmowane jako źródło prawdy. Zmiany dotyczą nowych Checkout Sessions. Poprzednia transakcja nadal zachowuje w Stripe i historii ChemDisk kwotę oraz walutę z chwili zakupu.

Stripe Dashboard nie jest źródłem aktualnego cennika tej aplikacji. Zmiana przypadkowego Price w katalogu Stripe nie zmieni kart cenowych ChemDisk. Dzięki temu administrator nie musi kopiować nowych `price_...` po każdej zmianie kwoty.

Księga użytkownika jest zapisywana w site-wide magazynie Netlify Blobs `chemdisk-payments`. Każdy zapis używa warunku ETag. Historia przechowuje maksymalnie 100 najnowszych zakupów i operacji administracyjnych; starsze pozycje są automatycznie usuwane, a pojedynczy znacznik czasu nadal chroni przed ponownym naliczeniem starej Checkout Session. Dane transakcji pozostają niezależnie w Stripe.

Usunięcie konta nie jest jedną transakcją obejmującą Identity i Blobs. Funkcja najpierw usuwa użytkownika z Identity, a następnie próbuje usunąć jego księgę. Jeśli pojawi się `PAYMENT_HISTORY_DELETE_FAILED` z `identityDeleted: true`, zachowaj zwrócone ID użytkownika i ponów akcję **Usuń konto**; endpoint potrafi dokończyć czyszczenie także wtedy, gdy rekord Identity już nie istnieje. Do czasu skutecznego ponowienia w Blobs może pozostawać osierocona księga.

Globalne wyłączenie płatności pozostawia ofertę i ceny widoczne, ale dezaktywuje przyciski zakupu, a serwer odrzuca każdą próbę utworzenia Checkout. Ponowne włączenie nie wymaga zmiany kluczy Stripe.

Gdy sumowanie jest włączone, kolejny zakup jest dołączany do późniejszej z dat: bieżący termin wygaśnięcia lub chwila zakupu. Gdy administrator włączy blokadę dokupowania, serwer nie utworzy Checkout użytkownikowi mającemu aktywny dostęp; następny zakup będzie możliwy dopiero po wygaśnięciu obecnego okresu.

Webhook jest głównym mechanizmem nadawania dostępu. Strona `/payment-success/` wykonuje dodatkową, uwierzytelnioną weryfikację jako bezpieczny fallback i odświeża JWT z nową rolą. Samo wejście pod adres sukcesu bez opłaconej sesji niczego nie przyznaje.

Odebranie płatnego dostępu w panelu administratora zapisuje zdarzenie w historii i natychmiast wygasza rolę, ale **nie wykonuje zwrotu pieniędzy**. Ewentualny refund wykonuje się osobno przy właściwej płatności w Stripe Dashboard.

## Identity, role i dostęp

Jedynym źródłem uprawnień jest `app_metadata`. `user_metadata` jest edytowalne przez użytkownika i służy wyłącznie do danych profilu — nigdy nie wolno na jego podstawie przyznawać dostępu.

Przykład metadanych nadanych z panelu Identity lub Admin API:

```json
{
  "app_metadata": {
    "roles": ["week"]
  }
}
```

Nie ustawiaj ręcznie `session_id` ani `timed_access`; zarządza nimi funkcja `identity-login`. Pole `app_metadata.status` jest obsługiwane tylko dla zgodności ze starszą konfiguracją, ale nowe konta należy aktywować rolami.

| Rola | Znaczenie |
| --- | --- |
| `admin` | Stały dostęp administracyjny. |
| `active` | Stały dostęp kursanta. |
| `hour` | Dostęp przez 1 godzinę. |
| `day` | Dostęp przez 24 godziny. |
| `week` | Dostęp przez 7 dni. |
| `month` | Dostęp przez 30 dni. |
| `halfyear` | Dostęp przez 182 dni. |
| `year` | Dostęp przez 365 dni. |

Okres roli czasowej przypisanej **ręcznie** zaczyna się przy pierwszym udanym logowaniu po jej przypisaniu. Okres kupiony przez Stripe zaczyna się po potwierdzeniu płatności i ma od razu dokładny termin wygaśnięcia. Ponowne logowanie nie przedłuża żadnego działającego okresu. Po wygaśnięciu klient blokuje dostęp, a przy kolejnym logowaniu hook usuwa wygasłą rolę.

`netlify.toml` przepuszcza do `/members` i `/members/*` wyłącznie JWT z jedną z powyższych ról. Funkcja czatu dodatkowo sprawdza aktualny czas wygaśnięcia roli.

### Jedna aktywna sesja

Przy każdym udanym logowaniu konta z dostępem `identity-login` zapisuje nowy `app_metadata.session_id`. Zalogowana przeglądarka porównuje swój identyfikator z bieżącym kontem mniej więcej co 30 sekund oraz po powrocie do karty lub odzyskaniu sieci. Gdy inne urządzenie się zaloguje, starsza sesja jest lokalnie zamykana. Moduły czekają z uruchomieniem zewnętrznych iframe i API na wynik pierwszej kontroli. Funkcja czatu i funkcje administracyjne również porównują identyfikator po stronie serwera i odrzucają token poprzedniego urządzenia.

Monitor pomija ukryte karty, aby kilka kart tej samej przeglądarki nie próbowało jednocześnie odświeżać tokenu po uśpieniu komputera. Widoczna karta ponawia kontrolę po `focus`, `online`, `pageshow` i wybudzeniu. Chwilowy brak sieci, timeout Identity albo nieudane odświeżenie ciasteczka nie powodują samodzielnie wylogowania poprawnej sesji; aplikacja zachowuje stan i próbuje ponownie. Wylogowanie następuje dopiero po potwierdzonym zastąpieniu sesji, braku aktywnego dostępu albo świadomej akcji użytkownika.

„Jedna aktywna sesja” oznacza ostatnie poprawne logowanie, a nie jedną kartę. Karty w tym samym profilu przeglądarki współdzielą dane GoTrue i `localStorage`; starsza karta przed wyczyszczeniem stanu ponownie sprawdza, czy inna karta nie zapisała już nowszej sesji.

Ważne ograniczenie: statyczny CDN Netlify sprawdza role znajdujące się w już wydanym JWT, ale nie odpytuje bazy Identity o aktualny `session_id` przy każdym pliku. Dlatego wcześniej wydany token może nadal przejść samą regułę CDN do czasu jego wygaśnięcia, choć zwykły interfejs wyloguje starą kartę po kontroli sesji. Zmiana roli również staje się w pełni widoczna po odświeżeniu lub ponownym wydaniu tokenu.

Jeśli każdy pojedynczy zasób ma wymagać natychmiastowej, serwerowej weryfikacji jednej sesji, nie może być podawany bezpośrednio jako statyczny plik. Trzeba go obsłużyć przez Function/Edge Function albo osobny backend, który przy każdym żądaniu sprawdza bieżący stan konta.

## Profil kursanta

Interfejs rejestracji, przyjmowania zaproszenia i resetowania hasła w ChemDisk wymaga co najmniej 10 znaków. Jest to walidacja po stronie tej aplikacji; niezależną, serwerową politykę haseł konfiguruje Netlify Identity. Hook `identity-signup` nie ocenia siły hasła — normalizuje imię i nazwisko trafiające do `user_metadata` oraz usuwa z tych metadanych pola wyglądające jak uprawnienia.

W Identity zapisywane są zgodne pola `first_name`, `last_name`, `full_name` i `name`. Dashboard pokazuje nazwę oraz inicjały konta. Zalogowany użytkownik może kliknąć swoją kartę konta i zmienić imię, nazwisko albo hasło. Zmiana hasła wymaga ponownego uwierzytelnienia obecnym hasłem, co najmniej 10 znaków w nowym haśle oraz identycznego powtórzenia. Hasła trafiają bezpośrednio do Netlify Identity i nie są zapisywane w `localStorage`, profilu ani funkcjach ChemDisk. Zmiana własnego profilu nie zmienia roli ani czasu dostępu.

## Panel administratora

Przycisk **Panel administratora** pojawia się w bocznym menu wyłącznie dla konta mającego aktualną rolę `admin`. Panel pozwala:

- zaprosić konto przez e-mail bez ustawiania lub poznawania hasła użytkownika;
- wyszukać użytkownika po imieniu, nazwisku albo e-mailu;
- pobrać pełną listę kontaktów jako JSON albo XML; eksport zawiera wyłącznie e-mail, imię i nazwisko, niezależnie od aktywnego filtra wyszukiwania;
- poprawić imię i nazwisko zapisane w `user_metadata`;
- wybrać brak dostępu, stały dostęp albo dokładnie jeden okres czasowy;
- dodatkowo przyznać rolę `admin`;
- trwale usunąć inne konto (własne konto administratora jest chronione);
- przeglądać datę i czas utworzenia konta, ostatnie logowanie i pozostały czas;
- rozwijać pojedyncze konta zamiast renderować wszystkie formularze naraz;
- przeglądać historię zakupów Stripe i operacji odebrania dostępu;
- odebrać płatny dostęp bez automatycznego wykonywania refundu;
- ustawić ceny i dostępność sześciu pakietów, walutę, globalny stan płatności oraz zasadę sumowania okresów;
- przeglądać i trwale usuwać zgłoszenia Netlify Forms;
- edytować, podglądać, publikować i przywracać Markdown dashboardu;
- sprawdzić konfigurację prywatnego repo materiałów oraz liczbę lekcji i promptów bez ujawniania tokenu;
- obsłużyć całą listę użytkowników dzięki stronicowaniu.

Interfejs wysyła JWT zalogowanego administratora do `/.netlify/functions/admin-users`. Funkcja ponownie pobiera aktualny rekord administratora z Identity, dopiero wtedy używa dostarczonego przez środowisko Netlify krótkotrwałego tokena operatora do listowania lub aktualizacji kont. Token operatora nigdy nie jest zwracany do przeglądarki. Funkcja blokuje odebranie sobie własnej roli administratora i zachowuje `session_id` oraz niezwiązane metadane konta.

Przyciski **Pobierz JSON** i **Pobierz XML** są aktywowane dopiero po poprawnym pobraniu całej, stronicowanej listy kont. Plik powstaje lokalnie w przeglądarce i nie zawiera identyfikatorów, ról, terminów dostępu ani danych Stripe. Jest jednak zbiorem danych osobowych, dlatego należy ograniczyć jego udostępnianie i usunąć go, gdy przestanie być potrzebny.

Przy rzeczywistej zmianie roli stare `timed_access` jest czyszczone. Nowa rola czasowa rozpoczyna okres przy następnym logowaniu użytkownika. Sama poprawka imienia lub nazwiska z pozostawioną aktywną rolą czasową nie zeruje jej bieżącego terminu. Zmiany ról są w pełni widoczne po odświeżeniu tokenu albo ponownym logowaniu.

Panel pokazuje termin aktywnej roli czasowej. Po wygaśnięciu roli nadanej ręcznie pojawia się jawna akcja **Odnów ten okres**; dopiero ona przygotowuje nowy okres do uruchomienia przy kolejnym logowaniu. Dostęp kupiony przedłuża się przez kolejny Checkout. Zwykłe zapisanie nazwiska nie odnawia dostępu przypadkiem.

Panel administracyjny wymaga środowiska Netlify Functions (`netlify dev` lub deployu), ponieważ lokalne otwarcie statycznego HTML nie dostarcza serwerowego kontekstu Identity. Jeśli kontekst administratora Identity nie jest dostępny, endpoint kończy żądanie bezpiecznym błędem `503` zamiast wykonywać operację bez weryfikacji.

Zakładka **Formularze** pokazuje formularze przetworzone przez Netlify Forms, np. `members-contact` oraz publiczny `contact`. Nie pobiera odpowiedzi z osadzonych Google Forms — te pozostają w Google Forms/Sheets. Przycisk **Pobierz wszystko** pobiera jeden plik JSON zawierający wszystkie formularze Netlify i wszystkie strony ich odpowiedzi; podpisane tokeny służące do usuwania nie trafiają do eksportu. Panel widoku stronicuje odpowiedzi po 50 i wczytuje maksymalnie 100 stron; po przekroczeniu tego zakresu przerywa z jawnym błędem zamiast pokazywać niepełną listę. Każde usunięcie wymaga potwierdzenia, a funkcja wydaje dla konkretnego zgłoszenia podpisany token ważny przez 15 minut. Po jego wygaśnięciu odśwież listę przed ponowieniem; `NETLIFY_API_TOKEN` nigdy nie trafia do przeglądarki.

## Edycja dashboardu

Wersją bazową jest `public/members/dashboard.md`. Administrator może również zapisać aktywną wersję w zakładce **Dashboard** bez wykonywania deployu. Jest ona przechowywana w Netlify Blobs, a zapis używa kontroli wersji (`etag`) i silnie spójnego dostępu przez serwerowe `NETLIFY_API_TOKEN` oraz `SITE_ID`, aby dwóch administratorów nie nadpisało sobie zmian po cichu. Sekretny token nie jest wysyłany do przeglądarki. Przycisk przywracania atomowo dezaktywuje override i ponownie aktywuje plik z wdrożenia.

Aplikacja ma dwa interfejsy dla tego samego aktywnego klucza:

- zakładka **Dashboard** w panelu administratora służy do bezpośredniej edycji Markdownu, podglądu, publikacji i przywracania pliku z wdrożenia;
- **Dashboard Builder** w Studio zamienia obsługiwany Markdown na graficzne klocki, pozwala importować plik i publikować, ale nie ma akcji przywracania wersji statycznej.

Przywracanie wykonuj wyłącznie z zakładki administratora. Oba edytory używają tego samego `etag`, więc otwarcie ich równocześnie może prawidłowo zakończyć starszą publikację konfliktem `409`.

Panel kursanta najpierw próbuje pobrać aktywną wersję z funkcji, a gdy jej nie ma lub magazyn jest chwilowo niedostępny, bezpiecznie wraca do `dashboard.md`. Nie trzeba zmieniać `index.html`.

Jeżeli administrator nie opublikował własnej wersji, kursanci widzą pełny bazowy `dashboard.md` ze wszystkimi przykładowymi materiałami i narzędziami. Przy pierwszym otwarciu edytora administrator dostaje czysty szablon zawierający tylko ekran Start oraz sekcję **Pomoc i konto**. Dopiero kliknięcie **Opublikuj zmiany** zapisuje ten szablon jako aktywną wersję i ukrywa bazowe materiały. Nagłówek **Pomoc i konto** jest obowiązkowy: jeżeli nie występuje, aplikacja dołącza cały domyślny szablon sekcji. Jeżeli autor utworzył już taki nagłówek, jego własna treść jest zachowywana i brakujące domyślne linki nie są dopisywane pojedynczo. Akcja **Przywróć plik z wdrożenia** dezaktywuje override, omija starą kopię z pamięci podręcznej i ponownie pokazuje pełny dashboard bazowy.

Magazyn `chemdisk-dashboard` jest site-wide i pozostaje po kolejnych wdrożeniach. Deploy Preview tej samej witryny również może zobaczyć ten magazyn, dlatego nie publikuj zmian z podglądu, jeśli nie mają trafić do produkcyjnego dashboardu.

Uwaga na pracę lokalną: `admin-dashboard` celowo otwiera magazyn z jawnymi `SITE_ID` i `NETLIFY_API_TOKEN`, aby uzyskać silną spójność. Jeżeli lokalny `.env` wskazuje produkcyjną witrynę, `netlify dev` może odczytać i zmienić jej site-wide Blobs. Do prób zapisu używaj osobnej witryny testowej i jej danych albo nie wykonuj mutacji z lokalnego środowiska. Lokalny sandbox Blobs nie zastępuje magazynu wskazanego jawnymi poświadczeniami.

Aktywna treść znajduje się pod jednym kluczem `dashboard.md` i może mieć maksymalnie 256 KiB po dołączeniu obowiązkowej sekcji pomocy. Otwarcie lub odświeżenie panelu wykonuje jeden chroniony `GET` do `admin-dashboard`, jedną kanoniczną kontrolę Identity i jeden silnie spójny odczyt Bloba. Dashboard nie odpytuje Blobs cyklicznie — pozostawienie otwartej strony nie pobiera ponownie Markdownu. Jeżeli override nie istnieje, klient wykonuje dodatkowy odczyt statycznego `/members/dashboard.md`.

Udana publikacja to jedno żądanie `PUT`. Funkcja odczytuje metadane bieżącej wersji, wykonuje zapis warunkowy i odczyt kontrolny, po czym zwraca treść oraz nowy `etag`. Przywracanie zapisuje wersjonowany tombstone zamiast wykonywać niekontrolowane usunięcie; następnie klient pobiera plik statyczny. Żadna z tych operacji nie uruchamia production deployu.

### Blobs i kredyty Netlify

W aktualnej tabeli metered billing Netlify Blobs nie występuje jako osobny miernik miejsca ani pojedynczych operacji `get`/`set`. Z tego wynika, że w tej architekturze koszt dostępu do Blobs powstaje pośrednio przez:

- web request do Function;
- czas działania Function, obejmujący kontrolę Identity i komunikację z Blobs;
- transfer odpowiedzi JSON z Markdownem do przeglądarki;
- pozostałe pliki i żądania całej strony, które nie są kosztem samego Bloba.

Aktualna tabela planów kredytowych podaje:

| Miernik | Zużycie |
| --- | ---: |
| Udany production deploy | 15 kredytów |
| Deploy Preview, branch deploy, nieudany deploy lub rollback | 0 kredytów |
| Compute Functions | 10 kredytów za GB-godzinę |
| Web bandwidth | 20 kredytów za GB |
| Web requests | 2 kredyty za 10 000 żądań |

Plan Free zawiera 300 kredytów miesięcznie i ma twardy limit, Personal — 1000, a Pro zaczyna się od 3000. Według bieżącej tabeli automatyczne doładowanie kosztuje w Personal 5 USD za 500 kredytów, a w Pro 10 USD za 1500 kredytów. Stawki i zasady mogą się zmieniać; przed szacowaniem ruchu sprawdź [aktualne zasady kredytów](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), [naliczanie Functions](https://docs.netlify.com/build/functions/usage-and-billing/) oraz [dokumentację Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/). Konto Free, Starter lub Pro utworzone przed 4 września 2025 r. może nadal korzystać z planu Legacy, którego limity są rozliczane inaczej.

Zapis w Studio nie jest deployem, dlatego nie nalicza 15 kredytów przewidzianych dla production deployu. Zużywa jednak zwykłe żądanie i compute Function podczas publikowania dashboardu.

Ten sam model rozliczenia dotyczy publicznego pobrania cennika, utworzenia Checkout, webhooka, biblioteki materiałów oraz widoków historii: korzystają z Functions. Biblioteka wykonuje dodatkowo autoryzowany odczyt GitHub API. Roboczy zapis Lesson Buildera jest lokalny; pobranie listy lub import lekcji ze zdalnego repo używa Function, ale zapis draftu w przeglądarce nie używa Blobs.

### Trwałe dane, kopie i rollback

Kod w Git oraz deploy Netlify nie są kopią wszystkich danych aplikacji:

| System | Dane |
| --- | --- |
| Repozytorium/deploy aplikacji | Bazowy `public/members/dashboard.md`, pliki aplikacji i Functions. |
| Prywatne repo materiałów | Lekcje `lessons/*.md`, prompty `prompts/*.txt`/`*.json` i opcjonalny `catalog.json`. |
| Blob `chemdisk-dashboard` | Jeden aktywny klucz `dashboard.md` albo tombstone przywracający wersję bazową. |
| Blob `chemdisk-payments` | Cennik w `config/prices.json` i księgi `users/<uuid>.json`, po maksymalnie 100 ostatnich zdarzeń. |
| Netlify Identity | Konta, role, `timed_access`, profil i identyfikator ostatniej sesji. |
| Netlify Forms | Zgłoszenia formularzy ChemDisk. |
| Stripe | Checkout Sessions, płatności, zdarzenia i dane rozliczeniowe Stripe. |

Rollback deployu przywraca pliki oraz kod Functions z wybranego wdrożenia, ale nie cofa site-wide Blobs, Identity, Forms ani Stripe. `etag`, numer wersji i metadane `updatedAt`/`updatedBy` chronią przed przypadkowym nadpisaniem i ułatwiają diagnostykę; aplikacja nie udostępnia na ich podstawie historii poprzednich wersji. Akcja przywrócenia dashboardu aktywuje bieżący plik statyczny z deployu, a nie wcześniejszy override z Blobs.

Przed zmianą produkcyjnego dashboardu, cennika, migracją witryny albo masowym usuwaniem skopiuj aktywny Markdown do lokalnego pliku i wykonaj osobny eksport potrzebnych danych przez stronę **Blobs** w panelu Netlify, autoryzowane API/SDK lub panel właściwego dostawcy. Kopię trzymaj poza tą samą witryną. Lekcje i prompty nie są przechowywane w Blobs ani deployu aplikacji; ich źródłem prawdy, kopią i historią jest prywatne repozytorium materiałów.

### Graficzne Studio treści

Administrator widzi w bocznym menu dodatkowy skrót **Studio treści** prowadzący do `/members/module/studio/`. Reguły w `netlify.toml` chronią cały katalog Studio rolą `admin` przed ogólną regułą `/members/*`; samo ukrycie linku w interfejsie nie jest mechanizmem autoryzacji.

Start grupuje narzędzia w kategorie **Tworzenie treści**, **Wygląd platformy** i **Zarządzanie**. Wyszukiwarka filtruje kafelki lokalnie; przełącznik **Otwórz narzędzie** pozostaje dostępny w każdym edytorze. Widok zarządzania znajduje się pod `/members/module/studio/manage/`: `?tab=progress`, `?tab=ai-usage` oraz `?tab=payments`. Te trzy zakładki zostały usunięte z dialogu administratora dashboardu. Stare linki `/members/?admin=…` przekierowują administratora do Studio; inne parametry nie są przenoszone. Panel administratora nadal zawiera konta i ich historię płatności, formularze oraz techniczną konfigurację materiałów, AI i strony głównej.

Zarządzanie ma osobny kontroler `manage/management.js`; nie ładuje dashboardu ani bibliotek lekcji. Dane wybranej zakładki są pobierane na żądanie, współbieżne odczyty są łączone, a ponowne otwarcie wykorzystuje pamięć bieżącej strony. Odświeżenie listy jest ręczne. Limity AI zachowują konfiguracje OpenAI/Gemini z ENV, ustawienia bazowe i indywidualne. Zapis cen nadal sprawdza `expectedEtag`. Formularze ostrzegają przed utratą niezapisanych ustawień. Opisy edytorów i odtwarzaczy są uproszczone, natomiast techniczne instrukcje panelu administratora i generatora `.env` pozostają dostępne.

Na stronie startowej Studio znajduje się **Eksplorator treści** w formie zwartego drzewa. Pokazuje foldery **Lekcje**, **Egzaminy**, **Prezentacje**, **Quizy**, **Prompty** i **Media wspólne**. Wspólny paginator renderuje najwyżej 12 pierwszych wyników, a **Pokaż więcej** dodaje kolejne 12. Ten sam wzorzec działa w bibliotekach Dashboard Buildera, Lesson Buildera, Prompt Buildera, Quiz Buildera, Exam Buildera, Presentation Studio, w lokalnych folderach `photos` oraz w Media Managerze. Zmiana wyszukiwania lub repozytorium resetuje widok do pierwszej strony. Pierwszy bootstrap repozytorium jest odkładany do wejścia do buildera albo przewinięcia eksploratora w pobliże ekranu, więc samo otwarcie strony Start nie zużywa Function. Po rozwinięciu materiału widać jego definicję oraz lokalny folder `photos`; lista obrazów jest pobierana dopiero wtedy, a miniatury w Media Managerze dopiero po pojawieniu się na ekranie. Każdy obraz można usunąć osobno, z informacją o rozmiarze i liczbie lokalnych odwołań. Wyszukiwarka filtruje po nazwie, ścieżce i tagach, a **Otwórz** przełącza Studio do właściwego Buildera. **Duplikuj** tworzy nową definicję i kopiuje jej lokalne media, zachowując wspólne referencje bez powielania plików.

Usunięcie definicji wymaga aktualnego SHA i potwierdzenia. Gdy materiał ma lokalne obrazy, Studio osobno pyta, czy usunąć również `photos`, czy zachować pliki. Najpierw usuwa definicję, a dopiero potem opcjonalne pliki lokalne, więc częściowy błąd porządkowania nie pozostawia aktywnego materiału z brakującymi ilustracjami. Przed usunięciem egzaminu pokazuje wykryte użycia w Dashboardzie i lekcjach. Media z `assets/shared/` nigdy nie są usuwane razem z materiałem, ponieważ mogą należeć do wielu definicji. Każda operacja tworzy odwracalny commit Git; lokalny draft i historyczny postęp nie są automatycznie kasowane.

Studio ma sześć trybów oraz bezpośrednie wejścia do wspólnego **Media Managera** i administracyjnego panelu **AI / Modele**:

- **Dashboard Builder** — przeciąganie sekcji, harmonijek poziomów 3–6, organizerów sekwencyjnych, tekstów, komunikatów i kart modułów, w tym natywnego quizu oraz formularza kontaktowego zapisującego odpowiedzi w Netlify Forms. Organizer numeruje umieszczone w nim moduły i odblokowuje każdy następny dopiero po ukończeniu wcześniejszych. Do istniejącej harmonijki można dodać osobny organizer przyciskiem **+1→** albo akcją w inspektorze; można też przełączyć całą harmonijkę na tryb sekwencyjny. Każdą dużą sekcję oraz każdą zagnieżdżoną harmonijkę można tymczasowo zwinąć strzałką w jej nagłówku, aby skrócić obszar roboczy; nie zmienia to jej ustawienia dla kursanta. Inspektor konfiguruje ID lub link materiału, wariant kalkulatora/tablicy, tryb ochrony `type`, plik lekcji, quiz, prompt czatu, notatkę kontaktową albo bezpieczny własny link. Selektor przełącza przeszukiwane repozytorium, a karta zapamiętuje jego `id`, więc identyczne nazwy plików nie kolidują;
- **Lesson Builder** — układanie slajdów oraz bloków nagłówka, tekstu, obrazu z Media Managera lub starszego HTTPS, wideo YouTube, osadzonych prezentacji Google Slides, listy, tabeli, cytatu, calloutu, kodu, stylowanej sekcji, harmonijki, wzorów, pomocy AI, tablic interaktywnych, formularza kontaktowego i estetycznych kafelków z linkiem. Slajd może korzystać ze zgodnego wstecznie układu automatycznego albo swobodnego płótna 16:9: zaznaczony klocek przeciąga się po podglądzie i skaluje czterema uchwytami, a dokładne X, Y, szerokość i wysokość pozostają dostępne w inspektorze. Na telefonie płótno przechodzi w bezpieczny układ pionowy. Obrazy wybiera się lub wgrywa przez Media Manager; w układzie automatycznym nadal działa szybki uchwyt szerokości. Tabela ma od 2 do 8 kolumn, do 30 wierszy, opcjonalny podpis i wyrównanie; w odtwarzaczu przewija się poziomo na wąskim ekranie. Dedykowany wizualny kreator równań działa podobnie do uproszczonego edytora z Worda: ma gotowe szablony, palety symboli, klikalne strzałki, osobne pola substratów i produktów, warunki nad i pod strzałką oraz bieżący podgląd. Przy pytaniu jest dodatkowa paleta H₂O, CO₂, H₂SO₄, NH₄⁺, SO₄²⁻ oraz przyciski indeksu dolnego i górnego. Każdy slajd może osobno wyłączyć animację albo użyć zanikania, ruchu w górę, ruchu z boku lub miękkiego przybliżenia. Do slajdu można dodać pytanie tekstowe, liczbowe, wyboru, ABCD, luki z listą albo luki wpisywane ręcznie. Materiały z repozytorium wybiera się z własnych, przeszukiwalnych kart pokazujących tytuł i nazwę pliku zamiast z systemowego `datalist`. Lekcję można wyszukać, wczytać, zapisać, zaktualizować albo usunąć w repozytorium wybranym z listy;
- **Quiz Builder** — tworzenie samodzielnych quizów z pytaniami jednokrotnego i wielokrotnego wyboru, prawda/fałsz oraz odpowiedzią tekstową. Builder ma lokalny autosave, walidację, interaktywny podgląd z punktacją, próg zaliczenia, wyjaśnienia, obrazy z Media Managera oraz jawne akcje **Zapisz draft** i **Opublikuj**. Definicja trafia do `quizzes/<quizId>/quiz.json`; backend ponownie sprawdza schemat, stabilne ID i referencje mediów przed zapisem. Dashboard Builder wybiera quiz z biblioteki, a `/members/module/quiz/` udostępnia uczniowi wyłącznie wersję opublikowaną, zapisuje wynik, zaliczenie i liczbę prób w centralnym postępie;
- **Prompt Builder** — tworzenie pojedynczego promptu `.json` lub zestawu ponumerowanych instrukcji `.txt`. Builder waliduje numery punktów, limity treści i format, pokazuje gotowe źródło oraz obsługuje ten sam ręczny, repozytoryjny i wielorepozytoryjny obieg co lekcje;
- **Exam Builder** — tworzenie definicji egzaminów, pytań i banku pytań oraz konfiguracja dostępu, czasu, nawigacji, punktacji, prób, wyników i raportów. Definicje są zapisywane w tym samym prywatnym repozytorium, a próby uczniów pozostają w Netlify Blobs;
- **Presentation Studio** — natywny edytor slajdów z trzema panelami, motywami i 11 układami. Obsługuje tekst, nagłówki, obrazy, kształty i linie, wzory, ikony, tabele, przyciski, kod oraz bezpieczne embedy. Elementy mają bezpośrednie przeciąganie, osiem uchwytów zmiany rozmiaru, zachowanie proporcji, osobny tryb kadrowania, opacity, wyrównywanie, linie środka, warstwy, blokowanie, kopiowanie, cofanie i ponawianie. Slajdy można przeciągać, duplikować i przesuwać przyciskami, a tło może być kolorem, gradientem, obrazem albo motywem. Zapisuje `presentations/<presentationId>/presentation.json`, a kursant otwiera jeden wspólny odtwarzacz ChemDisk z klawiaturą, dotykiem, pełnym ekranem i dokładnym postępem po stabilnych `slideId`.

Na większym ekranie biblioteka po lewej, obszar roboczy pośrodku oraz ustawienia/podgląd po prawej mają niezależne przewijanie. Każdą bibliotekę, prawy panel i górny pasek narzędzi można zwinąć osobno; ustawienia są zapamiętywane osobno dla Dashboard Buildera, Lesson Buildera, Prompt Buildera i Exam Buildera w `chemdisk.studio.layout.v1`. Pełny podgląd otwiera chroniony adres Studio w osobnym oknie, wczytuje aktualny lokalny draft i aktualizuje się po kolejnych zmianach.

W Lesson Builderze na dole przewijanej listy klocków znajduje się sekcja **Narzędzia lekcji**: kreator równań, pomoc AI i tablica. Kliknięcie albo przeciągnięcie któregoś z nich automatycznie otwiera jego ustawienia; na ekranie mobilnym Studio przewija widok do panelu edycji.

#### Przepływ Dashboard Buildera

1. Kliknij **Wczytaj aktywny**, zanim zaczniesz publikować. Studio pobiera wtedy override z Blobs albo bazowy `dashboard.md` oraz zapamiętuje jego `etag`.
2. Edytuj klocki, ich ustawienia albo kod w oknie **Markdown**. Podgląd korzysta z tego samego modelu co eksport.
3. Kliknij **Opublikuj**. `PUT` używa zapamiętanego `etag`; Studio nie wykonuje automatycznie nowego `GET` tuż przed zapisem.
4. Jeżeli inna karta lub administrator zdążył opublikować nowszą wersję, serwer zwraca `409`. Nowszy dashboard nie zostaje nadpisany, a lokalny draft pozostaje w przeglądarce. Ponowne wczytanie aktywnej wersji zastępuje draft dopiero po potwierdzeniu użytkownika; Studio nie wykonuje automatycznego diffu ani scalania.

Import pliku dashboardu w Studio przyjmuje do 512 KiB, ale publikacja nadal ma twardy limit 256 KiB UTF-8. Walidacja wymaga tytułu, co najmniej jednego działu i jednej poprawnej karty, sprawdza typy ochrony, domeny Google/YouTube, nazwę pliku lekcji i bezpieczne adresy. Domyślny szablon **Pomoc i konto** jest dołączany, gdy w dokumencie nie ma nagłówka o tej nazwie.

Round-trip dashboardu zachowuje znaczenie składni obsługiwanej przez parser, lecz nie gwarantuje identycznego tekstu źródłowego. Komentarze i nadmiarowe puste linie są usuwane, formatowanie jest normalizowane, parametry URL mogą zostać ponownie zakodowane, a nieobsługiwana konstrukcja może zmienić się w zwykły tekst. Przed importem rozbudowanego, ręcznie pisanego pliku zachowaj jego kopię.

#### Przepływ Lesson Buildera

Lesson Builder może rozpocząć pustą lekcję albo zaimportować istniejący `.md`, zamienić go na edytowalne bloki i ponownie wygenerować deterministyczny Markdown. Dostępne są podgląd, edycja źródła, kopiowanie do schowka i pobranie pliku. Import pliku ma limit 512 KiB, edytor źródła przyjmuje do 524 288 znaków, lekcja może zawierać od 1 do 100 slajdów, a nazwa pliku musi kończyć się `.md`, zaczynać znakiem alfanumerycznym, mieć maksymalnie 80 znaków i nie może zawierać `..` ani ścieżki katalogu. Obraz może wskazywać stabilną referencję `photos/...` lub `assets/shared/...`; starsze pełne adresy `https://` nadal działają.

Przycisk **Nowa lekcja** przygotowuje pierwszy slajd i przełącza zapis na tryb **Utwórz plik w GitHubie**. Jeżeli w repozytorium istnieje pusty plik `.md`, Studio otwiera go jako edytowalny szablon, zachowuje jego SHA i przy pierwszym zapisie uzupełnia ten sam plik bez tworzenia duplikatu.

Ręczny obieg pozostaje zawsze dostępny: kliknij **Pobierz .md**, a następnie samodzielnie dodaj plik do `lessons/` w prywatnym repo i wykonaj commit. Możesz też wybrać repozytorium nad biblioteką i użyć przycisku **Zapisz w GitHubie**. Nowy plik tworzy commit, a wcześniej wczytany plik jest aktualizowany tylko wtedy, gdy jego SHA nie zmienił się od odczytu. Zmiana repozytorium albo nazwy wczytanego dokumentu tworzy nowy plik i pozostawia oryginał do osobnego usunięcia. **Usuń z GitHuba** jest aktywne wyłącznie dla repozytorium, z którego plik wczytano, wymaga potwierdzenia i także zapisuje zmianę jako commit; zawartość można odzyskać z historii repo.

Studio nie wykonuje cichego automatycznego zapisu do GitHuba. Autosave zapisuje wyłącznie lokalny draft, a operacja sieciowa następuje dopiero po kliknięciu przycisku repozytorium. Gdy inna karta albo osoba zmieni plik wcześniej, serwer zwraca konflikt zamiast nadpisywać nowszą wersję. Należy wtedy ponownie wczytać plik i świadomie połączyć zmiany.

Odtwarzacz lekcji odrzuca plik większy niż 512 KiB lub zawierający ponad 100 slajdów. Builder pilnuje liczby slajdów, lecz obecnie nie blokuje pobrania tylko dlatego, że wynikowy Markdown przekroczył limit bajtów odtwarzacza. Przed wysłaniem bardzo dużej lekcji sprawdź rozmiar, np. `wc -c lessons/nazwa.md`, i utrzymaj go poniżej 524 288 bajtów.

Klocek **Google Slides** przyjmuje ID, standardowy link `docs.google.com/presentation/d/...`, link opublikowany `.../d/e/...` albo link pliku z Dysku. Eksport zapisuje wyłącznie zweryfikowane ID, tryb publikacji i tytuł w dyrektywie `:::googleslides`; odtwarzacz osadza prezentację w responsywnym iframe z ograniczonym sandboxem. Plik nadal musi być udostępniony odbiorcom kursu.

Na jednym slajdzie może znajdować się najwyżej jedno zadanie. Pytanie można dodać bezpośrednio z pustego slajdu, a następnie wpisać każdą opcję osobno i wskazać poprawną znakiem ✓. Quiz ABCD wymaga czterech opcji; pytanie `choice` co najmniej dwóch, a graficzne pole Studio zachowuje maksymalnie osiem. Przy lukach każde pole zwykłego tekstu ma przycisk **Dodaj lukę tutaj**. Studio pokazuje kolejność fragmentów i luk jako osobne kontrolki, a poprawną odpowiedź ustawia się na karcie danej luki. Dla luk tekstowych można ustawić sprawdzanie każdej luki osobno albo wszystkich naraz. Opcje i aliasy odpowiedzi nie mogą zawierać separatora `|`. Kontenery `:::style` i `:::accordion` muszą mieć treść i nie mogą zawierać kolejnego kontenera tego typu. Dla obrazu przycisk **Wybierz z Media Managera** zapisuje referencję, ALT, szerokość i wyrównanie w ścisłej dyrektywie `:::image`; odtwarzacz pobiera prywatny plik dopiero po uwierzytelnieniu. Kafelek z linkiem przyjmuje adresy `http`, `https`, `mailto`, kotwice i wewnętrzne ścieżki `/...`; niebezpieczne protokoły są odrzucane. Klocek formularza otwiera chroniony `/members/module/contact/`, może dołączyć maksymalnie 240 znaków treści wstępnej i zapisuje wysłane wiadomości w Netlify Forms. Klocek AI może opcjonalnie wskazać prompt `.json` lub punkt z `.txt` w wybranym repozytorium. Klocek tablicy otwiera `/members/module/whiteboard/` albo `/members/module/bitpaper/`; dla BitPaper może przekazać bezpieczną nazwę planszy `.json`. Przejście jest zapisywane osobno w każdym slajdzie, a systemowe `prefers-reduced-motion` wyłącza animację.

Eksport zawsze synchronizuje nagłówek `#` pierwszego slajdu z globalnym tytułem lekcji. Ton calloutu nie ma osobnego pola w Markdownzie i po ponownym imporcie jest rozpoznawany z jego tytułu. Tak jak przy dashboardzie, dla ważnego ręcznie pisanego źródła zachowaj kopię przed round-tripem przez graficzne klocki.

Robocze modele są automatycznie zapisywane w `localStorage` jako `chemdisk.studio.dashboard.v1`, `chemdisk.studio.lesson.v1` i `chemdisk.studio.prompt.v1`; autosave nie wysyła requestu, nie zapisuje Bloba i nie synchronizuje danych między urządzeniami. Draft nie jest przypisany do ID administratora, dlatego inny administrator korzystający z tego samego profilu przeglądarki zobaczy ten sam lokalny stan. Historia obejmuje do 60 operacji osobno dla każdego trybu, ale istnieje tylko do przeładowania strony i nie jest odtwarzana razem z draftem. `Ctrl/Cmd+Z` cofa, `Ctrl/Cmd+Shift+Z` lub `Ctrl/Cmd+Y` ponawia, a `Ctrl/Cmd+S` otwiera publikację dashboardu albo pobiera lekcję lub prompt na dysk — nie zapisuje go automatycznie w GitHubie. JWT jest pobierany dopiero do operacji serwerowej i nie trafia do trwałej pamięci Studio.

Podgląd dashboardu w Studio pokazuje strukturę i wygląd kart bez całej logiki właściwego panelu, a Prompt Builder pokazuje dokładne źródło, które zostanie zapisane. Podgląd lekcji jest interaktywny: pozwala zaznaczać odpowiedzi, wpisywać tekst, uzupełniać luki oraz zobaczyć podpowiedź i wynik. Działa zarówno po prawej stronie Studio, jak i w pełnym osobnym oknie. Ostateczny test całego postępu i nawigacji wykonuj w rzeczywistym module `/members/module/lesson/`.

Obsługiwana składnia:

```md
# Tytuł panelu

Krótki tekst powitalny.

> Komunikat widoczny nad wszystkimi działami.

## Stechiometria

Opis działu wyświetlany pod jego nazwą.

> Opcjonalny komunikat tylko dla tego działu.

### Lekcja 1 — obliczenia molowe

To jest zwykły tekst opisujący harmonijkę. Nie wymaga żadnego specjalnego znacznika.

#### Materiały podstawowe

To jest tekst wewnątrz zagnieżdżonej harmonijki.

- [Prezentacja](/members/module/slides/?id=ID_PLIKU&type=2) — Slajdy do lekcji.
- [Zestaw zadań](/members/module/pdf/?id=ID_PLIKU&type=1) — Zadania do samodzielnej pracy.

##### Zadania dodatkowe

Możesz schodzić niżej aż do nagłówka z sześcioma znakami `#`.

- [Zestaw dodatkowy](/members/module/pdf/?id=ID_PLIKU&type=1) — Materiał dla chętnych.
```

Zasady parsera:

- pojedynczy `#` ustawia tytuł panelu;
- `##` rozpoczyna dział i tworzy pozycję w menu;
- `###` wewnątrz działu rozpoczyna harmonijkę główną;
- `####`, `#####` i `######` tworzą kolejne poziomy harmonijek; nagłówek z taką samą albo mniejszą liczbą `#` wraca do odpowiedniego poziomu;
- zwykła linia bez specjalnego początku staje się bezpiecznym tekstem-opisem aktualnego panelu, działu albo harmonijki; kilka kolejnych linii jest łączonych w jeden opis;
- wiersz zaczynający się od `>` tworzy komunikat;
- karta musi być listą w formacie `- [Nazwa](adres) — Opis` i znajdować się pod działem;
- HTML nie jest wykonywany, a pozostałe elementy pełnego Markdown nie są interpretowane;
- dla modułów używaj ścieżek zaczynających się od `/members/module/` i koduj tekst parametrów URL, np. spację jako `%20`;
- linki zewnętrzne `http`/`https` otwierają się w nowej karcie, ale materiały kursowe najlepiej prowadzić przez chronione moduły.

## Moduły i parametry linków

Wartość `id` może być bezpośrednim identyfikatorem. Moduły Google i YouTube akceptują też właściwy pełny link, jeśli zostanie prawidłowo zakodowany jako wartość parametru URL.

| Moduł | Parametry i działanie | Przykład |
| --- | --- | --- |
| `/members/module/bitpaper/` | Opcjonalne `path` — bezpieczna nazwa opublikowanego pliku JSON z katalogu modułu; lokalna tablica z importem i eksportem. | `/members/module/bitpaper/?path=plansza.json` |
| `/members/module/whiteboard/` | Brak parametrów; biała tablica. | `/members/module/whiteboard/` |
| `/members/module/kalkulator/` | Brak parametrów; kalkulator naukowy. | `/members/module/kalkulator/` |
| `/members/module/classic/` | Brak parametrów; kalkulator klasyczny. | `/members/module/classic/` |
| `/members/module/atonom/` | Opcjonalne `formula` — polska nazwa obsługiwanego związku; interaktywny model cząsteczki. Bez parametru otwiera fenol. | `/members/module/atonom/?formula=cis-but-2-en` |
| `/members/module/lesson/` | `file` — plik `.md` z `lessons/`; opcjonalne `repo` wybiera skonfigurowane repozytorium. Bez `file` otwiera wyszukiwarkę biblioteki. | `/members/module/lesson/?repo=organiczna&file=izotopy-wegla.md` |
| `/members/module/quiz/` | `quiz` — ID opublikowanego quizu z `quizzes/<quizId>/quiz.json`; opcjonalne `repo` wybiera repozytorium, a `material` wiąże kartę z postępem dashboardu. Draft jest dostępny tylko administratorowi przez `preview=1`. | `/members/module/quiz/?repo=organiczna&quiz=stechiometria-1` |
| `/members/module/chat/` | Opcjonalne `repo` oraz `prompt=nazwa.json` albo `plik=nazwa.txt&punkt=N`; prompt jest wybierany po stronie funkcji. | `/members/module/chat/?repo=organiczna&plik=prompty-przyklad.txt&punkt=1` |
| `/members/module/forms/` | `id` — ID albo zakodowany link Google Forms. | `/members/module/forms/?id=ID_FORMULARZA` |
| `/members/module/contact/` | `internal` — stała informacja dołączana do zgłoszenia, maks. 240 znaków. | `/members/module/contact/?internal=Pytanie%20o%20dzia%C5%82%201` |
| `/members/module/slides/` | `id` — ID/link Google Slides dla `type=1/2` albo pełny HTTPS dla `type=4/5`; `1` zwykły podgląd, `2` ograniczony interfejs, `4` osadzenie adresu w iframe, `5` bezpośrednie otwarcie w przeglądarce. | `/members/module/slides/?id=https%3A%2F%2Fexample.com%2Fprezentacja&type=4` |
| `/members/module/pdf/` | `id` — ID/link z Dysku dla `type=1/2/3` albo pełny HTTPS dla `type=4/5`; `1` podgląd z maskami, `2` pobranie, `3` zwykły Google, `4` iframe, `5` bezpośredni widok przeglądarki. | `/members/module/pdf/?id=https%3A%2F%2Fexample.com%2Fmaterial.pdf&type=5` |
| `/members/module/film/` | `id` — ID/link; `type=1` YouTube z ograniczonym interfejsem, `type=2` Google Drive, `type=3` zwykły YouTube. | `/members/module/film/?id=CH50zuS8DD0&type=1` |
| `/members/module/yt/` | `id` — ID albo link YouTube; własne kontrolki i maska odtwarzacza. Obsługuje też linki `youtu.be`, `watch`, `shorts`, `live` i `embed`. | `/members/module/yt/?id=CH50zuS8DD0` |
| `/time` | Brak parametrów; pokazuje rolę i pozostały czas dostępu. | `/time` |

`/members/module/studio/` nie jest kartą kursową. To osobna aplikacja administracyjna chroniona rolą `admin`; zwykły kursant jest przekierowywany do panelu.

W trybach ograniczonych (`pdf: type=1`, `slides: type=2`) odnośniki „Awaryjnie” i „Sprawdź w Google” są ukryte i nie otrzymują adresu pliku. „Ponów” tylko ponownie ładuje osadzony podgląd. Dla Slides `type=1` jest świadomie zwykłym podglądem, dlatego może udostępniać przejście do Google — do materiałów chronionych używaj `type=2`.

Tryby `type=4` i `type=5` przyjmują wyłącznie pełny adres `https://` bez loginu i hasła w URL. W trybie `4` ChemDisk próbuje osadzić stronę w iframe; właściciel zewnętrznej strony może to zablokować nagłówkami `X-Frame-Options` lub CSP i wtedy należy użyć `type=5`. Tryb `5` po sprawdzeniu sesji otwiera źródłowy adres bezpośrednio w zwykłym widoku przeglądarki i celowo nie stosuje masek ani sandboxa. W obu trybach parametr źródłowy jest usuwany z widocznego adresu ChemDisk zaraz po odczytaniu.

Maski, sandbox i ukrycie linków ograniczają typowe przejścia z interfejsu, ale nie są zabezpieczeniem DRM. Plik musi być dostępny dla przeglądarki, więc zaawansowany użytkownik nadal może ustalić źródło przez narzędzia deweloperskie lub ruch sieciowy. Materiałów, których odbiorca absolutnie nie może pobrać, nie należy udostępniać klientowi w oryginalnej postaci.

### Interaktywne lekcje z Markdown

Moduł `/members/module/lesson/` zamienia plik Markdown w prezentację typu wizard. Pliki lekcji umieszczaj w osobnym prywatnym repo:

```text
chemdisk-content/
└── lessons/
    ├── izotopy-wegla.md
    └── przyklad.md
```

Lekcję otwiera parametr `file`. Przy wielu źródłach `repo` wskazuje `id` z konfiguracji; link bez `repo` zachowuje zgodność i używa repozytorium domyślnego:

```text
/members/module/lesson/?file=moja-lekcja.md
/members/module/lesson/?repo=organiczna&file=moja-lekcja.md
```

Do dashboardu można dodać ją jak każdy inny materiał:

```md
- [Izotopy węgla](/members/module/lesson/?file=izotopy-wegla.md) — Lekcja interaktywna z krótkim zadaniem.
```

Nazwa z parametru może zawierać litery ASCII, cyfry, kropki, myślniki i podkreślenia, musi kończyć się `.md` i nie może zawierać ścieżki do innego katalogu. Dzięki temu link nie może odczytać pliku spoza `lessons/`. Moduł i serwerowy endpoint wymagają aktywnego dostępu kursowego; bezpośredni adres prywatnego repo nie jest ujawniany jako publiczne źródło.

Każda linia zawierająca wyłącznie `---` kończy slajd i zaczyna następny:

```md
# Tytuł lekcji

Wprowadzenie do tematu.

---

## Drugi krok

- Pierwsza informacja
- Druga informacja

> Ważna uwaga dla kursanta.
```

Opcjonalny blok ustawień na początku treści danego slajdu wybiera jego subtelne przejście:

```md
:::slide
transition: rise
:::
```

Dozwolone wartości to `none`, `fade`, `rise`, `slide` i `zoom`. Domyślne `fade` nie musi być zapisywane. Ustawienie dotyczy tylko bieżącego slajdu; `none` całkowicie wyłącza jego przejście.

Parser obsługuje nagłówki `#`, `##`, `###`, akapity, listy numerowane i punktowane, cytaty `>`, pogrubienie `**tekst**`, kursywę `*tekst*`, kod, bezpieczne linki oraz obrazy. Dla obrazu z publicznego repozytorium wstaw jego pełny publiczny adres HTTPS, np. `![Opis](https://raw.githubusercontent.com/OWNER/REPO/main/images/schemat.png)`. Token do prywatnych lekcji nie jest używany do pobierania obrazów. Surowy HTML jest wyświetlany jako tekst i nie jest wykonywany.

Dodatkowo zapis `^13^C` tworzy indeks górny (¹³C), a `H~2~O` — indeks dolny. Jest to wygodne przy zapisie izotopów i wzorów chemicznych.

Do rozbudowanych wzorów służy bezpieczny blok `:::formula`. Studio udostępnia dla niego wizualny kreator z gotowymi reakcjami, klikalnymi symbolami i strzałkami, osobnymi polami warunków reakcji oraz podglądem na żywo. Odtwarzacz i oba podglądy Studio renderują wynik przez MathJax z rozszerzeniem `mhchem`.

Reakcja chemiczna:

```md
:::formula
mode: chemistry
title: Spalanie wodoru
left: 2 H2 + O2
arrow: ->
above: 450 °C
below: kat. Pt
right: 2 H2O
:::
```

Dozwolone strzałki to pusty zapis (pojedynczy wzór), `->`, `<-`, `<->`, `<=>`, `<=>>` i `<<=>`. Dwie ostatnie pokazują równowagę przesuniętą odpowiednio w prawo albo w lewo. `above` umieszcza temperaturę, światło lub inny warunek nad strzałką, a `below` — katalizator, ciśnienie albo dodatkowy warunek pod nią. Rozszerzenie chemiczne rozpoznaje m.in. indeksy w `H2O`, ładunki w `SO4^2-`, izotopy w `^14C`, stopnie utlenienia w `Fe^{III}` oraz oznaczenia faz `(s)`, `(l)`, `(g)` i `(aq)`.

Wzór matematyczny:

```md
:::formula
mode: math
title: Stężenie molowe
expression: c = \frac{n}{V}
:::
```

Obsługiwany jest ograniczony, bezpieczny podzbiór zapisu matematycznego: potęgi `x^{2}`, indeksy `a_{n}`, ułamki `\frac{a}{b}`, pierwiastki `\sqrt{x}`, sumy, iloczyny, całki, granice, pochodne cząstkowe, wektory, strzałki, podstawowe funkcje, greckie litery i symbole porównania. Nie są przyjmowane dowolne polecenia LaTeX, HTML, adresy ani makra ładujące zasoby.

Estetyczny kafelek z linkiem:

```md
:::linkcard
title: Tablica wzorów
description: Otwórz materiał pomocniczy do zadania.
url: https://example.com/wzory
icon: math
color: #2563eb
new_tab: true
:::
```

Ikony: `link`, `book`, `video`, `chemistry`, `math`, `file` i `external`. Kolor ma format `#RRGGBB`. `new_tab: true` dodaje bezpieczne otwieranie w nowej karcie. Adres może używać `http`, `https`, `mailto`, `#kotwicy` albo wewnętrznej ścieżki `/...`; protokoły skryptowe są odrzucane.

Pomoc AI dotycząca bieżącego slajdu:

```md
:::aihelp
title: Masz pytanie do tego slajdu?
description: Otwórz asystenta i zapytaj o niezrozumiały fragment.
button: Zapytaj AI
repository: glowne
prompt: korepetytor.json
point: 1
:::
```

`repository`, `prompt` i `point` są opcjonalne. Prompt może być plikiem `.json` albo `.txt`; punkt jest używany przy TXT. Po kliknięciu lekcja zapisuje wyłącznie w tej samej przeglądarce kontekst slajdu pod losowym identyfikatorem i otwiera czat w nowej karcie. Czat usuwa wpis po pierwszym odczycie, odrzuca dane starsze niż 10 minut i jawnie informuje ucznia, że kontekst zostanie dołączony do pierwszego pytania. Treść slajdu nie jest umieszczana w URL.

Formularz kontaktowy do prowadzącego:

```md
:::contactform
title: Zapytaj prowadzącego
description: Napisz, który fragment lekcji wymaga wyjaśnienia.
button: Otwórz formularz
internal: Pytanie do lekcji o stechiometrii
new_tab: false
:::
```

`internal` jest opcjonalną informacją wstępną o długości do 240 znaków. Kafelek otwiera chroniony moduł kontaktowy, który uzupełnia imię i e-mail z konta kursanta, a odpowiedź zapisuje w Netlify Forms. Parametr pomaga rozpoznać kontekst zgłoszenia, ale nie jest zaufanym identyfikatorem użytkownika ani uprawnienia.

Tablica interaktywna:

```md
:::board
title: Rozpisz rozwiązanie
description: Użyj tablicy do wzorów i obliczeń.
button: Otwórz tablicę
variant: bitpaper
path: stechiometria.json
new_tab: true
:::
```

`variant` przyjmuje `whiteboard` albo `bitpaper`. `path` jest opcjonalny, działa tylko z BitPaper i musi być samą bezpieczną nazwą pliku `.json`, bez katalogu. Pusta wartość otwiera nową planszę.

Stylowany fragment i harmonijkę można zapisać bez wykonywania HTML lub dowolnego CSS:

```md
:::style font=georgia color=#0e665a bold=true size=large align=center
Treść z wybraną czcionką, pogrubieniem, rozmiarem i wyrównaniem.
:::

:::accordion Dodatkowe wyjaśnienie open=true
Treść widoczna po rozwinięciu. Parametr `open=true` jest opcjonalny.
:::
```

Dozwolone czcionki to `sans`, `arial`, `verdana`, `serif`, `georgia`, `times`, `rounded`, `mono` i `courier`; rozmiary: `small`, `normal`, `large`, `xlarge`; wyrównanie: `left`, `center`, `right`. `bold=true` pogrubia cały stylowany blok. Kolor musi mieć format `#RRGGBB`. Inne wartości wracają do bezpiecznych ustawień domyślnych.

Gdy pytanie utworzone w Studio zawiera kilka akapitów albo element Markdown, builder otacza je blokiem `:::question … :::` bezpośrednio przed `:::task`. Dzięki temu ponowny import jednoznacznie odróżnia treść pytania od pozostałej zawartości slajdu; moduł lekcji renderuje wnętrze tego bloku jak zwykły, bezpieczny Markdown.

#### Zadanie z polem odpowiedzi

Na slajdzie może wystąpić jeden blok `:::task` (działa również polska nazwa `:::zadanie`). Domyślnie przełącznik ucznia **Nauka po kolei** jest włączony, więc slajd z zadaniem nie odblokuje przycisku **Dalej**, dopóki kursant nie poda poprawnej odpowiedzi. Uczeń może wyłączyć ten przełącznik, przejść do dowolnego dalszego kroku i wrócić do pominiętego zadania później.

```md
## Zadanie

Ile neutronów znajduje się w izotopie ^13^C?

:::task
type: number
label: Liczba neutronów
answer: 7
placeholder: Wpisz liczbę
hint: Odejmij Z = 6 od A = 13.
success: Dokładnie — 13 − 6 = 7 neutronów.
:::
```

Pola bloku zadania:

| Pole | Wymagane | Znaczenie |
| --- | --- | --- |
| `answer` | tak | Poprawna odpowiedź. Kilka wariantów rozdziel znakiem `|`, np. `atom \| ATOM`. |
| `type` | nie | `text` (domyślnie), `number`, `choice`, `abcd`, `gaps` albo `gaps-text`. |
| `label` | nie | Podpis pola lub polecenie nad odpowiedziami. |
| `placeholder` | nie | Przykład wyświetlany w pustym polu. |
| `hint` | nie | Podpowiedź pokazywana po błędnej próbie. |
| `success` | nie | Komunikat po poprawnej odpowiedzi. |
| `options` | dla `choice`, `abcd` i `gaps` | Opcje rozdzielone `|`. `choice` i `gaps` wymagają co najmniej dwóch, a `abcd` dokładnie czterech opcji. |
| `text` | dla `gaps` i `gaps-text` | Zdanie z lukami zapisanymi jako `{{opis luki}}`; kolejność znaczników odpowiada kolejności wartości w `answer`. |
| `check_mode` | nie | Dla `gaps-text`: `each` sprawdza każdą lukę osobno, a `all` wszystkie naraz (domyślnie). |
| `case_sensitive` | nie | `true`/`tak`, jeśli wielkość liter ma mieć znaczenie. Domyślnie tekst jest sprawdzany bez rozróżniania wielkości liter. |

Można również używać polskich nazw pól bez znaków diakrytycznych lub z nimi: `typ`, `odpowiedź`, `etykieta`, `przykład`, `podpowiedź`, `sukces`, `opcje`, `tekst`, `tryb sprawdzania`, `wielkość liter`.

Odpowiedź tekstowa jest normalizowana Unicode NFKC, przycinana i ma łączone wielokrotne odstępy. Odpowiedź liczbowa akceptuje przecinek albo kropkę dziesiętną, ale porównanie jest dokładne — bez tolerancji i bez automatycznego rozpoznawania jednostek. Liczbę akceptowanych aliasów zwiększa się separatorem `|`. Liczba prób nie jest ograniczona; błędna próba pokazuje podpowiedź. Przy włączonej opcji **Nauka po kolei** dopiero poprawna odpowiedź odblokowuje następny slajd, a po jej wyłączeniu zadanie można pominąć.

Przykład pytania wyboru:

```md
:::task
type: choice
label: Wybierz liczbę neutronów w węglu-13
options: 6 | 7 | 13
answer: 7
hint: Liczba neutronów to A − Z.
:::
```

Quiz z widocznymi oznaczeniami A–D można zapisać krócej jako `type: abcd`. Poprawną odpowiedź podaj literą albo pełną treścią opcji:

```md
:::task
type: abcd
label: Która liczba jest liczbą atomową węgla?
options: 4 | 6 | 12 | 13
answer: B
hint: Liczba atomowa jest równa liczbie protonów.
success: Dobrze — węgiel ma liczbę atomową 6.
:::
```

Luki z `type: gaps` pokazują listy wyboru. Jeśli uczeń ma sam wpisać tekst, użyj `type: gaps-text`; liczba odpowiedzi rozdzielonych `|` musi być taka sama jak liczba znaczników:

```md
:::task
type: gaps-text
label: Uzupełnij wzór i masę molową
text: Woda ma wzór {{wzór}}, a jej masa molowa wynosi około {{masa}} g/mol.
answer: H2O | 18
check_mode: each
case_sensitive: true
hint: Sprawdź symbole pierwiastków i dodaj ich masy atomowe.
success: Wszystkie luki są poprawne.
:::
```

Postęp, rozwiązane zadania i ukończenie są zachowywane w `sessionStorage`, czyli przy odświeżeniu w tej samej karcie. Dostępny pod planem przycisk **Resetuj postęp** po potwierdzeniu czyści stan wyłącznie bieżącej lekcji i wraca do pierwszego slajdu. Przycisk **Powtórz lekcję** robi to samo po ukończeniu materiału. Odpowiedzi znajdują się w statycznym pliku Markdown, więc ten moduł służy do nauki i samosprawdzenia, a nie do tajnych lub punktowanych egzaminów.

### Atonom — modele cząsteczek

Moduł `/members/module/atonom/` buduje edukacyjny, interaktywny model cząsteczki na podstawie polskiej nazwy związku. Pokazuje wzór sumaryczny, rodzinę związku, liczbę atomów i wiązań, przybliżoną masę molową oraz krótką wskazówkę dotyczącą budowy. Canvas można obracać i powiększać; dostępne są pauza animacji, reset widoku oraz suwaki energii ruchu, rozmiaru atomów i odległości kamery.

Blok ATONOM umieszczony w lekcji nie ładuje modelu automatycznie. Odtwarzacz i podgląd Studio pokazują najpierw kafelek z nazwą związku; iframe powstaje dopiero po kliknięciu **Pokaż związek** i jest usuwany po wybraniu **Ukryj model**.

Obsługiwany zakres obejmuje między innymi:

- proste i rozgałęzione alkany, alkeny, alkiny oraz cykloalkany do 12 atomów węgla w łańcuchu głównym;
- halogenowe i alkilowe podstawniki z lokantami;
- alkohole i polialkohole, aldehydy, ketony, kwasy karboksylowe, estry i aminy;
- benzen, fenol, toluen, anilinę i podstawione pochodne benzenu;
- glicynę, alaninę, wodę, amoniak i dwutlenek węgla;
- poprawne przypadki izomerii `cis`/`trans` dla obsługiwanych alkenów.

Parser nie jest pełnym parserem całej nomenklatury IUPAC. Nieobsługiwana albo chemicznie niespójna nazwa daje czytelny błąd i przykład poprawnego zapisu zamiast zgadywania struktury. Model ma charakter dydaktyczny — nie zastępuje obliczeń geometrii kwantowej ani profesjonalnego oprogramowania chemicznego.

Wybrany związek można przekazać i udostępnić w parametrze `formula`:

```text
/members/module/atonom/?formula=fenol
/members/module/atonom/?formula=cis-but-2-en
/members/module/atonom/?formula=kwas%202-metylopropanowy
```

Przycisk kopiowania zachowuje aktualną nazwę w linku. Indywidualne kolory atomów i wiązań są zapisywane lokalnie w `atonom-atom-colors` oraz `atonom-bond-colors`; można je przywrócić do palety domyślnej. Atonom respektuje wspólny `chem.theme` i ograniczenie ruchu `prefers-reduced-motion`.

Na publicznej stronie głównej pozycja **Atonom** prowadzi obecnie do osobnej witryny `https://atonom.netlify.app`, natomiast karta w chronionym dashboardzie otwiera lokalny moduł `/members/module/atonom/`. Są to dwa różne wdrożenia; zmiana zewnętrznej witryny nie aktualizuje automatycznie wersji dołączonej do ChemDisk i odwrotnie.

### Kalkulatory i tablice

`/members/module/kalkulator/` osadza naukowy symulator NumWorks. Wymaga połączenia z zewnętrzną usługą i uruchamia iframe dopiero po potwierdzeniu sesji.

`/members/module/classic/` działa lokalnie i obsługuje dodawanie, odejmowanie, mnożenie, dzielenie, modulo, nawiasy, znaki jednoargumentowe oraz kropkę lub przecinek dziesiętny. Nie używa `eval`. Można klikać przyciski albo pisać z klawiatury:

- cyfry, `+`, `-`, `*`, `/`, `%`, `(`, `)`, `.` i `,` wpisują działanie;
- `x`, `X` i `×` oznaczają mnożenie, a `:` i `÷` — dzielenie;
- `Enter` lub `=` oblicza wynik;
- `Backspace` i `Delete` usuwają ostatni znak;
- `Escape` czyści kalkulator.

Operator `%` oznacza resztę z dzielenia, a nie przeliczenie wartości procentowej.

`/members/module/bitpaper/` jest lokalną tablicą canvas z przesuwaniem, skalowaniem, zaznaczaniem, ołówkiem, gumką, tekstem, cofaniem/ponawianiem oraz oknami zadań, do których można dodawać obrazy. Planszę można wyeksportować/importować jako JSON albo pobrać jako PNG. Import planszy ma limit 15 MB, a pojedynczy obraz zadania 8 MB. Parametr `path=nazwa.json` automatycznie wczytuje bezpiecznie nazwaną planszę opublikowaną w katalogu modułu.

BitPaper nie synchronizuje uczestników w czasie rzeczywistym i nie zapisuje planszy na serwerze; do przenoszenia stanu służy plik JSON. `/members/module/whiteboard/` osadza tldraw i podobnie jak NumWorks wymaga dostępności usługi zewnętrznej.

### Filmy

Najprostsze linki:

```text
/members/module/film/?id=ID_YOUTUBE&type=1
/members/module/film/?id=ID_DRIVE&type=2
/members/module/film/?id=ID_YOUTUBE&type=3
```

- `type=1` uruchamia YouTube z ograniczonym interfejsem;
- `type=2` uruchamia film z Google Drive we wbudowanym odtwarzaczu Google;
- `type=3` uruchamia YouTube z pełniejszymi kontrolkami;
- dla samego ID pliku Drive trzeba podać `type=2`;
- strona odtwarzacza i całe otoczenie działają pod domeną ChemDisk, ale film nadal jest przesyłany przez YouTube lub Google.

W `type=1` odtwarzacz ukrywa odnośniki awaryjne, nakłada maski na tytuł, logo i przyciski dostawcy oraz uruchamia iframe w sandboxie bez `allow-popups` i bez nawigacji górnego okna. `type=3` jest świadomie trybem zwykłym i może udostępniać pełniejsze funkcje YouTube. `type=2` korzysta z Google Drive i wymaga poprawnego udostępnienia pliku.

Ponieważ zawartość YouTube działa w zewnętrznym iframe, aplikacja nie może modyfikować jej kodu. Sandbox i maski blokują typowe kliknięcia prowadzące do YouTube w trybie ograniczonym, ale po zmianie interfejsu przez dostawcę położenie masek może wymagać aktualizacji. Nie jest to zabezpieczenie DRM.

### Odtwarzacz YT

Moduł `/members/module/yt/` jest osobnym odtwarzaczem YouTube z kontrolkami ChemDisk. W linku podaj 11-znakowe ID filmu albo pełny, zakodowany link YouTube:

```text
/members/module/yt/?id=CH50zuS8DD0
/members/module/yt/?id=https%3A%2F%2Fyoutu.be%2FCH50zuS8DD0
```

Akceptowane są linki `youtu.be`, `youtube.com/watch`, `shorts`, `live` i `embed`. Po otwarciu parametr `id` jest przenoszony do `sessionStorage` i usuwany z paska adresu. Odświeżenie w tej samej karcie zachowuje film; otwarcie czystego adresu w nowej karcie wymaga ponownego przekazania ID.

Odtwarzacz ma własne przyciski odtwarzania, restartu, wyciszania i pełnego ekranu, suwaki postępu oraz głośności i obsługę dotyku. Na telefonie podpisy przycisków są zastępowane ikonami, a film pozostaje osadzony w stronie dzięki `playsinline=1`. Ostatnie szybkie kliknięcie wyciszenia zawsze wyznacza stan docelowy, niezależnie od opóźnienia API YouTube.

Film musi pozwalać na osadzanie. Własne kontrolki i maski ograniczają przypadkowe przejście do YouTube, ale nie są zabezpieczeniem DRM.

### Prompty czatu

Pliki promptów umieszczaj w `prompts/` prywatnego repo materiałów. Funkcja `chat` pobiera wybrany plik z GitHuba po stronie serwera; token i treść promptu nie trafiają do przeglądarki kursanta. Administrator może odczytać treść w chronionym Prompt Builderze, aby ją świadomie edytować. Zmiana promptu wymaga tylko commitu w repo materiałów, bez deployu aplikacji.

W **Studio treści → Prompt AI** można utworzyć `.json` z jedną instrukcją albo `.txt` z wieloma punktami `::punkt N`. Dostępne są: import pliku, edycja źródła, kopiowanie, pobranie na dysk, wczytanie z repo, zapis oraz usunięcie. Ręczny obieg jest równorzędny z przyciskami GitHub. Builder nie wysyła promptu do modelu AI i nie uruchamia czatu — przygotowuje oraz waliduje tylko plik instrukcji.

Najprostsza zawartość:

```json
{
  "prompt": "Jesteś asystentem przygotowującym do matury z chemii..."
}
```

Rozpoznawane są tekstowe pola `prompt`, `system`, `text`, `value` i `content`. Czat wywołuje wyłącznie serwerową funkcję z tokenem użytkownika; model i klucz API nie są wybierane przez adres URL.

Jeden plik TXT może zawierać wiele niezależnych instrukcji. Używaj jednoznacznych nagłówków w osobnych liniach:

```txt
::punkt 1
Jesteś korepetytorem chemii. Naprowadzaj, ale nie podawaj od razu wyniku.

::punkt 2
Sprawdź równanie reakcji, jednostki i cyfry znaczące.
Zakończ krótką modelową odpowiedzią.
```

Link do drugiego punktu: `/members/module/chat/?plik=prompty-przyklad.txt&punkt=2`. Dla innego źródła dodaj np. `repo=organiczna`: `/members/module/chat/?repo=organiczna&plik=prompty-przyklad.txt&punkt=2`. Nagłówki `::punkt N` pozwalają umieszczać wewnątrz promptu zwykłe listy `1.`, `2.` bez przypadkowego podziału. Nazwa repozytorium, pliku, numer punktu i treść są ponownie walidowane po stronie funkcji; klient nie może przesłać własnego pola `system`.

Obsługiwany jest też prostszy zapis zgodny ze zwykłą numerowaną listą:

```txt
1. Naprowadzaj na rozwiązanie zadania bez podawania od razu wyniku.
2. Sprawdź odpowiedź, jednostki i cyfry znaczące.
```

Nie mieszaj obu zapisów w jednym pliku. Jeżeli pojedyncza instrukcja sama zawiera numerowaną listę, użyj wariantu `::punkt N`, aby granice punktów pozostały jednoznaczne.

Netlify nakłada na funkcję `chat` limit 30 wywołań na minutę dla agregacji IP i domeny. Właściwe limity użytkownika są konfigurowane w **Panel administratora → AI Limity** i zapisywane trwale w Netlify Blobs. Rezerwacja z warunkowym zapisem zapobiega przekroczeniu limitu przez równoległe żądania; nie jest to licznik zależny od pamięci pojedynczego wystąpienia Function.

### Osobne pliki CSS i JavaScript modułu

Każdy moduł ma stały element `<base>`, np.:

```html
<base href="/members/module/kalkulator/">
<link rel="stylesheet" href="./style.css">
<script defer src="./script.js"></script>
```

Dzięki temu `style.css` i `script.js` są pobierane z katalogu modułu również wtedy, gdy Netlify obsłuży ładny adres bez `index.html`. Przy dodawaniu nowego modułu ustaw jego własny bezwzględny `<base>` i w dashboardzie linkuj najlepiej do ścieżki zakończonej `/`.

## Media Manager i natywne prezentacje

Wspólny **Media Manager** jest używany przez Exam Builder, Lesson Builder, Presentation Studio, obsługę quizów oraz eksplorator. Zakładka **W tym materiale** zapisuje pliki w jego własnym `photos/`, a **Wspólne dla kursu** w `assets/shared/`. Obsługuje wybór wielu plików, przeciąganie, wklejanie `Ctrl/Cmd+V`, wyszukiwanie, paginację po 12 kart, leniwe miniatury i jawne usuwanie. Definicje zapisują stabilne referencje względne, nigdy tymczasowy Blob URL ani token GitHub. Pliki są odczytywane przez `content-media` dopiero po sprawdzeniu sesji i dostępu do kursu.

Usunięcie obrazu lokalnego pokazuje liczbę wystąpień w definicji właściciela. Dla `assets/shared/` aplikacja celowo wyświetla mocniejsze ostrzeżenie, ponieważ pełne skanowanie wszystkich repozytoriów przy każdym otwarciu byłoby kosztowne i zawodne. Usunięcie wymaga dokładnego SHA, więc nowsza równoległa wersja pliku nie zostanie nadpisana. Historia commita GitHub umożliwia odwrócenie operacji.

**Presentation Studio** zapisuje wersjonowany, natywny `presentation.json` w prywatnym repozytorium. Slajdy i elementy mają trwałe ID, dlatego zmiana kolejności nie niszczy postępu. Starsze definicje bez nowych pól są normalizowane do bezpiecznych wartości domyślnych, a istniejący moduł Google Slides nadal działa niezależnie. Dashboard Builder ma osobny typ **Prezentacja ChemDisk**. Odtwarzacz `/members/module/presentation/` pokazuje wyłącznie opublikowaną definicję, wznawia ostatni slajd i wysyła odwiedziny do istniejącego centralnego systemu postępu.

**Quiz Builder** zapisuje wersjonowany `quiz.json` bez dowolnego HTML. Dashboard Builder ma osobny typ **Quiz ChemDisk**, który wybiera definicję z repozytorium i może być krokiem organizatora. Odtwarzacz `/members/module/quiz/` pokazuje tylko opublikowaną wersję, pobiera prywatne obrazy po uwierzytelnieniu, oblicza wynik dla wszystkich czterech typów pytań i zapisuje procent, zaliczenie oraz liczbę prób w centralnym systemie postępu. Gdy autor wyłączy powtórzenia, zapisane ukończenie blokuje ponowną próbę także po ponownym otwarciu strony.

## Centralny system postępu ucznia

ChemDisk ma jeden wspólny system postępu dla dashboardu, lekcji, prezentacji, filmów, PDF-ów, quizów i pozostałych modułów. Nie jest to osobna aplikacja ani nowy framework: rozwiązanie rozszerza istniejące Netlify Functions, Netlify Identity, Netlify Blobs, Dashboard Builder i Lesson Builder.

Źródłem prawdy jest store Netlify Blobs `chemdisk-progress`. `localStorage` i `sessionStorage` są wyłącznie krótkotrwałym cache'em interfejsu. Dokument kursanta jest zapisany pod kluczem `users/<base64url-user-id>.json`, konfiguracja pod `config/catalog.json`, a audyt pod prefiksem `audit/`. Zapisy dokumentów użytkownika i konfiguracji używają mocnego odczytu oraz warunkowych zapisów ETag z ponowieniem po konflikcie.

Funkcja `progress` zawsze wyznacza użytkownika z aktualnie zweryfikowanej sesji Netlify Identity i wymaga aktywnego dostępu do kursu. Nie przyjmuje `userId` ani w treści, ani w query. Funkcja `admin-progress` wymaga świeżo zweryfikowanej roli `admin`. Te same role, czasowy dostęp Stripe i mechanizm jednej aktywnej sesji pozostają bez zmian.

### Statusy i dane

Status ma jedną z wartości: `not_started`, `opened`, `in_progress`, `completed`. Otwarcie zwykłego śledzonego materiału będącego liściem dashboardu kończy go na 100%, z wyjątkiem Google Slides umieszczonych w organizerze sekwencyjnym oraz natywnego Quizu ChemDisk. Przy Slides uczeń po obejrzeniu slajdów używa przycisku **Zakończ krok**, a quiz kończy się po sprawdzeniu odpowiedzi. Lekcja nadal wylicza dokładny procent z wykonanych kroków, a egzamin po samym otwarciu ma status `opened`; jego procent rośnie z liczbą zapisanych odpowiedzi i osiąga 100% dopiero po zakończeniu próby. Otwarcie działu lub harmonijki nie zalicza ich bezpośrednio — ich procent wynika z dzieci. Wspólna część rekordu zawiera `materialId`, `materialType`, pierwsze i ostatnie otwarcie, `openCount`, procent, ostatnią pozycję, datę ukończenia i ostatnią aktywność. Pole `details` przechowuje dane typu materiału:

- lekcja: bieżący i najwyższy krok, stabilne identyfikatory ukończonych kroków oraz liczba kroków śledzonych;
- prezentacja: ostatni i najwyższy slajd, odwiedzone slajdy oraz łączna liczba slajdów;
- film: czas trwania, ostatnia pozycja, rozpoczęcie odtwarzania i złączone zakresy rzeczywiście odtworzone;
- PDF: ostatnia i najwyższa odwiedzona strona; jest to wyłącznie postęp nawigacyjny, nie dowód przeczytania;
- quiz: osobne `progressPercent`, `scorePercent`, rozpoczęcie, ukończenie i liczba prób.
- egzamin: rozpoczęcie, liczba odpowiedzi, liczba pytań, numer i ID próby, osobny `scorePercent`, zaliczenie oraz czas.

### Konfiguracja w Dashboard Builderze

W Studio wybierz Dashboard Builder, a następnie cały dashboard, dział, harmonijkę albo materiał. Sekcja „Postęp ucznia” udostępnia:

- śledzenie `ON`, `OFF` lub `INHERIT`;
- widoczność paska `ON`, `OFF` lub `INHERIT`;
- wagę, domyślnie `1`;
- dla prezentacji sposób liczenia: najwyższy slajd, odwiedzone slajdy albo wymagane slajdy;
- dla filmu próg ukończenia od 1 do 100%;
- na poziomie całej platformy niezależne rejestrowanie otwarć.

Studio pokazuje ustawienie efektywne. Dziedziczenie biegnie od całego kursu przez dział i kolejne harmonijki do materiału. `OFF` rodzica wyłącza element dziedziczący, ale jawne `ON` materiału jest nadpisaniem. Każdy efektywnie włączony element automatycznie uczestniczy w postępie wszystkich swoich rodziców — nie ma osobnych, rozbieżnych flag sekcji, działu i kursu. Wyłączenie śledzenia lub paska nie usuwa historii.

Konfiguracja i stabilne identyfikatory są zapisywane w niewidocznych, jednoliniowych komentarzach Markdown `chemdisk-progress`. Po opublikowaniu Dashboard Builder synchronizuje katalog postępu z funkcją administratora. Brak komentarza zachowuje bezpieczne ustawienia zgodne ze starym dashboardem.

Klocek **Organizer po kolei** jest specjalną grupą z `settings.navigation: "sequential"`. Musi zawierać co najmniej dwa moduły i nie może zawierać kolejnej harmonijki. Może zawierać między innymi Google Slides, PDF, lekcję, Quiz ChemDisk i egzamin. Pierwszy krok jest dostępny od razu; kolejne karty pokazują blokadę i nazwę najwcześniejszego nieukończonego wymagania. Google Slides w takim organizerze nie zaliczają się przy samym otwarciu — moduł pokazuje uczniowi przycisk **Zakończ krok**. PDF otwiera się w skonfigurowanym trybie i po poprawnym otwarciu odblokowuje następny krok. Natywny quiz zapisuje ukończenie dopiero po sprawdzeniu odpowiedzi. Endpoint postępu odrzuca próbę otwarcia zablokowanego `materialId` kodem `SEQUENCE_LOCKED`, a Exam Engine sprawdza ten warunek przed zwróceniem definicji egzaminu. Po ukończeniu kroku powrót do dashboardu automatycznie uaktualnia przyciski na „Kontynuuj”, „Otwórz ponownie” lub „Rozpocznij”.

### Lekcje i blokada nawigacji

Lesson Builder zapisuje stabilne `stepId`; zmiana kolejności nie usuwa zaliczeń przypisanych do istniejących kroków. Dla każdego kroku można niezależnie ustawić wpływ na procent, wymagalność do przejścia oraz warunek przejścia. Krok egzaminowy przechowuje wyłącznie `repositoryId` i `examId`, a warunek może wymagać ukończenia, zaliczenia albo wyniku wyższego niż lokalny próg lekcji. Definicja i klucz odpowiedzi nie są kopiowane do Markdownu lekcji.

Tryb lekcji może być swobodny albo sekwencyjny. Serwer odrzuca nieznany, zablokowany lub zbyt odległy krok, więc blokada nie opiera się wyłącznie na przyciskach w przeglądarce. Administrator może dla użytkownika wymusić `DEFAULT`, `ALLOW` lub `DENY`, a także ustawić, odblokować lub zablokować krok. Stary zapis sesyjny pozostaje cache'em awaryjnym, ale po załadowaniu pierwszeństwo ma stan serwera.

### Paski i agregaty

Dashboard wyświetla pasek całego kursu, działów, harmonijek i materiałów, o ile efektywne `showProgress` jest włączone. Agregacja jest hierarchiczna: sekcja liczy wszystkie swoje efektywnie włączone dzieci, dział liczy włączone sekcje, a kurs liczy włączone działy. Waga zmienia wpływ elementu na jego bezpośredniego rodzica. Wyłączone elementy nie zwiększają mianownika, a kontener bez ani jednego włączonego potomka nie pokazuje uczniowi paska. Gdy globalne śledzenie jest wyłączone, historia pozostaje w Blobs, procenty nie są aktualizowane, a paski są ukryte; rejestrowanie samych otwarć może nadal działać.

Usunięcie elementu w Dashboard Builderze i opublikowanie dashboardu zapisuje w katalogu znacznik unieważnienia. Od tej chwili jego stary rekord nie jest zwracany ani liczony żadnemu uczniowi. Nie wymaga to skanowania wszystkich Blobów użytkowników podczas publikacji; rekord jest odfiltrowywany i sprzątany przy najbliższej operacji danego konta. Ponowne dodanie tego samego stabilnego ID zaczyna postęp od zera.

Kursant może po potwierdzeniu zresetować pojedynczy materiał przy jego pasku albo cały własny kurs z karty postępu i ustawień profilu. Endpoint zawsze bierze właściciela danych z uwierzytelnionej sesji; reset kursanta nie przyjmuje `userId`.

### Panel administratora

Zakładka **Postępy** zawiera ustawienia globalne, wyszukiwanie, sortowanie i filtry użytkowników, raport pojedynczego kursanta, agregaty globalne oraz audit log. Raport ucznia jest kompaktowym, zagnieżdżonym drzewem: początkowo pokazuje tylko najwyższy poziom, a szczegóły, akcje i kolejne dzieci tworzy dopiero przy pierwszym rozwinięciu wiersza. Raport pokazuje otwarcia, procent, pozycję właściwą dla typu materiału, pierwsze otwarcie i ostatnią aktywność. Konta Identity bez aktywności są dołączane z postępem 0%. Rozwijana sekcja globalna objaśnia sposób liczenia metryk, pokazuje rozkład na kartach, rankingi materiałów oraz czytelną historię zmian z polskimi nazwami operacji, użytkownikiem, materiałem, administratorem i podsumowaniem zmiany.

Administrator może oznaczyć materiał jako ukończony lub nieukończony, zmienić pomijanie kroków, ustawić/odblokować/zablokować krok i z potwierdzeniem zresetować materiał, sekcję, dział albo cały kurs. Każda taka operacja zapisuje `adminId`, `targetUserId`, akcję, materiał, poprzednią i nową wartość oraz czas.

Raport globalny obejmuje średni postęp, rozpoczęcia, ukończenia, rozkład kwartylowy, materiały najczęściej nieotwierane i porzucane oraz najczęstszy punkt zatrzymania. Endpointy listujące dane są ograniczone i stronicowane; dokument użytkownika jest pobierany bezpośrednio po kluczu, a nie przez skanowanie store.

### Integracje odtwarzaczy i iframe

Moduły `yt` i `film` zapisują także zakresy odtwarzane w normalnym tempie i nie uznają samego przewinięcia do końca za obejrzany fragment. Aktualizacje są grupowane co 15 sekund zamiast wysyłania przy każdym `timeupdate`. Zgodnie z prostą regułą ukończenia moduł jako element kursu osiąga jednak 100% już przy otwarciu; telemetria filmu pozostaje dostępna w szczegółach raportu.

Google Slides, Google Drive PDF i Google Forms działają w obcych iframe'ach, których zawartości przeglądarka nie pozwala ChemDisk odczytać. Poza organizerem ich otwarcie zalicza sam moduł według reguły 100%; Google Slides wewnątrz organizera wymagają świadomego kliknięcia **Zakończ krok**. Dokładny slajd, strona lub wynik pojawia się tylko wtedy, gdy użyty, kontrolowany odtwarzacz wysyła odpowiednio `chemdisk:slide`, `chemdisk:pdf-page`, `chemdisk:video` albo `chemdisk:quiz`. ChemDisk akceptuje komunikat wyłącznie z bieżącego iframe i jego oczekiwanego originu. Ręczne zakończenie Google Slides jest deklaracją ucznia, ponieważ zewnętrzny iframe nie udostępnia ChemDisk wiarygodnego stanu obejrzenia.

### Endpointy

- `GET /.netlify/functions/progress` — własny dokument, katalog i agregaty;
- `POST /.netlify/functions/progress` — własne zdarzenie `open`, `progress`, `complete`, `lesson_step`, `presentation`, `video`, `pdf`, `quiz` lub `exam`;
- `DELETE /.netlify/functions/progress` — reset własnego materiału (`materialId`) albo całego własnego kursu (`scope: "course"`);
- `GET|PUT|DELETE /.netlify/functions/admin-progress` — raporty, konfiguracja, ręczne operacje, reset i audyt administratora.

Nie są potrzebne nowe zmienne środowiskowe. System używa istniejących `NETLIFY_API_TOKEN` i `SITE_ID`, które są już wymagane przez pozostałe store'y Blobs.

## Exam Engine i Exam Builder

Exam Engine rozszerza obecną architekturę ChemDisk. Definicje egzaminów i bank pytań używają tego samego `content-repository.js`, tych samych dozwolonych repozytoriów i tego samego tokenu GitHub co lekcje. Próby użytkowników nie trafiają do GitHuba: ich źródłem prawdy jest silnie spójny store Netlify Blobs `chemdisk-exams`. Wynik i stan egzaminu są równocześnie przekazywane do jedynego store'u postępu `chemdisk-progress`; nie istnieje drugi system agregowania postępu kursu.

### Pliki i stabilne identyfikatory

Każdy egzamin ma ścieżkę `exams/<examId>/exam.json`. Plik zawiera metadane, pytania lub stabilne odwołania do banku, konfigurację wyświetlania, nawigacji, czasu, losowania, punktacji, prób, dostępu, wyniku i status `draft`/`published`. Przy dostępie selektywnym może zawierać stabilne ID uprawnionych kont, ale nie zawiera ich nazw, e-maili, prób, indywidualnych wyników ani sekretów. Wspólny `exams/question-bank.json` przechowuje pytania wielokrotnego użycia ze stabilnym `questionId`.

Obrazy są zapisywane jako referencje względne, np. `photos/mechanizm-a1b2c3.webp` albo `assets/shared/logo.svg`, wraz z ALT. Pytanie i odpowiedź mogą mieć wiele obrazów. Po pierwszym zapisaniu draftu administrator otwiera Media Manager, przeciąga plik, wybiera go z dysku albo wkleja przez `Ctrl+V`/`Cmd+V`; starsze pole szybkiego uploadu przy pytaniu również pozostaje aktywne. Studio przesyła plik przez chronioną Function do lokalnego `photos/` lub biblioteki wspólnej, a do `exam.json` dopisuje stabilną referencję po kolejnym zapisaniu draftu. Przyjmowane są PNG, JPG/JPEG, WEBP, GIF i bezpieczny SVG do 4 MB; format i zawartość są weryfikowane po stronie serwera. Exam Player pobiera obrazy przez uwierzytelnioną Function, więc adres tymczasowy, token GitHub i dowolna ścieżka wejściowa nie są ujawniane klientowi.

### Praca w Builderze

W **Studio treści → Egzamin** administrator wybiera repozytorium, tworzy egzamin i przechodzi przez zakładki: Informacje, Pytania, Bank pytań, Wyświetlanie, Nawigacja, Czas, Losowanie, Punktacja, Próby, Dostęp, Bezpieczeństwo, Wyniki i Raporty. Obsługiwane typy to jedna odpowiedź, wiele odpowiedzi, prawda/fałsz, krótki tekst, liczba z tolerancją, dopasowywanie, kolejność i uzupełnianie luk.

W **Dostępie** można wskazać wszystkich uprawnionych kursantów albo tylko wybrane osoby. Selektor pobiera konta z istniejącego, chronionego endpointu Netlify Identity i wyszukuje po imieniu, nazwisku, adresie e-mail oraz stabilnym ID. Do `exam.json` trafiają wyłącznie ID zaznaczonych kont; e-mail i nazwa służą tylko do wygodnego wyboru w Builderze. Wyszukiwanie automatycznie dociąga kolejne strony użytkowników, więc nie jest ograniczone do pierwszych 100 kont. Pusta lista w trybie „Tylko wybrane osoby” blokuje publikację, zamiast przypadkowo udostępnić egzamin wszystkim.

**Zapisz draft** zapisuje poprawny, niewidoczny dla uczniów `exam.json`; **Opublikuj** udostępnia go Exam Playerowi. Podgląd draftu jest dostępny tylko dla administratora i tworzy izolowaną próbę, która nie wpływa na limity, raporty ani postęp. Po przygotowaniu definicji ekran ładowania znika i nie zasłania karty startowej podglądu. Bank jest zapisywany przed egzaminem, aby publikacja nie utworzyła odwołań do brakujących pytań. Kontrola publikacji odrzuca m.in. powtórzone ID, brak klucza, niemożliwą pulę losowania i sumę limitów kategorii większą od liczby pytań.

Przed usunięciem Builder sprawdza opublikowany Dashboard oraz pliki lekcji w wybranym repozytorium, pokazuje liczbę i nazwy znalezionych miejsc, a potem wymaga potwierdzenia. Usunięcie jest commitem Git i można je odtworzyć z historii, ale istniejące odwołanie w Dashboardzie lub lekcji przestanie działać.

### Próba, czas i bezpieczeństwo klucza

Function `exam` wyznacza właściciela próby wyłącznie ze zweryfikowanej sesji Identity. Klient nie może przesłać `userId`, odczytać próby innej osoby ani samodzielnie policzyć wyniku. Przy starcie serwer zapisuje dokładny zestaw pytań, kolejność pytań i odpowiedzi, `startedAt`, opcjonalne `expiresAt`, numer próby oraz rewizję. Losowanie z całej puli i limity kategorii są więc stałe dla wznowionej próby.

Aktywna próba otrzymuje wyłącznie bezpieczną reprezentację pytań. Klucz, ukryta punktacja i wyjaśnienia nie są wysyłane z definicją. Wyjątkiem jest jawnie włączony tryb informacji natychmiastowej: dopiero po kliknięciu **Zatwierdź i sprawdź odpowiedź** Function zwraca ocenę oraz tekst prawidłowej odpowiedzi wyłącznie dla tego jednego pytania. Serwer zapisuje zatwierdzenie i od tej chwili odrzuca każdą próbę zmiany tej odpowiedzi, także wykonaną poza interfejsem. Dla dopasowywania serwer generuje losowe identyfikatory prawej kolumny, aby same ID nie zdradzały par. Punktacja — w tym punkty częściowe, opcjonalne ujemne, strategie wielokrotnego wyboru, zaakceptowane teksty i tolerancja liczby — jest liczona wyłącznie po stronie serwera.

Odpowiedź jest od razu buforowana w bieżącej karcie, a zmiany są zapisywane server-side jedną paczką po około 8 sekundach lub razem z najbliższą nawigacją, zatwierdzeniem albo zakończeniem. Każda mutacja ma `operationId` i oczekiwaną rewizję; powtórzenie tego samego zapisu jest idempotentne, a równoległa starsza karta dostaje konflikt zamiast nadpisać nowszy stan. Odświeżenie wznawia aktywną próbę i odzyskuje niezapisany bufor tej samej karty, jeśli pozwala na to konfiguracja. Limit całego egzaminu i limit pytania są sprawdzane przez serwer również wtedy, gdy timer jest ukryty. Przed końcem czasu klient próbuje dosłać oczekującą paczkę, natomiast upływ limitu całego egzaminu nadal kończy próbę server-side.

Event log przechowuje zdarzenia cyklu próby (start, wznowienie, odświeżenie, opuszczenie, timeout i wysłanie) oraz ograniczone sygnały wymagające uwagi: wyjście kursorem poza obszar strony, kopiowanie, wklejanie i otwarcie menu prawego przycisku. Zwykły zapis odpowiedzi i każde przejście między pytaniami nie tworzą osobnego wpisu. Powtarzające się sygnały tego samego rodzaju są ograniczane po stronie klienta. Przeglądarka nie gwarantuje dostarczenia zdarzenia zamknięcia karty ani nie pozwala wiarygodnie udowodnić niesamodzielnej pracy, dlatego raport pokazuje te dane jako pomocnicze alerty, a nie proctoring. Polityka opuszczenia może pozwolić wrócić, ostrzec, tylko zapisać zdarzenie albo zakończyć próbę, jeśli komunikat dotrze do serwera.

### Wynik, próby i integracja z kursem

Egzamin rozdziela `progressPercent` od `scorePercent`. Otwarcie daje status `opened`, zapisane odpowiedzi zwiększają postęp, a wysłanie lub timeout kończy próbę. O wyniku zaliczono/nie zaliczono decyduje serwerowy próg egzaminu. Przy wielu próbach wynik przekazywany do kursu może być najlepszy, pierwszy, ostatni albo średni. Limity prób i cooldown są sprawdzane atomowo.

Administrator wybiera jeden z trzech trybów odpowiedzi: od razu po osobnym zatwierdzeniu pytania, dopiero po zakończeniu całego testu albo nigdy. W trybie „Nigdy — pełny wynik tylko dla administratora” uczeń dostaje jedynie potwierdzenie zapisania próby; procent, punkty, zaliczenie, odpowiedzi i wyjaśnienia pozostają w chronionym raporcie administratora. W dwóch pozostałych trybach można osobno zdecydować o widoczności procentu, punktów, zaliczenia, własnych odpowiedzi, wyjaśnień i czasu. Ukryte pola nie są tylko maskowane CSS-em — nie występują w odpowiedzi Function.

Dashboard Builder ma typ **Egzamin**, który zapisuje repozytorium i `examId` oraz zwykłe ustawienia centralnego postępu. Lesson Builder ma klocek **Egzamin z biblioteki** z warunkiem opcjonalnym, wymaganym ukończeniem, wymaganym zaliczeniem lub lokalnym minimum. Wymagany krok blokuje przejście także server-side; wyłączenie go z procentu lekcji nie wyłącza wymagalności. Ten sam egzamin może być użyty na Dashboardzie i w wielu lekcjach bez kopiowania definicji.

### Raporty i dane

Zakładka **Raporty** w Exam Builderze pokazuje uczestników, liczbę prób, średnią, medianę, minimum/maksimum, średni czas, zdawalność, rozkład wyników oraz analizę pytań z odsetkiem odpowiedzi poprawnych, dystrybucją i najczęstszym błędnym dystraktorem. Lista prób jest kompaktowa; pełne pytania, odpowiedzi, klucz, punkty, kolejność i event log są pobierane dopiero po rozwinięciu próby.

Raport ucznia w **Panel administratora → Postępy** ma przy egzaminie drugi zwijany poziom „Próby egzaminu, wyniki i czas”. Dopiero jego otwarcie pobiera daty, czas, numer, wynik i zaliczenie. Administrator może zresetować pojedynczą próbę; operacja jest miękkim resetem, przelicza postęp na podstawie pozostałych prób i trafia do wspólnego audit logu. Próby i raporty są indeksowane po repozytorium, egzaminie i użytkowniku, więc zwykły odczyt nie skanuje całego store.

`chemdisk-exams` przechowuje odpowiedzi i wyniki niezależnie od przełącznika pasków postępu. Globalne `OFF` centralnego postępu zatrzymuje liczenie procentu kursu i ukrywa paski, ale nie może wyłączyć autosave, czasu ani zapisu samej próby, bo egzamin przestałby działać. Zaznaczenie odpowiedzi aktualizuje ekran natychmiast i trafia do bufora bieżącej karty w `sessionStorage`; serwer pozostaje źródłem prawdy. Zmienione odpowiedzi są wysyłane jedną paczką po około 8 sekundach albo dołączane do już potrzebnego żądania przejścia, zatwierdzenia lub zakończenia. Przejście jest optymistyczne w UI, lecz ograniczenia nadal są walidowane server-side. Definicja, historia prób i zapis otwarcia są pobierane wspólnym bootstrapem. Dla 60 pytań wyświetlanych pojedynczo typowy pełny obieg bez dodatkowych obrazów, alertów i natychmiastowej informacji zwrotnej to około 62 wywołania Function (bootstrap, start, 59 przejść i submit), plus tylko te okresowe zapisy, przy których uczeń pozostawał na pytaniu dłużej niż interwał. Tryb natychmiastowy dodaje po jednym zatwierdzeniu na sprawdzone pytanie. Dokładny koszt zależy od konfiguracji, bieżącego planu Netlify i zachowania ucznia.

### Endpointy egzaminacyjne

- `GET|POST /.netlify/functions/exam` — publiczna definicja, obraz, start/wznowienie, autosave, bezpieczne zatwierdzenie pojedynczej odpowiedzi, nawigacja, event, submit i wynik własnej próby;
- `GET|DELETE /.netlify/functions/admin-exams` — raport globalny, raport użytkownika/próby, odwołania oraz administracyjny reset;
- `GET|POST|PUT|DELETE /.netlify/functions/content-library` — istniejący chroniony przepływ listy, odczytu, zapisu/publikacji i usuwania `exam.json` oraz banku.

Exam Engine i Media Manager nie dodają nowych zmiennych środowiskowych. Nie implementują AI ani nie przedstawiają zdarzeń przeglądarki jako niezawodnego proctoringu.

## AI Provider Manager

Zakładka **Panel administratora → AI / Modele** zarządza wieloma konfiguracjami Google Gemini i OpenAI. Przy tworzeniu formularz pokazuje od razu trzy kroki: dostawca i model, klucz API oraz **Zapisz konfigurację i klucz**. Jedno zatwierdzenie zapisuje metadane i sekret w oddzielnych magazynach. Każda konfiguracja ma stabilne `aiConfigId`, nazwę, opis, dostawcę, ręcznie wpisany identyfikator modelu, stan testu i status klucza. Przycisk **Pobierz modele** odczytuje bieżącą listę bezpośrednio od dostawcy, ale nie blokuje ręcznego użycia nowego modelu. Jedna konfiguracja jest domyślna, a chat, przyszłe sprawdzanie AI, formularze AI oraz ogólna grupa innych/przyszłych modułów mogą mieć własny override. Nierozpoznana nazwa modułu korzysta z przypisania **Inne / przyszłe moduły**, a bez niego z konfiguracji domyślnej.

Metadane znajdują się w store `chemdisk-ai-config`, a wartości kluczy w osobnym `chemdisk-ai-secrets`. Odczyt administracyjny zwraca wyłącznie `secretConfigured` oraz cztery ostatnie znaki zapisane podczas zmiany klucza — Function nie pobiera pełnego sekretu tylko po to, aby go zamaskować. Utworzenie i usunięcie konfiguracji, zmiana modelu, klucza, domyślnej konfiguracji, routingu oraz test połączenia trafiają do audit logu bez wartości sekretów.

Centralny `netlify/ai-router.js` wybiera konfigurację modułu, pobiera sekret wyłącznie server-side i wywołuje adapter. Adaptery Gemini i OpenAI mają wspólne operacje wysyłania, testowania, pobierania modeli, normalizacji zużycia oraz błędów. Rozszerzenie o kolejnego dostawcę wymaga dodania adaptera, a nie zmiany kodu przeglądarki. Obecny chat korzysta z routingu `chat`. Klucze `GEMINI_API_KEY` i `OPENAI_API_KEY` tworzą pełnoprawne pozycje **Gemini (ENV)** i **OpenAI (ENV)**, które można przypisać do czatu również obok konfiguracji utworzonych w panelu. Identyfikatory `env-gemini` i `env-openai` są zarezerwowane. Niekompletna konfiguracja z panelu nie przełącza się cicho na innego dostawcę ani ENV; automatyczny fallback działa tylko wtedy, gdy został jawnie ustawiony.

Test połączenia wykonuje minimalny odczyt wybranego modelu po stronie serwera. Osobno rozpoznaje: działające połączenie, błędny klucz, brak uprawnienia, niedostępny model, chwilowy limit ruchu, brak salda/limitu rozliczeniowego, timeout i awarię dostawcy. Dzięki temu brak środków OpenAI nie jest już przedstawiany jako chwilowe przeciążenie. Zwykły kursant nie ma dostępu do endpointu `/.netlify/functions/admin-ai`; wszystkie mutacje wymagają aktualnej kanonicznej sesji administratora i żądania JSON same-origin.

## Centralne limity i usage AI

Każde faktyczne wywołanie dostawcy — generowanie, test połączenia i pobranie listy modeli — przechodzi przez router, atomową rezerwację limitu, adapter i zakończenie wpisu usage. Otwieranie UI, pobranie ustawień oraz raportów nie jest requestem AI. Router rozpoznaje serwerowo `userId`, stabilne `moduleId`, `aiConfigId`, dostawcę i model; klient nie wybiera użytkownika, dla którego ma zostać naliczone użycie.

Zakładka **Panel administratora → AI Limity** obsługuje równoczesne limity godzinowe, dzienne, tygodniowe, miesięczne i lifetime dla:

- globalnych requestów, tokenów wejścia, wyjścia i łącznych oraz szacowanego kosztu;
- domyślnego użytkownika i jego trybu `inherit`, `custom`, `unlimited` albo `disabled`;
- stabilnego modułu per użytkownik, np. `chat`, `aiGrader`, `aiForms` lub własnego ID;
- całego dostawcy;
- konfiguracji globalnie oraz konfiguracji per użytkownik.

Puste pole oznacza brak limitu, a `0` blokuje dany zakres od razu. Wszystkie aktywne reguły obowiązują jednocześnie. Przykładowo **Domyślnie dla użytkownika: 20/h** i **OpenAI (ENV) per użytkownik: 5/h** pozwalają temu samemu użytkownikowi na pięć wywołań tej konfiguracji; szóste blokuje warstwa konfiguracji, mimo że w puli bazowej zostało jeszcze 15. Tryb użytkownika **Własne limity** zastępuje tylko limit bazowy, **Bez limitu użytkownika** pomija warstwy per-user, a wspólne pule globalne/dostawcy/konfiguracji nadal działają. Rezerwacja requestu oraz maksymalnego budżetu tokenów używa silnego odczytu Netlify Blobs i warunkowego zapisu ETag/CAS. Dzięki temu równoległe żądania nie omijają limitu. Providerowe `429`, awaria, nieprawidłowy klucz oraz kontrolowane limity ChemDisk mają różne kody. Normalne przekroczenie limitu zwraca `429`, a `AI_DISABLED_FOR_USER` — `403`, nie `500`.

Fallback jest wyłącznie jawny: w polityce konkretnego `aiConfigId` można wskazać drugą konfigurację. Router nie wykonuje samoczynnego przełączenia. Każdy rzeczywisty call — także nieudany primary oraz późniejszy fallback — jest osobnym requestem, a nowa konfiguracja przechodzi własne limity przed wywołaniem.

Cennik nie jest zaszyty w kodzie. Administrator wpisuje osobno cenę wejścia i wyjścia za milion tokenów dla konfiguracji. ChemDisk zapisuje `estimatedCostMicros` (milion mikrojednostek = jedna jednostka wybranej waluty). Gdy udany call nie zwraca potrzebnego podziału tokenów, koszt jest liczony konserwatywnie z rezerwacji wejścia i maksymalnego wyjścia; przy aktywnym limicie kosztu bez cennika request jest bezpiecznie odrzucany.

Store `chemdisk-ai-limit-config` zawiera politykę limitów, strefę czasową, progi ostrzeżeń, cenniki, fallbacki i audyt. Store `chemdisk-ai-usage` zawiera agregaty globalne i per-user. Dla każdego okresu utrzymuje sumy total/module/provider/config/model, a szczegółowy log globalny jest ograniczony do 300 wpisów i nie zawiera promptu. Retencja agregatów jest ograniczona do 48 godzin, 90 dni, 26 tygodni, 18 miesięcy i lifetime. Rezerwacje starsze niż 10 minut zwalniają zarezerwowane tokeny. Ręczny reset czyści dokument użytkownika, nie fałszuje historycznych sum globalnych, i trafia do audytu.

Raport pokazuje requesty, sukcesy, błędy, input/output/total tokens, średnią tokenów na request i szacowany koszt dla dostawców, modeli, konfiguracji, modułów i użytkowników. Widok użytkownika obejmuje godzinę, dzień, tydzień, miesiąc i lifetime oraz szczegóły warstw. Tabela użytkowników łączy wszystkie konta Identity z ich użyciem AI, obsługuje wyszukiwanie i doładowuje kolejne wiersze partiami. Jeśli administrator włączy ustawienie widoczności, chat pobiera z `GET /.netlify/functions/ai-usage` wyłącznie własne liczniki oraz pozostały limit.

Nowe endpointy:

- `GET|PUT|POST /.netlify/functions/admin-ai-usage` — ustawienia, raport, audyt i potwierdzony reset użytkownika; wyłącznie administrator;
- `GET /.netlify/functions/ai-usage` — wyłącznie własne użycie zalogowanego kursanta;
- zwykłe wywołanie modelu nadal wykonuje `POST /.netlify/functions/chat`, ale limitowanie i zapis realizuje centralny router.

## Landing Page Builder

Studio zawiera osobny **Landing Page Builder** pod `/members/module/studio/landing/`. Administrator układa sześć stabilnych sekcji strony głównej, zmienia ich kolejność, widoczność, tekst, obraz HTTPS/lokalny, CTA, kolory, logo oraz podstawowe metadane SEO. **Zapisz draft** nie wpływa na stronę publiczną. **Opublikuj** po potwierdzeniu zapisuje osobną wersję publiczną w store `chemdisk-landing`; `public/index.html` pozostaje wersją awaryjną, jeśli store lub Function są niedostępne.

Przycisk **Wybierz / dodaj z GitHuba** otwiera bibliotekę plików w osobnym publicznym repo. Upload przechodzi przez funkcję administracyjną wyłącznie w chwili dodawania pliku. Po zapisie edytor zwraca niezmienny URL jsDelivr przypięty do SHA commita, a zwykłe wyświetlanie logo i obrazów odbywa się bezpośrednio z CDN, bez wywołania Function. Konfiguracja:

```dotenv
GITHUB_SITE_ASSETS_TOKEN=github_pat_TOKEN_TYLKO_DO_REPO_ASSETOW
GITHUB_SITE_ASSETS_DIRECTORY=
```

Repozytorium `Kuczis-Media/logo` i gałąź `main` są celowo stałe, aby biblioteka logo oraz favicon wszystkich stron zawsze używały tego samego źródła. Repo musi pozostać publiczne. Token fine-grained powinien obejmować tylko to repo i uprawnienie **Contents: Read and write**. Token pozostaje po stronie Netlify; przeglądarka otrzymuje tylko nazwę repo, listę plików i publiczne adresy CDN. `GITHUB_SITE_ASSETS_DIRECTORY` można ustawić np. na `branding`, aby trzymać zarządzane pliki w jednym folderze; favicon pozostaje w katalogu głównym pod `benzene-ring.svg`.

Edytor ma przełącznik podglądu desktop/mobile, skrót `Ctrl/Cmd+S`, lokalne odzyskiwanie niezapisanego draftu, przywracanie wersji opublikowanej, wykrywanie konfliktu równoczesnej edycji oraz timeouty zapisu. Link GitHub w formacie `blob` albo `raw` wklejony do pola obrazu jest normalizowany do jsDelivr.

### Kolory formularza i ograniczenie wywołań

W **Studio → Landing Page Builder → Kontakt → Formularz — tło pól i kolory** ustawisz osobno tło formularza, tło pól, tekst, obramowanie, wyróżnienie aktywnego pola i etykiety. Skrót **Edytuj kolory pól formularza na stronie głównej** od razu otwiera te ustawienia. Każdy kolor ma wybór wizualny i kod `#RRGGBB`, a próbka pokazuje efekt bez wywołania serwera. Ustawienia dotyczą formularza na landingu, nie formularzy wewnątrz kursu. **Użyj palety** usuwa nadpisanie; domyślne tło pól pochodzi z koloru powierzchni, a nie z tła całej strony. Po **Opublikuj** kolory są częścią publicznego modelu, również przy eksporcie HTML.

- Publiczny wybór źródła landingu i publikacja mają 5-minutowy cache przeglądarki; działa on także pomiędzy kartami i stronami platformy. Błąd sieci nie powoduje próby na każdej kolejnej stronie — ponowienie następuje po wygaśnięciu cache. Brak dostępu do localStorage nie blokuje strony.
- Endpoint publicznego landingu ma 5-minutowy durable cache CDN. Łącznie z cache przeglądarki zmiana w trybie publikacji na platformie może być widoczna u innych odwiedzających z opóźnieniem do około 10 minut przy kolejnym otwarciu strony. Builder aktualizuje lokalną kopię autora po udanej publikacji. Otwarta strona nie odpytuje serwera cyklicznie.
- Cennik wczytuje się automatycznie, a zweryfikowana publiczna oferta jest współdzielona w localStorage przez 5 minut. Odczyt nie wysyła sesji ani tokena. Istniejący cache CDN może dodatkowo opóźnić odświeżenie oferty; utworzenie płatności zawsze sprawdza aktualną cenę i dostępność na serwerze.
- Lekcja zapisuje stan lokalnie od razu. Robocze zapisy postępów łączą się po 5 sekundach przerwy, z maksymalnym oczekiwaniem 15 sekund przy ciągłej edycji. Zatwierdzenie kroku i ukończenie nie czekają na ten timer. Ukrycie lub opuszczenie strony wysyła oczekującą paczkę przez `keepalive` (zamknięcie przeglądarki lub awaria sieci nadal nie gwarantują dostarczenia).
- Egzamin zachowuje odpowiedzi lokalnie od razu i wysyła roboczą paczkę co najwyżej raz na 15 sekund zamiast 8 sekund. Jawny zapis, nawigacja, oddanie pracy i zdarzenia egzaminu mogą wysłać ją wcześniej. Quiz nadal zapisuje odpowiedzi przy odpowiednich działaniach ucznia; zabezpieczenia sesji i kontroli dostępu nie zostały spowolnione.

To ograniczenia odczytów i zapisów w kodzie, nie pomiar oszczędności na koncie. Przy analizie Netlify porównuj oddzielnie Functions compute, web requests i bandwidth: odpowiedź z CDN nie musi uruchamiać Function, ale samo żądanie i transfer też mogą być rozliczane. Animacja modelu 3D korzysta z zewnętrznych plików Spline, a jej ruch nie wywołuje Functions.

### Generator `.env` bez dodatkowych Functions

Administrator otwiera **Studio → Generator .env** albo **Panel administratora → Materiały → Otwórz generator .env**. Narzędzie udostępnia gotową listę zmiennych ChemDisk, własne wiersze, lokalny import istniejącego pliku, wyszukiwarkę, ukrywanie sekretów, kopiowanie pełnej zawartości lub samych nazw i pobranie pliku `.env`.

Generator działa wyłącznie w przeglądarce: nie wywołuje Function, nie zapisuje wpisanych sekretów w `localStorage` i nie wysyła ich do serwera. Fine-grained PAT GitHuba nie wymaga płatnego planu. Ograniczenie planu może dotyczyć automatycznego zapisu sekretu w Netlify; na planie bez tej funkcji skopiuj wygenerowane nazwy i wartości ręcznie do **Project configuration → Environment variables**, a potem uruchom deploy. Pobrany `.env` pozostaje sekretem i nie może zostać zacommitowany.

Builder i runtime nie przyjmują dowolnego HTML. Serwer ogranicza pola i długości, akceptuje tylko kolory `#RRGGBB`, bezpieczne ścieżki/kotwice lub HTTPS, a przeglądarka wstawia treść przez `textContent`. Draft jest dostępny tylko przez `admin-landing` po kanonicznej kontroli roli administratora; publiczny endpoint `landing` zwraca wyłącznie opublikowany model.

Publiczny model landingu ma 5-minutowy durable cache Netlify CDN z `must-revalidate`, natomiast endpointy administracyjne pozostają `no-store`. Studio pobiera repozytoria i pięć typów materiałów jednym żądaniem bootstrap zamiast sześciu osobnych wywołań, współdzieli trwające identyczne odczyty i przez 30–60 sekund wykorzystuje pamięciowy cache przypisany do aktualnego użytkownika. Zapis lub usunięcie unieważnia cache, a ręczne **Odśwież** zawsze go omija. Prywatne obrazy mają osobny cache Blob, są pobierane najwyżej po cztery równolegle i ładują się dopiero w pobliżu viewportu; lekcja przygotowuje maksymalnie cztery obrazy wyłącznie z następnego slajdu i wyłącza prefetch przy `saveData` lub 2G. Brakujący plik i `429` nie są bezcelowo ponawiane, a chwilowy błąd sieci ma najwyżej jedną krótką próbę ponowną. Publiczne linki GitHub w Landing Builderze są zamieniane na jsDelivr, a podgląd nie ustawia ponownie niezmienionego `src`. Functions są pakowane przez `esbuild`, co ogranicza rozmiar artefaktów i koszt zimnego startu bez zmiany ich API.

## Bezpieczeństwo i ograniczenia materiałów

- Role są odczytywane wyłącznie z `app_metadata`; pola profilu nie mogą przyznać dostępu.
- `/members/*` otrzymuje nagłówki `no-store`, `noindex`, `nosniff` i ochronę przed osadzaniem ChemDisk w obcej stronie.
- Funkcja chatu wymaga zalogowanego użytkownika z aktualnym dostępem, ma limity wywołań, czasu odpowiedzi, długości wyniku, historii i załączników oraz nie zwraca diagnostyki OpenAI ani Gemini. Przeglądarka przesyła obrazy JPEG, PNG, WebP lub GIF do około 3 MB.
- Identyfikatory i pełne linki wejściowe są walidowane względem oczekiwanych domen Google lub YouTube.
- Moduły Forms, Slides, PDF, Film i YT po odczytaniu parametrów zapisują stan w `sessionStorage` i czyszczą zapytanie z paska adresu. Odświeżenie działa w tej samej karcie, ale czysty adres bez ID nie przeniesie materiału do nowej karty lub przeglądarki.
- Wartość `internal` formularza kontaktowego jest stała w interfejsie, lecz pochodzi z adresu URL. Nie używaj jej jako zaufanego identyfikatora ceny, uprawnień ani użytkownika.

Maski, ukrywanie przycisków, blokada menu kontekstowego i ograniczone kontrolki mają jedynie utrudniać przypadkowe pobranie lub przejście do źródła. **Nie są DRM.** Użytkownik mający dostęp do materiału może użyć narzędzi przeglądarki, ruchu sieciowego, funkcji dostawcy albo zrzutu ekranu. Realną granicą dostępu są role aplikacji, uprawnienia udostępniania Google/YouTube oraz ewentualny backend wydający chronione pliki.

## Testy i kontrola przed deployem

```bash
npm test
npm run build
```

Oba skrypty uruchamiają `node --test` przez `scripts/run-tests.cjs`, w osobnym procesie bez produkcyjnych ENV. Runner przepuszcza tylko ustawienia systemowe potrzebne do wykonania testów; nie przekazuje konfiguracji dostawcy, tokenów Gitei/GitHuba, AI, Stripe ani Netlify. Testy ustawiają własne fikcyjne dane i korzystają z atrap usług. Nie zmienia to zmiennych Netlify ani konfiguracji opublikowanych Functions. Do wybranych plików użyj np. `npm test -- tests/gitea-provider.test.js`; bezpośrednie `node --test` omija tę izolację i nie powinno być używane w środowisku z sekretami.

Przed testami `npm run build` i `npm test` tworzą bundle frontendu przez `scripts/build-dashboard.cjs`. Jest to wymagane na czystym checkoutcie: katalog `public/assets/build` jest generowany i ignorowany przez Git, a testy weryfikują wszystkie lokalne odsyłacze HTML do zasobów. Testy obejmują między innymi hooki Identity, odporność sesji po uśpieniu i w wielu kartach, funkcje administracyjne, Stripe i księgi Blobs, bezpieczny odczyt i zapis prywatnych repo GitHub/Gitea, parser dashboardu, centralny postęp, wspólny motyw, media, kalkulator klasyczny, parser chemiczny Atonom, odtwarzacz lekcji oraz modele Studio i Exam Engine. Netlify wykonuje tę samą bramkę `npm run build` przed publikacją katalogu `public`; błąd bundlowania lub testu blokuje wdrożenie.

Opcjonalna kontrola składni wszystkich plików JavaScript:

```bash
find public netlify -type f \( -name '*.js' -o -name '*.mjs' \) -exec node --check {} \;
```

Przed publikacją wykonaj też krótki test ręczny:

1. konto bez roli jest odsyłane do logowania;
2. każda z używanych ról otwiera dashboard i właściwe materiały;
3. drugie logowanie na innym urządzeniu wylogowuje pierwszą przeglądarkę po kontroli sesji, ale kilka kart tego samego profilu pozostaje zalogowanych;
4. po uśpieniu i wybudzeniu komputera chwilowy brak sieci nie wylogowuje poprawnej sesji, a faktycznie zastąpiona sesja zostaje zamknięta;
5. wygasła rola czasowa blokuje czat i panel;
6. zmiana imienia i nazwiska pozostaje po odświeżeniu;
7. administrator widzi listę kont, a zwykły kursant nie widzi panelu administracyjnego;
8. zmiana roli w panelu działa po ponownym logowaniu i nie przedłuża czasu przy samej zmianie nazwiska;
9. formularz kontaktowy pojawia się w Netlify Forms, a administrator może odczytać i po potwierdzeniu usunąć testowe zgłoszenie;
10. edycja dashboardu działa po odświeżeniu i można ją przywrócić do wersji z wdrożenia;
11. zwijanie sidebara jest zapamiętane, a aktywny dział zmienia się od razu po kliknięciu i podczas przewijania;
12. przełączenie motywu dashboardu jest respektowane przez każdą aplikację modułu, stronę zakupu i status dostępu;
13. kalkulator klasyczny przyjmuje cyfry, operatory, `Enter`, `=`, `Backspace`, `Delete` i `Escape` z klawiatury;
14. BitPaper importuje i eksportuje JSON, zapisuje PNG oraz respektuje limity planszy i obrazu;
15. Atonom poprawnie buduje kilka rodzin związków, pokazuje błąd dla nieobsługiwanej nazwy i kopiuje link z `formula`;
16. Studio wczytuje aktywny dashboard, zachowuje lokalny draft, wykrywa konflikt `etag` i publikuje poprawny układ;
17. Lesson Builder importuje istniejącą lekcję, odtwarza jej bloki i quizy, pozwala pobrać `.md` ręcznie oraz generuje plik działający w module `lesson`;
18. blok wzoru zachowuje reakcję ze strzałką, temperaturą i katalizatorem oraz renderuje potęgi, indeksy, ułamki i pierwiastki w Studio i odtwarzaczu;
19. kafelek z linkiem zachowuje tytuł, opis, ikonę, kolor i ustawienie nowej karty, a niebezpieczny protokół jest odrzucany;
20. każdy wariant przejścia slajdu działa w Studio i odtwarzaczu, `none` wyłącza animację, a ograniczenie ruchu z systemu jest respektowane;
21. klocek AI przekazuje treść slajdu do pierwszego pytania, obsługuje opcjonalny prompt i nie umieszcza treści w URL;
22. klocki białej tablicy i BitPaper otwierają właściwy moduł, a BitPaper przyjmuje bezpieczną nazwę planszy;
23. Prompt Builder importuje, waliduje i eksportuje pliki `.json` oraz wielopunktowe `.txt`;
24. administrator tworzy testowy plik lekcji lub promptu w GitHubie, aktualizuje go po ponownym wczytaniu, a konflikt SHA nie nadpisuje nowszej wersji;
25. usunięcie testowego pliku wymaga potwierdzenia i tworzy commit widoczny w historii repo;
26. zakładka **Materiały** pokazuje poprawne repo i liczby plików, wyszukiwarka Studio widzi lekcje, prompty i egzaminy, a odtwarzacze otwierają treść z właściwego repo;
27. po zmianie pliku w repo materiałów nowa wersja jest widoczna bez deployu aplikacji po wygaśnięciu 20-sekundowego cache’u;
28. linki Google i YouTube działają na docelowej domenie i przy docelowych ustawieniach udostępniania;
29. zwykły użytkownik nie może podać cudzego `userId`, odczytać cudzego postępu ani wywołać `admin-progress`;
30. otwarcie zwykłego materiału innego niż lekcja i egzamin daje 100%, lekcja wylicza procent z kroków, egzamin z odpowiedzi, a otwarcie kontenera nie zalicza jego dzieci;
31. ustawienia `ON/OFF/INHERIT` i wagi dają hierarchiczny procent sekcji, działu i kursu bez osobnych flag agregacji;
32. wyłączenie globalnego postępu zachowuje historię, a osobny przełącznik otwarć działa zgodnie z ustawieniem;
33. lekcja sekwencyjna odrzuca skok do zablokowanego kroku, natomiast nadpisanie użytkownika działa;
34. film YT nie zalicza przewiniętego fragmentu, PDF jest opisany jako nawigacyjny, a quiz pokazuje osobno postęp i wynik;
35. reset i ręczna zmiana administratora pojawiają się w audit logu;
36. aktywna próba nie zwraca klucza, obce `attemptId` daje 404, a timer ukryty nadal kończy próbę server-side;
37. Dashboard → egzamin → autosave → odświeżenie → wynik → raport działa end-to-end;
38. niezaliczony wymagany egzamin blokuje lekcję, a wynik spełniający lokalny próg ją odblokowuje.
