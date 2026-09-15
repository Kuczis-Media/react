# ChemDisk — kompletna instrukcja od zera

Ta instrukcja jest przeznaczona dla osoby, która nie musi znać programowania. Prowadzi od założenia kont, przez wdrożenie aplikacji, aż do codziennego dodawania lekcji, użytkowników i płatności.

Stan instrukcji: 16 sierpnia 2026 r. Nazwy pojedynczych przycisków w GitHubie, Netlify, Google lub Stripe mogą z czasem zostać lekko zmienione, ale opisane miejsca i zasady pozostają takie same.

## 1. Najważniejsze pojęcia

W tej aplikacji występują trzy różne rodzaje kont i dwa różne rodzaje repozytoriów.

### Konta

1. **Konto GitHub** — służy do przechowywania kodu aplikacji oraz osobnych plików lekcji i promptów.
2. **Konto Netlify** — publikuje stronę, uruchamia funkcje serwerowe, obsługuje logowanie, formularze i magazyn danych.
3. **Konto Stripe** — obsługuje płatności.
4. **Konto Google** — służy do utworzenia klucza Gemini oraz opcjonalnie do przechowywania Prezentacji, PDF-ów i Formularzy Google.

Kursant nie musi mieć konta GitHub, Netlify ani Stripe. Kursant ma zwykłe konto utworzone w systemie logowania strony.

### Repozytoria

- **Repozytorium aplikacji** zawiera kod ChemDisk. Otrzymujesz do niego od właściciela oprogramowania link GitHub. W tej instrukcji nie podajemy konkretnego adresu, ponieważ właściciel może go zmienić.
- **Repozytorium materiałów** tworzysz osobno. Zawiera lekcje `.md`, prompty `.json`/`.txt`, bank pytań, egzaminy, natywne prezentacje i ich obrazy. Może być prywatne.
- Można podłączyć jedno albo kilka repozytoriów materiałów.
- Obrazy można trzymać prywatnie razem z materiałem w `photos/` albo współdzielić z wielu materiałów przez `assets/shared/`. Starsze publiczne adresy HTTPS w lekcjach nadal działają.

### Co oznacza deploy

**Deploy** to opublikowanie nowej wersji kodu aplikacji na Netlify.

- Zmiana kodu aplikacji wymaga nowego deployu.
- Dodanie, poprawienie lub usunięcie lekcji albo promptu w repozytorium materiałów nie wymaga deployu aplikacji.
- Opublikowanie dashboardu w Studio również nie wymaga deployu.
- Zmiana klucza lub zmiennej środowiskowej wymaga uruchomienia nowego deployu, aby funkcje dostały nową konfigurację.

## 2. Jak działa całość

| Element | Do czego służy | Czy wymaga klucza |
| --- | --- | --- |
| GitHub — repo aplikacji | Przechowuje kod ChemDisk i uruchamia automatyczne deploye | Nie dla aplikacji; potrzebny jest dostęp konta GitHub |
| GitHub — repo materiałów | Przechowuje prywatne lekcje, prompty i egzaminy | Tak, fine-grained token |
| Netlify Hosting | Publikuje stronę z katalogu `public` | Nie |
| Netlify Functions | Bezpiecznie łączy stronę z Gemini, GitHubem i Stripe | Korzysta z kluczy zapisanych w Netlify |
| Netlify Identity | Rejestracja, logowanie, reset hasła, użytkownicy i role | Nie |
| Netlify Forms | Formularz publiczny i kontakt kursanta | Nie |
| Netlify Blobs | Aktywny dashboard, cennik i historia dostępu | W tej aplikacji używa tokenu Netlify |
| Gemini API | Asystent AI | Tak, `GEMINI_API_KEY` |
| Stripe | Checkout i płatności za czas dostępu | Tak, klucz tajny i sekret webhooka |
| Google Drive / Slides / Forms | PDF-y, prezentacje, filmy Drive i formularze | Nie, ale pliki muszą mieć prawidłowe udostępnianie |
| YouTube | Filmy w dashboardzie i lekcjach | Nie |
| NumWorks | Kalkulator naukowy | Nie |
| tldraw | Zewnętrzna biała tablica | Nie |
| ATONOM | Lokalne modele związków chemicznych | Nie |

Pozostałe połączenia techniczne, które nie wymagają własnego klucza:

- `identity.netlify.com` dostarcza używany przez aplikację interfejs Netlify Identity;
- `cdn.jsdelivr.net` dostarcza część ikon i publicznych grafik;
- `cdnjs.cloudflare.com` dostarcza Font Awesome na stronie publicznej;
- `fonts.googleapis.com` dostarcza używane kroje pisma;
- MathJax z jsDelivr wyświetla wzory matematyczne i reakcje chemiczne w czacie, kreatorze oraz lekcjach;
- `raw.githubusercontent.com` może dostarczać publiczne obrazy użyte w lekcjach;
- publiczna strona ATONOM jest osobnym odnośnikiem na stronie głównej, a chroniony moduł ATONOM znajduje się również lokalnie w ChemDisk.

Awaria CDN albo zablokowanie go przez rozszerzenie przeglądarki może czasowo ukryć ikonę, font, wzór lub zewnętrzny moduł, ale nie zmienia kont i ról użytkowników.

## 3. Kolejność pierwszej konfiguracji

Najbezpieczniej wykonać czynności w tej kolejności:

1. Załóż konto GitHub i uzyskaj dostęp do repozytorium aplikacji.
2. Załóż konto Netlify i wdroż projekt z GitHuba.
3. Włącz Netlify Identity.
4. Utwórz pierwsze konto administratora.
5. Utwórz prywatne repozytorium materiałów.
6. Utwórz wąski token GitHub tylko do repozytorium materiałów.
7. Dodaj zmienne GitHub do Netlify.
8. Utwórz klucz Gemini i dodaj go do Netlify.
9. Utwórz token Netlify i dodaj go do Netlify.
10. Utwórz sandbox Stripe, klucz testowy i webhook.
11. Wykonaj ponowny deploy.
12. Przetestuj logowanie, administratora, lekcję, czat, formularz i płatność.
13. Dopiero po pełnych testach przełącz Stripe na prawdziwe płatności.

## 4. Konto GitHub i dostęp do kodu

### 4.1. Założenie konta

