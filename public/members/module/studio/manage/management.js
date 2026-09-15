(function () {
  'use strict';

  // Studio-only management: no course loading or background polling.
  window.NextMedUI?.render('studio-price-fields', document.querySelector('.admin-prices-grid'), {});
  const elements = {
    adminTabs: Array.from(document.querySelectorAll('[data-admin-tab]')),
    adminPanels: Array.from(document.querySelectorAll('[data-admin-panel]')),
    adminProgressGlobalTracking: document.getElementById('admin-progress-global-tracking'),
    adminProgressGlobalShow: document.getElementById('admin-progress-global-show'),
    adminProgressRecordOpens: document.getElementById('admin-progress-record-opens'),
    adminProgressSaveSettings: document.getElementById('admin-progress-save-settings'),
    adminProgressMetrics: document.getElementById('admin-progress-metrics'),
    adminProgressSearch: document.getElementById('admin-progress-search'),
    adminProgressFilter: document.getElementById('admin-progress-filter'),
    adminProgressSort: document.getElementById('admin-progress-sort'),
    adminProgressRefresh: document.getElementById('admin-progress-refresh'),
    adminProgressStatus: document.getElementById('admin-progress-status'),
    adminProgressUserList: document.getElementById('admin-progress-user-list'),
    adminProgressMore: document.getElementById('admin-progress-more'),
    adminProgressDetail: document.getElementById('admin-progress-detail'),
    adminProgressGlobalReport: document.getElementById('admin-progress-global-report'),
    adminProgressAudit: document.getElementById('admin-progress-audit'),
    adminAiUsagePeriod: document.getElementById('admin-ai-usage-period'),
    adminAiUsageRefresh: document.getElementById('admin-ai-usage-refresh'),
    adminAiUsageStatus: document.getElementById('admin-ai-usage-status'),
    adminAiUsageSummary: document.getElementById('admin-ai-usage-summary'),
    adminAiUsageTimezone: document.getElementById('admin-ai-usage-timezone'),
    adminAiUsageCurrency: document.getElementById('admin-ai-usage-currency'),
    adminAiUsageShowUser: document.getElementById('admin-ai-usage-show-user'),
    adminAiWarning1: document.getElementById('admin-ai-warning-1'),
    adminAiWarning2: document.getElementById('admin-ai-warning-2'),
    adminAiWarning3: document.getElementById('admin-ai-warning-3'),
    adminAiLimitScope: document.getElementById('admin-ai-limit-scope'),
    adminAiLimitScopeIdWrap: document.getElementById('admin-ai-limit-scope-id-wrap'),
    adminAiLimitScopeId: document.getElementById('admin-ai-limit-scope-id'),
    adminAiLimitModuleWrap: document.getElementById('admin-ai-limit-module-wrap'),
    adminAiLimitModuleId: document.getElementById('admin-ai-limit-module-id'),
    adminAiLimitUserModeWrap: document.getElementById('admin-ai-limit-user-mode-wrap'),
    adminAiLimitUserMode: document.getElementById('admin-ai-limit-user-mode'),
    adminAiLimitExplanation: document.getElementById('admin-ai-limit-explanation'),
    adminAiConfigPolicy: document.getElementById('admin-ai-config-policy'),
    adminAiPriceInput: document.getElementById('admin-ai-price-input'),
    adminAiPriceOutput: document.getElementById('admin-ai-price-output'),
    adminAiFallback: document.getElementById('admin-ai-fallback'),
    adminAiLimitGrid: document.getElementById('admin-ai-limit-grid'),
    adminAiUsageSave: document.getElementById('admin-ai-usage-save'),
    adminAiUsageProviders: document.getElementById('admin-ai-usage-providers'),
    adminAiUsageModels: document.getElementById('admin-ai-usage-models'),
    adminAiUsageConfigs: document.getElementById('admin-ai-usage-configs'),
    adminAiUsageModules: document.getElementById('admin-ai-usage-modules'),
    adminAiUsageUsers: document.getElementById('admin-ai-usage-users'),
    adminAiUsersSearch: document.getElementById('admin-ai-users-search'),
    adminAiUsersCount: document.getElementById('admin-ai-users-count'),
    adminAiUsersMore: document.getElementById('admin-ai-users-more'),
    adminAiUserDetail: document.getElementById('admin-ai-user-detail'),
    adminAiUsageAudit: document.getElementById('admin-ai-usage-audit'),
    adminAiUsageAuditList: document.getElementById('admin-ai-usage-audit-list'),
    adminPricesForm: document.getElementById('admin-prices-form'),
    adminPaymentCurrency: document.getElementById('admin-payment-currency'),
    adminPaymentDisabled: document.getElementById('admin-payment-disabled'),
    adminPaymentBlockStacking: document.getElementById('admin-payment-block-stacking'),
    adminPriceHour: document.getElementById('admin-price-hour'),
    adminPriceDay: document.getElementById('admin-price-day'),
    adminPriceWeek: document.getElementById('admin-price-week'),
    adminPriceMonth: document.getElementById('admin-price-month'),
    adminPriceHalfyear: document.getElementById('admin-price-halfyear'),
    adminPriceYear: document.getElementById('admin-price-year'),
    adminEnabledHour: document.getElementById('admin-enabled-hour'),
    adminEnabledDay: document.getElementById('admin-enabled-day'),
    adminEnabledWeek: document.getElementById('admin-enabled-week'),
    adminEnabledMonth: document.getElementById('admin-enabled-month'),
    adminEnabledHalfyear: document.getElementById('admin-enabled-halfyear'),
    adminEnabledYear: document.getElementById('admin-enabled-year'),
    adminPricesStatus: document.getElementById('admin-prices-status'),
    adminPricesReload: document.getElementById('admin-prices-reload'),
    adminPricesSave: document.getElementById('admin-prices-save')
  };

  const ADMIN_USERS_URL = '/.netlify/functions/admin-users';

  const ADMIN_EXAMS_URL = '/.netlify/functions/admin-exams';

  const PAYMENT_CONFIG_URL = '/.netlify/functions/payment-config';

  const ADMIN_PROGRESS_URL = '/.netlify/functions/admin-progress';

  const ADMIN_AI_URL = '/.netlify/functions/admin-ai';

  const ADMIN_AI_USAGE_URL = '/.netlify/functions/admin-ai-usage';

  const ADMIN_PROGRESS_PAGE_SIZE = 30;

  const ADMIN_AI_USERS_PAGE_SIZE = 25;

  const ACCESS_ROLE_OPTIONS = Object.freeze([
    { value: '', label: 'Brak dostępu' },
    { value: 'active', label: 'Stały dostęp' },
    { value: 'hour', label: '1 godzina' },
    { value: 'day', label: '1 dzień' },
    { value: 'week', label: '1 tydzień' },
    { value: 'month', label: '1 miesiąc' },
    { value: 'halfyear', label: 'Pół roku' },
    { value: 'year', label: '1 rok' }
  ]);

  const COURSE_ROLE_VALUES = new Set(ACCESS_ROLE_OPTIONS.map((role) => role.value).filter(Boolean));

  const ADMIN_ROLE_VALUES = new Set(['admin', ...COURSE_ROLE_VALUES]);

  const AI_LIMIT_PERIODS = Object.freeze(['hour', 'day', 'week', 'month', 'lifetime']);

  const AI_LIMIT_METRICS = Object.freeze(['requests', 'inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostMicros']);

  const ADMIN_ERROR_MESSAGES = Object.freeze({
    ADMIN_REQUIRED: 'Ta operacja jest dostępna tylko dla administratora.',
    ACCESS_EXPIRED: 'Dostęp do kursu wygasł. Zaloguj się ponownie po odnowieniu dostępu.',
    ACCESS_REQUIRED: 'To konto nie ma aktywnego dostępu do kursu.',
    AUTH_EXPIRED: 'Sesja administratora wygasła. Zaloguj się ponownie.',
    AUTH_REQUIRED: 'Zaloguj się ponownie, aby zarządzać kontami.',
    AI_CONFIG_CONFLICT: 'Konfiguracja AI została zmieniona równocześnie. Odśwież listę i spróbuj ponownie.',
    AI_CONFIG_NOT_FOUND: 'Nie znaleziono tej konfiguracji AI.',
    AI_INVALID_KEY: 'Dostawca odrzucił klucz API.',
    AI_PERMISSION_DENIED: 'Klucz API działa, ale nie ma uprawnień do wybranego modelu lub projektu.',
    AI_MODEL_UNAVAILABLE: 'Wybrany model jest niedostępny dla tego klucza.',
    AI_NOT_CONFIGURED: 'Nie skonfigurowano jeszcze dostawcy AI.',
    AI_PROVIDER_ERROR: 'Dostawca AI jest chwilowo niedostępny.',
    AI_PROVIDER_TIMEOUT: 'Dostawca AI nie odpowiedział w ciągu 45 sekund. Spróbuj ponownie.',
    AI_RATE_LIMITED: 'Dostawca AI ograniczył liczbę żądań. Spróbuj ponownie później.',
    AI_CREDIT_BALANCE_EXHAUSTED: 'Na koncie OpenAI nie ma środków API. Dodaj środki w rozliczeniach OpenAI.',
    AI_ORGANIZATION_SPEND_LIMIT_REACHED: 'Organizacja OpenAI osiągnęła ustawiony limit wydatków.',
    AI_PROJECT_SPEND_LIMIT_REACHED: 'Projekt OpenAI osiągnął ustawiony limit wydatków.',
    AI_ORGANIZATION_USAGE_LIMIT_REACHED: 'Organizacja OpenAI osiągnęła przyznany limit użycia API.',
    AI_QUOTA_EXHAUSTED: 'Konto OpenAI nie ma dostępnego limitu API. Sprawdź środki i limity rozliczeniowe.',
    AI_SECRET_MISSING: 'Najpierw ustaw klucz API dla tej konfiguracji.',
    AI_STORAGE_INVALID: 'Zapisana konfiguracja AI jest uszkodzona.',
    AI_STORAGE_UNAVAILABLE: 'Magazyn konfiguracji AI jest chwilowo niedostępny.',
    AI_LIMIT_STORAGE_INVALID: 'Magazyn limitów AI zawiera nieprawidłowe dane.',
    AI_LIMIT_STORAGE_UNAVAILABLE: 'Magazyn limitów i użycia AI jest chwilowo niedostępny.',
    AI_LIMIT_CONFLICT: 'Użycie AI zmieniło się równocześnie. Odśwież dane i spróbuj ponownie.',
    AI_CONCURRENT_REQUEST_LIMIT_REACHED: 'Trwa zbyt wiele równoległych wywołań AI. Spróbuj ponownie za chwilę.',
    AI_COST_ESTIMATE_UNAVAILABLE: 'Nie można bezpiecznie oszacować kosztu tego wywołania. Uzupełnij cennik konfiguracji AI.',
    AI_USAGE_RESET_BUSY: 'Nie można wyzerować użycia, gdy trwa wywołanie AI. Spróbuj ponownie za chwilę.',
    AI_FALLBACK_CYCLE: 'Fallback AI tworzy niedozwoloną pętlę.',
    INVALID_AI_FALLBACK: 'Wybrany fallback AI jest nieprawidłowy.',
    INVALID_AI_LIMIT_TIMEZONE: 'Podaj poprawną strefę czasową IANA, np. Europe/Warsaw.',
    INVALID_AI_LIMIT_VALUE: 'Limit musi być pusty albo nieujemną liczbą całkowitą (zero blokuje użycie).',
    INVALID_AI_PRICING: 'Cena tokenów musi być nieujemną liczbą.',
    INVALID_AI_WARNING_THRESHOLDS: 'Progi ostrzeżeń muszą rosnąć i mieścić się od 1 do 100%.',
    RESET_CONFIRMATION_REQUIRED: 'Reset użycia wymaga wyraźnego potwierdzenia.',
    INVALID_AI_ACTION: 'Wybrano nieprawidłową operację AI.',
    INVALID_AI_CONFIG: 'Uzupełnij nazwę, dostawcę i poprawny identyfikator modelu.',
    AI_CONFIG_ID_RESERVED: 'To ID jest zarezerwowane dla konfiguracji z ENV. Utwórz konfigurację z innym ID.',
    INVALID_AI_CONFIG_ID: 'Identyfikator konfiguracji AI jest nieprawidłowy.',
    INVALID_AI_MODULE: 'Wybrano nieprawidłowy moduł AI.',
    INVALID_AI_PROVIDER: 'Wybrano nieobsługiwanego dostawcę AI.',
    INVALID_AI_SECRET: 'Klucz API ma nieprawidłowy format.',
    UNEXPECTED_FIELDS: 'Żądanie zawiera nieobsługiwane pola.',
    CANNOT_DELETE_SELF: 'Nie możesz usunąć własnego konta administratora.',
    CANNOT_REMOVE_OWN_ADMIN: 'Nie możesz odebrać roli administratora własnemu kontu.',
    CONTENT_CATALOG_INVALID: 'Plik catalog.json w repozytorium materiałów jest nieprawidłowy.',
    CONTENT_DIRECTORY_NOT_FOUND: 'Nie udało się odczytać folderu materiałów. Sprawdź gałąź i katalog główny biblioteki.',
    CONTENT_ROOT_NOT_FOUND: 'Nie znaleziono katalogu głównego materiałów. Sprawdź pole „Katalog główny” (root).',
    CONTENT_REPOSITORIES_ENV_TOO_LARGE: 'Lista repozytoriów przekracza limit wartości ENV Netlify. Skróć nazwy lub katalogi albo zmniejsz liczbę pozycji.',
    CONTENT_REPOSITORY_NOT_CONFIGURED: 'Skonfiguruj Git / Content Provider w generatorze ENV i ustaw zmienne w Netlify.',
    CONTENT_REPOSITORY_INVALID_RESPONSE: 'Serwer repozytorium zwrócił nieprawidłową odpowiedź dla wskazanego repozytorium lub katalogu.',
    CONTENT_REPOSITORY_NOT_FOUND: 'Repozytorium nie istnieje lub token nie ma do niego dostępu. Sprawdź właściciela, nazwę i uprawnienia.',
    CONTENT_REPOSITORY_AUTH_FAILED: 'Token Gitea jest nieprawidłowy lub wygasł. Administrator musi go zaktualizować.',
    CONTENT_REPOSITORY_FORBIDDEN: 'Gitea odmawia dostępu. Sprawdź uprawnienia tokenu oraz blokady serwera.',
    CONTENT_REPOSITORY_RATE_LIMITED: 'Serwer repozytorium ograniczył ruch. Spróbuj ponownie za chwilę.',
    INVALID_GITEA_URL: 'Sprawdź GITEA_BASE_URL i GITEA_API_URL w konfiguracji serwera.',
    CONTENT_REPOSITORY_UNAVAILABLE: 'Serwer repozytorium jest chwilowo niedostępny.',
    CONTENT_REPOSITORY_ADMIN_UNAVAILABLE: 'Konfigurator repozytoriów jest chwilowo niedostępny.',
    CONTENT_REPOSITORY_BRANCH_NOT_FOUND: 'Nie znaleziono wskazanej gałęzi. Sprawdź pole „Gałąź” (np. main); nowe repozytorium musi mieć pierwszy commit, np. plik README.',
    CONTENT_REPOSITORY_CONFIG_PENDING_DEPLOY: 'W Netlify jest już nowsza konfiguracja oczekująca na deploy. Uruchom deploy, poczekaj na jego zakończenie i odśwież stronę.',
    CONTENT_REPOSITORY_DEFAULT_REQUIRED: 'Wybierz dokładnie jedno repozytorium domyślne.',
    CONTENT_REPOSITORY_DEFAULT_ID_RESERVED: 'ID „default” jest zarezerwowane dla repozytorium domyślnego. Zaznacz ten wpis jako domyślny albo nadaj mu inne ID.',
    CONTENT_REPOSITORY_PRODUCTION_REQUIRED: 'Repozytoria można zmieniać tylko z produkcyjnego wdrożenia platformy. Otwórz główny adres witryny Netlify.',
    CONTENT_REPOSITORY_ROOT_NOT_DIRECTORY: 'Wskazany katalog główny jest plikiem, a nie folderem. Popraw pole „Katalog główny”.',
    CONTENT_REPOSITORY_SHARED_TOKEN_CONFLICT: 'Repozytoria korzystające z tej samej zmiennej ENV otrzymały różne tokeny. Wklej ten sam token tylko raz albo użyj osobnych zmiennych tokenów wybranego dostawcy.',
    GITHUB_CONTENT_RATE_LIMITED: 'Serwer repozytorium wyczerpał limit zapytań dla tego tokenu. Poczekaj na odnowienie limitu i spróbuj ponownie.',
    INVALID_CONTENT_REPOSITORIES: 'Uzupełnij poprawnie ID, nazwę, owner/repo, gałąź i opcjonalny katalog każdego repozytorium.',
    INVALID_CONTENT_REPOSITORY_ACTION: 'Wybrano nieprawidłową operację repozytorium.',
    INVALID_GITHUB_CONTENT_TOKEN: 'Token repozytorium ma nieprawidłowy format.',
    GITHUB_CONTENT_TOKEN_REQUIRED: 'Wklej token repozytorium albo utwórz wskazaną poniżej zmienną tokenu ręcznie w Netlify i wykonaj deploy.',
    CONTENT_WRITE_CONFLICT: 'Plik został w międzyczasie zmieniony. Wczytaj najnowszą wersję i spróbuj ponownie.',
    DASHBOARD_CONFLICT: 'Dashboard został w międzyczasie zmieniony. Wczytaj najnowszą wersję i ponów edycję.',
    DASHBOARD_INVALID: 'Treść dashboardu jest nieprawidłowa.',
    DASHBOARD_STORAGE_INVALID: 'Zapisana wersja dashboardu jest uszkodzona. Aktywuj wersję z wdrożenia.',
    DASHBOARD_STORAGE_UNAVAILABLE: 'Magazyn dashboardu jest chwilowo niedostępny.',
    DASHBOARD_OVERRIDE_NOT_SET: 'Aktywna jest wersja dashboardu z wdrożenia.',
    DASHBOARD_STORE_UNAVAILABLE: 'Magazyn dashboardu jest chwilowo niedostępny.',
    DELETE_CAPABILITY_EXPIRED: 'Potwierdzenie usunięcia wygasło. Odśwież zgłoszenia i spróbuj ponownie.',
    DELETE_CAPABILITY_INVALID: 'Potwierdzenie usunięcia jest nieprawidłowe. Odśwież zgłoszenia.',
    DELETE_CAPABILITY_REQUIRED: 'Odśwież zgłoszenia przed próbą usunięcia.',
    EXPECTED_ETAG_REQUIRED: 'Wczytaj dashboard ponownie przed zapisaniem zmian.',
    FIRST_AND_LAST_NAME_REQUIRED: 'Uzupełnij poprawne imię i nazwisko użytkownika.',
    FORM_NOT_FOUND: 'Nie znaleziono tego formularza.',
    GITHUB_CONTENT_TOKEN_REJECTED: 'Token repozytorium jest nieprawidłowy albo nie ma dostępu do wskazanego repozytorium.',
    GITHUB_CONTENT_WRITE_REJECTED: 'Token repozytorium nie ma uprawnienia do zapisu w wybranym repozytorium.',
    IDENTITY_ADMIN_UNAVAILABLE: 'Administracja kontami jest chwilowo niedostępna.',
    IDENTITY_DELETE_FAILED: 'Nie udało się usunąć konta z Identity.',
    IDENTITY_INVITE_FAILED: 'Nie udało się wysłać zaproszenia przez Identity.',
    IDENTITY_REQUEST_FAILED: 'Nie udało się pobrać danych konta z Identity.',
    IDENTITY_RESPONSE_INVALID: 'Identity zwróciło nieprawidłowe dane konta.',
    IDENTITY_UNAVAILABLE: 'Nie udało się połączyć z usługą kont.',
    IDENTITY_UPDATE_FAILED: 'Nie udało się zapisać zmian w Identity.',
    INVALID_BODY: 'Dane zmiany konta są nieprawidłowe.',
    INVALID_FIRST_NAME: 'Podaj poprawne imię (od 2 do 80 znaków).',
    INVALID_EMAIL: 'Podaj poprawny adres e-mail.',
    INVALID_ETAG: 'Wersja dashboardu jest nieprawidłowa. Wczytaj ją ponownie.',
    INVALID_FORM_ID: 'Identyfikator formularza jest nieprawidłowy.',
    INVALID_JSON: 'Dane zmiany konta są nieprawidłowe.',
    INVALID_LAST_NAME: 'Podaj poprawne nazwisko (od 2 do 80 znaków).',
    INVALID_MARKDOWN: 'Treść dashboardu jest nieprawidłowa.',
    MARKDOWN_TOO_LARGE: 'Dashboard jest zbyt duży.',
    INVALID_ROLES: 'Wybrano nieprawidłową rolę.',
    INVALID_USER_ID: 'Identyfikator użytkownika jest nieprawidłowy.',
    INVITE_CREATED_PROFILE_UPDATE_FAILED: 'Zaproszenie wysłano, ale nie udało się nadać profilu lub roli. Sprawdź konto w Identity.',
    JSON_REQUIRED: 'Żądanie zmiany konta ma nieprawidłowy format.',
    MULTIPLE_ACCESS_ROLES: 'Wybierz tylko jeden rodzaj dostępu do kursu.',
    NETLIFY_FORMS_DELETE_FAILED: 'Netlify nie usunął zgłoszenia. Spróbuj ponownie.',
    NETLIFY_FORMS_NOT_CONFIGURED: 'Dodaj NETLIFY_API_TOKEN w zmiennych środowiskowych Netlify (zakres Functions).',
    NETLIFY_FORMS_REQUEST_FAILED: 'Netlify Forms odrzucił żądanie.',
    NETLIFY_FORMS_RESOURCE_NOT_FOUND: 'Nie znaleziono formularza lub zgłoszenia w tej witrynie.',
    NETLIFY_FORMS_RESPONSE_INVALID: 'Netlify Forms zwrócił nieprawidłowe dane.',
    NETLIFY_FORMS_TOKEN_REJECTED: 'NETLIFY_API_TOKEN jest nieprawidłowy albo nie ma dostępu do tej witryny.',
    NETLIFY_FORMS_UNAVAILABLE: 'Nie udało się połączyć z Netlify Forms.',
    NETLIFY_BUILDS_STOPPED: 'Buildy tego projektu są zatrzymane w Netlify. Włącz je i spróbuj ponownie.',
    NETLIFY_CONTENT_CONFIG_NOT_CONFIGURED: 'Dodaj jednorazowo NETLIFY_API_TOKEN w Netlify. SITE_ID jest ustawiane automatycznie.',
    NETLIFY_CONTENT_CONFIG_RESPONSE_INVALID: 'Netlify zwrócił nieprawidłową odpowiedź konfiguracji.',
    NETLIFY_CONTENT_CONFIG_SITE_NOT_FOUND: 'NETLIFY_API_TOKEN nie ma dostępu do tego projektu Netlify.',
    NETLIFY_CONTENT_CONFIG_TOKEN_REJECTED: 'NETLIFY_API_TOKEN jest nieprawidłowy albo nie może edytować tego projektu.',
    NETLIFY_CONTENT_CONFIG_UNAVAILABLE: 'API Netlify jest chwilowo niedostępne.',
    NETLIFY_CONTENT_CONFIG_WRITE_FAILED: 'Netlify nie zapisał zmiennych środowiskowych.',
    NETLIFY_CONTENT_SECRET_WRITE_FAILED: 'Netlify nie zapisał tokenu jako sekretu. Żadna jawna wersja PAT nie została utworzona; sprawdź ustawienia ENV i spróbuj ponownie.',
    NETLIFY_DEPLOY_START_FAILED: 'Netlify nie uruchomił deployu. Sprawdź stan projektu i spróbuj ponownie przyciskiem „Uruchom tylko deploy”.',
    NETLIFY_SECRETS_CONTROLLER_REQUIRED: 'Automatyczny zapis PAT wymaga Netlify Secrets Controller (plan Personal lub wyższy). Na Free utwórz wskazaną zmienną tokenu wskazaną poniżej ręcznie, wykonaj deploy i pozostaw pole tokenu puste.',
    NO_CHANGES: 'Nie wskazano żadnych zmian do zapisania.',
    INVALID_PAYMENT_ACTION: 'Wybrano nieprawidłową operację płatności.',
    INVALID_PAYMENT_ENABLED_SETTING: 'Ustawienie dostępności płatności jest nieprawidłowe.',
    INVALID_CURRENCY: 'Wybierz obsługiwaną walutę.',
    INVALID_ENABLED_PLANS: 'Lista dostępnych pakietów jest nieprawidłowa.',
    INVALID_PRICE: 'Cena musi wynosić od 1,00 do 10 000,00 jednostek wybranej waluty.',
    INVALID_STACKING_SETTING: 'Ustawienie przedłużania jest nieprawidłowe.',
    PAYMENT_CONFIG_CONFLICT: 'Ceny zostały w międzyczasie zmienione. Wczytaj je ponownie.',
    PAYMENT_CONFIG_INVALID: 'Zapisana konfiguracja cen jest nieprawidłowa.',
    PAYMENT_HISTORY_DELETE_FAILED: 'Konto usunięto z Identity, ale nie udało się usunąć historii płatności. Kliknij „Usuń konto” ponownie, aby dokończyć czyszczenie.',
    PAYMENT_LEDGER_CONFLICT: 'Historia płatności zmieniła się w tym samym czasie. Spróbuj ponownie.',
    PAYMENT_LEDGER_INVALID: 'Historia płatności użytkownika jest uszkodzona.',
    PAYMENT_STORAGE_UNAVAILABLE: 'Magazyn płatności jest chwilowo niedostępny.',
    STRIPE_NOT_CONFIGURED: 'Dodaj klucze Stripe w zmiennych środowiskowych Netlify.',
    REQUEST_TOO_LARGE: 'Przesłano zbyt dużo danych.',
    SAME_ORIGIN_REQUIRED: 'Ze względów bezpieczeństwa odśwież panel i spróbuj ponownie.',
    SESSION_CHECK_UNAVAILABLE: 'Nie udało się potwierdzić bieżącej sesji administratora.',
    SESSION_REPLACED: 'To konto zalogowało się na innym urządzeniu. Zaloguj się ponownie.',
    SUBMISSION_NOT_FOUND: 'Nie znaleziono tego zgłoszenia.',
    USER_ALREADY_EXISTS_OR_INVITE_REJECTED: 'Konto już istnieje albo Identity odrzuciło zaproszenie.',
    USER_NOT_FOUND: 'Nie znaleziono tego użytkownika.'
  });

  let currentUser = null;

  let adminUsers = [];

  let adminPricesLoaded = false;

  let adminPricesEtag = null;

  let adminProgressLoaded = false;

  let adminProgressUsers = [];

  let adminProgressUsersCursor = '';

  let adminProgressVisibleCount = ADMIN_PROGRESS_PAGE_SIZE;

  let adminProgressLoadingMore = false;

  let adminProgressActiveIds = new Set();

  let adminProgressReport = null;

  let adminProgressCatalog = null;

  let adminProgressAuditEntries = [];

  let adminProgressAuditCursor = '';

  let adminProgressAuditLoadingMore = false;

  let adminAiSettings = null;

  let adminAiUsageLoaded = false;

  let adminAiUsageSettings = null;

  let adminAiUsageReport = null;

  let adminAiLimitSelection = { scope: 'global', id: '' };

  let adminAiUserUsageRows = new Map();

  let adminAiUserUsagePeriod = '';

  let adminAiUserVisibleCount = ADMIN_AI_USERS_PAGE_SIZE;

  let adminAiUserUsageRequestId = 0;

  const adminAiUserUsagePending = new Set();

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pl')
      .trim();
  }

  function isAdminUser(user) {
    const appMetadata = user && user.app_metadata ? user.app_metadata : {};
    return Array.isArray(appMetadata.roles) && appMetadata.roles.includes('admin');
  }

  function adminProfileFrom(rawUser) {
    const source = rawUser && typeof rawUser === 'object' ? rawUser : {};
    const userMetadata = source.user_metadata && typeof source.user_metadata === 'object' ? source.user_metadata : {};
    const appMetadata = source.app_metadata && typeof source.app_metadata === 'object' ? source.app_metadata : {};
    const fullName = String(source.fullName || source.full_name || userMetadata.full_name || userMetadata.name || '').trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    let firstName = String(source.firstName || source.first_name || userMetadata.first_name || userMetadata.firstName || '').trim();
    let lastName = String(source.lastName || source.last_name || userMetadata.last_name || userMetadata.lastName || '').trim();
    if (!firstName && nameParts.length) firstName = nameParts.shift() || '';
    if (!lastName && nameParts.length) lastName = nameParts.join(' ');
    const rawRoles = Array.isArray(source.roles) ? source.roles : Array.isArray(appMetadata.roles) ? appMetadata.roles : [];
    const rawTimedAccess = source.timedAccess && typeof source.timedAccess === 'object'
      ? source.timedAccess
      : source.timed_access && typeof source.timed_access === 'object'
        ? source.timed_access
        : appMetadata.timed_access && typeof appMetadata.timed_access === 'object' ? appMetadata.timed_access : null;
    const timedRole = rawTimedAccess && String(rawTimedAccess.role || '').trim();
    const timedExpiresAt = rawTimedAccess && String(rawTimedAccess.expiresAt || rawTimedAccess.expires_at || '').trim();

    return {
      id: String(source.id || source.user_id || '').trim(),
      email: String(source.email || '').trim(),
      firstName,
      lastName,
      roles: Array.from(new Set(rawRoles.filter((role) => ADMIN_ROLE_VALUES.has(role)))),
      timedAccess: timedRole && COURSE_ROLE_VALUES.has(timedRole)
        ? {
            role: timedRole,
            assignedAt: String(rawTimedAccess.assignedAt || rawTimedAccess.assigned_at || '').trim(),
            expiresAt: timedExpiresAt,
            active: rawTimedAccess.active !== false
          }
        : null,
      confirmedAt: String(source.confirmedAt || source.confirmed_at || '').trim(),
      createdAt: String(source.createdAt || source.created_at || '').trim(),
      updatedAt: String(source.updatedAt || source.updated_at || '').trim(),
      lastSignInAt: String(source.lastSignInAt || source.last_sign_in_at || '').trim(),
      paymentDetails: null,
      paymentDetailsLoaded: false
    };
  }

  function adminDateLabel(value, fallback = 'Brak danych') {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return fallback;
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function setPanelStatus(element, message, type) {
    if (!element) return;
    element.textContent = message || '';
    element.className = `admin-status${type ? ` is-${type}` : ''}`;
  }

  async function getUserToken(requireAdmin) {
    const auth = window.ChemAuth;
    const identity = window.netlifyIdentity;
    const user = auth && typeof auth.getUser === 'function' ? auth.getUser()
      : identity && typeof identity.currentUser === 'function' ? identity.currentUser() : null;
    if (requireAdmin && !isAdminUser(user)) throw new Error('Ta funkcja jest dostępna tylko dla administratora.');
    if (!user || typeof user.jwt !== 'function') throw new Error('Nie udało się odczytać sesji administratora.');
    const token = await user.jwt();
    if (!token) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
    return token;
  }

  async function getAdminToken() {
    return getUserToken(true);
  }

  async function readAdminResponse(response) {
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const fallback = response.status === 403
        ? 'Nie masz uprawnień do zarządzania kontami.'
        : response.status === 401
          ? 'Sesja administratora wygasła. Zaloguj się ponownie.'
          : `Nie udało się wykonać operacji (${response.status}).`;
      const code = payload && typeof payload.error === 'string' ? payload.error : '';
      const serverMessage = payload && typeof payload.message === 'string' ? payload.message : '';
      throw new Error(ADMIN_ERROR_MESSAGES[code] || serverMessage || fallback);
    }
    return payload;
  }

  function setAdminPricesBusy(busy) {
    if (elements.adminPricesReload) elements.adminPricesReload.disabled = Boolean(busy);
    if (elements.adminPricesSave) elements.adminPricesSave.disabled = Boolean(busy);
    if (elements.adminPaymentCurrency) elements.adminPaymentCurrency.disabled = Boolean(busy);
    if (elements.adminPaymentDisabled) elements.adminPaymentDisabled.disabled = Boolean(busy);
    if (elements.adminPaymentBlockStacking) elements.adminPaymentBlockStacking.disabled = Boolean(busy);
    adminPaymentPlanEntries().forEach((entry) => {
      if (entry.input) entry.input.disabled = Boolean(busy);
      if (entry.enabled) entry.enabled.disabled = Boolean(busy);
    });
  }

  function adminPaymentPlanEntries() {
    return [
      { id: 'hour', input: elements.adminPriceHour, enabled: elements.adminEnabledHour },
      { id: 'day', input: elements.adminPriceDay, enabled: elements.adminEnabledDay },
      { id: 'week', input: elements.adminPriceWeek, enabled: elements.adminEnabledWeek },
      { id: 'month', input: elements.adminPriceMonth, enabled: elements.adminEnabledMonth },
      { id: 'halfyear', input: elements.adminPriceHalfyear, enabled: elements.adminEnabledHalfyear },
      { id: 'year', input: elements.adminPriceYear, enabled: elements.adminEnabledYear }
    ];
  }

  function setAdminPriceInputs(payload) {
    const plans = payload && Array.isArray(payload.plans) ? payload.plans : [];
    const byId = new Map((plans || []).map((plan) => [plan.id, plan]));
    adminPaymentPlanEntries().forEach((entry) => {
      const plan = byId.get(entry.id);
      if (entry.input && plan && Number.isSafeInteger(plan.amount)) {
        entry.input.value = (plan.amount / 100).toFixed(2);
      }
      if (entry.enabled) entry.enabled.checked = Boolean(plan && plan.enabled);
    });
    if (elements.adminPaymentCurrency) elements.adminPaymentCurrency.value = String(payload.currency || 'pln');
    if (elements.adminPaymentDisabled) {
      elements.adminPaymentDisabled.checked = payload.paymentsEnabled === false;
    }
    if (elements.adminPaymentBlockStacking) {
      elements.adminPaymentBlockStacking.checked = payload.stackingEnabled === false;
    }
  }

  async function fetchAdminPrices() {
    setAdminPricesBusy(true);
    setPanelStatus(elements.adminPricesStatus, 'Wczytywanie cen…', 'loading');
    try {
      const token = await getAdminToken();
      const response = await fetch(`${PAYMENT_CONFIG_URL}?admin=1`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const payload = await readAdminResponse(response);
      if (!payload || !Array.isArray(payload.plans)) throw new Error('Serwer zwrócił nieprawidłową konfigurację cen.');
      setAdminPriceInputs(payload);
      adminPricesEtag = typeof payload.etag === 'string' ? payload.etag : null;
      adminPricesLoaded = true;
      pendingChanges.delete('payments');
      setPanelStatus(
        elements.adminPricesStatus,
        payload.paymentsEnabled === false
          ? 'Oferta wczytana. Płatności są obecnie wyłączone przez administratora.'
          : payload.checkoutAvailable
          ? `Ceny wczytane. Stripe działa w trybie ${payload.testMode ? 'testowym' : 'produkcyjnym'}.`
          : 'Ceny wczytane, ale klucze Stripe lub webhook nie są jeszcze w pełni skonfigurowane.',
        payload.paymentsEnabled === false || payload.checkoutAvailable ? 'info' : 'error'
      );
    } catch (error) {
      adminPricesLoaded = false;
      adminPricesEtag = null;
      setPanelStatus(elements.adminPricesStatus, error && error.message ? error.message : 'Nie udało się wczytać cen.', 'error');
    } finally {
      setAdminPricesBusy(false);
    }
  }

  function priceInputToCents(input) {
    const normalized = String(input.value || '').replace(',', '.').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const amount = Math.round(Number(normalized) * 100);
    return Number.isSafeInteger(amount) && amount >= 100 && amount <= 1_000_000 ? amount : null;
  }

  async function saveAdminPrices(event) {
    event.preventDefault();
    if (!adminPricesLoaded) {
      setPanelStatus(elements.adminPricesStatus, 'Najpierw wczytaj aktualne ceny.', 'error');
      return;
    }
    const prices = {};
    const enabledPlans = [];
    for (const entry of adminPaymentPlanEntries()) {
      const amount = priceInputToCents(entry.input);
      if (amount == null) {
        setPanelStatus(elements.adminPricesStatus, 'Każda cena musi wynosić od 1,00 do 10 000,00 jednostek wybranej waluty i mieć najwyżej dwa miejsca po przecinku.', 'error');
        entry.input.focus();
        return;
      }
      prices[entry.id] = amount;
      if (entry.enabled && entry.enabled.checked) enabledPlans.push(entry.id);
    }
    const currency = String(elements.adminPaymentCurrency.value || '').toLowerCase();
    const paymentsEnabled = !elements.adminPaymentDisabled.checked;
    const stackingEnabled = !elements.adminPaymentBlockStacking.checked;

    setAdminPricesBusy(true);
    setPanelStatus(elements.adminPricesStatus, 'Zapisywanie cen…', 'loading');
    try {
      const token = await getAdminToken();
      const response = await fetch(PAYMENT_CONFIG_URL, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          currency,
          enabledPlans,
          expectedEtag: adminPricesEtag,
          paymentsEnabled,
          prices,
          stackingEnabled
        })
      });
      const payload = await readAdminResponse(response);
      adminPricesEtag = typeof payload.etag === 'string' ? payload.etag : adminPricesEtag;
      setAdminPriceInputs(payload);
      pendingChanges.delete('payments');
      try { window.localStorage.removeItem('nextmed.payments.public-config.v1'); } catch (_) {}
    } catch (error) {
      if (error && (error.code === 'INVALID_ETAG' || error.status === 412 || error.status === 409)) {
        try {
          const token = await getAdminToken();
          const refreshRes = await fetch(`${PAYMENT_CONFIG_URL}?admin=1`, {
            method: 'GET', cache: 'no-store', credentials: 'same-origin',
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
          });
          const fresh = await readAdminResponse(refreshRes);
          if (fresh && typeof fresh.etag === 'string') {
            adminPricesEtag = fresh.etag;
            const retryRes = await fetch(PAYMENT_CONFIG_URL, {
              method: 'PUT', credentials: 'same-origin',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ currency, enabledPlans, expectedEtag: adminPricesEtag, paymentsEnabled, prices, stackingEnabled })
            });
            const retryPayload = await readAdminResponse(retryRes);
            adminPricesEtag = typeof retryPayload.etag === 'string' ? retryPayload.etag : adminPricesEtag;
            setAdminPriceInputs(retryPayload);
            setPanelStatus(elements.adminPricesStatus, 'Oferta zapisana (po synchronizacji wersji). Waluta i pakiety zaktualizowane.', 'info');
            pendingChanges.delete('payments');
            try { window.localStorage.removeItem('nextmed.payments.public-config.v1'); } catch (_) {}
            return;
          }
        } catch (_) {}
      }
      setPanelStatus(elements.adminPricesStatus, error && error.message ? error.message : 'Nie udało się zapisać cen.', 'error');
    } finally {
      setAdminPricesBusy(false);
    }
  }

  function adminProgressPercent(value) {
    const percent = Math.max(0, Math.min(100, Number(value) || 0));
    if (percent === 0) return '0%';
    if (percent < 1) return '<1%';
    if (percent < 10) return `${String(Math.round(percent * 10) / 10).replace('.', ',')}%`;
    return `${Math.round(percent)}%`;
  }

  function reconcileAdminProgressUsers() {
    const rows = new Map(adminProgressUsers.map((user) => [user.id, user]));
    const parentIds = new Set((adminProgressCatalog?.nodes || []).map((node) => node.parentId).filter(Boolean));
    const trackedLeaves = (adminProgressCatalog?.nodes || []).filter((node) => !parentIds.has(node.id)).length;
    adminUsers.forEach((user) => {
      const existing = rows.get(user.id);
      const identityName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      if (existing) {
        if (!existing.name) existing.name = identityName;
        if (!existing.email) existing.email = user.email || '';
        return;
      }
      rows.set(user.id, {
        id: user.id,
        name: identityName,
        email: user.email || '',
        progressPercent: 0,
        completed: 0,
        started: 0,
        notOpened: trackedLeaves,
        lastActivityAt: null
      });
    });
    adminProgressUsers = [...rows.values()];
  }

  function adjustedAdminProgressReport() {
    const report = adminProgressReport || {};
    const missing = adminUsers.filter((user) => !adminProgressActiveIds.has(user.id)).length;
    if (!missing) return report;
    const sourceUsers = Math.max(0, Number(report.users) || 0);
    const users = sourceUsers + missing;
    return {
      ...report,
      users,
      averageProgress: users ? ((Number(report.averageProgress) || 0) * sourceUsers) / users : 0,
      distribution: {
        ...(report.distribution || {}),
        '0-25': Number(report.distribution?.['0-25'] || 0) + missing
      },
      mostUnopened: (report.mostUnopened || [])
        .map((item) => ({ ...item, notOpened: Number(item.notOpened || 0) + missing }))
        .sort((left, right) => right.notOpened - left.notOpened)
    };
  }

  function filteredAdminProgressUsers() {
    const query = normalizeText(elements.adminProgressSearch?.value || '');
    const filter = elements.adminProgressFilter?.value || 'all';
    const sort = elements.adminProgressSort?.value || 'lastActivityAt';
    let rows = adminProgressUsers.filter((user) => {
      if (query && !normalizeText(`${user.name} ${user.email} ${user.id}`).includes(query)) return false;
      if (filter === 'completed') return user.progressPercent >= 100;
      if (filter === 'started') return user.progressPercent > 0 && user.progressPercent < 100;
      if (filter === 'not_started') return user.progressPercent <= 0;
      return true;
    });
    rows = [...rows].sort((left, right) => {
      if (sort === 'progressPercent') return right.progressPercent - left.progressPercent;
      return String(right[sort] || '').localeCompare(String(left[sort] || ''), 'pl', { sensitivity: 'base' });
    });
    return rows;
  }

  function renderAdminProgressUsers() {
    const rows = filteredAdminProgressUsers();
    const visibleRows = rows.slice(0, adminProgressVisibleCount);
    const reactUsers = window.NextMedUI?.render('studio-progress-users', elements.adminProgressUserList, {
      users: visibleRows, percent: adminProgressPercent, dateLabel: adminDateLabel, onSelect: loadAdminProgressUser
    });
    const cards = reactUsers ? [] : visibleRows.map((user) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-progress-user';
      const identity = document.createElement('span');
      identity.append(
        Object.assign(document.createElement('strong'), { textContent: user.name || user.email || user.id }),
        Object.assign(document.createElement('small'), { textContent: `${user.email || 'Brak e-maila'} · ${user.id}` })
      );
      const stats = document.createElement('span');
      stats.className = 'admin-progress-user-stats';
      stats.append(
        Object.assign(document.createElement('strong'), { textContent: adminProgressPercent(user.progressPercent) }),
        Object.assign(document.createElement('small'), { textContent: `${user.completed} ukończonych · ${user.started} rozpoczętych · ${user.notOpened} nieotwartych` })
      );
      const activity = document.createElement('time');
      activity.textContent = adminDateLabel(user.lastActivityAt, 'Brak aktywności');
      button.append(identity, stats, activity);
      button.addEventListener('click', () => loadAdminProgressUser(user.id));
      return button;
    });
    if (!reactUsers) elements.adminProgressUserList?.replaceChildren(...cards);
    if (elements.adminProgressMore) {
      const hiddenRows = visibleRows.length < rows.length;
      elements.adminProgressMore.hidden = !hiddenRows && !adminProgressUsersCursor;
      elements.adminProgressMore.disabled = adminProgressLoadingMore;
      elements.adminProgressMore.textContent = adminProgressLoadingMore
        ? 'Wczytywanie…'
        : hiddenRows
          ? `Pokaż więcej (${visibleRows.length} z ${rows.length})`
          : 'Pobierz kolejne konta';
    }
  }

  async function loadMoreAdminProgressUsers() {
    if (adminProgressLoadingMore) return;
    adminProgressLoadingMore = true;
    renderAdminProgressUsers();
    try {
      if (adminProgressUsersCursor) {
        const payload = await adminProgressRequest(
          'GET',
          null,
          `?view=users&limit=${ADMIN_PROGRESS_PAGE_SIZE}&cursor=${encodeURIComponent(adminProgressUsersCursor)}`
        );
        const page = Array.isArray(payload.users) ? payload.users : [];
        const rows = new Map(adminProgressUsers.map((user) => [user.id, user]));
        page.forEach((user) => {
          if (user?.id) {
            rows.set(user.id, user);
            adminProgressActiveIds.add(user.id);
          }
        });
        adminProgressUsers = [...rows.values()];
        adminProgressUsersCursor = typeof payload.cursor === 'string' ? payload.cursor : '';
        adminProgressCatalog = payload.catalog || adminProgressCatalog;
        reconcileAdminProgressUsers();
      }
      adminProgressVisibleCount += ADMIN_PROGRESS_PAGE_SIZE;
      setPanelStatus(
        elements.adminProgressStatus,
        adminProgressUsersCursor
          ? 'Wczytano kolejną partię. Następne konta są dostępne na żądanie.'
          : 'Wczytano wszystkie dostępne rekordy postępu.',
        'success'
      );
    } catch (error) {
      setPanelStatus(elements.adminProgressStatus, error?.message || 'Nie udało się wczytać kolejnych kont.', 'error');
    } finally {
      adminProgressLoadingMore = false;
      renderAdminProgressUsers();
    }
  }

  function renderAdminProgressMetrics(report) {
    if (!elements.adminProgressMetrics) return;
    const values = [
      ['Średni postęp', adminProgressPercent(report?.averageProgress)],
      ['Uczniowie', String(report?.users || 0)],
      ['Rozpoczęcia', String(report?.starts || 0)],
      ['Ukończenia', String(report?.completions || 0)]
    ];
    elements.adminProgressMetrics.replaceChildren(...values.map(([label, value]) => {
      const card = document.createElement('span');
      card.append(
        Object.assign(document.createElement('strong'), { textContent: value }),
        Object.assign(document.createElement('small'), { textContent: label })
      );
      return card;
    }));
  }

  function adminProgressCountShare(count, total) {
    const value = Math.max(0, Number(count) || 0);
    const all = Math.max(0, Number(total) || 0);
    return all ? Math.round((value / all) * 100) : 0;
  }

  function adminProgressStopLabel(item) {
    if (item?.commonStop == null || item.commonStop === '') return '';
    const node = adminProgressCatalog?.nodes?.find((candidate) => candidate.id === item.materialId);
    if (node?.type === 'lesson') {
      const step = node.settings?.steps?.find((candidate) => candidate.id === item.commonStop);
      return `Najczęstszy ostatni krok: ${step?.title || item.commonStop}`;
    }
    if (node?.type === 'presentation') return `Najczęstszy ostatni slajd: ${item.commonStop}`;
    if (node?.type === 'video') {
      const seconds = Math.max(0, Math.round(Number(item.commonStop) || 0));
      return `Najczęstsza ostatnia pozycja: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `Najczęstszy punkt zatrzymania: ${item.commonStop}`;
  }

  function createAdminProgressRanking(title, description, items, valueKey, emptyLabel) {
    const section = document.createElement('section');
    section.className = 'admin-progress-insight-card';
    const header = document.createElement('header');
    header.append(
      Object.assign(document.createElement('h4'), { textContent: title }),
      Object.assign(document.createElement('p'), { textContent: description })
    );
    section.append(header);
    const rows = (items || []).filter((item) => Number(item?.[valueKey]) > 0).slice(0, 5);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-progress-report-empty';
      empty.textContent = emptyLabel;
      section.append(empty);
      return section;
    }
    const list = document.createElement('ol');
    list.className = 'admin-progress-ranking';
    rows.forEach((item, index) => {
      const row = document.createElement('li');
      const rank = document.createElement('span');
      rank.className = 'admin-progress-ranking-position';
      rank.textContent = String(index + 1);
      const copy = document.createElement('span');
      copy.className = 'admin-progress-ranking-copy';
      copy.append(Object.assign(document.createElement('strong'), { textContent: item.title || item.materialId || 'Materiał' }));
      const stopLabel = valueKey === 'abandoned' ? adminProgressStopLabel(item) : '';
      if (stopLabel) copy.append(Object.assign(document.createElement('small'), { textContent: stopLabel }));
      const value = document.createElement('strong');
      value.className = 'admin-progress-ranking-value';
      value.textContent = String(Number(item[valueKey]) || 0);
      value.title = valueKey === 'notOpened' ? 'Liczba uczniów bez otwarcia' : 'Liczba uczniów bez ukończenia';
      row.append(rank, copy, value);
      list.append(row);
    });
    section.append(list);
    return section;
  }

  function renderAdminProgressGlobal(report) {
    if (!elements.adminProgressGlobalReport) return;
    const distribution = report?.distribution || {};
    const section = document.createElement('section');
    section.className = 'admin-progress-report-block admin-progress-global-report';
    const heading = document.createElement('header');
    heading.className = 'admin-progress-report-heading';
    heading.append(
      Object.assign(document.createElement('h3'), { textContent: 'Jak uczniowie przechodzą kurs' }),
      Object.assign(document.createElement('p'), { textContent: `Każde z ${Number(report?.users) || 0} kont trafia do jednego przedziału według aktualnego postępu całego kursu. Konto bez aktywności znajduje się w grupie 0–25%.` })
    );
    section.append(heading);

    const distributionGrid = document.createElement('div');
    distributionGrid.className = 'admin-progress-distribution';
    [
      ['0-25', '0–25%', 'Początek'],
      ['25-50', '25–50%', 'Pierwsza połowa'],
      ['50-75', '50–75%', 'Druga połowa'],
      ['75-100', '75–100%', 'Blisko ukończenia']
    ].forEach(([key, range, label], index) => {
      const count = Number(distribution[key]) || 0;
      const share = adminProgressCountShare(count, report?.users);
      const card = document.createElement('article');
      card.className = `admin-progress-distribution-card is-range-${index + 1}`;
      const top = document.createElement('span');
      top.append(
        Object.assign(document.createElement('small'), { textContent: range }),
        Object.assign(document.createElement('strong'), { textContent: String(count) })
      );
      const bar = document.createElement('span');
      bar.className = 'admin-progress-distribution-bar';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', `${label}: ${share}% wszystkich kont`);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(share));
      const fill = document.createElement('span');
      fill.style.width = `${share}%`;
      bar.append(fill);
      card.append(
        top,
        Object.assign(document.createElement('p'), { textContent: label }),
        bar,
        Object.assign(document.createElement('small'), { textContent: `${share}% wszystkich kont` })
      );
      distributionGrid.append(card);
    });
    section.append(distributionGrid);

    const explanation = document.createElement('div');
    explanation.className = 'admin-progress-report-note';
    explanation.append(
      Object.assign(document.createElement('strong'), { textContent: 'Jak czytać te dane?' }),
      Object.assign(document.createElement('p'), { textContent: 'Średni postęp u góry jest średnią wyników wszystkich kont. Rozpoczęcie oznacza co najmniej jedno zarejestrowane otwarcie, a ukończenie — 100% postępu kursu. Lista pozostawionych materiałów jest wskaźnikiem pomocniczym: liczy materiały otwarte, ale jeszcze nieukończone; nie jest dowodem, że uczeń z nich zrezygnował.' })
    );
    section.append(explanation);

    const insights = document.createElement('div');
    insights.className = 'admin-progress-insight-grid';
    insights.append(
      createAdminProgressRanking(
        'Najczęściej nieotwierane',
        'Liczba kont, na których materiał nie ma ani jednego zarejestrowanego otwarcia.',
        report?.mostUnopened, 'notOpened', 'Wszystkie raportowane materiały zostały już przez kogoś otwarte.'
      ),
      createAdminProgressRanking(
        'Otwarte, ale nieukończone',
        'Materiały rozpoczęte bez statusu ukończenia. Punkt zatrzymania pokazujemy tylko wtedy, gdy odtwarzacz przekazał wiarygodną pozycję.',
        report?.mostAbandoned, 'abandoned', 'Brak otwartych materiałów pozostawionych bez ukończenia.'
      )
    );
    section.append(insights);
    elements.adminProgressGlobalReport.replaceChildren(section);
  }

  function adminProgressIdentityLabel(userId) {
    if (!userId) return '';
    const user = adminUsers.find((candidate) => candidate.id === userId);
    const name = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
    const progressUser = adminProgressUsers.find((candidate) => candidate.id === userId);
    return name || user?.email || progressUser?.name || progressUser?.email || userId;
  }

  function adminProgressMaterialLabel(materialId) {
    if (!materialId) return '';
    return adminProgressCatalog?.nodes?.find((node) => node.id === materialId)?.title || materialId;
  }

  function adminProgressAuditActionLabel(action) {
    return ({
      'progress.catalog.update': 'Zmieniono konfigurację postępu',
      'progress.lesson_manifest.update': 'Zaktualizowano strukturę lekcji',
      'progress.preference.update': 'Zmieniono zasady pomijania kroków',
      'progress.mark_completed': 'Oznaczono materiał jako ukończony',
      'progress.mark_incomplete': 'Oznaczono materiał jako nieukończony',
      'progress.set_step': 'Ustawiono bieżący krok lekcji',
      'progress.unlock_step': 'Ręcznie odblokowano krok',
      'progress.lock_step': 'Ręcznie zablokowano krok',
      'progress.reset.material': 'Zresetowano materiał',
      'progress.reset.section': 'Zresetowano sekcję',
      'progress.reset.department': 'Zresetowano dział',
      'progress.reset.course': 'Zresetowano cały kurs',
      'exam.attempt.reset': 'Zresetowano próbę egzaminu'
    })[action] || 'Wykonano operację administracyjną';
  }

  function adminProgressSkipModeLabel(mode) {
    return ({ DEFAULT: 'według lekcji', ALLOW: 'dozwolone', DENY: 'zabronione' })[mode] || 'według lekcji';
  }

  function adminProgressAuditChangeLabel(entry) {
    const previous = entry?.previousValue || {};
    const next = entry?.newValue || {};
    if (entry.action === 'progress.catalog.update') {
      const removed = Number(next.removedCount) || 0;
      return `Materiały w katalogu: ${Number(previous.nodeCount) || 0} → ${Number(next.nodeCount) || 0}${removed ? ` · usunięte: ${removed}` : ''}.`;
    }
    if (entry.action === 'progress.lesson_manifest.update') {
      return `Plik: ${next.filename || previous.filename || '—'} · liczba kroków: ${Number(next.stepCount) || 0}.`;
    }
    if (entry.action === 'progress.preference.update') {
      return `Pomijanie kroków: ${adminProgressSkipModeLabel(previous.skipMode)} → ${adminProgressSkipModeLabel(next.skipMode)}.`;
    }
    if (entry.action === 'progress.mark_completed' || entry.action === 'progress.mark_incomplete') {
      return `Postęp: ${adminProgressPercent(previous.progressPercent)} → ${adminProgressPercent(next.progressPercent)}.`;
    }
    if (entry.action === 'progress.set_step') {
      return `Krok: ${previous.details?.currentStepId || '—'} → ${next.details?.currentStepId || '—'}.`;
    }
    if (entry.action === 'progress.unlock_step') return 'Wskazany krok dodano do indywidualnych odblokowań ucznia.';
    if (entry.action === 'progress.lock_step') return 'Wskazany krok dodano do indywidualnych blokad ucznia.';
    if (entry.action === 'exam.attempt.reset') {
      return `Próba ${next.attemptId || previous.attemptId || '—'} została wycofana, a wynik egzaminu przeliczony na podstawie pozostałych prób.`;
    }
    if (String(entry.action || '').startsWith('progress.reset.')) {
      const count = previous && typeof previous === 'object' ? Object.keys(previous).length : 0;
      return `Usunięte rekordy postępu: ${count}.`;
    }
    return 'Zmiana została zapisana w historii administratora.';
  }

  function renderAdminProgressAudit(entries) {
    if (!elements.adminProgressAudit) return;
    const section = document.createElement('section');
    section.className = 'admin-progress-report-block admin-progress-audit-report';
    const header = document.createElement('header');
    header.className = 'admin-progress-report-heading';
    header.append(
      Object.assign(document.createElement('h3'), { textContent: 'Historia zmian administratorów' }),
      Object.assign(document.createElement('p'), { textContent: 'Tutaj widać ręczne zmiany postępu, resety i publikacje konfiguracji. Wpisu nie tworzy zwykła aktywność ucznia.' })
    );
    section.append(header);
    const rows = entries || [];
    if (!rows.length) {
      section.append(Object.assign(document.createElement('p'), { className: 'admin-progress-report-empty', textContent: 'Nie zapisano jeszcze żadnej operacji administratora.' }));
      elements.adminProgressAudit.replaceChildren(section);
      return;
    }
    const list = document.createElement('ol');
    list.className = 'admin-progress-audit-list';
    rows.forEach((entry) => {
      const item = document.createElement('li');
      const marker = document.createElement('span');
      marker.className = 'admin-progress-audit-marker';
      marker.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('div');
      copy.className = 'admin-progress-audit-copy';
      copy.append(Object.assign(document.createElement('strong'), { textContent: adminProgressAuditActionLabel(entry.action) }));
      const context = [
        entry.targetUserId ? `Uczeń: ${adminProgressIdentityLabel(entry.targetUserId)}` : '',
        entry.materialId ? `Materiał: ${adminProgressMaterialLabel(entry.materialId)}` : ''
      ].filter(Boolean).join(' · ');
      if (context) copy.append(Object.assign(document.createElement('p'), { textContent: context }));
      copy.append(
        Object.assign(document.createElement('p'), { className: 'admin-progress-audit-change', textContent: adminProgressAuditChangeLabel(entry) }),
        Object.assign(document.createElement('small'), { textContent: `${adminDateLabel(entry.timestamp)} · administrator: ${adminProgressIdentityLabel(entry.adminId)}` })
      );
      item.append(marker, copy);
      list.append(item);
    });
    section.append(list);
    if (adminProgressAuditCursor) {
      const pagination = document.createElement('div');
      pagination.className = 'admin-progress-audit-pagination';
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'button button-secondary';
      more.textContent = adminProgressAuditLoadingMore ? 'Wczytywanie…' : 'Pokaż starsze wpisy';
      more.disabled = adminProgressAuditLoadingMore;
      more.addEventListener('click', loadMoreAdminProgressAudit);
      pagination.append(more);
      section.append(pagination);
    }
    elements.adminProgressAudit.replaceChildren(section);
  }

  async function loadMoreAdminProgressAudit() {
    if (!adminProgressAuditCursor || adminProgressAuditLoadingMore) return;
    adminProgressAuditLoadingMore = true;
    renderAdminProgressAudit(adminProgressAuditEntries);
    try {
      const payload = await adminProgressRequest(
        'GET',
        null,
        `?view=audit&limit=20&cursor=${encodeURIComponent(adminProgressAuditCursor)}`
      );
      adminProgressAuditEntries.push(...(Array.isArray(payload.audit) ? payload.audit : []));
      adminProgressAuditCursor = typeof payload.cursor === 'string' ? payload.cursor : '';
    } catch (error) {
      setPanelStatus(elements.adminProgressStatus, error?.message || 'Nie udało się wczytać starszej historii.', 'error');
    } finally {
      adminProgressAuditLoadingMore = false;
      renderAdminProgressAudit(adminProgressAuditEntries);
    }
  }

  async function adminProgressRequest(method, body, query = '') {
    const token = await getAdminToken();
    const response = await fetch(`${ADMIN_PROGRESS_URL}${query}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return readAdminResponse(response);
  }

  async function adminExamRequest(method, query, body) {
    const token = await getAdminToken();
    const response = await fetch(`${ADMIN_EXAMS_URL}${query || ''}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return readAdminResponse(response);
  }

  async function fetchAdminProgress(force = false) {
    if (adminProgressLoaded && !force) return;
    setPanelStatus(elements.adminProgressStatus, 'Wczytywanie raportów…', 'loading');
    try {
      const [users, global, audit] = await Promise.all([
        adminProgressRequest('GET', null, `?view=users&limit=${ADMIN_PROGRESS_PAGE_SIZE}`),
        adminProgressRequest('GET', null, '?view=global&limit=200'),
        adminProgressRequest('GET', null, '?view=audit&limit=20'),
        loadAdminUsers()
      ]);
      adminProgressUsers = Array.isArray(users.users) ? users.users : [];
      adminProgressUsersCursor = typeof users.cursor === 'string' ? users.cursor : '';
      adminProgressVisibleCount = ADMIN_PROGRESS_PAGE_SIZE;
      adminProgressActiveIds = new Set(adminProgressUsers.map((user) => user.id));
      adminProgressReport = global.report || null;
      adminProgressCatalog = users.catalog || adminProgressCatalog;
      adminProgressAuditEntries = Array.isArray(audit.audit) ? audit.audit : [];
      adminProgressAuditCursor = typeof audit.cursor === 'string' ? audit.cursor : '';
      reconcileAdminProgressUsers();
      const globalSettings = adminProgressCatalog?.global || {};
      elements.adminProgressGlobalTracking.value = globalSettings.tracking === 'OFF' ? 'OFF' : 'ON';
      elements.adminProgressGlobalShow.value = globalSettings.showProgress === 'OFF' ? 'OFF' : 'ON';
      elements.adminProgressRecordOpens.checked = globalSettings.recordOpens !== false;
      renderAdminProgressUsers();
      renderAdminProgressMetrics(adjustedAdminProgressReport());
      renderAdminProgressGlobal(adjustedAdminProgressReport());
      renderAdminProgressAudit(adminProgressAuditEntries);
      adminProgressLoaded = true;
      pendingChanges.delete('progress');
      setPanelStatus(
        elements.adminProgressStatus,
        adminProgressUsersCursor
          ? 'Wczytano pierwszą partię rekordów postępu. Kolejne są dostępne pod listą.'
          : 'Wczytano wszystkie dostępne rekordy postępu.',
        'success'
      );
    } catch (error) {
      adminProgressLoaded = false;
      setPanelStatus(elements.adminProgressStatus, error?.message || 'Nie udało się wczytać raportów.', 'error');
    }
  }

  async function saveAdminProgressSettings() {
    if (!adminProgressCatalog) return;
    elements.adminProgressSaveSettings.disabled = true;
    try {
      const catalog = {
        ...adminProgressCatalog,
        global: {
          ...adminProgressCatalog.global,
          tracking: elements.adminProgressGlobalTracking.value,
          showProgress: elements.adminProgressGlobalShow.value,
          recordOpens: elements.adminProgressRecordOpens.checked
        }
      };
      const payload = await adminProgressRequest('PUT', { action: 'catalog', catalog });
      adminProgressCatalog = payload.catalog;
      setPanelStatus(elements.adminProgressStatus, 'Ustawienia postępu zapisane.', 'success');
      pendingChanges.delete('progress');
    } catch (error) {
      setPanelStatus(elements.adminProgressStatus, error?.message || 'Nie udało się zapisać ustawień.', 'error');
    } finally {
      elements.adminProgressSaveSettings.disabled = false;
    }
  }

  function recordDetailsLabel(node, record) {
    if (!record) return 'Nieotwarty';
    const details = record.details || {};
    if (node.type === 'presentation') return `Slajd ${Number(details.lastSlideIndex) + 1 || '—'}/${details.totalSlides || '—'} · ${record.openCount} otwarć`;
    if (node.type === 'video') return `Pozycja ${Math.round(Number(details.lastPlaybackPosition) || 0)} s / ${Math.round(Number(details.duration) || 0)} s`;
    if (node.type === 'lesson') return `Krok ${Number(details.currentStepIndex) + 1 || '—'} · ukończone ${details.completedStepIds?.length || 0}/${details.totalTrackedSteps || '—'}`;
    if (node.type === 'pdf') return `Strona ${details.lastPage || '—'}/${details.totalPages || '—'} · postęp nawigacyjny`;
    if (node.type === 'quiz') return `Postęp ${adminProgressPercent(record.progressPercent)} · wynik ${details.scorePercent == null ? '—' : adminProgressPercent(details.scorePercent)} · próby ${details.attempts || 0}`;
    if (node.type === 'exam') return `Postęp ${adminProgressPercent(record.progressPercent)} · wynik ${details.scorePercent == null ? '—' : adminProgressPercent(details.scorePercent)} · ${details.passed == null ? 'bez wyniku zaliczenia' : details.passed ? 'zaliczono' : 'nie zaliczono'} · próba ${details.attempts || 0}`;
    return `${record.openCount || 0} otwarć`;
  }

  function adminMaterialStatusLabel(record) {
    return ({ completed: 'Ukończono', in_progress: 'W trakcie', opened: 'Otwarto' })[record?.status] || 'Nie rozpoczęto';
  }

  function adminProgressNodeTypeLabel(type) {
    return ({
      department: 'Dział',
      section: 'Sekcja',
      subsection: 'Podsekcja',
      lesson: 'Lekcja',
      lesson_step: 'Krok lekcji',
      presentation: 'Prezentacja',
      video: 'Film',
      pdf: 'PDF',
      quiz: 'Quiz',
      exam: 'Egzamin',
      script: 'Skrypt',
      iframe: 'Osadzony materiał',
      other: 'Materiał'
    })[type] || 'Materiał';
  }

  async function mutateAdminProgress(body, confirmation) {
    if (confirmation && !window.confirm(confirmation)) return false;
    await adminProgressRequest(body.scope ? 'DELETE' : 'PUT', body);
    return true;
  }

  async function loadAdminProgressUser(userId) {
    setPanelStatus(elements.adminProgressStatus, 'Wczytywanie raportu ucznia…', 'loading');
    try {
      const payload = await adminProgressRequest('GET', null, `?view=user&userId=${encodeURIComponent(userId)}`);
      renderAdminProgressUser(payload);
      setPanelStatus(elements.adminProgressStatus, 'Raport ucznia jest aktualny.', 'success');
    } catch (error) {
      setPanelStatus(elements.adminProgressStatus, error?.message || 'Nie udało się wczytać raportu ucznia.', 'error');
    }
  }

  function renderAdminProgressUser(payload) {
    const host = elements.adminProgressDetail;
    const user = payload.user;
    const aggregate = payload.aggregate;
    host.hidden = false;
    host.replaceChildren();
    const header = document.createElement('header');
    header.append(
      Object.assign(document.createElement('h3'), { textContent: user.profile?.name || user.profile?.email || user.userId }),
      Object.assign(document.createElement('p'), { textContent: `${user.profile?.email || 'Brak e-maila'} · ${user.userId} · ostatnia aktywność: ${adminDateLabel(user.lastActivityAt)}` }),
      Object.assign(document.createElement('strong'), { textContent: `Postęp kursu: ${adminProgressPercent(aggregate.course.progressPercent)}` })
    );
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'button button-secondary'; close.textContent = 'Zamknij raport';
    close.addEventListener('click', () => { host.hidden = true; });
    header.append(close);
    host.append(header);

    const accountSettings = document.createElement('details');
    accountSettings.className = 'admin-progress-account-settings';
    const accountSummary = document.createElement('summary');
    accountSummary.textContent = 'Ustawienia ucznia i reset całego kursu';
    const controls = document.createElement('div');
    controls.className = 'admin-progress-manual-controls';
    const skip = document.createElement('select');
    skip.className = 'text-field';
    skip.setAttribute('aria-label', 'Pomijanie kroków przez tego ucznia');
    [['DEFAULT', 'Według lekcji'], ['ALLOW', 'Pomijanie dozwolone'], ['DENY', 'Pomijanie zabronione']].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; skip.append(option);
    });
    skip.value = user.preferences?.skipMode || 'DEFAULT';
    const saveSkip = document.createElement('button'); saveSkip.type = 'button'; saveSkip.className = 'button button-secondary'; saveSkip.textContent = 'Zapisz pomijanie';
    saveSkip.addEventListener('click', async () => {
      await mutateAdminProgress({ action: 'preference', targetUserId: user.userId, preferences: { skipMode: skip.value } });
      await loadAdminProgressUser(user.userId);
    });
    const resetCourse = document.createElement('button'); resetCourse.type = 'button'; resetCourse.className = 'button button-danger-soft'; resetCourse.textContent = 'Reset całego kursu';
    resetCourse.addEventListener('click', async () => {
      if (await mutateAdminProgress({ targetUserId: user.userId, scope: 'course' }, 'Zresetować cały postęp tego użytkownika? Historia materiałów zostanie usunięta, a operacja zapisana w audycie.')) {
        await loadAdminProgressUser(user.userId);
      }
    });
    controls.append(skip, saveSkip, resetCourse);
    const skipHelp = document.createElement('p');
    skipHelp.textContent = '„Według lekcji” korzysta z przełącznika w Studio → Lesson Builder. Indywidualne zezwolenie lub zakaz ma pierwszeństwo dla tego ucznia. Ręczna blokada konkretnego kroku nadal obowiązuje. Administrator może pomijać; pominięcie nie zalicza zadania.';
    accountSettings.append(accountSummary, skipHelp, controls);
    host.append(accountSettings);

    const list = document.createElement('div');
    list.className = 'admin-progress-material-tree';
    const nodes = (payload.catalog?.nodes || []).filter((node) => node.type !== 'course');
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const childrenByParent = new Map();
    nodes.forEach((node) => {
      const parentId = nodesById.has(node.parentId) ? node.parentId : '__root__';
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(node);
    });

    const appendMaterialActions = (actions, node, record) => {
      if (!['department', 'section', 'subsection', 'course'].includes(node.type)) {
        [['mark_completed', 'Oznacz ukończone'], ['mark_incomplete', 'Oznacz nieukończone']].forEach(([action, label]) => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary'; button.textContent = label;
          button.addEventListener('click', async () => {
            await mutateAdminProgress({ action, targetUserId: user.userId, materialId: node.id });
            await loadAdminProgressUser(user.userId);
          });
          actions.append(button);
        });
      }
      if (node.type === 'lesson' && node.settings?.steps?.length) {
        const step = document.createElement('select'); step.className = 'text-field';
        node.settings.steps.forEach((item) => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; step.append(option); });
        step.value = record?.details?.currentStepId || node.settings.steps[0].id;
        const setStep = document.createElement('button'); setStep.type = 'button'; setStep.className = 'button button-secondary'; setStep.textContent = 'Ustaw krok';
        setStep.addEventListener('click', async () => {
          await mutateAdminProgress({ action: 'set_step', targetUserId: user.userId, materialId: node.id, stepId: step.value });
          await loadAdminProgressUser(user.userId);
        });
        const unlock = document.createElement('button'); unlock.type = 'button'; unlock.className = 'button button-secondary'; unlock.textContent = 'Odblokuj krok';
        unlock.addEventListener('click', async () => {
          await mutateAdminProgress({ action: 'unlock_step', targetUserId: user.userId, materialId: node.id, stepId: step.value });
          await loadAdminProgressUser(user.userId);
        });
        const lock = document.createElement('button'); lock.type = 'button'; lock.className = 'button button-secondary'; lock.textContent = 'Zablokuj krok';
        lock.addEventListener('click', async () => {
          await mutateAdminProgress({ action: 'lock_step', targetUserId: user.userId, materialId: node.id, stepId: step.value });
          await loadAdminProgressUser(user.userId);
        });
        actions.append(step, setStep, unlock, lock);
      }
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button button-danger-soft'; reset.textContent = 'Reset';
      const scope = node.type === 'department' ? 'department' : ['section', 'subsection'].includes(node.type) ? 'section' : 'material';
      reset.addEventListener('click', async () => {
        if (await mutateAdminProgress({ targetUserId: user.userId, scope, materialId: node.id }, `Zresetować „${node.title}” dla tego użytkownika?`)) {
          await loadAdminProgressUser(user.userId);
        }
      });
      actions.append(reset);
    };

    const formatExamDuration = (seconds) => {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      const minutes = Math.floor(total / 60);
      return `${minutes ? `${minutes} min ` : ''}${total % 60} s`;
    };

    const appendExamAttempts = (body, node) => {
      const repositoryId = node.settings?.repositoryId || 'default';
      const examId = node.settings?.examId || '';
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(repositoryId) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(examId)) return;
      const report = document.createElement('details');
      report.className = 'admin-progress-exam-attempts';
      const summary = document.createElement('summary');
      summary.textContent = 'Próby egzaminu, wyniki i czas';
      const content = document.createElement('div');
      content.className = 'admin-progress-exam-attempt-list';
      report.append(summary, content);
      let loaded = false;
      report.addEventListener('toggle', async () => {
        if (!report.open || loaded) return;
        loaded = true;
        content.textContent = 'Wczytywanie prób egzaminu…';
        try {
          const query = `?view=user&repo=${encodeURIComponent(repositoryId)}&exam=${encodeURIComponent(examId)}&userId=${encodeURIComponent(user.userId)}`;
          const result = await adminExamRequest('GET', query);
          const attempts = (result.user?.attempts || []).slice().sort((left, right) => Number(right.number) - Number(left.number));
          content.replaceChildren();
          if (!attempts.length) {
            content.append(Object.assign(document.createElement('p'), { className: 'admin-progress-report-empty', textContent: 'Uczeń nie rozpoczął jeszcze żadnej próby tego egzaminu.' }));
            return;
          }
          attempts.forEach((attempt) => {
            const row = document.createElement('article');
            row.className = 'admin-progress-exam-attempt';
            const copy = document.createElement('div');
            const status = attempt.status === 'active' ? 'W trakcie'
              : attempt.status === 'timed_out' ? 'Zakończona przez limit czasu'
                : attempt.status === 'reset' ? 'Zresetowana' : 'Zakończona';
            copy.append(
              Object.assign(document.createElement('strong'), { textContent: `Próba ${attempt.number} · ${status}` }),
              Object.assign(document.createElement('small'), { textContent: `Wynik: ${attempt.scorePercent == null ? '—' : adminProgressPercent(attempt.scorePercent)} · ${attempt.passed == null ? 'brak statusu' : attempt.passed ? 'zaliczono' : 'nie zaliczono'} · czas: ${attempt.durationSeconds == null ? '—' : formatExamDuration(attempt.durationSeconds)}` }),
              Object.assign(document.createElement('small'), { textContent: `Start: ${adminDateLabel(attempt.startedAt)} · zakończenie: ${adminDateLabel(attempt.submittedAt)}` })
            );
            row.append(copy);
            if (attempt.status !== 'reset') {
              const reset = document.createElement('button');
              reset.type = 'button';
              reset.className = 'button button-danger-soft';
              reset.textContent = 'Reset próby';
              reset.addEventListener('click', async () => {
                if (!window.confirm(`Zresetować próbę ${attempt.number} tego egzaminu? Wynik ucznia zostanie przeliczony na podstawie pozostałych prób.`)) return;
                reset.disabled = true;
                try {
                  await adminExamRequest('DELETE', '', {
                    repositoryId, examId, targetUserId: user.userId, attemptId: attempt.attemptId,
                    operationId: `dashboard-reset-${Date.now()}`
                  });
                  await loadAdminProgressUser(user.userId);
                } catch (error) {
                  setPanelStatus(elements.adminProgressStatus, error?.message || 'Nie udało się zresetować próby.', 'error');
                  reset.disabled = false;
                }
              });
              row.append(reset);
            }
            content.append(row);
          });
        } catch (error) {
          loaded = false;
          content.textContent = error?.message || 'Nie udało się wczytać prób egzaminu.';
        }
      });
      body.append(report);
    };

    const createMaterialRow = (node) => {
      const data = aggregate.nodes[node.id];
      const record = user.records[node.id] || null;
      const nested = childrenByParent.get(node.id) || [];
      const isContainer = nested.length > 0 || ['department', 'section', 'subsection'].includes(node.type);
      const card = document.createElement('details');
      card.className = 'admin-progress-material';
      const summary = document.createElement('summary');
      const copy = document.createElement('span');
      copy.className = 'admin-progress-material-copy';
      copy.append(
        Object.assign(document.createElement('strong'), { textContent: node.title }),
        Object.assign(document.createElement('small'), { textContent: `${adminProgressNodeTypeLabel(node.type)}${nested.length ? ` · ${nested.length} ${nested.length === 1 ? 'element' : 'elementy'}` : ''}` })
      );
      const state = document.createElement('span');
      state.className = 'admin-progress-material-state';
      state.textContent = isContainer
        ? `${data?.completedCount || 0}/${data?.trackedCount || 0} ukończonych`
        : adminMaterialStatusLabel(record);
      const percent = document.createElement('strong');
      percent.className = 'admin-progress-material-percent';
      percent.textContent = adminProgressPercent(data?.progressPercent);
      const chevron = document.createElement('span');
      chevron.className = 'admin-progress-material-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '›';
      summary.append(copy, state, percent, chevron);
      card.append(summary);

      let hydrated = false;
      card.addEventListener('toggle', () => {
        if (!card.open || hydrated) return;
        hydrated = true;
        const body = document.createElement('div');
        body.className = 'admin-progress-material-body';
        const facts = document.createElement('div');
        facts.className = 'admin-progress-material-facts';
        if (isContainer) {
          facts.append(
            Object.assign(document.createElement('small'), { textContent: `Postęp: ${adminProgressPercent(data?.progressPercent)} · ukończone materiały: ${data?.completedCount || 0}/${data?.trackedCount || 0}` }),
            Object.assign(document.createElement('small'), { textContent: nested.length ? 'Rozwiń poniższe wiersze, aby zobaczyć ich parametry.' : 'Ten kontener nie ma materiałów.' })
          );
        } else {
          facts.append(
            Object.assign(document.createElement('small'), { textContent: `${record?.opened ? 'Otwarty' : 'Nieotwarty'} · ${adminMaterialStatusLabel(record)} · ${recordDetailsLabel(node, record)}` }),
            Object.assign(document.createElement('small'), { textContent: `Pierwsze otwarcie: ${adminDateLabel(record?.firstOpenedAt)} · ostatnia aktywność: ${adminDateLabel(record?.lastActivityAt)}` })
          );
        }
        const actions = document.createElement('div');
        actions.className = 'admin-progress-material-actions';
        appendMaterialActions(actions, node, record);
        body.append(facts, actions);
        if (node.type === 'exam') appendExamAttempts(body, node);
        if (nested.length) {
          const childList = document.createElement('div');
          childList.className = 'admin-progress-material-children';
          nested.forEach((child) => childList.append(createMaterialRow(child)));
          body.append(childList);
        }
        card.append(body);
      });
      return card;
    };

    (childrenByParent.get('__root__') || []).forEach((node) => list.append(createMaterialRow(node)));
    if (!list.childElementCount) {
      list.append(Object.assign(document.createElement('p'), { className: 'admin-empty', textContent: 'Brak materiałów w katalogu postępu.' }));
    }
    host.append(list);
  }

  function adminAiProviderLabel(provider) {
    return provider === 'openai' ? 'OpenAI' : 'Google Gemini';
  }

  function availableAdminAiConfigs() {
    const configs = [...(adminAiSettings?.configs || [])];
    const environmentConfigs = Array.isArray(adminAiSettings?.environmentConfigs)
      ? adminAiSettings.environmentConfigs
      : [
          ...(adminAiSettings?.legacyEnvironment?.gemini ? [{ aiConfigId: 'env-gemini', name: 'Gemini (ENV)', provider: 'gemini' }] : []),
          ...(adminAiSettings?.legacyEnvironment?.openai ? [{ aiConfigId: 'env-openai', name: 'OpenAI (ENV)', provider: 'openai' }] : [])
        ];
    environmentConfigs.forEach((config) => {
      if (!configs.some((item) => item.aiConfigId === config.aiConfigId)) configs.push(config);
    });
    return configs;
  }

  async function adminAiRequest(method, body, query) {
    const token = await getAdminToken();
    const response = await fetch(`${ADMIN_AI_URL}${query || ''}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return readAdminResponse(response);
  }

  async function adminAiUsageRequest(method, body, query) {
    const token = await getAdminToken();
    const response = await fetch(`${ADMIN_AI_USAGE_URL}${query || ''}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return readAdminResponse(response);
  }

  function emptyAdminAiLimitSet() {
    return Object.fromEntries(AI_LIMIT_METRICS.map((metric) => [
      metric,
      Object.fromEntries(AI_LIMIT_PERIODS.map((period) => [period, null]))
    ]));
  }

  function emptyAdminAiConfigPolicy() {
    return {
      global: emptyAdminAiLimitSet(),
      perUser: emptyAdminAiLimitSet(),
      pricing: { inputPerMillion: null, outputPerMillion: null },
      fallbackConfigId: null
    };
  }

  function adminAiUserLabel(userId) {
    const user = adminUsers.find((item) => (item.id || item.sub) === userId);
    if (!user) return userId;
    const metadata = user.user_metadata || {};
    const name = [
      user.firstName || metadata.first_name || metadata.firstName,
      user.lastName || metadata.last_name || metadata.lastName
    ].filter(Boolean).join(' ');
    return `${name || user.email || userId}${user.email && name ? ` · ${user.email}` : ''}`;
  }

  function populateAdminAiLimitScope() {
    if (!adminAiUsageSettings) return;
    const scope = elements.adminAiLimitScope.value;
    const usesModuleInput = scope === 'module';
    const usesId = ['provider', 'config', 'configUser', 'user'].includes(scope);
    elements.adminAiLimitScopeIdWrap.hidden = !usesId;
    elements.adminAiLimitModuleWrap.hidden = !usesModuleInput;
    elements.adminAiLimitUserModeWrap.hidden = scope !== 'user';
    elements.adminAiConfigPolicy.hidden = !['config', 'configUser'].includes(scope);
    if (elements.adminAiLimitExplanation) {
      elements.adminAiLimitExplanation.textContent = ({
        global: 'Wspólna pula dla wszystkich wywołań AI. Jeden użytkownik może zużyć ją także innym.',
        defaultUser: 'Limit bazowy jest liczony osobno dla każdego użytkownika w trybie „Dziedzicz”.',
        provider: 'Wspólna pula wybranego dostawcy dla wszystkich użytkowników i konfiguracji.',
        module: 'Limit modułu jest liczony osobno dla każdego użytkownika, np. osobno dla czatu.',
        config: 'Wspólna pula wybranej konfiguracji AI dla wszystkich użytkowników.',
        configUser: 'Dodatkowy limit wybranej konfiguracji, liczony osobno dla każdego użytkownika. Działa równolegle z limitem bazowym, ale tylko gdy routing wywołania używa dokładnie tej konfiguracji.',
        user: '„Własne limity” zastępują tylko limit bazowy. „Bez limitu użytkownika” wyłącza warstwy bazową, modułową i konfiguracji na użytkownika, lecz nadal obowiązują pule wspólne.'
      })[scope] || '';
    }
    let choices = [];
    if (scope === 'provider') choices = ['gemini', 'openai'].map((id) => ({ id, label: adminAiProviderLabel(id) }));
    if (scope === 'config' || scope === 'configUser') choices = availableAdminAiConfigs().map((config) => ({ id: config.aiConfigId, label: `${config.name} · ${config.aiConfigId}` }));
    if (scope === 'user') {
      const ids = new Set([
        ...adminUsers.map((user) => user.id || user.sub),
        ...Object.keys(adminAiUsageSettings.users || {}),
        ...(adminAiUsageReport?.users || []).map((user) => user.userId)
      ].filter(Boolean));
      choices = Array.from(ids).map((id) => ({ id, label: adminAiUserLabel(id) }));
    }
    if (usesId) {
      const previous = adminAiLimitSelection.scope === scope ? adminAiLimitSelection.id : '';
      elements.adminAiLimitScopeId.replaceChildren(...choices.map((choice) => Object.assign(document.createElement('option'), {
        value: choice.id, textContent: choice.label
      })));
      elements.adminAiLimitScopeId.value = choices.some((choice) => choice.id === previous) ? previous : choices[0]?.id || '';
    }
    if (usesModuleInput) {
      const known = Object.keys(adminAiUsageSettings.modules || {});
      elements.adminAiLimitModuleId.value = adminAiLimitSelection.scope === scope && adminAiLimitSelection.id
        ? adminAiLimitSelection.id : known[0] || 'chat';
    }
    adminAiLimitSelection = {
      scope,
      id: usesModuleInput ? elements.adminAiLimitModuleId.value.trim() : usesId ? elements.adminAiLimitScopeId.value : ''
    };
    renderAdminAiLimitEditor();
  }

  function selectedAdminAiLimitSet(create) {
    const settings = adminAiUsageSettings;
    if (!settings) return null;
    const { scope, id } = adminAiLimitSelection;
    if (scope === 'global') return settings.global;
    if (scope === 'defaultUser') return settings.defaultUser;
    if (!id) return null;
    if (scope === 'provider' || scope === 'module') {
      const map = scope === 'provider' ? settings.providers : settings.modules;
      if (!map[id] && create) map[id] = emptyAdminAiLimitSet();
      return map[id] || null;
    }
    if (scope === 'config' || scope === 'configUser') {
      if (!settings.configs[id] && create) settings.configs[id] = emptyAdminAiConfigPolicy();
      const policy = settings.configs[id];
      return policy ? policy[scope === 'config' ? 'global' : 'perUser'] : null;
    }
    if (scope === 'user') {
      if (!settings.users[id] && create) settings.users[id] = { mode: 'inherit', limits: emptyAdminAiLimitSet() };
      return settings.users[id]?.limits || null;
    }
    return null;
  }

  function commitAdminAiLimitEditor() {
    if (!adminAiUsageSettings) return;
    const limitSet = selectedAdminAiLimitSet(true);
    if (limitSet) {
      elements.adminAiLimitGrid.querySelectorAll('input[data-ai-limit-metric]').forEach((input) => {
        const raw = input.value.trim();
        if (!raw) limitSet[input.dataset.aiLimitMetric][input.dataset.aiLimitPeriod] = null;
        else {
          const value = Number(raw);
          if (!Number.isSafeInteger(value) || value < 0) throw new Error('Limit musi być pusty albo nieujemną liczbą całkowitą.');
          limitSet[input.dataset.aiLimitMetric][input.dataset.aiLimitPeriod] = value;
        }
      });
    }
    const { scope, id } = adminAiLimitSelection;
    if (scope === 'user' && id && adminAiUsageSettings.users[id]) {
      adminAiUsageSettings.users[id].mode = elements.adminAiLimitUserMode.value;
    }
    if (['config', 'configUser'].includes(scope) && id) {
      const policy = adminAiUsageSettings.configs[id] || (adminAiUsageSettings.configs[id] = emptyAdminAiConfigPolicy());
      const parsePrice = (input) => {
        if (!input.value.trim()) return null;
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0) throw new Error('Cena tokenów musi być nieujemną liczbą.');
        return value;
      };
      policy.pricing.inputPerMillion = parsePrice(elements.adminAiPriceInput);
      policy.pricing.outputPerMillion = parsePrice(elements.adminAiPriceOutput);
      policy.fallbackConfigId = elements.adminAiFallback.value || null;
    }
  }

  function renderAdminAiLimitEditor() {
    const limitSet = selectedAdminAiLimitSet(true);
    const selectedUserMode = adminAiLimitSelection.scope === 'user'
      ? adminAiUsageSettings.users[adminAiLimitSelection.id]?.mode || 'inherit'
      : '';
    const disabled = !limitSet || (adminAiLimitSelection.scope === 'user' && ['unlimited', 'disabled'].includes(selectedUserMode));
    const labels = { requests: 'Żądania', inputTokens: 'Tokeny wejścia', outputTokens: 'Tokeny wyjścia', totalTokens: 'Tokeny łącznie', estimatedCostMicros: 'Koszt (mikro)' };
    const periodLabels = { hour: 'Godzina', day: 'Dzień', week: 'Tydzień', month: 'Miesiąc', lifetime: 'Łącznie' };
    const reactLimits = window.NextMedUI?.render('studio-ai-limit-grid', elements.adminAiLimitGrid, {
      metrics: AI_LIMIT_METRICS, periods: AI_LIMIT_PERIODS, values: limitSet, disabled, labels, periodLabels,
      selection: `${adminAiLimitSelection.scope}:${adminAiLimitSelection.id || ''}`
    });
    if (!reactLimits) {
    const table = document.createElement('table');
    table.className = 'admin-ai-limit-table';
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    header.append(Object.assign(document.createElement('th'), { textContent: 'Metryka' }));
    AI_LIMIT_PERIODS.forEach((period) => header.append(Object.assign(document.createElement('th'), { textContent: periodLabels[period] })));
    head.append(header);
    const body = document.createElement('tbody');
    AI_LIMIT_METRICS.forEach((metric) => {
      const row = document.createElement('tr');
      row.append(Object.assign(document.createElement('th'), { textContent: labels[metric] }));
      AI_LIMIT_PERIODS.forEach((period) => {
        const cell = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.className = 'text-field';
        input.dataset.aiLimitMetric = metric;
        input.dataset.aiLimitPeriod = period;
        input.disabled = disabled;
        const value = limitSet && limitSet[metric] && limitSet[metric][period];
        input.value = value == null ? '' : String(value);
        input.setAttribute('aria-label', `${labels[metric]} — ${periodLabels[period]}`);
        cell.append(input);
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body);
    elements.adminAiLimitGrid.replaceChildren(table);
    }

    const { scope, id } = adminAiLimitSelection;
    if (scope === 'user' && id) {
      elements.adminAiLimitUserMode.value = adminAiUsageSettings.users[id]?.mode || 'inherit';
      const editable = ['inherit', 'custom'].includes(elements.adminAiLimitUserMode.value);
      elements.adminAiLimitGrid.querySelectorAll('input').forEach((input) => { input.disabled = !editable; });
    }
    if (['config', 'configUser'].includes(scope) && id) {
      const policy = adminAiUsageSettings.configs[id] || (adminAiUsageSettings.configs[id] = emptyAdminAiConfigPolicy());
      elements.adminAiPriceInput.value = policy.pricing.inputPerMillion == null ? '' : String(policy.pricing.inputPerMillion);
      elements.adminAiPriceOutput.value = policy.pricing.outputPerMillion == null ? '' : String(policy.pricing.outputPerMillion);
      const fallbackOptions = [Object.assign(document.createElement('option'), { value: '', textContent: 'Brak fallbacku' })];
      availableAdminAiConfigs().filter((config) => config.aiConfigId !== id).forEach((config) => fallbackOptions.push(Object.assign(document.createElement('option'), { value: config.aiConfigId, textContent: config.name })));
      elements.adminAiFallback.replaceChildren(...fallbackOptions);
      elements.adminAiFallback.value = policy.fallbackConfigId || '';
    }
  }

  function formatAdminAiCost(micros) {
    return `${(Number(micros || 0) / 1_000_000).toLocaleString('pl-PL', { maximumFractionDigits: 6 })} ${adminAiUsageReport?.currency || adminAiUsageSettings?.currency || ''}`.trim();
  }

  function renderAdminAiUsageSummary() {
    const totals = adminAiUsageReport?.totals || {};
    const period = adminAiUsageReport?.period || 'day';
    const cards = [
      ['Żądania', totals.requests || 0, 'requests'],
      ['Tokeny łącznie', totals.totalTokens || 0, 'totalTokens'],
      ['Szacowany koszt', formatAdminAiCost(totals.estimatedCostMicros), 'estimatedCostMicros'],
      ['Aktywni użytkownicy', (adminAiUsageReport?.users || []).filter((user) => user.requests > 0).length, null]
    ].map(([label, value, metric]) => {
      const card = document.createElement('article');
      const limit = metric ? adminAiUsageSettings?.global?.[metric]?.[period] : null;
      const raw = metric ? Number(totals[metric] || 0) : Number(value || 0);
      const percent = limit == null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((raw / limit) * 100));
      const thresholds = adminAiUsageSettings?.warningThresholds || [70, 90, 100];
      card.dataset.warning = percent >= thresholds[2] ? 'limit' : percent >= thresholds[1] ? 'critical' : percent >= thresholds[0] ? 'warning' : 'ok';
      card.append(
        Object.assign(document.createElement('span'), { textContent: label }),
        Object.assign(document.createElement('strong'), { textContent: typeof value === 'number' ? value.toLocaleString('pl-PL') : String(value) })
      );
      const progress = document.createElement('progress');
      progress.max = 100;
      progress.value = percent;
      progress.setAttribute('aria-label', limit == null ? `${label}: bez limitu` : `${label}: ${percent}% limitu`);
      const note = document.createElement('small');
      note.textContent = limit == null ? 'bez limitu globalnego' : `${percent}% z ${metric === 'estimatedCostMicros' ? formatAdminAiCost(limit) : Number(limit).toLocaleString('pl-PL')}`;
      card.append(progress, note);
      return card;
    });
    elements.adminAiUsageSummary.replaceChildren(...cards);
  }

  function renderAdminAiUsageTable(host, rows, options = {}) {
    if (window.NextMedUI?.render('studio-ai-table', host, {
      rows: rows || [], reset: options.reset, label: options.label, cost: formatAdminAiCost,
      onLimits: openAdminAiUserLimits, onDetail: renderAdminAiUserDetail, onReset: resetAdminAiUserUsage
    })) return;
    const table = document.createElement('table');
    table.className = 'admin-ai-usage-table';
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    const headings = ['Nazwa / ID', 'Żądania', 'OK', 'Błędy', 'Wejście', 'Wyjście', 'Łącznie', 'Śr./request', 'Koszt'];
    if (options.reset) headings.push('Limit bazowy', 'Użycie bazowe');
    headings.forEach((label) => header.append(Object.assign(document.createElement('th'), { textContent: label })));
    if (options.reset) header.append(Object.assign(document.createElement('th'), { textContent: 'Akcje' }));
    head.append(header);
    const body = document.createElement('tbody');
    (rows || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.dataset.warning = row.warning?.level || 'ok';
      const label = options.label ? options.label(row) : row.id;
      const average = row.avgTokensPerRequest == null
        ? (row.requests ? Math.round(Number(row.totalTokens || 0) / row.requests) : 0)
        : row.avgTokensPerRequest;
      const values = [label, row.requests || 0, row.successfulRequests || 0, row.errors || 0, row.inputTokens || 0, row.outputTokens || 0, row.totalTokens || 0, average, formatAdminAiCost(row.estimatedCostMicros)];
      if (options.reset) {
        const limitLabel = row.mode === 'disabled' ? 'wyłączone' : row.limit == null ? '∞' : row.limit;
        values.push(limitLabel, `${Number(row.usagePercent || 0)}%`);
      }
      values.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        cell.textContent = typeof value === 'number' ? value.toLocaleString('pl-PL') : String(value || '—');
        tr.append(cell);
      });
      if (options.reset) {
        const cell = document.createElement('td');
        const limits = Object.assign(document.createElement('button'), { className: 'button button-secondary', type: 'button', textContent: 'Limity' });
        limits.addEventListener('click', () => openAdminAiUserLimits(row.userId));
        const detail = Object.assign(document.createElement('button'), { className: 'button button-secondary', type: 'button', textContent: 'Szczegóły' });
        detail.addEventListener('click', () => renderAdminAiUserDetail(row));
        const button = Object.assign(document.createElement('button'), { className: 'button button-secondary button-danger-soft', type: 'button', textContent: 'Wyzeruj' });
        button.addEventListener('click', () => resetAdminAiUserUsage(row.userId));
        cell.append(limits, detail, button);
        tr.append(cell);
      }
      body.append(tr);
    });
    if (!body.childElementCount) {
      const row = document.createElement('tr');
      const cell = Object.assign(document.createElement('td'), { colSpan: options.reset ? 12 : 9, textContent: 'Brak danych w tym okresie.' });
      row.append(cell);
      body.append(row);
    }
    table.append(head, body);
    const scroll = document.createElement('div');
    scroll.className = 'admin-ai-table-scroll';
    scroll.append(table);
    host.replaceChildren(scroll);
  }

  function emptyAdminAiPublicMetrics() {
    return {
      requests: 0,
      successfulRequests: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostMicros: 0
    };
  }

  function adminAiEffectiveUserPolicy(userId) {
    const policy = adminAiUsageSettings?.users?.[userId];
    if (!policy || policy.mode === 'inherit') return { mode: 'inherit', limits: adminAiUsageSettings?.defaultUser || emptyAdminAiLimitSet() };
    if (policy.mode === 'custom') return { mode: 'custom', limits: policy.limits || emptyAdminAiLimitSet() };
    return { mode: policy.mode, limits: null };
  }

  function emptyAdminAiUserRow(userId, period) {
    const policy = adminAiEffectiveUserPolicy(userId);
    return {
      userId,
      mode: policy.mode,
      ...emptyAdminAiPublicMetrics(),
      limit: policy.limits?.requests?.[period] ?? null,
      usagePercent: 0,
      warning: null,
      periods: Object.fromEntries(AI_LIMIT_PERIODS.map((name) => [name, emptyAdminAiPublicMetrics()])),
      breakdown: { providers: [], modules: [], configs: [], models: [] }
    };
  }

  function allAdminAiUserIds() {
    return Array.from(new Set([
      ...adminUsers.map((user) => user.id || user.sub),
      ...Object.keys(adminAiUsageSettings?.users || {}),
      ...(adminAiUsageReport?.users || []).map((row) => row.userId)
    ].filter(Boolean)));
  }

  function adminAiUserSearchValue(userId) {
    const user = adminUsers.find((item) => (item.id || item.sub) === userId);
    return normalizeText([
      userId,
      user?.email,
      user?.firstName,
      user?.lastName,
      adminAiUserLabel(userId)
    ].filter(Boolean).join(' '));
  }

  function renderAdminAiUsageUsers() {
    if (!adminAiUsageSettings || !adminAiUsageReport) return;
    const period = adminAiUsageReport.period || elements.adminAiUsagePeriod.value || 'day';
    const query = normalizeText(elements.adminAiUsersSearch?.value);
    const allIds = allAdminAiUserIds().sort((left, right) => (
      adminAiUserLabel(left).localeCompare(adminAiUserLabel(right), 'pl', { sensitivity: 'base' })
    ));
    const filteredIds = query ? allIds.filter((userId) => adminAiUserSearchValue(userId).includes(query)) : allIds;
    const visibleIds = filteredIds.slice(0, adminAiUserVisibleCount);
    const rows = visibleIds.map((userId) => adminAiUserUsageRows.get(userId) || emptyAdminAiUserRow(userId, period));
    renderAdminAiUsageTable(elements.adminAiUsageUsers, rows, {
      reset: true,
      label: (row) => adminAiUserLabel(row.userId)
    });

    if (elements.adminAiUsersCount) {
      const shown = Math.min(visibleIds.length, filteredIds.length);
      elements.adminAiUsersCount.textContent = query
        ? `Wyświetlono ${shown} z ${filteredIds.length} pasujących kont (${allIds.length} łącznie)`
        : `Wyświetlono ${shown} z ${allIds.length} kont`;
    }
    const remaining = Math.max(0, filteredIds.length - visibleIds.length);
    elements.adminAiUsersMore.hidden = remaining === 0;
    elements.adminAiUsersMore.textContent = remaining
      ? `Pokaż więcej (${Math.min(ADMIN_AI_USERS_PAGE_SIZE, remaining)} z ${remaining})`
      : 'Pokaż więcej';

    const missing = visibleIds.filter((userId) => !adminAiUserUsageRows.has(userId) && !adminAiUserUsagePending.has(userId));
    if (missing.length) void loadAdminAiUsageUserRows(missing, period);
  }

  async function loadAdminAiUsageUserRows(userIds, period) {
    const ids = Array.from(new Set(userIds)).filter(Boolean);
    if (!ids.length) return;
    ids.forEach((userId) => adminAiUserUsagePending.add(userId));
    const requestId = adminAiUserUsageRequestId;
    try {
      for (let index = 0; index < ids.length; index += 50) {
        const chunk = ids.slice(index, index + 50);
        const query = `?view=users&period=${encodeURIComponent(period)}&ids=${encodeURIComponent(chunk.join(','))}`;
        const payload = await adminAiUsageRequest('GET', null, query);
        if (requestId !== adminAiUserUsageRequestId || period !== adminAiUserUsagePeriod) return;
        (payload.users || []).forEach((row) => {
          if (row?.userId) adminAiUserUsageRows.set(row.userId, row);
        });
      }
      renderAdminAiUsageUsers();
    } catch (error) {
      setPanelStatus(elements.adminAiUsageStatus, error?.message || 'Nie udało się wczytać użycia wybranych użytkowników.', 'error');
    } finally {
      ids.forEach((userId) => adminAiUserUsagePending.delete(userId));
    }
  }

  function renderAdminAiUserDetail(row) {
    const heading = document.createElement('div');
    heading.className = 'admin-ai-list-heading';
    const copy = document.createElement('div');
    copy.append(
      Object.assign(document.createElement('span'), { className: 'eyebrow', textContent: 'Szczegóły użytkownika' }),
      Object.assign(document.createElement('h3'), { textContent: adminAiUserLabel(row.userId) })
    );
    const close = Object.assign(document.createElement('button'), { className: 'button button-secondary', type: 'button', textContent: 'Zamknij' });
    close.addEventListener('click', () => { elements.adminAiUserDetail.hidden = true; });
    heading.append(copy, close);
    const grid = document.createElement('div');
    grid.className = 'admin-ai-usage-tables';
    const periods = document.createElement('div');
    periods.className = 'admin-ai-usage-summary admin-ai-user-periods';
    [['Ta godzina', 'hour'], ['Dzisiaj', 'day'], ['Tydzień', 'week'], ['Miesiąc', 'month'], ['Łącznie', 'lifetime']].forEach(([label, key]) => {
      const metrics = row.periods?.[key] || {};
      const card = document.createElement('article');
      card.append(
        Object.assign(document.createElement('span'), { textContent: label }),
        Object.assign(document.createElement('strong'), { textContent: `${Number(metrics.requests || 0).toLocaleString('pl-PL')} req.` }),
        Object.assign(document.createElement('small'), { textContent: `${Number(metrics.totalTokens || 0).toLocaleString('pl-PL')} tokenów · ${formatAdminAiCost(metrics.estimatedCostMicros)}` })
      );
      periods.append(card);
    });
    [['Moduły', 'modules'], ['Dostawcy', 'providers'], ['Konfiguracje', 'configs'], ['Modele', 'models']].forEach(([label, key]) => {
      const section = document.createElement('section');
      section.append(Object.assign(document.createElement('h3'), { textContent: label }));
      const host = document.createElement('div');
      section.append(host);
      renderAdminAiUsageTable(host, row.breakdown?.[key] || []);
      grid.append(section);
    });
    elements.adminAiUserDetail.replaceChildren(heading, periods, grid);
    elements.adminAiUserDetail.hidden = false;
    elements.adminAiUserDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderAdminAiUsage() {
    if (!adminAiUsageSettings || !adminAiUsageReport) return;
    elements.adminAiUsageTimezone.value = adminAiUsageSettings.timezone;
    elements.adminAiUsageCurrency.value = adminAiUsageSettings.currency;
    elements.adminAiUsageShowUser.checked = adminAiUsageSettings.showUserLimits !== false;
    [elements.adminAiWarning1, elements.adminAiWarning2, elements.adminAiWarning3].forEach((input, index) => { input.value = String(adminAiUsageSettings.warningThresholds[index]); });
    renderAdminAiUsageSummary();
    renderAdminAiUsageTable(elements.adminAiUsageProviders, adminAiUsageReport.providers);
    renderAdminAiUsageTable(elements.adminAiUsageModels, adminAiUsageReport.models);
    renderAdminAiUsageTable(elements.adminAiUsageConfigs, adminAiUsageReport.configs, {
      label: (row) => adminAiSettings?.configs?.find((config) => config.aiConfigId === row.id)?.name || row.id
    });
    renderAdminAiUsageTable(elements.adminAiUsageModules, adminAiUsageReport.modules);
    renderAdminAiUsageUsers();
    populateAdminAiLimitScope();
  }

  async function fetchAdminAiUsage(force) {
    if (adminAiUsageLoaded && !force) return;
    elements.adminAiUsageRefresh.disabled = true;
    setPanelStatus(elements.adminAiUsageStatus, 'Wczytywanie limitów i użycia AI…', 'loading');
    try {
      const period = elements.adminAiUsagePeriod.value || 'day';
      const [settings, report, providerSettings] = await Promise.all([
        adminAiUsageRequest('GET', null, '?view=settings'),
        adminAiUsageRequest('GET', null, `?view=report&period=${encodeURIComponent(period)}`),
        adminAiRequest('GET'),
        adminUsers.length ? Promise.resolve() : loadAdminUsers()
      ]);
      adminAiUsageSettings = settings;
      adminAiUsageReport = report;
      adminAiSettings = providerSettings;
      adminAiUserUsagePeriod = report.period;
      adminAiUserUsageRows = new Map((report.users || []).filter((row) => row?.userId).map((row) => [row.userId, row]));
      adminAiUserUsageRequestId += 1;
      adminAiUserUsagePending.clear();
      adminAiUsageLoaded = true;
      pendingChanges.delete('ai-usage');
      renderAdminAiUsage();
      setPanelStatus(elements.adminAiUsageStatus, `Raport: ${report.key} · strefa ${report.timezone}.`, 'info');
    } catch (error) {
      adminAiUsageLoaded = false;
      setPanelStatus(elements.adminAiUsageStatus, error?.message || 'Nie udało się wczytać limitów AI.', 'error');
    } finally { elements.adminAiUsageRefresh.disabled = false; }
  }

  async function openAdminAiUserLimits(userId) {
    try { commitAdminAiLimitEditor(); }
    catch (error) { setPanelStatus(elements.adminAiUsageStatus, error.message, 'error'); return; }
    await activateAdminTab('ai-usage', false);
    if (!adminAiUsageSettings) return;
    elements.adminAiLimitScope.value = 'user';
    adminAiLimitSelection = { scope: 'user', id: userId };
    populateAdminAiLimitScope();
    elements.adminAiLimitScopeId.value = userId;
    adminAiLimitSelection.id = userId;
    renderAdminAiLimitEditor();
    elements.adminAiLimitUserMode.focus();
  }

  async function saveAdminAiUsageSettings() {
    try {
      commitAdminAiLimitEditor();
      adminAiUsageSettings.timezone = elements.adminAiUsageTimezone.value.trim();
      adminAiUsageSettings.currency = elements.adminAiUsageCurrency.value.trim().toUpperCase();
      adminAiUsageSettings.showUserLimits = elements.adminAiUsageShowUser.checked;
      adminAiUsageSettings.warningThresholds = [elements.adminAiWarning1, elements.adminAiWarning2, elements.adminAiWarning3].map((input) => Number(input.value));
      elements.adminAiUsageSave.disabled = true;
      setPanelStatus(elements.adminAiUsageStatus, 'Zapisywanie limitów…', 'loading');
      adminAiUsageSettings = await adminAiUsageRequest('PUT', { settings: adminAiUsageSettings });
      pendingChanges.delete('ai-usage');
      adminAiUsageLoaded = false;
      await loadAdminAiUsage(true);
      setPanelStatus(elements.adminAiUsageStatus, 'Limity AI zostały zapisane i obowiązują od następnego żądania.', 'info');
    } catch (error) {
      setPanelStatus(elements.adminAiUsageStatus, error?.message || 'Nie udało się zapisać limitów AI.', 'error');
    } finally { elements.adminAiUsageSave.disabled = false; }
  }

  function loadMoreAdminAiUsers() {
    adminAiUserVisibleCount += ADMIN_AI_USERS_PAGE_SIZE;
    renderAdminAiUsageUsers();
  }

  async function resetAdminAiUserUsage(userId) {
    if (!window.confirm(`Wyzerować całe zarejestrowane użycie AI użytkownika „${adminAiUserLabel(userId)}”? Operacja zostanie zapisana w audycie.`)) return;
    setPanelStatus(elements.adminAiUsageStatus, 'Zerowanie użycia użytkownika…', 'loading');
    try {
      await adminAiUsageRequest('POST', { action: 'reset-user', userId, confirmed: true });
      adminAiUsageLoaded = false;
      await loadAdminAiUsage(true);
      setPanelStatus(elements.adminAiUsageStatus, 'Użycie użytkownika wyzerowano. Liczniki globalne pozostały bez zmian.', 'info');
    } catch (error) { setPanelStatus(elements.adminAiUsageStatus, error?.message || 'Nie udało się wyzerować użycia.', 'error'); }
  }

  async function loadAdminAiUsageAudit() {
    if (!elements.adminAiUsageAudit.open) return;
    elements.adminAiUsageAuditList.textContent = 'Wczytywanie historii…';
    try {
      const payload = await adminAiUsageRequest('GET', null, '?view=audit');
      const audit = Array.isArray(payload.audit) ? payload.audit : [];
      if (!audit.length) return void (elements.adminAiUsageAuditList.textContent = 'Historia zmian jest jeszcze pusta.');
      const list = document.createElement('ol');
      audit.forEach((entry) => {
        const item = document.createElement('li');
        const copy = document.createElement('span');
        copy.append(
          Object.assign(document.createElement('strong'), { textContent: entry.action === 'ai.usage.user.reset' ? 'Wyzerowano użycie użytkownika' : 'Zmieniono limity AI' }),
          Object.assign(document.createElement('small'), { textContent: entry.targetUserId || 'ustawienia globalne' }),
          Object.assign(document.createElement('small'), { textContent: `${new Date(entry.timestamp).toLocaleString('pl-PL')} · admin ${entry.adminId || '—'}` })
        );
        item.append(Object.assign(document.createElement('span'), { className: 'admin-ai-audit-marker', textContent: '•' }), copy);
        list.append(item);
      });
      elements.adminAiUsageAuditList.replaceChildren(list);
    } catch (error) { elements.adminAiUsageAuditList.textContent = error?.message || 'Nie udało się wczytać historii.'; }
  }

  let usersLoaded = false;
  let usersRequest = null;
  const panelRequests = new Map();
  const pendingChanges = new Set();
  const tabNames = { progress: 'Postępy i raporty', 'ai-usage': 'Limity AI', payments: 'Płatności' };

  function mayReloadManagement(name) {
    return !pendingChanges.has(name) || window.confirm('Odrzucić niezapisane zmiany ustawień i wczytać zapisane dane ponownie?');
  }

  function runManagementLoad(name, loader) {
    if (panelRequests.has(name)) return panelRequests.get(name);
    const panel = elements.adminPanels.find((item) => item.dataset.adminPanel === name);
    panel.inert = true;
    panel.setAttribute('aria-busy', 'true');
    const request = Promise.resolve().then(loader).finally(() => {
      panelRequests.delete(name);
      panel.inert = false;
      panel.setAttribute('aria-busy', 'false');
    });
    panelRequests.set(name, request);
    return request;
  }

  function loadAdminPrices() { return runManagementLoad('payments', fetchAdminPrices); }
  function loadAdminProgress(force = false) { return runManagementLoad('progress', () => fetchAdminProgress(force)); }
  function loadAdminAiUsage(force = false) { return runManagementLoad('ai-usage', () => fetchAdminAiUsage(force)); }

  async function loadAdminUsers() {
    if (usersLoaded) return;
    if (usersRequest) return usersRequest;
    usersRequest = (async () => {
      const token = await getAdminToken();
      const uniqueUsers = new Map();
      let page = 1;
      let hasMore;
      do {
        const response = await fetch(`${ADMIN_USERS_URL}?page=${page}&perPage=100`, {
          cache: 'no-store', credentials: 'same-origin',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
        });
        const payload = await readAdminResponse(response);
        const rows = Array.isArray(payload) ? payload : (payload.users || []);
        rows.map(adminProfileFrom).filter((user) => user.id).forEach((user) => uniqueUsers.set(user.id, user));
        hasMore = Boolean(payload.pagination?.hasMore);
        page += 1;
      } while (hasMore && page <= 100);
      if (hasMore) throw new Error('Lista kont jest zbyt długa, aby wyświetlić ją w całości.');
      adminUsers = Array.from(uniqueUsers.values());
      usersLoaded = true;
    })();
    try { return await usersRequest; } finally { usersRequest = null; }
  }

  function activateAdminTab(name, focusTab = false, updateUrl = true) {
    const activeName = Object.hasOwn(tabNames, name) ? name : 'progress';
    elements.adminTabs.forEach((tab) => {
      const active = tab.dataset.adminTab === activeName;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    elements.adminPanels.forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== activeName; });
    document.getElementById('management-title').textContent = tabNames[activeName];
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeName);
      url.searchParams.delete('user');
      window.history.replaceState(null, '', url);
    }
    return activeName === 'progress' ? loadAdminProgress(false)
      : activeName === 'ai-usage' ? loadAdminAiUsage(false)
        : adminPricesLoaded ? Promise.resolve() : loadAdminPrices();
  }

  function bindManagementEvents() {
    const trackChanges = (name, controls) => controls.forEach((control) => {
      ['input', 'change'].forEach((event) => control.addEventListener(event, () => pendingChanges.add(name)));
    });
    trackChanges('payments', [elements.adminPricesForm]);
    trackChanges('progress', [elements.adminProgressGlobalTracking, elements.adminProgressGlobalShow, elements.adminProgressRecordOpens]);
    trackChanges('ai-usage', [elements.adminAiLimitGrid, elements.adminAiLimitUserMode, elements.adminAiUsageTimezone, elements.adminAiUsageCurrency,
      elements.adminAiUsageShowUser, elements.adminAiWarning1, elements.adminAiWarning2, elements.adminAiWarning3,
      elements.adminAiPriceInput, elements.adminAiPriceOutput, elements.adminAiFallback]);
    window.addEventListener('beforeunload', (event) => {
      if (!pendingChanges.size) return;
      event.preventDefault();
      event.returnValue = '';
    });
    elements.adminTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => { void activateAdminTab(tab.dataset.adminTab); });
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const count = elements.adminTabs.length;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
        void activateAdminTab(elements.adminTabs[next].dataset.adminTab, true);
      });
    });
    elements.adminProgressRefresh.addEventListener('click', () => {
      if (!mayReloadManagement('progress')) return;
      usersLoaded = false; return loadAdminProgress(true);
    });
    elements.adminProgressSaveSettings.addEventListener('click', saveAdminProgressSettings);
    elements.adminProgressMore.addEventListener('click', loadMoreAdminProgressUsers);
    elements.adminProgressSearch.addEventListener('input', () => {
      adminProgressVisibleCount = ADMIN_PROGRESS_PAGE_SIZE;
      renderAdminProgressUsers();
    });
    elements.adminProgressFilter.addEventListener('change', () => {
      adminProgressVisibleCount = ADMIN_PROGRESS_PAGE_SIZE;
      renderAdminProgressUsers();
    });
    elements.adminProgressSort.addEventListener('change', () => {
      adminProgressVisibleCount = ADMIN_PROGRESS_PAGE_SIZE;
      renderAdminProgressUsers();
    });

    elements.adminAiUsageRefresh.addEventListener('click', () => {
      if (!mayReloadManagement('ai-usage')) return;
      usersLoaded = false; return loadAdminAiUsage(true);
    });
    elements.adminAiUsagePeriod.addEventListener('change', () => {
      if (!mayReloadManagement('ai-usage')) {
        elements.adminAiUsagePeriod.value = adminAiUsageReport?.period || 'day';
        return;
      }
      adminAiUsageLoaded = false;
      adminAiUserVisibleCount = ADMIN_AI_USERS_PAGE_SIZE;
      loadAdminAiUsage(true);
    });
    elements.adminAiLimitScope.addEventListener('change', () => {
      try { commitAdminAiLimitEditor(); } catch (error) { return setPanelStatus(elements.adminAiUsageStatus, error.message, 'error'); }
      populateAdminAiLimitScope();
    });
    elements.adminAiLimitScopeId.addEventListener('change', () => {
      try { commitAdminAiLimitEditor(); } catch (error) { return setPanelStatus(elements.adminAiUsageStatus, error.message, 'error'); }
      adminAiLimitSelection.id = elements.adminAiLimitScopeId.value;
      renderAdminAiLimitEditor();
    });
    elements.adminAiLimitModuleId.addEventListener('change', () => {
      try { commitAdminAiLimitEditor(); } catch (error) { return setPanelStatus(elements.adminAiUsageStatus, error.message, 'error'); }
      adminAiLimitSelection.id = elements.adminAiLimitModuleId.value.trim();
      renderAdminAiLimitEditor();
    });
    elements.adminAiLimitUserMode.addEventListener('change', () => {
      const id = adminAiLimitSelection.id;
      if (id) {
        const policy = adminAiUsageSettings.users[id] || (adminAiUsageSettings.users[id] = { mode: 'inherit', limits: emptyAdminAiLimitSet() });
        policy.mode = elements.adminAiLimitUserMode.value;
      }
      renderAdminAiLimitEditor();
    });
    elements.adminAiLimitGrid.addEventListener('input', (event) => {
      if (adminAiLimitSelection.scope !== 'user' || !event.target?.matches?.('input[data-ai-limit-metric]')) return;
      const id = adminAiLimitSelection.id;
      if (!id || elements.adminAiLimitUserMode.value !== 'inherit') return;
      const policy = adminAiUsageSettings.users[id] || (adminAiUsageSettings.users[id] = { mode: 'inherit', limits: emptyAdminAiLimitSet() });
      policy.mode = 'custom';
      elements.adminAiLimitUserMode.value = 'custom';
    });
    elements.adminAiUsageSave.addEventListener('click', saveAdminAiUsageSettings);
    elements.adminAiUsersSearch.addEventListener('input', () => {
      adminAiUserVisibleCount = ADMIN_AI_USERS_PAGE_SIZE;
      renderAdminAiUsageUsers();
    });
    elements.adminAiUsersMore.addEventListener('click', loadMoreAdminAiUsers);
    elements.adminAiUsageAudit.addEventListener('toggle', loadAdminAiUsageAudit);
    elements.adminPricesForm.addEventListener('submit', saveAdminPrices);
    elements.adminPricesReload.addEventListener('click', () => {
      if (mayReloadManagement('payments')) return loadAdminPrices();
    });
  }

  async function startManagement() {
    const access = document.getElementById('management-access');
    const app = document.getElementById('management-app');
    const auth = window.ChemAuth;
    try {
      const session = await auth?.ready;
      currentUser = auth?.getUser?.() || null;
      if (!session?.authenticated || !session.session?.ok || !isAdminUser(currentUser)) {
        access.textContent = 'Zaloguj się na konto administratora, aby otworzyć zarządzanie platformą.';
        return;
      }
      window.addEventListener('chem-auth-user-changed', () => {
        currentUser = auth?.getUser?.() || null;
        if (!isAdminUser(currentUser)) {
          app.hidden = true;
          pendingChanges.clear();
          window.location.replace('/members/');
        }
      });
      bindManagementEvents();
      access.hidden = true;
      app.hidden = false;
      const params = new URL(window.location.href).searchParams;
      const tab = params.get('tab');
      const userId = params.get('user');
      await activateAdminTab(tab, false, false);
      if (tab === 'ai-usage' && userId) await openAdminAiUserLimits(userId);
    } catch (_) {
      app.hidden = true;
      access.hidden = false;
      access.textContent = 'Nie udało się otworzyć studia. Odśwież stronę lub zaloguj się ponownie.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startManagement, { once: true });
  else void startManagement();
})();
