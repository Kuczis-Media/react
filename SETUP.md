# Pierwsze uruchomienie platformy

## Kreator przed wdrożeniem

W katalogu aplikacji uruchom:

```sh
npm run setup
```

Otwórz adres wypisany w terminalu: domyślnie **http://127.0.0.1:4319/**. Kreator nie wymaga działającej platformy, logowania do Studio, połączenia projektu z Netlify ani zainstalowanych zależności npm. Wymaga Node.js zgodnego z `package.json`. Jeśli port jest zajęty: `npm run setup -- --port=4320`.

Lokalny serwer udostępnia wyłącznie samodzielną stronę kreatora. Nie czyta istniejącego `.env`, nie odbiera formularzy, nie pobiera kluczy i nie łączy się z API. Całe generowanie odbywa się w przeglądarce; wartości nie są utrwalane w jej magazynie. Zamknięcie karty usuwa niezapisane dane. Zatrzymanie serwera: **Ctrl+C**.

Na działającej platformie ten sam formularz znajduje się w **Studio → Generator .env** i wymaga roli administratora.

## Pięć kroków

1. **Dostawca Git.** Wybierz GitHub lub Gitea. W Gitei podaj adres HTTPS swojej instancji. Niestandardowe API jest opcjonalne: domyślnie używane jest `/api/v1` tej samej instancji. Wklej token konta, które ma prawo odczytu i zapisu repozytoriów. Ten wybór dotyczy materiałów i publicznych plików; kod samej aplikacji może być przechowywany osobno.
2. **Repozytoria.** Dodaj biblioteki: nazwę w Studio oraz `właściciel/nazwa`. Możesz wkleić pełny adres repozytorium wybranego dostawcy. W sekcji dodatkowej ustaw gałąź, katalog materiałów, stałe ID i ewentualny osobny token. Jedna biblioteka jest domyślna; maksymalnie można skonfigurować 20. JSON powstaje automatycznie.
3. **Netlify.** Wpisz `NETLIFY_API_TOKEN`, wymagany do zapisu danych platformy. Opcjonalny `SITE_ID` jest UUID projektu: potrzebujesz go przy lokalnym uruchomieniu Functions; na wdrożeniu ustawia go Netlify. Pusty `SITE_ID` jest pomijany w eksporcie.
4. **Usługi.** Zaznacz używane OpenAI, Gemini, Stripe i/lub publiczne repozytorium logo i strony głównej. Wyłączone usługi nie trafiają do eksportu. AI możesz także skonfigurować po wdrożeniu, w Studio.
5. **Gotowe pliki.** Sprawdź listę brakujących pól. Pobierz konfigurację, JSON repozytoriów i instrukcję dopasowaną do zaznaczonych usług.

Kreator sprawdza format danych, ale nie sprawdza zdalnie poprawności tokenów ani istnienia repozytoriów. Brak kluczy pozwala pobrać **szablon do uzupełnienia**. Błędne adresy, niepoprawny JSON lub niespójne repozytoria blokują eksport, żeby nie pobrać poprzedniej, nieaktualnej konfiguracji.

Pobierane pliki:

| Plik | Zastosowanie |
| --- | --- |
| `platforma.env` | Wartości zmiennych i tokenów. Nazwa unika zmieniania pliku `.env` na `env.txt` przez przeglądarkę. Lokalnie zmień nazwę na `.env`; Netlify może importować `platforma.env` bez zmiany nazwy. |
| `repositories.json` | Lista bibliotek bez wartości tokenów. Ta sama lista jest już osadzona w zmiennej `GITEA_CONTENT_REPOSITORIES` albo `GITHUB_CONTENT_REPOSITORIES` w pliku ENV. Nie trzeba publikować tego JSON w repozytorium. |
| `URUCHOMIENIE.md` | Instrukcja wdrożenia, wybrane repozytoria i lista brakujących pól. Bez sekretów. |

## Utworzenie projektu i pierwszego administratora

1. Utwórz repozytorium kodu aplikacji i projekt Netlify. Repozytoria materiałów muszą istnieć osobno. Zainicjalizuj wybraną gałąź, np. pierwszym plikiem README; token nie może zapisać materiału do nieistniejącej gałęzi.
2. `netlify.toml` określa build `npm run build`, katalog publikacji `public` i katalog Functions `netlify/functions`.
3. W Netlify, w **Project configuration → Environment variables**, zaimportuj pobrany plik. Sprawdź docelowy kontekst, np. **Production**, oraz zakres obejmujący **Functions**. Jeśli plan nie pozwala oznaczać zmiennych jako sekretów, nadal pozostawiaj wartości poza kodem publicznym.
4. Włącz **Netlify Identity**. Zaproś własny adres e-mail i nadaj kontu rolę `admin` w `app_metadata.roles`. Samo wpisanie roli w `user_metadata` nie przyznaje uprawnień. W konfiguracji projektu zachowaj funkcje `identity-signup` i `identity-login`.
5. Wykonaj deploy po ustawieniu ENV. Zaloguj się przez `/login/`; w panelu kursanta pojawi się jedno wejście **Studio**.
6. W Studio otwórz **Biblioteki materiałów** i sprawdź połączenia. Dodaj pierwszą lekcję/egzamin lub skopiuj przykłady z `Examples/` do katalogu wskazanego dla biblioteki.
7. W **Edytorze panelu kursanta** dodaj opublikowane materiały do kursu i opublikuj panel. Sam zapis pliku w repozytorium nie dodaje go automatycznie do panelu ucznia.