1. Otwórz [stronę rejestracji GitHub](https://github.com/signup).
2. Podaj e-mail, utwórz hasło i nazwę użytkownika.
3. Potwierdź adres e-mail.
4. Włącz uwierzytelnianie dwuskładnikowe, czyli 2FA. Jest to szczególnie ważne, ponieważ konto będzie miało dostęp do kodu i materiałów.

### 4.2. Otrzymanie aplikacji

1. Właściciel oprogramowania przekazuje Ci link do repozytorium aplikacji.
2. Jeśli repozytorium jest prywatne, właściciel musi również nadać Twojemu kontu dostęp.
3. Zaakceptuj ewentualne zaproszenie wysłane przez GitHub.
4. Otwórz otrzymany link po zalogowaniu.
5. Jeżeli widzisz listę plików, dostęp działa.

Nie wpisuj linku właściciela na stałe do tej instrukcji. W Netlify wybierzesz repozytorium z listy udostępnionej Twojemu kontu.

## 5. Utworzenie strony na Netlify

### 5.1. Konto Netlify

1. Otwórz [Netlify](https://app.netlify.com/).
2. Kliknij rejestrację.
3. Najwygodniej wybierz logowanie przez GitHub.
4. Potwierdź dostęp Netlify do konta GitHub.
5. Jeśli Netlify pyta o utworzenie zespołu, możesz na początku utworzyć własny zespół.

### 5.2. Import repozytorium aplikacji

1. Na głównym ekranie Netlify kliknij **Add new project**.
2. Wybierz **Import an existing project**.
3. Wybierz **GitHub**.
4. Zezwól aplikacji Netlify na odczyt repozytorium aplikacji.
5. Wybierz repozytorium otrzymane od właściciela oprogramowania.
6. Jeżeli go nie widzisz:
   - kliknij konfigurację dostępu GitHub;
   - przy aplikacji Netlify wybierz dostęp do wskazanego repozytorium;
   - upewnij się, że zaakceptowano zaproszenie do prywatnego repozytorium;
   - wróć do Netlify i odśwież listę.
7. Ustaw lub sprawdź:
   - **Build command:** `npm run build`
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
8. Ustawienia te znajdują się już w `netlify.toml`, więc Netlify powinno je wykryć automatycznie.
9. Kliknij **Publish** albo **Deploy**.
10. Poczekaj, aż deploy otrzyma status **Published**.

Netlify nada stronie tymczasowy adres zakończony `.netlify.app`. Własną domenę można dodać później w **Domain management → Production domains**.

### 5.3. Automatyczne aktualizacje kodu

Po połączeniu z GitHubem każdy push lub commit do używanej gałęzi repozytorium aplikacji uruchamia nowy deploy. Materiały z osobnego repo nie uruchamiają deployu i nie muszą go uruchamiać.

Jeżeli Netlify jest połączone bezpośrednio z repozytorium właściciela, jego nowy commit na używanej gałęzi uruchomi deploy automatycznie. Jeżeli utworzysz własny fork lub osobną kopię repozytorium, późniejsze zmiany właściciela nie pojawią się w niej samoczynnie — trzeba je scalić do swojej kopii.

### 5.4. Własna domena

1. W Netlify otwórz **Domain management → Production domains**.
2. Kliknij **Add a domain**.
3. Wybierz kupno domeny albo dodanie domeny posiadanej u innego operatora.
4. Przy domenie zewnętrznej przepisz rekordy DNS dokładnie według instrukcji Netlify.
5. Poczekaj na aktywację DNS i certyfikatu HTTPS.
6. Ustaw właściwy adres jako domenę główną.
7. Wyślij nowe zaproszenie testowe Identity i sprawdź, czy link prowadzi na prawidłową domenę.
8. Zaktualizuj adres endpointu Stripe, jeżeli chcesz używać własnej domeny zamiast `.netlify.app`, i skopiuj sekret tego endpointu do Netlify.

Dodanie domeny do tej samej witryny nie kopiuje ani nie usuwa użytkowników, Forms i Blobs. Utworzenie nowej witryny Netlify jest już migracją danych.

### 5.5. Sprawdzanie deployu i powrót do starszej wersji

1. Wejdź do zakładki **Deploys**.
2. Otwórz najnowszy deploy.
3. Sprawdź, czy etap `npm run build` zakończył się powodzeniem.
4. W razie błędu otwórz log i znajdź pierwszą czerwoną informację.
5. Jeżeli nowy kod jest wadliwy, wybierz wcześniej działający deploy i użyj opcji ponownego opublikowania.

Powrót do starszego deployu kodu nie cofa automatycznie site-wide danych Blobs, historii Stripe ani commitów repozytorium materiałów.

## 6. Włączenie logowania Netlify Identity

Aplikacja ma już gotowy interfejs logowania. Nie trzeba pisać formularza ani instalować dodatkowego kodu.

1. Otwórz projekt w Netlify.
2. Wejdź w **Project configuration → Identity**.
3. Kliknij **Enable Identity**.
4. Otwórz ustawienia rejestracji.
5. Wybierz jeden z trybów:
   - **Invite only** — zalecany dla zamkniętego kursu; konto powstaje po zaproszeniu;
   - **Open** — każdy może utworzyć konto, ale bez roli i tak nie otworzy materiałów.
6. Pozostaw potwierdzanie e-maila włączone, jeśli chcesz ograniczyć fałszywe konta.
7. Wykonaj nowy deploy, jeśli Netlify o to poprosi.

Oficjalna instrukcja: [włączenie Netlify Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/).

## 7. Pierwszy administrator

Pierwszego administratora trzeba nadać w Netlify. Następnych administratorów można już tworzyć z panelu ChemDisk.

1. W Netlify przejdź do **Project configuration → Identity → Users**.
2. Zaproś swój adres e-mail.
3. Otwórz wiadomość z zaproszeniem.
4. Wejdź w link i ustaw hasło mające co najmniej 10 znaków.
5. Wróć do listy użytkowników Identity.
6. Otwórz swoje konto.
7. W edycji ról lub `app_metadata` dodaj rolę:

   ```json
   {
     "roles": ["admin"]
   }
   ```

8. Zapisz.
9. Wyloguj się ze strony ChemDisk i zaloguj ponownie.
10. W bocznym menu powinien pojawić się **Panel administratora** i wejście do **Studio treści**.

Jeśli Netlify pokazuje osobne pole **Roles**, wpisz po prostu `admin`; nie trzeba wtedy ręcznie edytować JSON. Oficjalna dokumentacja potwierdza, że role można ustawiać w szczegółach użytkownika: [Identity w Functions i role](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/).

Nie wpisuj ról do `user_metadata`. Uprawnienia aplikacji pochodzą wyłącznie z `app_metadata`.

## 8. Wszystkie zmienne i klucze

### 8.1. Zmienne, które trzeba skonfigurować

| Zmienna | Czy obowiązkowa | Skąd ją wziąć | Do czego służy |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Opcjonalny fallback AI | Google AI Studio | Awaryjne wywołania Gemini, gdy panel nie ma kompletnej konfiguracji |
| `GEMINI_MODEL` | Opcjonalna | Identyfikator modelu Google | Model fallbacku Gemini; domyślnie `gemini-2.5-flash` |
| `OPENAI_API_KEY` | Opcjonalny fallback AI | OpenAI Platform | Awaryjne wywołania OpenAI, gdy nie ma konfiguracji Gemini |
| `OPENAI_MODEL` | Opcjonalna | Identyfikator modelu OpenAI | Model fallbacku OpenAI; domyślnie `gpt-4.1-mini` |
| `GITHUB_CONTENT_TOKEN` | Dla repo materiałów | GitHub fine-grained PAT | Odczyt, zapis i usuwanie lekcji/promptów |
| `GITHUB_CONTENT_REPOSITORY` | Przy jednym repo | Właściciel i nazwa repo GitHub | Wskazuje repo, np. `login/nazwa-repo` |
| `GITHUB_CONTENT_REF` | Zalecana | Nazwa gałęzi | Zwykle `main` |
| `GITHUB_CONTENT_ROOT` | Opcjonalna | Własny układ repo | Pusty albo np. `materials` |
| `GITHUB_CONTENT_REPOSITORIES` | Przy wielu repo | Tworzysz samodzielnie jako JSON | Lista repozytoriów do selektora |
| `GITHUB_CONTENT_TOKEN_DOWOLNA_NAZWA` | Opcjonalna | Osobny token GitHub | Token dla repo innego właściciela |
| `GITHUB_SITE_ASSETS_TOKEN` | Dla uploadu logo i obrazów | GitHub fine-grained PAT | Zapis do jednego publicznego repo assetów strony |
| `GITHUB_SITE_ASSETS_DIRECTORY` | Opcjonalna | Własny układ repo | Pusty katalog główny albo np. `branding` |
| `NETLIFY_API_TOKEN` | Dla Forms, Blobs i pełnego panelu admina | Konto Netlify | Dostęp serwerowy do bieżącej witryny |
| `STRIPE_SECRET_KEY` | Dla płatności | Sandbox lub live Stripe | Tworzenie i sprawdzanie Checkout |
| `STRIPE_WEBHOOK_SECRET` | Dla płatności | Endpoint webhooka Stripe | Sprawdzenie podpisu zdarzeń |

### 8.2. Zmienne ustawiane automatycznie przez Netlify

Nie twórz ich ręcznie w produkcyjnym projekcie:

| Zmienna | Znaczenie |
| --- | --- |
| `SITE_ID` | Identyfikator projektu Netlify; w interfejsie może nazywać się **Project ID** |
| `URL` | Główny adres produkcyjny strony |
| `DEPLOY_PRIME_URL` | Główny adres danego deployu |
| `DEPLOY_URL` | Adres konkretnego deployu |

`SITE_ID` wpisuje się ręcznie tylko do lokalnego pliku `.env`, jeśli uruchamiasz projekt na swoim komputerze.

### 8.3. Gdzie dodać zmienne w Netlify

1. Otwórz projekt Netlify.
2. Wejdź w **Project configuration → Environment variables**.
3. Kliknij dodanie zmiennej.
4. Wpisz nazwę, na przykład `GEMINI_API_KEY`.
5. Wklej wartość.
6. Oznacz sekret jako zawierający poufną wartość, jeśli interfejs oferuje taką opcję.
7. Zakres musi obejmować **Functions**. Na planach bez osobnego wyboru zakresu pozostaw dostępność domyślną.
8. Dla produkcyjnych sekretów wybierz kontekst **Production**.
9. Dla Deploy Preview używaj osobnych danych testowych albo nie udostępniaj tam sekretów.
10. Po dodaniu lub zmianie zmiennych uruchom **Deploys → Trigger deploy → Deploy site**.

Oficjalna instrukcja: [zmienne środowiskowe Netlify](https://docs.netlify.com/build/environment-variables/get-started/).

### 8.4. Najważniejsza zasada bezpieczeństwa

Kluczy nigdy nie wolno:

- wklejać do pliku w `public`;
- dodawać do `dashboard.md`, lekcji lub promptu;
- commitować do GitHuba;
- wpisywać w kod JavaScript działający w przeglądarce;
- wysyłać kursantom;
- pokazywać na zrzucie ekranu.

Klucz w repozytorium prywatnym również należy uznać za ujawniony. Repozytorium prywatne nie jest sejfem na sekrety.

## 9. Prywatne repozytorium lekcji i promptów

### 9.1. Utworzenie repozytorium

1. Zaloguj się do GitHuba.
2. W prawym górnym rogu kliknij **+ → New repository**.
3. Wybierz właściciela.
4. Wpisz dowolną nazwę repozytorium materiałów.
5. Wybierz **Private**.
6. Zaznacz utworzenie pliku README, aby repo nie było puste.
7. Kliknij **Create repository**.

Oficjalna instrukcja: [tworzenie repozytorium GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository).

### 9.2. Wymagana struktura

Repo powinno wyglądać tak:

```text
repozytorium-materialow/
├── catalog.json             # opcjonalny
├── lessons/
│   ├── stechiometria.md
│   └── izotopy.md
└── prompts/
    ├── korepetytor.json
    └── zestaw-promptow.txt
```

GitHub nie przechowuje pustych folderów. Aby utworzyć pierwszy folder:

1. Kliknij **Add file → Create new file**.
2. W polu nazwy wpisz `lessons/start.md`.
3. Wpisz na przykład `# Pierwsza lekcja` albo pozostaw plik pusty i później wczytaj go do Lesson Buildera.
4. Kliknij **Commit changes**.
5. Powtórz z plikiem `prompts/start.json` i wpisz poprawną treść, np.:

   ```json
   {
     "prompt": "Pomagaj uczniowi zrozumieć zadanie krok po kroku."
   }
   ```

Można też od razu utworzyć nową lekcję i prompt w Studio po podłączeniu tokenu.

### 9.3. Token GitHub ograniczony tylko do repo materiałów

Nie używaj klasycznego tokenu do całego konta. Utwórz **fine-grained personal access token** ograniczony do wybranego repozytorium.

1. Kliknij zdjęcie profilowe GitHub.
2. Wybierz **Settings**.
3. Na dole lewego menu wybierz **Developer settings**.
4. Wybierz **Personal access tokens → Fine-grained tokens**.
5. Kliknij **Generate new token**.
6. Wpisz nazwę, np. `ChemDisk materiały`.
7. Ustaw datę wygaśnięcia. Zanotuj ją w kalendarzu.
8. W **Resource owner** wybierz właściciela repozytorium materiałów.
9. W **Repository access** wybierz **Only select repositories**.
10. Wskaż wyłącznie repozytorium lub repozytoria materiałów.
11. W **Repository permissions** znajdź **Contents**.
12. Ustaw **Read and write**.
13. Pozostałe dodatkowe uprawnienia pozostaw wyłączone lub tylko domyślne.
14. Kliknij **Generate token**.
15. Natychmiast skopiuj wartość zaczynającą się zwykle od `github_pat_`.
16. Wklej ją do Netlify jako `GITHUB_CONTENT_TOKEN`.

Jeśli repo należy do organizacji, token może oczekiwać na zatwierdzenie przez administratora organizacji. Do czasu zatwierdzenia aplikacja nie odczyta plików.

Oficjalna instrukcja: [zarządzanie fine-grained tokenami GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

### 9.4. Konfiguracja jednego repozytorium

Dodaj do Netlify:

```dotenv
GITHUB_CONTENT_TOKEN=github_pat_TUTAJ_WKLEJ_TOKEN
GITHUB_CONTENT_REPOSITORY=TWOJ_LOGIN/NAZWA_REPOZYTORIUM
GITHUB_CONTENT_REF=main
GITHUB_CONTENT_ROOT=
```

Ważne:

- `GITHUB_CONTENT_REPOSITORY` nie jest drugim kluczem. Jest zwykłym adresem w formie `właściciel/repo`.
- Bez tej zmiennej sam token nie wystarczy. W panelu pojawi się wtedy „Wymaga konfiguracji”.
- `GITHUB_CONTENT_ROOT` pozostaw pusty, jeżeli foldery `lessons` i `prompts` są w katalogu głównym.
- Jeżeli foldery leżą w `materials/lessons` i `materials/prompts`, ustaw `GITHUB_CONTENT_ROOT=materials`.

### 9.5. Konfiguracja kilku repozytoriów

Ustaw `GITHUB_CONTENT_TOKEN` oraz jedną zmienną `GITHUB_CONTENT_REPOSITORIES`:

```dotenv
GITHUB_CONTENT_TOKEN=github_pat_TUTAJ_WKLEJ_TOKEN
GITHUB_CONTENT_REPOSITORIES=[{"id":"glowne","label":"Materiały główne","repository":"TWOJ_LOGIN/pierwsze-repo","ref":"main","root":"","default":true},{"id":"organiczna","label":"Chemia organiczna","repository":"TWOJ_LOGIN/drugie-repo","ref":"main","root":""}]
```

Zasady:

- całość musi być poprawnym JSON-em w jednym wierszu;
- `id` zawiera małe litery, cyfry i myślniki;
- `label` jest nazwą widoczną w selektorze;
- `repository` ma format `właściciel/repo`;
- `default: true` ustaw przy jednym repo;
- maksymalnie można skonfigurować 20 repozytoriów;
- jeden token może obejmować kilka jawnie wybranych repo tego samego właściciela.
- ustawienie `GITHUB_CONTENT_REPOSITORIES` zastępuje konfigurację pojedynczego repo z `GITHUB_CONTENT_REPOSITORY`, `GITHUB_CONTENT_REF` i `GITHUB_CONTENT_ROOT`.

Jeżeli repozytoria mają różnych właścicieli zasobów, utwórz drugi token:

```dotenv
GITHUB_CONTENT_TOKEN=github_pat_TOKEN_PIERWSZEGO_WLASCICIELA
GITHUB_CONTENT_TOKEN_SZKOLA=github_pat_TOKEN_DRUGIEGO_WLASCICIELA
GITHUB_CONTENT_REPOSITORIES=[{"id":"glowne","label":"Moje materiały","repository":"LOGIN/pierwsze-repo","default":true},{"id":"szkola","label":"Materiały szkoły","repository":"ORGANIZACJA/drugie-repo","tokenEnv":"GITHUB_CONTENT_TOKEN_SZKOLA"}]
```

Nazwa dodatkowej zmiennej tokenu musi zaczynać się od `GITHUB_CONTENT_TOKEN`.

### 9.6. Czy po dodaniu lekcji trzeba robić deploy

Nie.

1. Dodajesz lub poprawiasz plik w `lessons/`.
2. GitHub zapisuje commit w repo materiałów.
3. Aplikacja pobiera aktualną listę przez GitHub API.
4. Lista może być pamiętana najwyżej przez około 20 sekund.
5. Administrator może kliknąć odświeżenie w zakładce **Materiały**.

Deploy jest potrzebny tylko po zmianie konfiguracji `GITHUB_CONTENT_*`, a nie po zmianie plików.

### 9.7. Opcjonalny `catalog.json`

Plik pozwala dodać tytuł, opis i tagi używane przez wyszukiwarkę:

```json
{
  "assets": {
    "lessons/izotopy.md": {
      "title": "Izotopy",
      "description": "Lekcja o liczbach A i Z.",
      "tags": ["atom", "matura"]
    },
    "prompts/korepetytor.json": {
      "title": "Korepetytor chemii",
      "description": "Naprowadza ucznia bez podawania od razu wyniku.",
      "tags": ["ai", "pomoc"]
    }
  }
}
```

Plik jest opcjonalny. Bez niego aplikacja użyje nazwy pliku.

### 9.8. Obrazy w publicznym repozytorium

1. Utwórz osobne publiczne repo obrazów albo użyj istniejącego.
2. Wgraj plik przez **Add file → Upload files**.
3. Zapisz commit.
4. Otwórz obraz i wybierz widok **Raw**.
5. Skopiuj pełny adres zaczynający się od `https://`.
6. W Lesson Builderze przeciągnij **Obraz z URL** i wklej adres.

Token prywatnego repo lekcji nie pobiera obrazów. Obrazy muszą być dostępne przez publiczny HTTPS.

## 10. Dostawcy AI — Gemini i OpenAI

Aplikacja używa Gemini lub OpenAI tylko po stronie Netlify Functions. Kursant nie otrzymuje klucza, identyfikatora konfiguracji ani diagnostyki dostawcy.

### 10.1. Konfiguracja w panelu administratora

1. Otwórz dashboard jako administrator.
2. Wejdź w **Panel administratora → AI / Modele**.
3. Kliknij **Nowa konfiguracja**, wpisz nazwę i wybierz Google Gemini albo OpenAI.
4. Wpisz identyfikator modelu ręcznie. Lista modeli nie jest zamknięta.
5. W widocznym od razu polu **2. Klucz API** wklej API key i kliknij **3. Zapisz konfigurację i klucz**. Jedna akcja najpierw tworzy konfigurację, a następnie zapisuje klucz w osobnym chronionym store sekretów. Panel nie potrafi później odczytać jego pełnej wartości.
6. Kliknij **Testuj**. Otrzymasz znormalizowany stan bez treści odpowiedzi i bez szczegółów mogących ujawnić sekret.
7. W razie potrzeby ustaw konfigurację jako domyślną albo przypisz ją tylko do chatu.

Klucz można zastąpić lub usunąć bez deployu. Panel pokazuje wyłącznie informację, czy klucz istnieje, i cztery ostatnie znaki zapamiętane podczas zapisu. Usunięcie konfiguracji usuwa również jej sekret i przypisania modułów. Zmiany trafiają do audit logu bez wartości klucza.

### 10.2. Klucz Gemini

#### Utworzenie klucza

1. Zaloguj się na konto Google.
2. Otwórz [Google AI Studio](https://aistudio.google.com/apikey).
3. Zaakceptuj warunki korzystania.
4. Otwórz sekcję **API Keys**.
5. Nowemu użytkownikowi Google może automatycznie utworzyć projekt i klucz.
6. Jeśli klucza nie ma, kliknij **Create API key**.
7. Wybierz istniejący projekt Google Cloud albo utwórz nowy.
8. Skopiuj wygenerowany klucz.
9. Wklej klucz w **Panel administratora → AI / Modele**. Opcjonalnie, jako fallback zgodny ze starszą konfiguracją, dodaj w Netlify:

   ```dotenv
   GEMINI_API_KEY=TUTAJ_WKLEJ_KLUCZ
   ```

10. Deploy jest potrzebny tylko po zmianie fallbacku ENV; zmiana klucza w panelu działa bez deployu.

Aktualne klucze tworzone w AI Studio mogą być kluczami autoryzacyjnymi powiązanymi z kontem usługi. Jest to prawidłowe. Oficjalna instrukcja: [klucze Gemini API](https://ai.google.dev/gemini-api/docs/api-key).

#### Limity i koszty

- Wywołania korzystają z limitów projektu Google.
- Model wybiera administrator; fallback ENV używa `GEMINI_MODEL` albo `gemini-2.5-flash`.
- Funkcja ma dodatkowy limit 12 żądań na minutę na użytkownika w danej instancji.
- Netlify nakłada również limit 30 żądań na minutę według IP i domeny.
- Włączenie płatnego poziomu Gemini może powodować koszty. Ustaw budżet i alerty w Google Cloud.
- W Google AI Studio sprawdzaj **Usage** oraz stan limitów.

### 10.3. Klucz OpenAI

1. Utwórz klucz API na koncie OpenAI z dostępem tylko do potrzebnego projektu.
2. Dodaj konfigurację OpenAI w **AI / Modele**, wpisz aktualny identyfikator modelu i zapisz.
3. Ustaw klucz, uruchom **Testuj**, a następnie ustaw konfigurację jako domyślną lub przypisz do wybranego modułu.
4. Kontroluj Usage, budżet i limity po stronie OpenAI. ChemDisk normalizuje informację o tokenach, ale dostawca pozostaje źródłem prawdy dla kosztów.

Opcjonalny fallback Netlify to `OPENAI_API_KEY` oraz `OPENAI_MODEL`. Jest sprawdzany po fallbacku Gemini, aby dotychczasowe wdrożenia nie zmieniły dostawcy samoczynnie.

### 10.4. Test chatu

1. Utwórz prompt w `prompts/`.
2. Dodaj w dashboardzie kartę **Asystent AI**.
3. Zaloguj się kontem z aktywnym dostępem.
4. Wyślij krótkie pytanie.
5. Jeśli pojawia się błąd usługi:
   - sprawdź status i test konfiguracji w **AI / Modele**;
   - przy fallbacku ENV sprawdź nazwę `GEMINI_API_KEY` albo `OPENAI_API_KEY`;
   - sprawdź, czy klucz nie został cofnięty;
   - sprawdź limity i rozliczenia projektu Google;
   - sprawdź log funkcji `chat` w Netlify;
   - wykonaj deploy po zmianie klucza.

## 11. Token Netlify

`NETLIFY_API_TOKEN` pozwala funkcjom tej aplikacji odczytywać i usuwać zgłoszenia Forms oraz korzystać z magazynów Blobs ze wskazanej witryny.

W przeciwieństwie do fine-grained tokenu GitHub, osobisty token Netlify jest powiązany z kontem Netlify i jego dostępem do zespołów. Jeżeli chcesz ograniczyć skutki ewentualnego wycieku, użyj osobnego konta operatorskiego mającego dostęp tylko do potrzebnego zespołu lub projektu, ustaw datę wygaśnięcia i regularnie obracaj token.

### 11.1. Utworzenie

1. Zaloguj się do Netlify.
2. Kliknij ikonę użytkownika i otwórz **User settings**.
3. Przejdź do **Applications**.
4. Otwórz **Personal access tokens**.
5. Kliknij utworzenie nowego tokenu.
6. Nadaj nazwę, np. `ChemDisk produkcja`.
7. Ustaw rozsądną datę wygaśnięcia.
8. Jeśli Netlify pyta o zespół, przyznaj dostęp do zespołu będącego właścicielem projektu.
9. Wygeneruj token i od razu go skopiuj.
10. W projekcie Netlify dodaj:

   ```dotenv
   NETLIFY_API_TOKEN=TUTAJ_WKLEJ_TOKEN
   ```

11. Nie dodawaj produkcyjnego `SITE_ID` ręcznie w Netlify — jest zmienną systemową.
12. Wykonaj deploy.

Oficjalna instrukcja: [ustawienia użytkownika i tokeny Netlify](https://docs.netlify.com/manage/accounts-and-billing/user-settings/).

### 11.2. Do testów lokalnych

Do lokalnego `.env` wpisuje się także:

```dotenv
NETLIFY_API_TOKEN=token_witryny_testowej
SITE_ID=project_id_witryny_testowej
```

`Project ID` znajdziesz w **Project configuration → General → Project information**.

Używaj osobnej witryny testowej. Lokalny projekt z produkcyjnym tokenem i `SITE_ID` może zmienić prawdziwy dashboard, cennik lub historię płatności.

## 12. Stripe w sandboxie

Ta aplikacja sprzedaje jednorazowe okresy dostępu: godzinę, dzień, tydzień, miesiąc, pół roku lub rok. Nie tworzy automatycznie odnawianych subskrypcji.

Nie potrzebujesz:

- klucza `pk_test_` ani `pk_live_`;
- identyfikatorów produktów `prod_...`;
- identyfikatorów cen `price_...`.

Aplikacja tworzy cenę Checkout po stronie serwera na podstawie cennika ustawionego przez administratora.

### 12.1. Konto i sandbox

1. Otwórz [Stripe Dashboard](https://dashboard.stripe.com/).
2. Utwórz konto i potwierdź e-mail.
3. Uzupełnienie wszystkich danych firmy jest konieczne dopiero przed prawdziwymi płatnościami.
4. Kliknij wybór konta w Dashboardzie.
5. Wybierz **Switch to sandbox → Create sandbox**.
6. Nadaj nazwę, np. `ChemDisk test`.
7. Dla pierwszych testów możesz wybrać utworzenie sandboxa od zera.
8. Otwórz sandbox. U góry powinna być widoczna informacja, że pracujesz w środowisku testowym.

Stripe zaleca obecnie sandboxy jako izolowane środowiska testowe. Oficjalna instrukcja: [zarządzanie sandboxami Stripe](https://docs.stripe.com/sandboxes/dashboard/manage).

### 12.2. Tajny klucz testowy

1. Będąc we właściwym sandboxie, przejdź do **Developers → API keys**.
2. Znajdź **Secret key** zaczynający się od `sk_test_`.
3. Kliknij odsłonięcie i skopiuj klucz.
4. W Netlify dodaj:

   ```dotenv
   STRIPE_SECRET_KEY=sk_test_TUTAJ_DALSZA_CZESC
   ```

5. Ustaw kontekst produkcyjnego wdrożenia tej testowej instalacji, ale pamiętaj, że jest to nadal sandbox Stripe.
6. Uruchom deploy.

Oficjalna instrukcja: [klucze Stripe](https://docs.stripe.com/keys).

### 12.3. Webhook

Webhook jest najważniejszym mechanizmem przyznawania dostępu po płatności.

1. Najpierw wykonaj deploy aplikacji, aby publiczny adres funkcji istniał.
2. Skopiuj główny adres strony Netlify lub własnej domeny.
3. W sandboxie Stripe otwórz **Workbench → Webhooks** albo **Developers → Webhooks / Event destinations**.
4. Kliknij utworzenie endpointu lub event destination.
5. Wybierz zdarzenia z własnego konta Stripe.
6. Jako adres endpointu wpisz:

   ```text
   https://TWOJA-DOMENA/.netlify/functions/stripe-webhook
   ```

7. Wybierz dokładnie zdarzenia:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   ```

8. Zapisz endpoint.
9. Otwórz jego szczegóły.
10. Kliknij **Reveal** przy signing secret.
11. Skopiuj sekret zaczynający się od `whsec_`.
12. W Netlify dodaj:

   ```dotenv
   STRIPE_WEBHOOK_SECRET=whsec_TUTAJ_DALSZA_CZESC
   ```

13. Uruchom ponowny deploy.

Sekret webhooka sandboxa nie działa dla endpointu live i odwrotnie. Oficjalna instrukcja: [webhooki Stripe](https://docs.stripe.com/webhooks).

### 12.4. Ustawienie cennika

1. Zaloguj się jako administrator.
2. Otwórz **Panel administratora → Płatności**.
3. Wybierz walutę.
4. Wpisz ceny.
5. Zaznacz dostępne okresy.
6. Zdecyduj:
   - czy płatności są globalnie włączone;
   - czy można dokupić kolejny okres przed końcem obecnego.
7. Zapisz.
8. Panel powinien potwierdzić tryb testowy Stripe.

Zmiana waluty nie przelicza cen automatycznie. Po zmianie waluty wpisz wszystkie kwoty ponownie.

### 12.5. Test płatności

1. Utwórz lub zaproś zwykłego użytkownika.
2. Użytkownik musi być zalogowany.
3. Otwórz **Kup lub przedłuż**.
4. Wybierz pakiet.
5. W Stripe Checkout użyj:

   ```text
   Numer: 4242 4242 4242 4242
   Data: dowolna przyszła, np. 12/34
   CVC: dowolne 3 cyfry
   Pozostałe dane: dowolne poprawne wartości testowe
   ```

6. Po powrocie sprawdź, czy użytkownik dostał rolę i termin.
7. W panelu administratora sprawdź historię płatności.
8. W Stripe otwórz webhook i sprawdź, czy dostarczenie zakończyło się kodem `200`.
9. Sprawdź logi funkcji `stripe-webhook` w Netlify.

Do odrzucenia z powodu braku środków użyj `4000 0000 0000 9995`. Nie wpisuj prawdziwych danych kart w sandboxie. Oficjalne numery: [testowanie Stripe](https://docs.stripe.com/testing).

### 12.6. Przejście na prawdziwe płatności

1. Zakończ pełną aktywację konta Stripe.
2. Uzupełnij dane firmy, właściciela i rachunku wypłat.
3. Przejdź do środowiska live.
4. Skopiuj klucz `sk_live_...`.
5. Utwórz osobny webhook live z tymi samymi dwoma zdarzeniami.
6. Skopiuj nowy sekret `whsec_...`.
7. W Netlify ustaw produkcyjne wartości:

   ```dotenv
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

8. Ogranicz je do kontekstu **Production**.
9. Deploy Preview i testowa witryna powinny nadal używać wyłącznie sandboxa.
10. Wykonaj deploy.
11. Przeprowadź małą prawdziwą płatność kontrolną.
12. Sprawdź webhook, rolę i historię użytkownika.

Zwrot pieniędzy wykonuje się osobno w Stripe. Odebranie dostępu w ChemDisk nie zwraca płatności.

## 13. Panel kursanta

Po zalogowaniu kursant widzi:

- stronę Start;
- działy i harmonijki z materiałami;
- wyszukiwarkę;
- zmianę jasnego lub ciemnego motywu;
- profil i zmianę imienia, nazwiska lub hasła;
- status i czas dostępu;
- zakup lub przedłużenie dostępu;
- formularz kontaktowy.

Użytkownik bez aktywnej roli może się zalogować i kupić dostęp, ale nie może otworzyć `/members/`.

Ikona biblioteki lekcji i Studio są przeznaczone wyłącznie dla administratora.

### 13.1. Zmiana własnego hasła

1. Kliknij swoją kartę profilu w lewym menu albo nazwę konta u góry.
2. W części **Zmień hasło** wpisz obecne hasło.
3. Wpisz nowe hasło mające co najmniej 10 znaków i różniące się od obecnego.
4. Powtórz nowe hasło dokładnie tak samo.
5. Kliknij **Zmień hasło**.

Obecne hasło jest ponownie sprawdzane przez Netlify Identity. ChemDisk nie zapisuje żadnego z wpisanych haseł. Jeśli obecne hasło jest nieprawidłowe albo nowe pola różnią się od siebie, formularz nie wykona zmiany.

## 14. Role i długość dostępu

| Rola | Znaczenie |
| --- | --- |
| `admin` | Administrator i stały dostęp |
| `active` | Stały dostęp kursanta |
| `hour` | 1 godzina |
| `day` | 24 godziny |
| `week` | 7 dni |
| `month` | 30 dni |
| `halfyear` | 182 dni |
| `year` | 365 dni |

Ręcznie nadany okres czasowy zaczyna się przy pierwszym poprawnym logowaniu po przypisaniu. Okres kupiony przez Stripe zaczyna się po potwierdzeniu płatności.

Aplikacja dopuszcza jedną aktywną sesję konta. Nowe logowanie na innym urządzeniu zastępuje poprzednią sesję. Kilka kart w tej samej przeglądarce może działać równocześnie.

## 15. Dodawanie i obsługa użytkowników

### 15.1. Zaproszenie nowego użytkownika

1. Zaloguj się jako administrator.
2. Otwórz **Panel administratora**.
3. Wybierz zakładkę **Użytkownicy**.
4. Rozwiń **Zaproś nowego użytkownika**.
5. Wpisz e-mail, imię i nazwisko.
6. Wybierz dostęp:
   - brak;
   - stały;
   - jeden z okresów czasowych.
7. Opcjonalnie zaznacz **Administrator**.
8. Kliknij **Wyślij zaproszenie**.
9. Użytkownik dostanie e-mail i sam ustawi hasło.

### 15.2. Zmiana danych lub dostępu

1. Znajdź konto po e-mailu albo nazwisku.
2. Rozwiń konto.
3. Zmień imię, nazwisko, rodzaj dostępu albo rolę administratora.
4. Zapisz.
5. Poproś użytkownika o wylogowanie i ponowne logowanie.

Sama poprawka imienia lub nazwiska nie odnawia aktywnego okresu.

### 15.3. Odebranie dostępu

- Dla dostępu nadanego ręcznie wybierz **Brak dostępu** i zapisz.
- Dla płatnego dostępu użyj akcji odebrania dostępu w historii płatności.
- Odebranie dostępu nie wykonuje zwrotu pieniędzy.
- Refund wykonuje się w Stripe przy odpowiedniej płatności.

### 15.4. Usunięcie konta

1. Rozwiń użytkownika.
2. Kliknij **Usuń konto**.
3. Przeczytaj komunikat.
4. Potwierdź wyłącznie po sprawdzeniu e-maila.

Usunięcie konta jest trwałe dla Identity i historii ChemDisk. Dane transakcji pozostają w Stripe. Administrator nie może usunąć własnego aktualnie zalogowanego konta.

### 15.5. Pobranie listy kontaktów na wydarzenie

1. Zaloguj się jako administrator.
2. Otwórz **Panel administratora → Użytkownicy**.
3. Poczekaj, aż nad listą pojawi się liczba kont. Przyciski eksportu pozostają nieaktywne, dopóki aplikacja nie pobierze całej listy.
4. Kliknij **Pobierz JSON** albo **Pobierz XML**:
   - JSON jest wygodny do dalszego użycia w aplikacjach i automatyzacjach;
   - XML przydaje się w programach, które wymagają tego formatu.
5. Gotowy plik znajdziesz w folderze pobranych plików przeglądarki. Nazwa zawiera datę i godzinę eksportu.

Eksport zawsze obejmuje wszystkie konta, nawet jeżeli w polu wyszukiwania widać tylko część z nich. Każdy wpis zawiera wyłącznie `email`, `firstName` i `lastName`. Plik nie zawiera haseł, ról, identyfikatorów kont, informacji o dostępie ani płatnościach Stripe.

To nadal są dane osobowe. Udostępniaj plik tylko osobom, które muszą go otrzymać do organizacji wydarzenia, nie wysyłaj go przez publiczny link i usuń niepotrzebne kopie po zakończeniu pracy.

## 16. Panel administratora

Panel ma siedem zakładek.

### Użytkownicy

- zapraszanie;
- wyszukiwanie;
- eksport wszystkich e-maili, imion i nazwisk do JSON albo XML;
- zmiana profilu;
- nadawanie i odbieranie dostępu;
- nadawanie administratora;
- usuwanie kont.

### Formularze

- pokazuje odpowiedzi formularzy Netlify;
- obsługuje publiczny `contact` i kursowy `members-contact`;
- nie pokazuje odpowiedzi Google Forms;
- przycisk **Pobierz wszystko** tworzy jeden plik JSON ze wszystkimi formularzami Netlify i wszystkimi ich odpowiedziami;
- usunięcie zgłoszenia jest trwałe;
- odpowiedzi można również eksportować z zakładki Forms w Netlify.

### Dashboard

- bezpośrednia edycja Markdown;
- podgląd;
- publikacja do Netlify Blobs bez deployu;
- przywrócenie statycznego `public/members/dashboard.md` z ostatniego deployu.

### Materiały

- wybór repozytorium;
- kontrola połączenia;
- liczba lekcji, promptów i egzaminów;
- wymuszenie odświeżenia listy;
- token nie jest pokazywany w przeglądarce.

### Postępy

- lista i wyszukiwarka kursantów;
- postęp kursu, działów i materiałów;
- próby egzaminów ładowane dopiero po rozwinięciu wybranego egzaminu;
- raporty globalne i audit log;
- ręczne ukończenie, reset i ustawienia nawigacji użytkownika.

### AI / Modele

- wiele konfiguracji Google Gemini i OpenAI;
- bezpieczne ustawianie, zastępowanie i usuwanie klucza bez deployu;
- ręczny identyfikator modelu lub lista pobrana od dostawcy;
- test klucza i dostępności modelu wykonywany server-side;
- konfiguracja domyślna oraz osobne przypisanie dla chatu, sprawdzania AI, formularzy AI i wspólny fallback dla innych/przyszłych modułów;
- pełny klucz nigdy nie wraca do przeglądarki.

### Płatności

- ceny i waluta;
- dostępne pakiety;
- globalne wyłączenie płatności;
- blokada lub zezwolenie na sumowanie okresów;
- historia płatności i operacji administratora;
- odebranie płatnego dostępu.

## 17. Studio treści

Studio jest dostępne tylko dla konta z rolą `admin`. Zawiera:

1. **Dashboard Builder**
2. **Lesson Builder**
3. **Quiz Builder**
4. **Prompt Builder**
5. **Exam Builder**
6. **Presentation Studio**
7. skrót do wspólnego **Media Managera**
8. skrót do **AI / Modele** w chronionym panelu administratora

Na stronie głównej Studio działa **Eksplorator treści**. Wybierz repozytorium i rozwiń folder **Lekcje**, **Egzaminy**, **Prezentacje**, **Quizy**, **Prompty** albo **Media wspólne**. Każdy materiał jest osobnym zwijanym folderem. Każda lista pokazuje najpierw maksymalnie 12 pozycji; przycisk **Pokaż więcej** dodaje następne 12 bez tworzenia od razu setek elementów interfejsu. Tak samo działają biblioteki plików w Dashboard Builderze, Lesson Builderze, Prompt Builderze, Quiz Builderze, Exam Builderze, Presentation Studio oraz obrazy w Media Managerze. Wpisanie nowego wyszukiwania lub zmiana repozytorium wraca do pierwszych 12 wyników. Po otwarciu materiału zobaczysz definicję oraz folder `photos`; zdjęcia są pobierane dopiero w tej chwili. Kliknij **Otwórz**, aby wczytać plik do odpowiedniego Buildera. **Duplikuj** poprosi o nową nazwę i skopiuje definicję razem z lokalnym `photos`; media wspólne pozostaną współdzielonymi referencjami. Quiz otwiera się bezpośrednio w aktywnym Quiz Builderze.

### Quiz Builder

1. Otwórz **Studio treści → Quiz** i wybierz repozytorium.
2. Ustaw ID, tytuł, opis, próg zaliczenia i opcjonalne losowanie pytań.
3. Dodaj pytania: **Jedna odpowiedź**, **Wiele odpowiedzi**, **Prawda / fałsz** albo **Odpowiedź tekstowa**.
4. Zaznacz poprawne warianty lub wpisz akceptowane odpowiedzi tekstowe — po jednej w wierszu.
5. Obraz okładki lub pytania wybierz w tym samym Media Managerze. Przed pierwszym zapisem dostępne są media wspólne; po utworzeniu `quiz.json` możesz też używać lokalnego `quizzes/<quizId>/photos/`.
6. Sprawdź działanie w panelu **Podgląd ucznia**, a potem kliknij **Zapisz draft** albo **Opublikuj**.

Quiz jest zapisywany jako strukturalny JSON, bez dowolnego HTML. Przeglądarka i backend walidują typy pytań, stabilne identyfikatory, punktację oraz referencje mediów. Zapis do GitHuba jest wykonywany dopiero po kliknięciu jednej z dwóch jawnych akcji.

Po publikacji otwórz **Dashboard Builder**, dodaj klocek **Quiz ChemDisk**, wybierz repozytorium i quiz z biblioteki, a następnie opublikuj dashboard. Kursant otworzy wspólny odtwarzacz pod `/members/module/quiz/`; draft nie zostanie mu zwrócony. Wynik procentowy, zaliczenie i liczba prób zapisują się w centralnym postępie. Jeśli wyłączysz powtórzenia, ukończony quiz pozostanie zablokowany po odświeżeniu i ponownym logowaniu.

Przycisk **Usuń** przy definicji wymaga potwierdzenia i aktualnej wersji SHA. Jeśli materiał zawiera lokalne obrazy, drugie pytanie pozwala usunąć również `photos` albo zachować ten folder. Przy egzaminie najpierw zobaczysz wykryte odwołania z Dashboardu i lekcji. Usunięcie nie kasuje lokalnego draftu, historii postępu ani kart odwołujących się do pliku. Pliki z **Media wspólne** nigdy nie są automatycznie usuwane razem z materiałem.

W rozwiniętym `photos` możesz usunąć pojedynczy niepotrzebny obraz albo kliknąć **Zarządzaj**, aby otworzyć Media Manager. Pokazuje on miniatury, rozmiar, lokalną liczbę użyć i wyszukiwarkę. Obsługuje przeciąganie, wybór wielu plików oraz wklejanie obrazów przez `Ctrl+V`/`Cmd+V`. Usuwanie zapisuje odwracalny commit GitHub. Dla pliku wspólnego zawsze pojawia się mocne ostrzeżenie, bo może być używany w wielu materiałach. Przy kasowaniu całego materiału wybierasz osobno, czy usunąć także jego lokalne zdjęcia; `assets/shared` nigdy nie jest wtedy kasowane.

W każdym builderze:

- lewa biblioteka, górne narzędzia oraz prawy panel mogą być zwijane niezależnie;
- kolumny mają niezależne przewijanie;
- szkic zapisuje się lokalnie w przeglądarce;
- dostępne są cofanie i ponawianie;
- podgląd można oglądać po prawej albo otworzyć w osobnym, pełnym oknie.

## 18. Dashboard Builder — instrukcja

### 18.1. Zwykły sposób pracy

1. Otwórz **Studio treści → Dashboard**.
2. Kliknij wczytanie aktywnego dashboardu.
3. Zmień tytuł i opis powitalny.
4. Przeciągnij **Sekcję** na obszar roboczy.
5. Do sekcji dodaj tekst, komunikat, harmonijkę albo kartę modułu.
6. Kliknij klocek.
7. Uzupełnij ustawienia po prawej.
8. Sprawdź zakładkę **Podgląd**.
9. Opcjonalnie otwórz pełny podgląd w nowym oknie.
10. Kliknij publikację.
11. Odśwież panel kursanta.

Publikacja zapisuje dashboard w Netlify Blobs. Nie wymaga commitu ani deployu.

Duży dashboard można porządkować podczas edycji: kliknij strzałkę w nagłówku całej sekcji albo zagnieżdżonej harmonijki, aby ukryć jej zawartość w obszarze roboczym. Ponowne kliknięcie ją rozwinie. Jest to wyłącznie ustawienie widoku edytora — nie zmienia tego, co zobaczy kursant.

### 18.2. Klocki struktury

| Klocek | Zastosowanie | Jak uzupełnić |
| --- | --- | --- |
| Sekcja | Główny dział i pozycja menu | Wpisz tytuł i dodaj klocki |
| Harmonijka | Rozwijana grupa w sekcji | Wpisz tytuł, umieść treść i karty |
| Organizer po kolei | Numerowana ścieżka z blokadą kolejnych modułów | Ułóż co najmniej dwa moduły w wymaganej kolejności |
| Pole tekstowe | Opis działu | Wpisz krótki tekst |
| Komunikat | Wyróżniona informacja | Wpisz ostrzeżenie lub wskazówkę |

Sekcja **Pomoc i konto** jest wymagana. Jeśli jej zabraknie, aplikacja dołączy bezpieczny domyślny szablon.

### 18.3. Organizer modułów wykonywanych po kolei

1. Przeciągnij **Organizer po kolei** do wybranej sekcji.
2. Nadaj mu tytuł, na przykład „Powtórka przed egzaminem”.
3. Dodaj do środka co najmniej dwa moduły, na przykład Prezentację, PDF, Lekcję, Quiz ChemDisk i Egzamin.
4. Ustaw kolejność przeciąganiem lub przyciskami strzałek.
5. Skonfiguruj każdy materiał i upewnij się, że ma włączone lub dziedziczone śledzenie postępu.
6. Opublikuj dashboard.

Organizer można również dodać do harmonijki, która już istnieje. Zaznacz tę harmonijkę i kliknij **Dodaj organizer po kolei** w jej ustawieniach albo przycisk **+1→** w nagłówku harmonijki. Powstanie osobny organizer wewnątrz; pozostałe materiały tej harmonijki nadal można otwierać w dowolnej kolejności. Jeżeli cała istniejąca harmonijka ma działać sekwencyjnie, zamiast dodawać dziecko zmień jej ustawienie **Sposób przechodzenia** na **Po kolei (organizer)**.

Uczeń może od razu rozpocząć pierwszy krok. Następny przycisk pozostaje zablokowany do czasu ukończenia wszystkich wcześniejszych kroków. Google Slides w organizerze pokazują przycisk **Zakończ krok** i nie odblokowują kolejnego modułu przy samym otwarciu; jest to świadoma deklaracja ucznia, bo zewnętrzny podgląd Google nie udostępnia ChemDisk wiarygodnego stanu obejrzenia. PDF otwiera się bezpośrednio z numerowanej karty w wybranym trybie i po poprawnym otwarciu odblokowuje następny krok. Lekcja wymaga ukończenia wymaganych kroków, Quiz ChemDisk zapisuje ukończenie po sprawdzeniu odpowiedzi, a egzamin kończy się dopiero po zapisaniu zakończonej próby. Blokada jest sprawdzana przez serwer postępu; Exam Engine sprawdza ją dodatkowo przed otwarciem egzaminu. Organizer nie może zawierać kolejnej harmonijki — jeśli potrzebujesz drugiej ścieżki, dodaj osobny organizer.

## 19. Wszystkie karty i moduły dashboardu

Każdą kartę dodaje się tak samo:

1. Przeciągnij ją z lewej biblioteki do sekcji lub harmonijki.
2. Kliknij dodaną kartę.
3. Wpisz tytuł i opis.
4. Uzupełnij pola specyficzne dla modułu.
5. Sprawdź wygenerowany adres i podgląd.

### 19.0. Natywna prezentacja ChemDisk

1. Otwórz **Studio treści → Prezentacja**.
2. Wybierz repozytorium i kliknij **Nowa**, albo otwórz prezentację z biblioteki po lewej.
3. Ustaw trwałe `presentationId`, tytuł, motyw, proporcje i sposób liczenia postępu.
4. Dodawaj slajdy i wybieraj układ: pusty, tytuł, tytuł z treścią, tytuł z obrazem, tekst z obrazem, dwie kolumny, pełny obraz, cytat, tabela, pytanie lub dział.
5. Z górnego paska dodaj tekst, nagłówek, obraz, kształt/linię, wzór, ikonę, tabelę, przycisk, kod albo bezpieczny embed. Element można przeciągać, zmieniać jego rozmiar ośmioma uchwytami, wyrównywać, przesuwać między warstwami, zablokować, duplikować i usunąć.
6. Obraz wybierz w Media Managerze. Możesz użyć lokalnego `photos/` albo `assets/shared/`; nie wpisuj ręcznie ścieżki GitHub.
7. Dla obrazu możesz włączyć **Tryb Przytnij** i przeciągnąć widoczny fragment niezależnie od rozmiaru ramki. Narożniki domyślnie zachowują proporcje; przełącznik w panelu pozwala to wyłączyć.
8. Ustaw tło jako kolor, gradient, obraz albo motyw i zdecyduj, czy zastosować je tylko do bieżącego slajdu, czy do wszystkich.
9. Dodaj notatki prowadzącego, sprawdź podgląd i kliknij **Zapisz draft**. Gdy materiał jest gotowy dla uczniów, kliknij **Opublikuj**.
10. W Dashboard Builderze dodaj kartę **Prezentacja ChemDisk**, wybierz repozytorium i prezentację, a następnie opublikuj dashboard.

Uczeń otwiera wspólny odtwarzacz ChemDisk. Postęp korzysta ze stabilnych `slideId`, więc sama zmiana kolejności slajdów nie kasuje odwiedzin. Draft jest dostępny tylko w podglądzie administratora; zwykły kursant widzi wyłącznie wersję opublikowaną.

### 19.1. Prezentacja Google

- Wklej pełny link albo ID prezentacji.
- Tryb `1` to zwykły podgląd.
- Tryb `2` ogranicza interfejs dostawcy.
- Tryb `4` przyjmuje dowolny pełny adres HTTPS i próbuje pokazać go wewnątrz ChemDisk.
- Tryb `5` przyjmuje dowolny pełny adres HTTPS i otwiera go bezpośrednio w zwykłym widoku przeglądarki, bez masek.
- Prezentacja musi mieć uprawnienia pozwalające kursantowi ją otworzyć.

Przykład adresu:

```text
/members/module/slides/?id=ID_PREZENTACJI&type=2
```

### 19.2. Dokument PDF z Google Drive

- Wklej link albo ID pliku Drive.
- Tryb `1` to podgląd z ograniczonym interfejsem.
- Tryb `2` wymusza pobranie.
- Tryb `3` to zwykły podgląd.
- Tryb `4` osadza dowolny pełny adres HTTPS wewnątrz ChemDisk.
- Tryb `5` otwiera pełny adres HTTPS bezpośrednio w przeglądarce, bez dodatkowych zabezpieczeń interfejsu.

```text
/members/module/pdf/?id=ID_PLIKU&type=1
```

Ograniczony interfejs nie jest DRM. Osoba mogąca obejrzeć dokument może użyć narzędzi przeglądarki lub wykonać zrzut.

W trybach `4` i `5` wklej cały adres zaczynający się od `https://`, nie samo ID. ChemDisk usuwa parametr z widocznego paska adresu po jego odczytaniu. Nie każda strona pozwala działać w iframe: jeśli tryb `4` pokazuje pusty ekran lub błąd, właściciel strony prawdopodobnie blokuje osadzanie. Wtedy wybierz tryb `5`.

### 19.3. Film

- `type=1` — YouTube z ograniczonym interfejsem;
- `type=2` — plik wideo z Google Drive;
- `type=3` — YouTube z pełniejszym odtwarzaczem.

```text
/members/module/film/?id=ID_FILMU&type=1
```

Usunięty moduł `filmv1` nie jest dostępny. Stare odnośniki są migrowane do modułu `film`.

### 19.4. Odtwarzacz YT

- Wklej ID albo pełny link YouTube.
- Odtwarzacz ma własne kontrolki ChemDisk.
- Film musi pozwalać na osadzanie.

```text
/members/module/yt/?id=ID_FILMU
```

### 19.5. Lekcja interaktywna

- Wybierz repozytorium.
- Wybierz plik `.md` z listy albo wpisz jego nazwę.
- Dla repo innego niż domyślne link zawiera `repo=identyfikator`.

```text
/members/module/lesson/?file=izotopy.md
/members/module/lesson/?repo=organiczna&file=alkany.md
```

### 19.6. Google Forms

- Wklej ID Formularza Google.
- Użyj testu lub ankiety udostępnionej właściwym odbiorcom.
- Wyniki trafiają do Google, a nie do Netlify Forms.

```text
/members/module/forms/?id=ID_FORMULARZA
```

### 19.7. Asystent AI

Wybierz:

- plik `.json` z jedną instrukcją; albo
- konkretny punkt pliku `.txt`.

```text
/members/module/chat/?prompt=korepetytor.json
/members/module/chat/?plik=zestaw.txt&punkt=2
/members/module/chat/?repo=organiczna&prompt=organiczna.json
```

Czat wymaga kompletnej konfiguracji w **AI / Modele** albo awaryjnego `GEMINI_API_KEY`/`OPENAI_API_KEY`, aktywnego dostępu użytkownika i poprawnego promptu.

### 19.8. Kalkulator naukowy

Moduł `kalkulator` osadza symulator NumWorks. Wymaga internetu i dostępności zewnętrznej usługi.

```text
/members/module/kalkulator/
```

### 19.9. Kalkulator klasyczny

Moduł `classic` działa lokalnie i obsługuje podstawowe działania, nawiasy, modulo oraz klawiaturę.

```text
/members/module/classic/
```

### 19.10. Biała tablica

Moduł `whiteboard` osadza tldraw. Dane i dostępność zależą od zewnętrznej usługi.

```text
/members/module/whiteboard/
```

### 19.11. BitPaper

Lokalna tablica ma:

- ołówek, gumkę i tekst;
- zaznaczanie i przesuwanie;
- cofanie i ponawianie;
- okna zadań i obrazy;
- eksport/import JSON;
- eksport PNG.

```text
/members/module/bitpaper/
```

Opcjonalny parametr `path=nazwa.json` automatycznie wczytuje planszę opublikowaną w katalogu modułu. BitPaper nie synchronizuje wielu osób w czasie rzeczywistym.

### 19.12. ATONOM

- Wpisz polską nazwę związku, np. `fenol`, `etanol` albo `cis-but-2-en`.
- Dashboard otwiera lokalny model.
- Link zawiera parametr `formula`.

```text
/members/module/atonom/?formula=kwas%20octowy
```

ATONOM pokazuje wzór, rodzinę, atomy, wiązania, przybliżoną masę molową oraz model do obracania.

### 19.13. Formularz kontaktowy

- Ustaw stałą treść wewnętrzną, która opisuje, skąd otwarto formularz.
- Wiadomość trafia do Netlify Forms jako `members-contact`.

```text
/members/module/contact/?internal=Pytanie%20z%20dzialu%20stechiometria
```

### 19.14. Link zewnętrzny

- Wklej pełny bezpieczny adres HTTPS.
- Używaj do stron, których nie obsługuje gotowy moduł.
- Sprawdź, czy użytkownik nie potrzebuje osobnego konta lub zgody.

### 19.15. Egzamin

1. Najpierw utwórz i opublikuj egzamin w **Studio treści → Egzamin**.
2. W Dashboard Builderze przeciągnij kartę **Egzamin**.
3. Wybierz repozytorium i egzamin z biblioteki.
4. Ustaw nazwę, opis, ikonę oraz zwykłe opcje centralnego postępu.
5. Opublikuj dashboard.

Karta przechowuje tylko stabilne `repositoryId` i `examId`. Nie kopiuje pytań ani odpowiedzi. Ten sam egzamin można dodać w kilku miejscach.

## 20. Lesson Builder — tworzenie lekcji

### 20.1. Nowa lekcja

1. Otwórz **Studio treści → Lekcja**.
2. Kliknij **Nowa lekcja**.
3. Wpisz nazwę pliku kończącą się `.md`, np. `stechiometria-1.md`.
4. Wpisz tytuł lekcji.
5. Edytuj pierwszy slajd.
6. Dodawaj kolejne slajdy.
7. Przeciągaj klocki na wybrany slajd.
8. Klikaj klocki i edytuj ich ustawienia po prawej.
9. Sprawdź podgląd po prawej i pełny podgląd w nowym oknie.
10. Wybierz repozytorium.
11. Kliknij **Utwórz plik w GitHubie**.

Jeżeli w GitHubie istnieje pusty plik `.md`, builder wczyta go jako startową lekcję gotową do edycji.

### 20.2. Edycja istniejącej lekcji

1. W lewej bibliotece wybierz repozytorium.
2. Wyszukaj lekcję.
3. Kliknij plik.
4. Edytuj.
5. Kliknij **Zapisz zmiany w GitHubie**.

Każdy zapis tworzy commit. Builder używa wersji SHA i nie nadpisuje po cichu nowszej zmiany wykonanej przez inną osobę.

### 20.3. Ręczny obieg pliku

Jeżeli nie chcesz dawać Studio prawa zapisu:

1. Twórz lekcję w builderze.
2. Kliknij **Pobierz .md**.
3. Otwórz repo materiałów.
4. Wejdź do `lessons`.
5. Kliknij **Add file → Upload files**.
6. Wgraj plik i zapisz commit.

Możesz też użyć **Importuj .md**, **Markdown** albo **Kopiuj**.

### 20.4. Usunięcie lekcji

1. Najpierw wczytaj plik z GitHuba.
2. Kliknij **Usuń z GitHuba**.
3. Sprawdź nazwę i potwierdź.

GitHub tworzy commit usuwający plik, dlatego zawartość można odzyskać z historii repo. Karta dashboardu wskazująca usunięty plik przestanie działać i trzeba ją poprawić lub usunąć.

## 21. Wszystkie klocki lekcji

Na jednym slajdzie można umieścić wiele klocków treści i najwyżej jedno zadanie sprawdzające.

Na dole przewijanej biblioteki klocków znajduje się sekcja **Narzędzia lekcji**. Są w niej: **Kreator równań**, **Zapytaj AI** i **Tablica**. Formularz kontaktowy znajduje się w grupie **Multimedia i aplikacje**. Kliknięcie działa tak samo jak przeciągnięcie. Studio automatycznie zaznacza dodany klocek i pokazuje jego ustawienia w panelu **Narzędzia i podgląd**.

### Nowy slajd

Tworzy kolejny krok lekcji. Kursant przechodzi między slajdami przyciskami i planem lekcji.

Po zaznaczeniu slajdu wybierz **Układ elementów**:

- **Automatyczny** — dotychczasowy, zgodny wstecznie układ klocków jeden pod drugim;
- **Swobodny** — płótno 16:9, na którym każdy główny klocek można przeciągnąć i skalować czterema narożnymi uchwytami.

W swobodnym układzie zaznacz klocek w podglądzie, przeciągnij etykietę **Przeciągnij** albo użyj pól X, Y, szerokości i wysokości w inspektorze. Pozycje są zapisywane procentowo w pliku lekcji, więc zachowują proporcje na różnych ekranach. Na telefonie elementy automatycznie przechodzą w czytelny układ pionowy. Przełączenie starego slajdu na układ swobodny nadaje klockom bezpieczne pozycje startowe; można je później dowolnie poprawić.

Po kliknięciu całego slajdu wybierz w prawym panelu jego przejście:

- **Brak przejścia** — slajd pojawia się natychmiast;
- **Łagodne zanikanie** — spokojne pojawienie się;
- **Subtelnie w górę** — niewielki ruch ku górze;
- **Delikatnie z boku** — krótki ruch poziomy;
- **Miękkie przybliżenie** — bardzo lekkie powiększenie.

Każdy slajd ma własne ustawienie. Domyślne jest łagodne zanikanie. Jeśli użytkownik w systemie włączy ograniczenie animacji, ChemDisk wyłączy ruch niezależnie od wybranej opcji.

### Nagłówek

Wybierz H1, H2 lub H3 i wpisz tytuł fragmentu.

### Tekst

Ustaw:

- treść;
- czcionkę: systemową, Arial, Verdana, szeryfową, Georgia, Times New Roman, zaokrągloną, monospace lub Courier New;
- rozmiar: mały, normalny, duży lub bardzo duży;
- wyrównanie do lewej, środka lub prawej;
- pogrubienie całego bloku;
- własny kolor tekstu;
- własny kolor tła.

W treści można używać:

```md
**pogrubienie**
*kursywa*
^indeks górny^
~indeks dolny~
```

### Obraz z URL

Wklej publiczny adres HTTPS i wpisz opis ALT. Plik nie jest kopiowany do repo lekcji.

### Obraz z Media Managera

Wybierz obraz lokalny lekcji albo plik wspólny. Media Manager obsługuje wybór z dysku, przeciąganie plików i wklejanie obrazu przez `Ctrl+V`/`Cmd+V`. Lokalny upload trafia do `lessons/<nazwa-lekcji>/photos/`, a lekcja zapisuje tylko stabilną referencję `photos/...`, ALT, szerokość i wyrównanie. W układzie automatycznym zaznaczony obraz ma uchwyt szerokości w prawym dolnym rogu. W układzie swobodnym cały obraz można przesuwać i skalować w obu osiach tak samo jak pozostałe klocki. Historia i lokalny autosave są aktualizowane po puszczeniu uchwytu.

### Lista

Wpisz jeden punkt w każdym wierszu i wybierz listę punktowaną albo numerowaną.

### Tabela

1. Przeciągnij klocek **Tabela** do slajdu albo kliknij go w bibliotece **Treść**.
2. Opcjonalnie wpisz podpis, np. „Porównanie właściwości”.
3. W polu nagłówków rozdziel kolumny pionową kreską `|`, np.:

```text
Substancja | Wzór | Stan skupienia
```

4. W polu wierszy wpisuj każdy wiersz w osobnej linii, a komórki również rozdzielaj znakiem `|`:

```text
Woda | H~2~O | ciecz
Tlen | O~2~ | gaz
Chlorek sodu | NaCl | ciało stałe
```

5. Wybierz wyrównanie do lewej, środka albo prawej.

Tabela może mieć od 2 do 8 kolumn i maksymalnie 30 wierszy. Każdy wiersz musi zawierać tyle samo komórek, ile podano nagłówków. W komórkach działają podstawowe oznaczenia tekstu, np. `**pogrubienie**`, `^indeks górny^` oraz `~indeks dolny~`. Na telefonie szeroka tabela nie ściska całej lekcji — można ją przewijać poziomo.

### Cytat

Użyj do definicji, reguły lub ważnego fragmentu.

### Callout

Wybierz: informacja, wskazówka, uwaga lub „zapamiętaj”. Dodaj tytuł i treść.

### Blok kodu

Służy do kodu albo fragmentu, który ma zachować odstępy i czcionkę monospace. Do estetycznych wzorów użyj osobnego klocka **Wzór chemiczny / matematyczny**.

### Wzór chemiczny / matematyczny

Ten klocek działa jak uproszczony edytor równań z Worda: ma gotowe szablony, klikalne symbole, osobne części równania i podgląd wyniku bezpośrednio w prawym panelu. Wybierz jeden z dwóch trybów.

#### Chemia — wzór lub reakcja

1. Możesz zacząć od gotowego szablonu: woda, spalanie, równowaga, dysocjacja, reakcja strąceniowa albo izotop.
2. W wizualnym układzie wpisz **Substraty / wzór** po lewej i **Produkty** po prawej.
3. Pośrodku wybierz strzałkę.
4. Nad strzałką wpisz lub wstaw przyciskiem temperaturę, `Δ` albo `hν`.
5. Pod strzałką wpisz lub wstaw katalizator albo ciśnienie.
6. Kliknij pole substratów albo produktów, a następnie użyj palety, aby dodać jon, izotop, stopień utlenienia, stan skupienia lub osad.
7. Obserwuj kartę **Podgląd równania**.
8. Dodaj podpis pod wzorem, np. „Spalanie wodoru”.

Dostępne są klikalne strzałki: brak strzałki, `→`, `←`, `↔`, równowaga `⇌` oraz równowaga przesunięta w jedną stronę. Nie trzeba pamiętać ich zapisu tekstowego.

Cyfry we wzorach są zamieniane na indeksy dolne automatycznie. Przydatne przykłady:

```text
H2O
Ca(OH)2
SO4^2-
^14C
Fe^{III}
NaCl (aq)
AgCl v
```

Jeśli chcesz pokazać tylko jeden wzór bez reakcji, wybierz **Bez strzałki — pojedynczy wzór** i pozostaw pole produktów puste.

#### Matematyka — równanie i symbole

Po przełączeniu trybu wybierz gotowy szablon albo kliknij miejsce w równaniu i użyj palety struktur, działań oraz liter greckich. Podgląd aktualizuje się podczas pisania. Dostępne są między innymi:

- potęga: `x^{2}`;
- indeks dolny: `a_{n}`;
- ułamek: `\frac{a}{b}`;
- pierwiastek: `\sqrt{x}`;
- suma: `\sum_{i=1}^{n}`;
- całka: `\int_{a}^{b}`;
- wektor: `\vec{v}`;
- symbole `π`, `Δ`, `∂`, `→`, `×`, `±`, `≈`, `≤`, `≥` i `∞`.

Przykłady:

```text
E = mc^{2}
c = \frac{n}{V}
x_{1,2} = \frac{-b \pm \sqrt{b^{2} - 4ac}}{2a}
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
```

Kreator przyjmuje tylko bezpieczny zestaw poleceń matematycznych. Nie wklejaj całego dokumentu LaTeX ani kodu HTML.

### Kafelek z linkiem

Tworzy estetyczną kartę prowadzącą do dodatkowego materiału zamiast pokazywania zwykłego, długiego adresu.

1. Wpisz tytuł, np. „Tablica wzorów”.
2. Dodaj krótki opis.
3. Wklej adres strony albo modułu.
4. Wybierz ikonę: link, książka, film, chemia, matematyka, plik lub strona zewnętrzna.
5. Wybierz kolor akcentu.
6. Zaznacz **Otwieraj w nowej karcie**, jeżeli kursant nie powinien opuszczać lekcji.

Możesz użyć pełnego adresu `https://...`, adresu `http://...`, poczty `mailto:...`, kotwicy `#...` albo wewnętrznej ścieżki zaczynającej się od `/`, np. `/members/module/whiteboard/`. Adresy skryptowe, takie jak `javascript:...`, są odrzucane.

### Harmonijka

Dodaje rozwijane wyjaśnienie. Może być domyślnie otwarta. Do środka można przeciągnąć zwykłe klocki treści.

### Wideo YouTube

Wklej link albo 11-znakowe ID. Film jest osadzany z `youtube-nocookie.com`.

### Google Slides

1. Przeciągnij **Google Slides** z grupy **Multimedia i aplikacje** na slajd lekcji.
2. Wklej ID prezentacji albo pełny link z Google Slides lub Dysku.
3. Jeżeli używasz identyfikatora z linku opublikowanego `/d/e/`, zaznacz **Opublikowana prezentacja Google**. Dla pełnego linku Studio rozpoznaje ten tryb automatycznie.
4. Wpisz tytuł widoczny pod prezentacją.

Prezentacja jest wyświetlana bezpośrednio wewnątrz lekcji w proporcjach 16:9. Google nadal sprawdza własne uprawnienia, dlatego przed publikacją udostępnij plik odbiorcom kursu. Studio odrzuca linki spoza `docs.google.com` i `drive.google.com`.

### ATONOM

Wpisz nazwę związku. Lekcja najpierw pokazuje estetyczny kafelek. Model ładuje się dopiero po kliknięciu **Pokaż związek**, dzięki czemu nie zajmuje od razu całego slajdu.

### Formularz kontaktowy

1. Przeciągnij **Formularz kontaktowy** na slajd.
2. Wpisz tytuł, opis i tekst przycisku.
3. Opcjonalnie wpisz do 240 znaków wstępnej wiadomości, np. `Pytanie do slajdu o redoks`.
4. Zdecyduj, czy formularz ma otwierać się w tej samej, czy w nowej karcie.

Uczeń otwiera istniejący formularz ChemDisk. Imię i e-mail są uzupełniane z konta, a wiadomość trafia do Netlify Forms i jest dostępna w panelu administratora. Wstępna treść pomaga rozpoznać lekcję, lecz nie jest bezpiecznym identyfikatorem użytkownika ani uprawnienia.

### Zapytaj AI o slajd

Ten klocek daje uczniowi estetyczny przycisk **Zapytaj AI**. Po kliknięciu:

1. otwiera się istniejący moduł ChemDisk AI w nowej karcie;
2. treść bieżącego slajdu jest jednorazowo przekazywana jako kontekst;
3. nad czatem pojawia się informacja, że AI użyje tego kontekstu przy pierwszym pytaniu;
4. uczeń wpisuje własne pytanie, a w samej rozmowie widzi tylko swoją wiadomość.

W prawym panelu ustaw tytuł, opis i napis przycisku. Pola repozytorium oraz promptu są opcjonalne:

- pozostaw je puste, aby użyć zwykłego asystenta;
- wybierz repozytorium, a następnie kliknij pole pliku i wybierz prompt `.json` albo `.txt` z wyświetlonej listy; nazwę nadal można wpisać ręcznie;
- plik `.json` przypisuje jedną instrukcję;
- przy pliku `.txt` podaj również numer punktu.

Klocek wymaga działającego czatu i zmiennej `GEMINI_API_KEY`. Kontekst nie trafia do pliku lekcji ani adresu URL. Przeglądarka zapisuje go lokalnie pod losowym identyfikatorem, czat odczytuje go tylko raz, a wpis starszy niż 10 minut jest odrzucany.

### Tablica interaktywna

Klocek tworzy kartę otwierającą jedno z dwóch istniejących narzędzi:

- **Biała tablica** — szybkie szkicowanie i notatki;
- **BitPaper** — rozbudowana plansza z rysowaniem, tekstem, zaznaczaniem oraz importem i eksportem.

Wpisz tytuł, opis i tekst przycisku, wybierz rodzaj tablicy oraz zdecyduj, czy ma otworzyć się w nowej karcie. Dla BitPaper można opcjonalnie podać bezpieczną nazwę gotowej planszy `.json`, np. `stechiometria.json`. Puste pole otwiera nową planszę.

### Fiszki

Wpisuj jedną kartę w wierszu:

```text
Pojęcie => Wyjaśnienie
```

Dodaj co najmniej dwie fiszki i wybierz kolor. Kursant klika kartę, aby zobaczyć tył.

## 22. Wszystkie zadania interaktywne lekcji

Po dodaniu zadania kliknij je i skonfiguruj w prawym panelu. Zadanie może zablokować przejście dalej do chwili poprawnej odpowiedzi.

Pod polem **Treść pytania** znajduje się paleta **Wzory i indeksy**. Kliknij gotowy wzór H₂O, CO₂, H₂SO₄, NH₄⁺ albo SO₄²⁻, aby wstawić go w miejscu kursora. Aby utworzyć własny indeks, zaznacz fragment tekstu i kliknij `x₂` lub `x²`. Studio zapisuje bezpieczną składnię `~indeks dolny~` i `^indeks górny^`, a podgląd oraz odtwarzacz pokazują już gotowy zapis typograficzny.

### 22.1. Quiz ABCD

1. Przeciągnij **Quiz ABCD**.
2. Wpisz pytanie.
3. Uzupełnij dokładnie cztery odpowiedzi.
4. Zaznacz ptaszkiem poprawną.
5. Dodaj podpowiedź i komunikat sukcesu.

### 22.2. Wybór jednej odpowiedzi

1. Przeciągnij **Wybór**.
2. Dodaj od 2 do 8 opcji.
3. Zaznacz poprawną.
4. Wpisz podpowiedź.

### 22.3. Pytanie tekstowe

1. Wpisz pytanie.
2. Wpisz każdą akceptowaną odpowiedź lub alias w osobnym wierszu.
3. Opcjonalnie włącz rozróżnianie wielkości liter.

Przykładowe aliasy:

```text
atom
Atom
atom węgla
```

Bez włączenia rozróżniania wielkości liter `atom` i `Atom` są traktowane tak samo.

### 22.4. Pytanie liczbowe

1. Wpisz polecenie.
2. Wpisz dokładny poprawny wynik.
3. Uczeń może użyć przecinka albo kropki dziesiętnej.

Moduł nie stosuje automatycznej tolerancji i nie rozpoznaje jednostek. Jeśli odpowiedzią jest `7`, nie wpisuj jako poprawnej wartości `7 mol`, chyba że używasz pytania tekstowego.

### 22.5. Luki z listy

1. Dodaj możliwe odpowiedzi do listy.
2. W polu **Tekst przed luką 1** wpisz początek zdania.
3. Kliknij **Dodaj lukę tutaj** przy fragmencie, po którym ma znaleźć się luka.
4. W następnym zwykłym polu wpisz dalszy tekst.
5. Powtórz dla kolejnych luk.
6. Na karcie każdej luki wpisz jej krótki opis i wybierz prawidłową odpowiedź.

Uczeń uzupełnia luki listami wyboru.

### 22.6. Luki wpisywane ręcznie

1. Wpisz początek zdania w pierwszym zwykłym polu tekstowym.
2. Kliknij **Dodaj lukę tutaj**.
3. W kolejnym polu wpisz tekst po luce i dodaj następne luki tam, gdzie ich potrzebujesz.
4. Przy każdej luce wpisz prawidłową odpowiedź.
5. Wybierz:
   - **Każda luka osobno** — uczeń sprawdza kolejne pola;
   - **Wszystkie luki naraz** — jeden przycisk sprawdza całe zadanie.
6. Opcjonalnie włącz rozróżnianie wielkości liter.

Edytor pokazuje wyłącznie zwykłe fragmenty tekstu i czytelne karty luk. Nie trzeba wpisywać ani oglądać składni `{{luka}}`; pojawia się ona wyłącznie wewnątrz wygenerowanego pliku Markdown.

## 23. Odtwarzacz lekcji

Odtwarzacz:

- pobiera `.md` z wybranego prywatnego repo;
- pokazuje plan lekcji w kompaktowym, zwijanym panelu po lewej;
- pokazuje dużą prezentację po prawej;
- pozwala zwinąć górny pasek;
- ma domyślnie włączony przełącznik **Nauka po kolei**, który wymaga rozwiązania zadania przed przejściem dalej;
- po wyłączeniu **Nauki po kolei** pozwala przejść do dowolnego dalszego slajdu, pominąć trudne zadanie i wrócić do niego później;
- pamięta postęp w danej karcie przeglądarki;
- pozwala użyć **Resetuj postęp** pod planem lekcji, potwierdzić operację i zacząć bieżącą lekcję od początku;
- umożliwia powtórzenie lekcji;
- pokazuje bibliotekę plików wyłącznie administratorowi.

Odpowiedzi są zawarte w pliku pobieranym przez przeglądarkę. Lekcja służy do samosprawdzenia, a nie do tajnego egzaminu.

## 24. Prompt Builder

### 24.1. Prompt JSON

1. Otwórz **Studio treści → Prompt AI**.
2. Wybierz format **JSON — jedna instrukcja**.
3. Nadaj nazwę kończącą się `.json`.
4. Wpisz instrukcję dla asystenta.
5. Sprawdź walidację.
6. Zapisz w GitHubie albo pobierz plik ręcznie.

Wynik ma postać:

```json
{
  "prompt": "Jesteś korepetytorem chemii. Naprowadzaj ucznia krok po kroku..."
}
```

### 24.2. Prompt TXT z kilkoma punktami

1. Wybierz format **TXT — numerowane punkty**.
2. Nadaj nazwę kończącą się `.txt`.
3. Dodawaj punkty.
4. Każdy punkt może być niezależną instrukcją dla innej karty czatu.
5. Zapisz.

Plik wygląda tak:

```txt
::punkt 1
Naprowadzaj na rozwiązanie, ale nie podawaj od razu wyniku.

::punkt 2
Sprawdź odpowiedź, jednostki i cyfry znaczące.
```

Kartę do drugiego punktu tworzy się parametrem `punkt=2`.

### 24.3. Dostępne działania

- wybór repozytorium;
- wyszukiwanie promptów;
- import `.json` lub `.txt`;
- edycja kodu źródłowego;
- kopiowanie;
- pobranie;
- utworzenie i aktualizacja pliku na GitHubie;
- usunięcie z GitHuba.

Prompt Builder nie wysyła treści do Gemini. Tylko przygotowuje i waliduje pliki.

## 25. Ręczna edycja dashboardu

Jeśli nie chcesz używać buildera:

1. Otwórz **Panel administratora → Dashboard**.
2. Edytuj Markdown.
3. Kliknij podgląd.
4. Kliknij **Opublikuj zmiany**.

Podstawy:

```md
# Tytuł dashboardu

Opis powitalny.

## Nazwa działu

Opis działu.

### Rozwijana harmonijka

> Ważny komunikat.

- [Nazwa karty](/members/module/lesson/?file=lekcja.md) — Krótki opis.
```

HTML nie jest wykonywany.

Przycisk **Przywróć plik z wdrożenia** wyłącza wersję zapisaną w Blobs i przywraca `public/members/dashboard.md`.

## 26. Google Drive, Slides i Forms

Te usługi nie wymagają kluczy API w ChemDisk.

### Prezentacja

1. Utwórz prezentację.
2. Kliknij **Udostępnij**.
3. Ustaw dostęp właściwy dla kursantów.
4. Skopiuj link.
5. Wklej do karty Prezentacja.

### PDF lub film Drive

1. Wgraj plik na Dysk Google.
2. Ustaw udostępnianie.
3. Skopiuj link.
4. Wklej do PDF albo Film z `type=2`.

### Formularz Google

1. Utwórz formularz.
2. Ustaw zbieranie odpowiedzi i dostęp.
3. Skopiuj link lub ID.
4. Dodaj kartę Google Forms.
5. Odpowiedzi przeglądaj w Google Forms lub połączonym Arkuszu Google.

Jeżeli iframe jest pusty albo pyta o dostęp, problem zwykle dotyczy ustawień udostępniania Google, a nie kodu ChemDisk.

## 27. Formularze Netlify

Aplikacja ma:

- publiczny formularz `contact`;
- formularz kursanta `members-contact`;
- ochronę reCAPTCHA obsługiwaną przez Netlify.

Po deployu Netlify wykrywa formularze w HTML. Odpowiedzi znajdziesz:

- w **Panel administratora → Formularze**; albo
- w zakładce **Forms** projektu Netlify.

W panelu administratora kliknij **Pobierz wszystko**, aby dostać jeden plik JSON ze wszystkimi formularzami ChemDisk oraz wszystkimi ich odpowiedziami. Eksport może zawierać dane osobowe, więc przechowuj go bezpiecznie i usuń po wykorzystaniu. Usuwanie odpowiedzi jest trwałe. Możesz też pobrać eksport z panelu Netlify. Oficjalna instrukcja: [zgłoszenia Netlify Forms](https://docs.netlify.com/manage/forms/submissions/).

## 28. Dane w Netlify Blobs

Blobs przechowują między deployami:

- opublikowany dashboard;
- konfigurację cen;
- historię płatności i operacji dostępu.

Nowy deploy nie usuwa tych danych. Deploy Preview tej samej witryny może mieć dostęp do tych samych site-wide stores, jeśli otrzyma produkcyjny token i identyfikator. Dlatego nie testuj operacji administracyjnych na podglądzie podłączonym do produkcji.

Oficjalny opis: [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

## 29. Testy lokalne

Ta część jest opcjonalna. Jest przydatna przed zmianą kodu.

### 29.1. Przygotowanie

1. Zainstaluj Node.js co najmniej `20.12.2`.
2. Pobierz repozytorium aplikacji przez GitHub Desktop albo `git clone`.
3. Otwórz terminal w katalogu projektu.
4. Uruchom:

   ```bash
   npm install
   ```

5. Zaloguj Netlify CLI:

   ```bash
   npx netlify login
   ```

6. Połącz katalog z osobną witryną testową:

   ```bash
   npx netlify link
   ```

### 29.2. Lokalny `.env`

Skopiuj `.env.example` jako `.env` i wpisz wyłącznie testowe dane:

```dotenv
GEMINI_API_KEY=klucz_testowego_projektu
GITHUB_CONTENT_TOKEN=github_pat_token_testowego_repo
GITHUB_CONTENT_REPOSITORY=LOGIN/testowe-materialy
GITHUB_CONTENT_REF=main
GITHUB_CONTENT_ROOT=
GITHUB_CONTENT_REPOSITORIES=
NETLIFY_API_TOKEN=token_testowej_witryny
SITE_ID=project_id_testowej_witryny
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Plik `.env` jest ignorowany przez Git i nie wolno go commitować.

### 29.3. Uruchomienie

```bash
npm run dev
```

Otwórz adres pokazany przez Netlify CLI, zwykle `http://localhost:8888`.

Nie otwieraj samego `public/index.html` z dysku. Identity i Functions wtedy nie działają.

### 29.4. Testy automatyczne

```bash
npm test
npm run build
```

W tym projekcie oba polecenia uruchamiają testy `node --test`. Netlify wykonuje `npm run build` przed publikacją.

## 30. Lista testów po wdrożeniu

Przed przyjęciem prawdziwej płatności sprawdź:

1. Publiczna strona się otwiera.
2. Rejestracja lub zaproszenie dochodzi e-mailem.
3. Reset hasła działa.
4. Konto bez roli nie otwiera `/members/`.
5. Konto z rolą `active` otwiera dashboard.
6. Konto `admin` widzi Panel administratora i Studio.
7. Zwykły kursant nie widzi Studio ani biblioteki lekcji.
8. Zmiana imienia i nazwiska pozostaje po odświeżeniu.
9. Zmiana hasła odrzuca błędne obecne hasło, wymaga 10 znaków i pozwala zalogować się nowym hasłem.
10. Drugie logowanie zastępuje sesję z innego urządzenia.
11. Dashboard Builder publikuje i pokazuje zmiany po odświeżeniu.
12. Przywrócenie pliku dashboardu działa.
13. Repo materiałów ma status gotowy.
14. Nowa lekcja pojawia się bez deployu.
15. Lekcja otwiera wszystkie użyte klocki.
16. Quiz ABCD sprawdza zaznaczoną odpowiedź.
17. Luki z listy działają.
17. Luki tekstowe działają osobno i wszystkie naraz.
18. Klocek wzoru pokazuje poprawne indeksy, reakcję ze strzałką i temperaturą oraz wzór matematyczny z ułamkiem i pierwiastkiem.
19. Kafelek z linkiem otwiera bezpieczny adres i nie pokazuje użytkownikowi surowego długiego linku.
20. Każdy slajd używa wybranego przejścia, a opcja **Brak przejścia** wyłącza animację.
21. ATONOM pokazuje kafelek, a model dopiero po kliknięciu.
22. Klocek **Zapytaj AI** otwiera czat, pokazuje informację o kontekście i odpowiada na pytanie dotyczące slajdu.
23. Klocki białej tablicy i BitPaper otwierają właściwe narzędzia.
24. Prompt JSON i wskazany punkt TXT działają w czacie.
25. Obraz można załączyć do czatu.
26. Formularz kontaktowy trafia do Netlify Forms.
27. Administrator widzi i może usunąć testowe zgłoszenie.
28. **Pobierz wszystko** zapisuje komplet formularzy i odpowiedzi do JSON.
29. Prezentacja i PDF działają także w trybie `4` z dozwolonym iframe oraz w trybie `5` jako bezpośredni adres.
30. Prezentacja, PDF, film, YouTube i Google Forms działają przy docelowym udostępnianiu.
31. Kalkulatory i obie tablice się otwierają.
32. Stripe pokazuje tryb testowy.
33. Płatność `4242 4242 4242 4242` kończy się sukcesem.
34. Webhook ma odpowiedź `200`.
35. Płatność nadaje prawidłową rolę i termin.
34. Odebranie dostępu nie wykonuje przypadkowego refundu.
35. `npm test` i `npm run build` kończą się bez błędów.

## 31. Co można usuwać i jak to odzyskać

| Operacja | Skutek | Możliwość odzyskania |
| --- | --- | --- |
| Lekcja/prompt usunięty przez Studio | Commit usuwający w GitHubie | Tak, z historii Git |
| Aktywny dashboard przywrócony do wdrożenia | Wyłączenie wersji Blobs | Można ponownie opublikować posiadaną treść |
| Zgłoszenie Netlify Forms | Trwałe usunięcie odpowiedzi | Nie; wcześniej pobierz CSV |
| Konto Identity | Usunięcie konta i historii ChemDisk | Nie; Stripe zachowuje transakcje |
| Płatny dostęp | Użytkownik traci rolę | Można nadać nowy dostęp; nie jest to refund |
| Dane testowe Stripe | Usunięcie obiektów sandboxa | Nie; dotyczy tylko środowiska testowego |
| Deploy Netlify | Zmiana opublikowanej wersji kodu | Można opublikować wcześniejszy deploy |
| Token API | Unieważnienie integracji | Utwórz nowy token, zmień zmienną i wykonaj deploy |

## 32. Kopie bezpieczeństwa

Raz w miesiącu:

1. Pobierz lub sklonuj repozytorium aplikacji.
2. Pobierz lub sklonuj wszystkie repozytoria materiałów.
3. W **Panel administratora → Formularze** kliknij **Pobierz wszystko** i zachowaj ważne zgłoszenia w JSON.
4. Zanotuj konfigurację repozytoriów bez wartości tokenów.
5. Sprawdź daty wygaśnięcia tokenów.
6. Sprawdź, kto ma dostęp do GitHuba, Netlify, Google i Stripe.
7. Zachowaj kody odzyskiwania 2FA poza komputerem.

Nie kopiuj sekretów do zwykłego dokumentu udostępnionego wielu osobom.

## 33. Najczęstsze problemy

### „Brak poprawnej konfiguracji repozytorium”

- sam `GITHUB_CONTENT_TOKEN` nie wystarcza;
- dodaj `GITHUB_CONTENT_REPOSITORY` albo poprawny `GITHUB_CONTENT_REPOSITORIES`;
- sprawdź `owner/repo`, `main` i JSON;
- uruchom deploy.

### Repo jest wybrane, ale plików nie widać

- sprawdź foldery `lessons` i `prompts`;
- sprawdź rozszerzenia `.md`, `.json`, `.txt`;
- sprawdź uprawnienie tokenu **Contents: Read and write**;
- odśwież po około 20 sekundach;
- sprawdź, czy token organizacji nie czeka na zatwierdzenie.

### Nie mogę utworzyć nowej lekcji

- kliknij **Nowa lekcja**;
- podaj nazwę kończącą się `.md`;
- wybierz skonfigurowane repo;
- upewnij się, że token ma zapis;
- przy pustym pliku wczytaj go — builder przygotuje szablon.

### Administrator nie widzi Studio

- sprawdź rolę `admin` w `app_metadata`;
- wyloguj się i zaloguj ponownie;
- sprawdź, czy konto nie ma starego tokenu sesji;
- nie próbuj nadawać uprawnień przez `user_metadata`.

### Kursant widzi ekran logowania mimo nadanej roli

- użytkownik powinien ponownie się zalogować;
- sprawdź dokładną nazwę roli;
- sprawdź, czy okres nie wygasł;
- sprawdź reguły deployu z `netlify.toml`.

### Czat nie działa

- sprawdź `GEMINI_API_KEY`;
- sprawdź limit i billing Google;
- sprawdź poprawność promptu;
- sprawdź aktywny dostęp kursanta;
- sprawdź log funkcji `chat`.

### Stripe pokazuje brak konfiguracji

- wymagane są jednocześnie `STRIPE_SECRET_KEY` i `STRIPE_WEBHOOK_SECRET`;
- oba muszą pochodzić z tego samego sandboxa albo tego samego środowiska live;
- po zmianie wykonaj deploy.

### Płatność jest w Stripe, ale brak dostępu

- sprawdź zdarzenia webhooka;
- wymagane są `checkout.session.completed` i `checkout.session.async_payment_succeeded`;
- sprawdź URL endpointu;
- sprawdź odpowiedź HTTP i log `stripe-webhook`;
- sprawdź, czy sekret `whsec_` pochodzi z tego endpointu.

### Formularza nie ma w Netlify

- aplikacja musi zostać wdrożona przez Netlify;
- sprawdź, czy wykrywanie formularzy jest włączone;
- wyślij testowe zgłoszenie;
- sprawdź zakładkę Forms i filtr spamu.

### Google lub YouTube jest puste

- sprawdź udostępnianie pliku;
- sprawdź, czy film pozwala na osadzanie;
- sprawdź poprawność ID;
- wyłącz na próbę rozszerzenie blokujące skrypty lub cookies;
- sprawdź konsolę i ruch sieciowy przeglądarki.

### Zmiana zmiennej nie pomogła

- sprawdź pisownię;
- sprawdź zakres Functions;
- sprawdź kontekst Production;
- uruchom nowy deploy;
- upewnij się, że oglądasz właściwy projekt i domenę.

## 34. Obsługa postępów uczniów

### 34.1. Pierwsze uruchomienie

Nie dodawaj nowej bazy ani zmiennych środowiskowych. Postęp korzysta z istniejących `NETLIFY_API_TOKEN` i `SITE_ID`. Po wdrożeniu:

1. zaloguj się jako administrator;
2. otwórz **Studio → Dashboard Builder**;
3. kliknij tło dashboardu i ustaw globalne śledzenie, widoczność pasków oraz rejestrowanie otwarć;
4. dla działów, harmonijek i materiałów ustaw `Dziedzicz`, `Włączone` albo `Wyłączone` oraz opcjonalną wagę;
5. opublikuj dashboard — publikacja zapisze komentarze konfiguracyjne w Markdown i zsynchronizuje katalog postępu;
6. dla lekcji otwórz Lesson Builder, ustaw tryb nawigacji oraz opcje poszczególnych kroków i opublikuj lekcję;
7. otwórz materiał z konta testowego, a następnie sprawdź **Panel administratora → Postępy**.

Brak nowych pól w starym dashboardzie lub lekcji używa bezpiecznych wartości domyślnych. Wyłączenie funkcji nie kasuje już zapisanych danych.

### 34.2. Jak ustawiać dziedziczenie

Kolejność to: ChemDisk → dział → sekcja/harmonijka → kolejna harmonijka → materiał. `INHERIT` przyjmuje ostatnie jawne `ON` lub `OFF`. Studio pokazuje obok kontrolki stan efektywny.

Przykład: dział `ON`, sekcja `OFF`, prezentacja `INHERIT` oznacza efektywne `OFF`. Ustawienie tej prezentacji na `ON` włącza ją niezależnie. Widoczność paska jest osobnym ustawieniem: można ukryć pasek uczniowi i nadal liczyć postęp do raportu administratora.

Nie ma osobnych flag „Uwzględniaj” dla sekcji, działu i kursu. Efektywnie włączony element automatycznie wpływa na każdego rodzica. Sekcja liczy włączone dzieci, dział liczy włączone sekcje, a kurs liczy włączone działy. Waga określa wpływ elementu na jego bezpośredniego rodzica; element z wagą `3` wpływa trzy razy bardziej niż sąsiedni element z wagą `1`.

### 34.3. Ustawienia lekcji

W Lesson Builderze wybierz lekcję, aby ustawić nawigację swobodną lub sekwencyjną. Następnie wybierz krok i skonfiguruj:

- stabilny `stepId`;
- uwzględnianie w procencie lekcji;
- osobną wymagalność do przejścia dalej;
- warunek przejścia i opcjonalny minimalny wynik.

Nie używaj numeru kroku jako ręcznego identyfikatora. `stepId` ma pozostać taki sam po zmianie kolejności. Krok dodatkowy może nie wpływać na procent, a nadal być wymagany — są to dwie różne opcje.

W trybie sekwencyjnym serwer blokuje nieznane i zbyt odległe kroki. W raporcie użytkownika administrator może ustawić pomijanie według lekcji, dozwolone lub zabronione oraz ręcznie ustawić, odblokować albo zablokować krok. Dla klocka egzaminowego można wymagać ukończenia, zaliczenia albo minimalnego wyniku. Serwer sprawdza aktualny wynik Exam Engine przed odblokowaniem kolejnego kroku.

### 34.4. Czytanie raportu

Lista użytkowników pokazuje konta Identity także wtedy, gdy nie mają jeszcze rekordu postępu. Można wyszukiwać po nazwie, e-mailu i ID, filtrować stan oraz sortować po aktywności, postępie, nazwie albo e-mailu.

Po kliknięciu konta zobaczysz procent kursu i kompaktową listę najwyższych działów. Kliknij wiersz, aby wczytać jego szczegóły, przyciski administracyjne i bezpośrednie dzieci; kolejne poziomy rozwija się tak samo. Ustawienia ucznia i reset całego kursu są schowane w osobnym rozwijanym bloku. Otwarcie zwykłego materiału innego niż lekcja, Quiz ChemDisk i egzamin zalicza go na 100%; lekcja liczy wykonane kroki, natywny quiz kończy się dopiero po sprawdzeniu odpowiedzi, a egzamin liczy zapisane odpowiedzi i kończy postęp dopiero po wysłaniu lub timeoutcie. Dla PDF, prezentacji, quizu i filmu zachowane dane szczegółowe trzeba interpretować osobno: wynik pozostaje oddzielony od samego postępu. Dla filmu wiarygodne są zakresy odtworzone przez kontrolowany player, a wynik quizu i egzaminu pozostaje zapisany osobno.

Google Slides, Google Drive i Google Forms są obcymi iframe'ami. ChemDisk nie może samodzielnie odczytać ich wewnętrznej nawigacji. Moduł zostanie zaliczony przy otwarciu, ale dokładną pozycję lub wynik zobaczysz tylko dla odtwarzacza, który emituje zweryfikowane komunikaty integracyjne ChemDisk.

Sekcja **Raporty globalne i historia zmian** pokazuje rozkład kont w czterech przedziałach wraz z ich udziałem procentowym. „Otwarte, ale nieukończone” jest wskaźnikiem pomocniczym, a nie dowodem porzucenia nauki: oznacza wyłącznie zapisane otwarcie bez statusu ukończenia. Historia zmian obejmuje operacje administratorów, nie zwykłą aktywność kursantów; każdy wpis opisuje czynność, ucznia, materiał, zmianę wartości, czas i administratora.

### 34.5. Reset i ręczne zmiany

W raporcie ucznia można oznaczyć materiał jako ukończony/nieukończony oraz zresetować materiał, sekcję, dział lub cały kurs. Reset wymaga potwierdzenia. Każda operacja administratora trafia do audit logu razem z administratorem, użytkownikiem, zakresem, poprzednią i nową wartością oraz czasem.

Kursant może zresetować pojedynczy własny materiał przy pasku na dashboardzie albo cały własny kurs z karty postępu lub ustawień profilu. Funkcja używa wyłącznie zalogowanej sesji i nie pozwala wskazać innego użytkownika.

Usunięcie elementu w Dashboard Builderze zaczyna obowiązywać po publikacji. Jego rekordy zostają logicznie unieważnione dla wszystkich kursantów i przestają wpływać na raporty oraz agregaty. System nie skanuje przy tym całego magazynu Blobs; sprząta wpis danego użytkownika przy jego następnym odczycie lub zapisie. Ponowne użycie tego samego ID nie przywraca starego postępu.

Wyłączenie śledzenia nie jest resetem. Aby zachować historię, użyj przełącznika `OFF`; aby usunąć stan konkretnego użytkownika, użyj jawnej operacji resetu.

### 34.6. Diagnostyka

- brak zakładki **Postępy**: sprawdź świeżą rolę `admin` i ponowne logowanie;
- `PROGRESS_STORAGE_UNAVAILABLE`: sprawdź `NETLIFY_API_TOKEN`, `SITE_ID` oraz dostęp tokenu do witryny;
- materiał inny niż lekcja nie zalicza się po otwarciu: sprawdź, czy tracking jest efektywnie `ON`, materiał jest opublikowany w katalogu i nie jest kontenerem;
- brak paska przy zapisanym procencie: sprawdź dziedziczone `showProgress`;
- lekcja nie pozwala przejść dalej: sprawdź tryb sekwencyjny, warunek poprzedniego kroku oraz nadpisanie użytkownika;
- nowy materiał nie wchodzi do procentu kursu: opublikuj ponownie Dashboard Builder, aby zsynchronizować katalog;
- dane po `OFF` nadal są w raporcie: to prawidłowe — historia jest zachowywana.

### 34.7. Kontrola przed produkcją

Uruchom `npm test` i `npm run build`, a następnie przetestuj dwa różne konta. Próba wysłania `userId` do funkcji kursanta ma zostać odrzucona, zwykły użytkownik nie może wywołać endpointu administratora, a skok w lekcji sekwencyjnej ma zwrócić blokadę. Sprawdź też zapis otwarcia przy globalnym `OFF`, reset każdego zakresu, wagi, dziedziczenie i audit log.

## 35. Exam Builder i obsługa egzaminów

### 35.1. Przygotowanie repozytorium

Exam Builder używa tego samego prywatnego repozytorium i tokenu co Lesson Builder. Nie dodawaj drugiego tokenu ani nowej bazy. Po pierwszym zapisie repo otrzyma strukturę:

```text
exams/
├── question-bank.json
└── identyfikator-egzaminu/
    ├── exam.json
    └── photos/
```

`exam.json` przechowuje definicję i klucz odpowiedzi. Przy dostępie dla wybranych osób zapisuje również ich stabilne ID, ale nie nazwy ani e-maile. Próby uczniów są zapisywane wyłącznie w Netlify Blobs `chemdisk-exams`, a postęp kursu nadal w istniejącym `chemdisk-progress`. Nie dodawaj prób, wyników ani profili użytkowników do GitHuba.

### 35.2. Utworzenie pierwszego egzaminu

1. Zaloguj się jako administrator i otwórz **Studio treści → Egzamin**.
2. Wybierz repozytorium treści.
3. Kliknij **Nowy**.
4. W **Informacje** wpisz trwały identyfikator małymi literami, nazwę, opis, instrukcję, komunikaty i próg zaliczenia.
5. Dodaj pytania w zakładce **Pytania** albo utwórz je w **Banku pytań** i dołącz do egzaminu.
6. Przejdź kolejno przez zakładki wyświetlania, nawigacji, czasu, losowania, punktacji, prób, dostępu, bezpieczeństwa i wyników.
7. Kliknij **Zapisz draft** i sprawdź **Podgląd ucznia**.
8. Gdy konfiguracja jest gotowa, kliknij **Opublikuj**.

Draft jest zapisany w GitHubie, ale zwykły kursant go nie otworzy. Podgląd administratora używa izolowanej próby: nie zużywa limitu, nie trafia do raportów i nie zmienia postępu.

### 35.3. Pytania i bank

Obsługiwane są: jedna odpowiedź, wiele odpowiedzi, prawda/fałsz, krótki tekst, liczba, dopasowywanie, kolejność i uzupełnianie luk. Każde pytanie ma stabilne `questionId`. Nie zmieniaj go po użyciu pytania, jeżeli chcesz zachować czytelną analizę historycznych prób.

Bank pozwala tworzyć, edytować, duplikować, usuwać, wyszukiwać, tagować i kategoryzować pytania. Dołączenie pytania z banku zapisuje odwołanie, a nie drugą kopię. Pytanie usunięte z banku trzeba również usunąć z listy odwołań egzaminu; Builder nie opublikuje brakującej referencji.

Najpierw zapisz draft, aby w repozytorium istniał `exams/<examId>/exam.json`. Następnie w zakładce **Informacje** lub przy edycji pytania kliknij **Media Manager**. Możesz przeciągnąć obraz, wybrać kilka plików albo wkleić obraz przez `Ctrl+V`/`Cmd+V`, a potem wskazać go jako okładkę, obraz pytania, konkretnej odpowiedzi, strony dopasowania albo elementu kolejności. Zakładka lokalna zapisuje plik w `exams/<examId>/photos/`, a wspólna w `assets/shared/`. Studio pokazuje miniaturę i pole ALT. Na końcu ponownie kliknij **Zapisz draft**, aby utrwalić referencję w `exam.json`.

Jednorazowo można wgrać do ośmiu obrazów pytania albo jedną okładkę. Każdy plik może mieć maksymalnie 4 MB i musi być prawidłowym PNG, JPG/JPEG, WEBP, GIF albo bezpiecznym SVG. Serwer sprawdza sygnaturę i odrzuca aktywną zawartość SVG, niezgodny typ oraz ścieżki wychodzące poza dozwolony folder. Usunięcie obrazu z pola pytania usuwa referencję z definicji; sam plik usuwa się jawnie w Media Managerze lub eksploratorze.

### 35.4. Najważniejsze ustawienia

- **Wyświetlanie**: jedno pytanie, określona liczba na ekran albo wszystkie.
- **Nawigacja**: cofanie, swobodne przechodzenie, pomijanie, wymagana odpowiedź i oznaczanie do sprawdzenia.
- **Czas**: brak limitu, limit egzaminu albo limit pytania; countdown, count up lub ukryty timer. Ukrycie licznika nie wyłącza limitu serwera.
- **Losowanie**: kolejność pytań/odpowiedzi, liczba z całej puli i limity kategorii.
- **Punktacja**: jednakowe lub indywidualne punkty, częściowe, ujemne oraz strategia wielu odpowiedzi. Tekst może mieć kilka akceptowanych wariantów, a liczba tolerancję.
- **Próby**: jedna, ograniczona liczba albo bez limitu; cooldown oraz wynik najlepszy, pierwszy, ostatni lub średni.
- **Dostęp**: zawsze, od/do daty albo zakres oraz wszyscy uprawnieni lub tylko osoby wybrane wyszukiwarką.
- **Wyniki**: prawidłowa odpowiedź od razu po zatwierdzeniu pytania, dopiero po zakończeniu całego testu albo nigdy; dodatkowo widoczność procentu, punktów, zaliczenia, własnych odpowiedzi, wyjaśnień i czasu.

W zakładce **Dostęp** ustaw **Tylko wybrane osoby**, wpisz co najmniej dwa znaki imienia, nazwiska, e-maila lub ID i kliknij znalezione konto. Wybrani pojawią się jako małe etykiety nad wyszukiwarką. Wyszukiwanie dociąga całą stronicowaną listę z Netlify Identity; przycisk **Wczytaj całą listę użytkowników** pozwala zrobić to od razu. Usunięcie etykiety odbiera przydział po ponownym opublikowaniu egzaminu. Pusta lista nie przejdzie walidacji. Osoba nadal potrzebuje aktywnej roli dostępu do kursu.

W trybie **Od razu po zatwierdzeniu** uczeń używa osobnego przycisku **Zatwierdź i sprawdź odpowiedź**. Po ujawnieniu prawidłowej odpowiedzi pole jest blokowane, a Function odrzuci również ręczną próbę późniejszego nadpisania. Tryb **Dopiero po zakończeniu całego testu** nie ujawnia klucza podczas aktywnej próby. Tryb **Nigdy — pełny wynik tylko dla administratora** pokazuje uczniowi tylko potwierdzenie zapisania próby; wynik i klucz pozostają w raporcie administratora.

### 35.5. Egzamin w Dashboardzie i lekcji

W Dashboard Builderze dodaj kartę **Egzamin**, wybierz repo i egzamin, ustaw opis oraz postęp, a następnie opublikuj dashboard. Uczeń zawsze otwiera wspólny Exam Player.

W Lesson Builderze dodaj klocek **Egzamin z biblioteki** i wybierz:

- opcjonalny;
- wymagane ukończenie;
- wymagane zaliczenie;
- wymagany minimalny wynik.

Lokalne minimum lekcji, np. 75%, nie zmienia globalnego progu egzaminu, np. 60%. Krok może być wyłączony z procentu lekcji i jednocześnie wymagany do przejścia — są to niezależne ustawienia. Lekcja przechowuje tylko `repositoryId` i `examId`, więc ten sam egzamin może być użyty w wielu lekcjach.

### 35.6. Próba ucznia

Po kliknięciu **Rozpocznij** serwer zapisuje zestaw i kolejność pytań, czas startu, ewentualny termin końca i numer próby. Zaznaczenie odpowiedzi działa natychmiast i jest buforowane w `sessionStorage` bieżącej karty. Zmienione odpowiedzi trafiają na serwer jedną paczką mniej więcej co 8 sekund albo razem z przejściem, zatwierdzeniem pytania lub zakończeniem próby. Nowe pytanie pojawia się od razu, natomiast Function potwierdza nawigację w tle i nadal sprawdza jej reguły server-side. Odświeżenie strony odtwarza najnowszy stan serwerowy oraz niezapisany bufor tej karty, jeżeli konfiguracja pozwala wrócić. Bufor jest usuwany po zakończeniu próby i nie zawiera klucza odpowiedzi.

Jeśli administrator włączył informację natychmiastową, samo zaznaczenie lub autosave jeszcze niczego nie ujawnia. Dopiero zatwierdzenie konkretnego pytania zapisuje nieodwracalny stan tego pytania i pobiera z serwera ograniczoną informację zwrotną. Pozostałe pytania aktywnej próby nadal nie zawierają klucza.

Timer i punktacja są serwerowe. Przesunięcie zegara urządzenia, edycja HTML ani wysłanie własnego procentu nie zmienia wyniku. System nie zapisuje historii każdego kliknięcia ani każdego przejścia. Rejestruje cykl próby oraz alerty: wyjście kursorem poza stronę, kopiowanie, wklejanie i otwarcie menu prawego przycisku. Administrator widzi je w zwijanej sekcji **Sygnały wymagające uwagi** raportu próby. Alerty są ograniczane częstotliwościowo i mają charakter pomocniczy — pasek przeglądarki, menu systemowe lub ograniczenia przeglądarki mogą wpływać na ich znaczenie, a zamknięcie karty nie zawsze da się dostarczyć do serwera. Event log nie jest pełnym proctoringiem.

`progressPercent` oznacza część egzaminu z zapisaną odpowiedzią, a `scorePercent` wynik merytoryczny. Samo otwarcie nie kończy egzaminu. Globalne wyłączenie pasków postępu nie wyłącza zapisu odpowiedzi, timerów ani wyników egzaminu.

### 35.7. Raporty i reset

W Exam Builderze otwórz egzamin i zakładkę **Raporty**. Najpierw zobaczysz zbiorcze metryki i kompaktową listę prób. Dopiero rozwinięcie konkretnej próby pobiera pytania, odpowiedzi ucznia, klucz, punkty, kolejność i event log. Analiza pytań pokazuje odsetek poprawnych/błędnych odpowiedzi, dystrybucję, częsty błędny dystraktor oraz ranking najłatwiejszych i najtrudniejszych.

W **Panel administratora → Postępy → użytkownik → egzamin** rozwiń **Próby egzaminu, wyniki i czas**. Lista jest pobierana dopiero wtedy, więc raport użytkownika nie tworzy od razu ogromnej strony. Możesz zresetować pojedynczą próbę; wynik kursu zostanie przeliczony z pozostałych prób, a operacja pojawi się w audit logu.

Przed usunięciem egzaminu Builder sprawdza Dashboard i lekcje w wybranym repozytorium oraz pokazuje znalezione miejsca. Najpierw usuń lub zmień odwołania. Sam commit usuwający `exam.json` można odzyskać z historii Git, ale nie naprawia on automatycznie kart ani kroków lekcji.

### 35.8. Koszt i diagnostyka

Egzamin wykonuje więcej wywołań Functions niż zwykły materiał, ale odpowiedź nie jest już zapisywana osobnym żądaniem przed każdą zmianą pytania. Zmiany są grupowane co około 8 sekund, a nawigacja, zatwierdzenie i submit przenoszą oczekujące odpowiedzi w tym samym atomowym żądaniu. Przy 60 pytaniach wyświetlanych pojedynczo pełne przejście bez dodatkowych obrazów, alertów i trybu natychmiastowego to zwykle około 63 wywołania Function: definicja, otwarcie, start, 59 przejść i zakończenie. Dodatkowe autosave pojawią się tylko wtedy, gdy uczeń pozostaje na pytaniu dłużej niż interwał; alerty i indywidualne zatwierdzenia również są osobnymi wywołaniami. Raporty korzystają z indeksów zamiast skanować cały magazyn. Wyłączenie centralnego postępu zatrzymuje procent kursu, lecz nie może zatrzymać przechowywania samej próby.

Najczęstsze problemy:

- `EXAM_NOT_PUBLISHED`: zapisałeś draft, ale nie kliknąłeś **Opublikuj**;
- `ATTEMPT_LIMIT_REACHED`: użytkownik wykorzystał limit; zresetuj właściwą próbę albo zmień konfigurację;
- `ATTEMPT_COOLDOWN`: nie minął wymagany odstęp;
- brak egzaminu na liście: sprawdź repozytorium i odśwież bibliotekę;
- brak obrazu: sprawdź ścieżkę względem katalogu egzaminu, format, wielkość i ALT;
- krok lekcji nadal zablokowany: sprawdź wymaganie lokalne, ostatni wynik oraz czy próba została zakończona;
- `EXAM_STORAGE_UNAVAILABLE`: sprawdź `NETLIFY_API_TOKEN`, `SITE_ID` i log Function;
- konflikt zapisu: druga karta ma nowszą rewizję; odśwież próbę, zamiast nadpisywać ją ręcznie.

Po wdrożeniu przetestuj pełny obieg na dwóch kontach: Dashboard → start → autosave → odświeżenie → wynik → raport, a potem Lekcja → egzamin niezaliczony → blokada oraz kolejna zaliczona próba → odblokowanie.

## 36. Bezpieczeństwo i ograniczenia

- Prywatne repo chroni pliki przed przypadkowym publicznym odczytem, ale kursant z dostępem musi otrzymać treść lekcji, aby ją zobaczyć.
- Maski PDF/YouTube utrudniają typowe kliknięcie lub pobranie, ale nie są DRM.
- Publiczne obrazy są dostępne dla każdego, kto zna ich adres.
- Prompt czatu jest pobierany serwerowo i nie jest wysyłany kursantowi jako konfiguracja.
- Każdy sekret przechowuj tylko po stronie Netlify Functions.
- Produkcja i testy powinny używać innych witryn Netlify, repo materiałów, tokenów oraz sandboxa Stripe.
- Tokeny ustawiaj z datą wygaśnięcia i regularnie je wymieniaj.
- Po odejściu administratora odbierz mu dostęp do GitHuba, Netlify, Google i Stripe.
- Włącz 2FA we wszystkich usługach.
- Nie publikuj danych osobowych kursantów w repozytoriach.

## 37. Lista przed uruchomieniem produkcji

- [ ] Mam dostęp do repozytorium aplikacji otrzymanego od właściciela.
- [ ] Netlify publikuje `public` i uruchamia `netlify/functions`.
- [ ] Identity jest włączone.
- [ ] Rejestracja ma właściwy tryb.
- [ ] Pierwszy administrator ma rolę `admin`.
- [ ] Prywatne repo materiałów ma `lessons`, `prompts` i `exams`.
- [ ] Token GitHub ma dostęp tylko do wybranych repo.
- [ ] `GITHUB_CONTENT_REPOSITORY` albo `GITHUB_CONTENT_REPOSITORIES` jest ustawione.
- [ ] Co najmniej jedna konfiguracja w **AI / Modele** przechodzi test albo działa awaryjny klucz ENV.
- [ ] `NETLIFY_API_TOKEN` należy do konta z dostępem do projektu.
- [ ] Stripe sandbox i webhook przechodzą test.
- [ ] Wszystkie formularze są widoczne.
- [ ] Zwykły kursant nie widzi narzędzi administratora.
- [ ] Wszystkie moduły używane w dashboardzie zostały otwarte.
- [ ] Wykonano test płatności i dostępu.
- [ ] `npm test` i `npm run build` przechodzą.
- [ ] Dashboard Builder opublikował katalog postępu, a ustawienia efektywne są zgodne z planem kursu.
- [ ] Dwa konta testowe nie mogą odczytać swoich wzajemnych postępów.
- [ ] Reset i ręczne oznaczenie ukończenia są widoczne w audit logu.
- [ ] Opublikowany egzamin przechodzi pełny test Dashboard → wynik → raport.
- [ ] Aktywna próba nie pokazuje klucza odpowiedzi, a dwa konta nie odczytują wzajemnych prób.
- [ ] Natychmiastowa odpowiedź ujawnia tylko zatwierdzone pytanie i nie pozwala go później zmienić.
- [ ] Wyszukiwarka odbiorców znajduje konto po imieniu, e-mailu i ID, a niewybrana osoba dostaje odmowę.
- [ ] Wymagany egzamin blokuje i odblokowuje krok lekcji zgodnie z wynikiem.
- [ ] Produkcyjne sekrety są ograniczone do Production.
- [ ] Utworzono kopię materiałów i zapisano procedurę odzyskania.

## 38. Limity, koszty i raporty AI

### 38.1. Pierwsza konfiguracja

1. Upewnij się, że Netlify ma `NETLIFY_API_TOKEN` z dostępem do bieżącej witryny oraz automatyczne `SITE_ID`.
2. W **Panel administratora → AI / Modele** utwórz konfigurację, zapisz klucz i sprawdź połączenie.
3. Otwórz **AI Limity**. Ustaw strefę czasową IANA, najczęściej `Europe/Warsaw`, walutę raportu oraz progi ostrzeżeń.
4. Wybierz warstwę. Puste pole oznacza brak limitu; `0` blokuje pierwsze żądanie w danym zakresie.
5. Kliknij **Zapisz wszystkie limity**. Reguły obowiązują od kolejnego requestu.

Możesz mieć jednocześnie np. 20 requestów/godzinę, 100/dzień i 1000/miesiąc. Żądanie przechodzi tylko wtedy, gdy spełnia wszystkie reguły globalne, użytkownika, modułu per użytkownik, dostawcy i konfiguracji. Tryb indywidualny:

- **Dziedzicz domyślne** — bierze domyślny limit użytkownika;
- **Własne limity** — używa tabeli konkretnego konta;
- **Bez limitu użytkownika** — pomija limity per-user, modułu i konfiguracji per-user, ale nadal respektuje limity globalne i dostawcy;
- **AI wyłączone** — serwer zwraca `AI_DISABLED_FOR_USER` bez kontaktu z providerem.

Limit modułu jest liczony per użytkownik. Wpisuj stabilne ID, np. `chat`, `aiGrader`, `aiForms` albo ID nowego modułu używane przez jego backend. Limit providera obejmuje cały ruch OpenAI albo Gemini. Dla `aiConfigId` dostępny jest limit globalny i osobny limit per-user.

### 38.2. Cennik i jawny fallback

W warstwie konfiguracji ustaw cenę tokenów wejścia i wyjścia za 1 000 000 tokenów. Nie kopiuj ceny „na zawsze”: zmieniaj ją po zmianie cennika dostawcy. Raport oznacza koszt jako szacowany. Limity kosztu wpisuje się w mikrojednostkach, czyli `1 000 000` odpowiada jednej jednostce wybranej waluty.

Fallback ustaw jawnie na konkretnej konfiguracji A, wskazując konfigurację B. Nie twórz pętli. Nieustawiony fallback oznacza brak przełączenia. Jeśli primary wykona provider call i dostanie `429`, awarię, błąd klucza albo brak modelu, ten call liczy się jako jeden request; fallback przechodzi własne limity i, jeśli zostanie wywołany, liczy się jako drugi.

### 38.3. Raport i reset

Raport dzień/tydzień/miesiąc pokazuje paski globalne, aktywnych użytkowników oraz tabele dostawców, modeli, konfiguracji, modułów i kont. **Szczegóły** użytkownika pokazują dzień, tydzień, miesiąc oraz rozbicie ruchu. **Wyzeruj** wymaga potwierdzenia, czyści tylko licznik tego konta i zapisuje operację w audycie; sumy globalne pozostają historycznie prawdziwe.

Jeżeli **Pokaż uczniowi własne limity** jest włączone, chat pokazuje użytkownikowi wyłącznie jego dzień i miesiąc. Parametr `userId` w adresie nie jest honorowany — serwer zawsze bierze ID z aktualnej kanonicznej sesji.

Najważniejsze komunikaty:

- `AI_*_LIMIT_REACHED` — wewnętrzny limit ChemDisk, HTTP 429;
- `AI_RATE_LIMITED` — limit po stronie providera;
- `AI_PROVIDER_ERROR` — awaria providera;
- `AI_INVALID_KEY` — klucz odrzucony;
- `AI_LIMIT_STORAGE_UNAVAILABLE` — brak bezpiecznej możliwości sprawdzenia limitu; request nie idzie do providera;
- `AI_USAGE_RECORD_FAILED` — provider został wywołany, ale bezpieczne domknięcie wpisu usage nie powiodło się.

### 38.4. Landing Page Builder

1. Otwórz **Studio treści → Landing Page Builder**.
2. Ustaw logo, tekst alternatywny, tytuł strony i opis SEO w panelu **Branding i SEO**.
3. Wybierz sekcję. Zmień tytuł, podtytuł, opis, obraz, CTA i kolory.
4. Obok pola logo lub obrazu kliknij **Wybierz / dodaj z GitHuba**, aby wyszukać plik, skopiować jego URL CDN albo wgrać nowy obraz przeciągnięciem, wklejeniem lub wyborem z dysku.
5. Przeciągnij sekcję albo użyj strzałek. Przełącznik **Widoczna** ukrywa ją po publikacji bez kasowania treści.
6. Sprawdź widok desktopowy i mobilny. `Ctrl+S` lub `Cmd+S` zapisuje draft.
7. Kliknij **Zapisz draft**, aby zachować pracę bez zmiany strony publicznej.
8. Sprawdź bezpieczny podgląd i kliknij **Opublikuj**. Na końcu otwórz stronę główną w nowej karcie.

Do biblioteki assetów dodaj w Netlify:

```dotenv
GITHUB_SITE_ASSETS_TOKEN=github_pat_TUTAJ_WKLEJ_TOKEN
GITHUB_SITE_ASSETS_DIRECTORY=
```

Kod celowo używa jednego stałego repo `Kuczis-Media/logo` na gałęzi `main`, aby logo i favicon zawsze pochodziły z tego samego miejsca. Repozytorium musi pozostać **Public**. Utwórz osobny fine-grained token ograniczony wyłącznie do tego repo i nadaj mu **Repository permissions → Contents: Read and write**. Nie używaj tokenu do prywatnych materiałów, jeśli może mieć węższy zakres. Po zmianie zmiennych wykonaj deploy. Samo późniejsze dodanie obrazu z Buildera nie wymaga deployu.

Nowy upload dostaje unikalną nazwę i zwraca adres jsDelivr przypięty do SHA commita. Dzięki temu przeglądarka pobiera logo, favicon i obrazy bezpośrednio z CDN; Function działa tylko podczas listowania lub uploadu w panelu administratora. Token GitHub nie trafia do kodu strony. Wklejony adres `github.com/.../blob/...` albo `raw.githubusercontent.com/...` jest automatycznie przeliczany na jsDelivr.

Wszystkie statyczne strony mają jeden favicon: `https://cdn.jsdelivr.net/gh/Kuczis-Media/logo@main/benzene-ring.svg`. Zmiana pliku pod tą samą nazwą może być widoczna z opóźnieniem cache CDN; do wersjonowanych obrazów landing page Builder używa URL z SHA commita.

Edytor zachowuje lokalną kopię niezapisanego draftu, ostrzega przed zamknięciem karty i pozwala przywrócić ostatnią wersję opublikowaną. Serwer wykrywa zapis oparty na starej rewizji, więc druga sesja administratora nie nadpisze po cichu nowszej pracy.

Publiczny odczyt landingu ma krótki cache Netlify CDN z odświeżaniem w tle. Endpointy administratora pozostają bez cache, a obrazy nigdy nie są proxy'owane przez Function. Konfiguracja `node_bundler = "esbuild"` w `netlify.toml` zmniejsza paczki Functions i ich zimny start.

Obraz musi używać HTTPS albo ścieżki lokalnej `/...`. CTA przyjmuje kotwicę `#sekcja`, ścieżkę lokalną lub HTTPS. Builder nie obsługuje wklejania HTML/JavaScript; tekst jest renderowany jako tekst, więc próba `<script>` nie jest wykonywana. Opublikowany model jest w `chemdisk-landing`, a statyczne `public/index.html` pozostaje awaryjną wersją przy braku Blobs.

### 38.4.1. Generator pliku `.env`

Generator otworzysz z karty **Studio → Generator .env** albo z zakładki **Panel administratora → Materiały**. Działa bez wywoływania Netlify Functions i pozwala:

- wypełnić gotowe zmienne ChemDisk;
- dodać własne nazwy i wartości;
- zaimportować istniejący `.env` wyłącznie lokalnie;
- ukryć lub podejrzeć pola sekretów;
- skopiować pełny plik albo same nazwy zmiennych;
- pobrać gotowy plik o nazwie `.env`.

Wpisane tokeny i klucze istnieją tylko w bieżącej karcie. Generator nie wysyła ich do serwera i nie zapisuje w `localStorage`. Fine-grained PAT GitHuba jest bezpłatny; płatny plan może być potrzebny jedynie do wybranych mechanizmów automatycznego zarządzania sekretami Netlify. Na planie bez tej możliwości skopiuj wartości ręcznie do **Project configuration → Environment variables**, wybierz właściwy kontekst i uruchom deploy. Pobrany `.env` trzymaj poza Gitem.

### 38.5. Store'y Netlify Blobs dodane dla AI i landing page

- `chemdisk-ai-limit-config` — ustawienia, cenniki, fallbacki i audyt;
- `chemdisk-ai-usage` — agregaty, krótkie rezerwacje i ograniczony log szczegółowy;
- `chemdisk-landing` — osobny draft i opublikowany model strony.

Landing page nadal używa `NETLIFY_API_TOKEN` i `SITE_ID` do draftu oraz publikacji. Biblioteka publicznych logo i obrazów wymaga dodatkowo `GITHUB_SITE_ASSETS_TOKEN` i opcjonalnie `GITHUB_SITE_ASSETS_DIRECTORY`; bez tokenu ręczne URL-e obrazów nadal działają, ale listowanie i upload do GitHuba są niedostępne. Klucze providerów AI nadal konfiguruj w panelu, a ENV traktuj jako migracyjny fallback.

## 39. Oficjalne źródła

- [Netlify — deploy z repozytorium](https://docs.netlify.com/start/quickstarts/deploy-from-repository/)
- [Netlify — zmienne środowiskowe](https://docs.netlify.com/build/environment-variables/get-started/)
- [Netlify — Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/)
- [Netlify — rejestracja i zaproszenia](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/registration-login/)
- [Netlify — tokeny użytkownika](https://docs.netlify.com/manage/accounts-and-billing/user-settings/)
- [Netlify — Forms](https://docs.netlify.com/manage/forms/submissions/)
- [Netlify — Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [GitHub — nowe repozytorium](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
- [GitHub — fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Google — klucze Gemini API](https://ai.google.dev/gemini-api/docs/api-key)
- [Stripe — sandboxy](https://docs.stripe.com/sandboxes)
- [Stripe — klucze API](https://docs.stripe.com/keys)
- [Stripe — webhooki](https://docs.stripe.com/webhooks)
- [Stripe — karty testowe](https://docs.stripe.com/testing)