### Token GitHub

Utwórz **fine-grained personal access token**, wybierz repozytoria i uprawnienie **Contents: Read and write**. Konto tokenu również musi mieć dostęp do tych repozytoriów. Jeżeli organizacja wymaga zatwierdzenia tokenu, zakończ ten proces przed próbą połączenia.

Wspólny token: `GITHUB_CONTENT_TOKEN`. Osobne: np. `GITHUB_CONTENT_TOKEN_BIOLOGIA`. Publiczne pliki używają `GITHUB_SITE_ASSETS_TOKEN`; importowane starsze konfiguracje mogą używać aliasu `GITHUB_TOKEN`.

[Dokumentacja tokenów GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

### Token Gitea

W swojej instancji otwórz **Settings → Applications → Generate New Token**. Token potrzebuje zapisu repozytoriów (`write:repository`) i dostępu do odpowiednich prywatnych repozytoriów. Wspólny token: `GITEA_TOKEN`; osobne: np. `GITEA_TOKEN_BIOLOGIA`.

[Dokumentacja Gitea API](https://docs.gitea.com/development/api-usage). Konfiguracja instancji i migracja: [GITEA_SETUP.md](GITEA_SETUP.md).

## JSON repozytoriów

Przykład wygenerowanej konfiguracji GitHub:

```json
[
  {
    "id": "glowne",
    "label": "Materiały główne",
    "repository": "moja-szkola/biologia",
    "ref": "main",
    "root": "",
    "tokenEnv": "GITHUB_CONTENT_TOKEN",
    "default": true
  },
  {
    "id": "chemia",
    "label": "Chemia",
    "repository": "moja-szkola/chemia",
    "ref": "main",
    "root": "kurs",
    "tokenEnv": "GITHUB_CONTENT_TOKEN_CHEMIA",
    "default": false
  }
]
```

`tokenEnv` jest **nazwą zmiennej**, a nie tokenem. Kreator zapisuje wartość osobno w ENV. ID biblioteki pozostaje częścią linków, więc przy migracji zachowaj dotychczasowe identyfikatory. Dla Gitei JSON ma taki sam schemat i nazwy tokenów `GITEA_TOKEN…`.

## Publiczne obrazy i strona główna

Użyj osobnego **publicznego** repozytorium z logo i plikami strony. Kreator odrzuca użycie tej samej biblioteki jako publicznej i jako prywatnego repo materiałów. Nie przenoś do publicznego repo kursów ani sekretów.

Po wdrożeniu ustaw źródło w **Studio → Publikacja strony głównej**, a wygląd w **Edytorze strony głównej**. Konfiguracja ENV określa połączenie, ale nie publikuje automatycznie strony. Repozytoryjny JSON można przechowywać pod `landing/config.json`; `landing/route.json` jest zarezerwowany dla ustawień źródła. Dla publicznego JSON Gitei używanego z innej domeny skonfiguruj odpowiedni CORS na publicznych trasach raw; szczegóły w `GITEA_SETUP.md`.

Jeśli nie używasz publicznego repo, stronę możesz publikować w Netlify Blobs. Włączenie modułu publicznych plików w kreatorze nie zmienia samoistnie wybranego trybu publikacji.

## Stripe i AI

- **Stripe:** zacznij od `sk_test_…`. Endpoint webhooka to `https://TWOJA-DOMENA/.netlify/functions/stripe-webhook`; włącz `checkout.session.completed` i `checkout.session.async_payment_succeeded`. Sekret tego endpointu (`whsec_…`) wpisz do ENV. Cennik i aktywację sprzedaży ustaw w **Studio → Płatności**. Przed trybem live przetestuj zakup i przyznanie dostępu.
- **AI:** klucze ENV są dostępne jako konfiguracje OpenAI/Gemini. W **Studio → Konfiguracja AI** przypisz dostawcę do czatu i oceniania. W **Limity i zużycie AI** ustaw limity. Nazwę modelu można edytować; dostępność zależy od konta dostawcy.

## Uruchomienie lokalne całej platformy

Kreator `npm run setup` jest samodzielny. Do działania całej aplikacji i paneli administratora potrzebujesz Netlify Dev oraz połączonego projektu:

```sh
npm install
# Zapisz pobrany platforma.env w katalogu projektu i zmień nazwę na .env.
npx netlify login
npx netlify link
npm run dev
```

Do testów użyj projektu testowego z jego własnym `SITE_ID` i danymi. Pliki `.env` i `platforma.env` są ignorowane przez Git. Nie umieszczaj ich w katalogu `public/`.

## Istniejąca instalacja

Użyj **Importuj istniejący .env**. Obsługiwane są starsze aliasy GitHub (`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_TOKEN`), konfiguracje pojedynczego repo i katalogi JSON. Import zachowuje identyfikatory, gałęzie, katalogi, własne zmienne i odwołania do tokenów. Niepoprawny JSON można poprawić w **Edytorze zmiennych**. Sekrety w podglądzie są domyślnie ukryte; eksport zawiera rzeczywiste wpisane wartości.

Zmiana wybranego dostawcy nie kopiuje materiałów między serwerami i nie przepisuje starych publicznych adresów. Zachowaj kopię konfiguracji przed migracją. Po imporcie ENV w Netlify konieczny jest nowy deploy.

Dalsze instrukcje: [README](readme.md), [instrukcja użytkownika](instrukcja.md), [przykładowe materiały](Examples/README.md), [import ENV do Netlify](https://docs.netlify.com/build/environment-variables/get-started/), [Netlify Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/).
