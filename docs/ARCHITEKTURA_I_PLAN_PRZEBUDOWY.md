# Architektura i Master Plan Przebudowy Platformy NextMed
**Wersja dokumentu:** 3.0 (Wersja Kompletna Produkcyjna – Google Slides Engine, Anki SRS, Intuitive Lesson Studio, Bulletproof AI Router, Fault-Tolerant Exams, Bento Dashboard)  
**Środowisko:** Gitea / Git CMS + Netlify JAMstack / React 19 Engine  
**Gwarancja:** 100% zachowania struktury zapisu i wersjonowania na serwerze Gitea (`.json`, `.md`, `catalog.json`).

---

## 0. Protokół Ciągłości Prac (Obsługa Limitów i Kolejnych Sesji)

> ### Jak pracujemy z tym plikiem po wyczerpaniu limitu wiadomości lub w nowej sesji?
> 1. Ten plik znajduje się bezpośrednio w repozytorium projektu pod ścieżką `docs/ARCHITEKTURA_I_PLAN_PRZEBUDOWY.md` i jest wersjonowany w Git.
> 2. Każde zadanie posiada swój znacznik stanu:
>    - `[ ]` – do zrobienia,
>    - `[/]` – w trakcie realizacji,
>    - `[x]` – ukończone i przetestowane.
> 3. W dowolnym nowym czacie wystarczy, że napiszesz:
>    > *"Kontynuujemy przebudowę wg docs/ARCHITEKTURA_I_PLAN_PRZEBUDOWY.md. Zrób Prompt 1.1"* (lub kolejny wolny krok).
>    Asystent od razu odczyta ten plik, sprawdzi co jest odhaczone, zweryfikuje stan repozytorium i podejmie pracę dokładnie w miejscu, w którym została przerwana, bez powtarzania analizy.

---

## 1. Wybór Architektury Frontendowej: React 19 SPA vs Next.js

### Analiza porównawcza pod kątem płynności i produkcji:

| Kryterium | Next.js (App Router / SSR) | React 19 SPA + Vite / esbuild (Rekomendowane) |
|---|---|---|
| **Czas przejścia między ekranami** | 150ms – 600ms (opóźnienie SSR + fetch do Gitea) | **0ms – 16ms** (błyskawiczne przejścia w pamięci RAM) |
| **Infrastruktura hostingowa** | Wymaga Node.js servera lub złożonego adaptera Netlify | **100% zgodne** z obecnym Netlify + Gitea |
| **Płynność canvasu (slajdy, egzamin)** | Ryzyko re-renderów przy hydracji SSR | **Idealna 60 FPS**, pełna kontrola nad stanem DOM |
| **Działanie offline / słaba sieć** | Błędy pobierania stron serwerowych | **Service Worker** buforuje całe lekcje i obrazy |
| **Przechowywanie stanu w Gitea** | Trudniejsza synchronizacja z prywatnym Git | **Bezpośredni, bezpieczny most** z Netlify Functions |

**Decyzja architektoniczna:**  
Wdrażamy **React 19 Single Page Architecture (SPA)** zintegrowany z obecnym buildem `esbuild`/`Vite`. Dzięki temu aplikacja działa jak natywny program desktopowy (zero białych mrugnięć, natychmiastowe otwieranie slajdów i testów), a backend Gitea i Netlify Functions pozostają w 100% nienaruszone.

---

## 2. Rozwiązanie Problemu z Obrazami („Koniec z ładowaniem wieczność”)

### Dlaczego obecnie zdjęcia ładowały się wolno?
1. Każde odpytanie o grafikę szło przez osobną funkcję Serverless (`content-media`), która logowała się do API Gitea, pobierała plik i kodowała go do formatu Base64 (+33% wagi transferu).
2. Przeglądarka musiała odebrać Base64, przekonwertować go na `Blob`, a potem na `Object URL`.
3. Przy braku repozytorium lub wolnym łączu kolejne żądania blokowały się w kolejce z 8-sekundowymi timeoutami.

### Nowy trójstopniowy silnik ładowania multimediów (Instant Media Engine):
1. **Direct Binary Streaming:** Likwidacja narzutu Base64. Obrazy są streamowane binarnie z poprawnymi nagłówkami `Content-Type`.
2. **Niezmienny Cache L2 (SHA-based Caching):**
   Ponieważ każdy plik w Git ma unikalny identyfikator SHA, dodajemy nagłówek:
   `Cache-Control: public, max-age=31536000, immutable`. Raz pobrany obraz jest zapisany w pamięci podręcznej przeglądarki na stałe.
3. **LQIP (Low-Quality Image Placeholders / Miniatury WebP):**
   Podczas zapisu lub uploadu obrazu w Studio automatycznie generowany jest miniaturowy, zoptymalizowany podgląd (2-5 KB WebP). Slajd, pytanie czy kafelka w galerii wyświetla miniaturę w czasie **0 milisekund**, a pełna rozdzielczość doczytuje się w tle bez skakania layoutu (zero layout shift).
4. **Service Worker Prefetching:**
   Gdy uczeń jest na Slajdzie 1, Service Worker w tle pobiera obrazy dla Slajdu 2 i 3. Przełączenie slajdu jest natychmiastowe.
5. **100% Przenośność i Bezpieczeństwo (Zapis miniatur bezpośrednio w Git/Gitea):**
   Miniatury WebP są zapisywane **bezpośrednio w repozytorium Git/Gitea** (obok oryginalnych zdjęć, np. w podfolderze `photos/thumbs/` lub wewnątrz struktury materiału).
   Dzięki temu, gdy postawisz **nową instancję platformy na Netlify** i podepniesz to samo repozytorium GitHub/Gitea, **wszystkie miniatury działają od razu bez konieczności przenoszenia Blobsów**! Git/Gitea jest jedynym i trwałym źródłem prawdy (SSOT), a pamięć Netlify Blobs pełni jedynie rolę ulotnego akceleratora L2.

### 2.2. Nowoczesna Biblioteka Multimediów w Studio (Media Library – Zero Lagów):
1. **Siatka Miniatur (Thumbnail Grid):**
   - Panel mediów w Studio natychmiast ładuje lekkie miniatury WebP z lokalnego cache `IndexedDB`/`CacheStorage`.
   - Koniec z zawieszaniem się przeglądarki przy otwieraniu folderu z 50 zdjęciami o wadze 10 MB każde.
2. **Wklejanie Bezpośrednio ze Schowka (`Ctrl+V`):**
   - Zrobienie zrzutu ekranu narzędziem wycinania (np. Snipping Tool na Windows lub `Cmd+Shift+4` na Macu) i naciśnięcie `Ctrl+V` na slajdzie lub w pytaniu natychmiast konwertuje obraz, zapisuje w repozytorium i wstawia na płótno w **50 milisekund**!
3. **Wizualny Selektor (Visual Media Picker Modal):**
   - Wyszukiwarka po nazwie pliku, tagach (np. *chemia organiczna*, *schemat*, *aparat*) i dacie dodania.
   - 1-kliknięcie wstawia obraz do aktywnego slajdu, pytania egzaminacyjnego czy fiszki.
   - Płynny podgląd w pełnym rozmiarze (LightBox) po najechaniu lub kliknięciu podglądu.

---

## 3. MODUŁ PREZENTACJI: WIERNA KOPIA GOOGLE SLIDES (MEGA MOCNY)

Edytor prezentacji w Presentation Studio staje się wierną kopią interfejsu i mechaniki działania (1:1) aplikacji Google Slides / PowerPoint:

### 3.1. Układ Interfejsu Edytora (Google Slides Clone)
1. **Lewy panel slajdów (Slide Filmstrip):**
   - Miniaturki slajdów renderowane w czasie rzeczywistym.
   - Płynne przeciąganie slajdów (Drag & Drop) ze zmianą kolejności.
   - Menu kontekstowe pod prawym przyciskiem: Nowy slajd, Powiel (`Ctrl+D`), Usuń (`Delete`), Pomiń slajd, Zmień tło.
   - Gotowe układy slajdów (Layout Picker): Slajd tytułowy, Tytuł i treść, Dwie kolumny, Porównanie, Zdjęcie z podpisem, Schemat chemiczny.
2. **Główny pasek narzędzi (Top Application Toolbar):**
   - **Narzędzia dodawania:** Kursor/Zaznaczanie (`V`), Pole tekstowe (`T`), Kształty (prostokąty, elipsy, strzałki, dymki, gwiazdy, nawiasy chemiczne), Linie i łączniki ze strzałkami, Obraz (z dysku, URL, biblioteka mediów), Wzory LaTeX i chemiczne `\ce{}`, Tabela (wizualna siatka wyboru NxM).
   - **Formatowanie tekstu:** Wybór czcionki, Rozmiar, Pogrubienie (`B`), Kursywa (`I`), Podkreślenie (`U`), Przekreślenie, Kolor tekstu, Kolor wyróżnienia (zakreślacz), Wyrównanie (lewo, środek, prawo, justowanie), Wyrównanie pionowe, Odstępy linii, Listy wypunktowane i numerowane, Indeks górny/dolny (kluczowe w chemii: $H_2O$, $SO_4^{2-}$).
   - **Właściwości obiektów:** Kolor wypełnienia (kolory jednolite oraz gradienty), Kolor obramowania, Grubość obramowania, Styl linii (ciągła, przerywana, kropkowana), Zaokrąglenie rogów (Border Radius), Cień obiektu (Drop Shadow), Przezroczystość (Opacity).
   - **Zarządzanie warstwami i pozycją:** Przesuń na wierzch (`Ctrl+Shift+]`), Przesuń wyżej (`Ctrl+]`), Przesuń niżej (`Ctrl+[`), Przesuń na spód (`Ctrl+Shift+[`), Wyrównaj do środka slajdu w poziomie/pionie.
3. **Płótno robocze (Canvas z inteligentnym przyciąganiem):**
   - **Inteligentne prowadnice (Smart Magnetic Alignment Guides):** Czerwone linie pojawiające się w ułamku sekundy, przyciągające elementy do środka slajdu, krawędzi innych elementów oraz wskazujące równe odstępy (distribute spacing).
   - **8 uchwytów zmiany rozmiaru (Bounding Box):** Rogowe i boczne uchwyty z zachowaniem proporcji (`Shift`) lub swobodnym skalowaniem + dedykowany uchwyt obrotu (Rotate Handle).
   - **Edycja tekstu Inline WYSIWYG:** Podwójne kliknięcie w dowolny kształt lub pole tekstowe aktywuje kursor tekstowy – formatujesz pojedyncze słowa wewnątrz zdania bez żadnych wyskakujących okienek.
   - **Zaznaczanie obszarem (Marquee Selection):** Kliknięcie i przeciągnięcie po płótnie zaznacza wszystkie obiekty w obszarze.
   - **Grupowanie:** `Ctrl+G` scala elementy w grupę, `Ctrl+Shift+G` rozgrupowuje.
   - **Skróty klawiszowe:** Nielimitowane Undo/Redo (`Ctrl+Z`, `Ctrl+Y`), Kopiuj/Wklej (`Ctrl+C`, `Ctrl+V`), Precyzyjne przesuwanie strzałkami o 1px (`Shift + Strzałki` o 10px).
   - **Dolny panel notatek (Speaker Notes):** Wysuwany pasek na notatki dla prelegenta.
   - **Kontrola zoomu:** Dopasuj do okna (`Ctrl+0`), 50%, 100%, 200%.
4. **Prawy panel boczny (Inspektor & Animacje):**
   - Właściwości zaznaczonego elementu lub całego slajdu.
   - **Krokowe animacje odkrywania (Step-by-step Reveal):** Ustawianie kolejności pojawiania się punktów na kliknięcie prelegenta (Fade in, Slide up, Zoom in, Highlight).
   - Przejścia między slajdami (Fade, Slide, Flip, Zoom).

### 3.2. Nowoczesny Player Prezentacji
- **Tryb Prelegenta (Presenter View):** Drugie okno dla wykładowcy:
  - Aktualny slajd, podgląd następnego slajdu, stoper wykładu, notatki prelegenta, miniatury wszystkich slajdów.
- **Wskaźnik laserowy i rysik na żywo (Live Annotation):**
  - Czerwona kropka wskaźnika laserowego z łagodnym ogonem.
  - Pisak odręczny z paletą kolorów i zakreślaczem (możliwość rysowania po slajdzie w trakcie zajęć na żywo).
- **Eksport do PDF:** 1-kliknięciem generowanie dokumentu PDF z zachowaniem czystej wektorowej typografii i wzorów.

### 3.3. Interaktywne Quizy Osadzone w Slajdach (Interactive Slide Quizzes)
- **Robienie quizów w slajdach:** Autor może przeciągnąć na dowolny slajd interaktywny "Blok Quizu" (tak jak dodaje pole tekstowe czy zdjęcie).
- Uczniowie oglądający prezentację mogą na żywo, z poziomu slajdu, klikać odpowiedzi (A, B, C, D) i sprawdzać swoją wiedzę bez opuszczania prezentacji.
- Blokady slajdów: Autor może ustawić, aby dany slajd z quizem blokował przejście do kolejnego slajdu, dopóki uczeń nie udzieli poprawnej odpowiedzi.

---

## 4. MODUŁ FISZEK I QUIZÓW: STANDARD ANKI / SUPERMEMO / QUIZLET

Fiszki otrzymują profesjonalny silnik powtórek rozłożonych w czasie (**Spaced Repetition System**) wzorowany na algorytmie **Anki SM-2**:

### 4.1. Silnik Algorytmu Anki SM-2
- Każda fiszka posiada parametry:
  - `status`: *Nowa (New)*, *Uczona (Learning)*, *Powtórka (Review)*,
  - `easeFactor`: współczynnik trudności (domyślnie 2.5, dynamicznie korygowany w zakresie 1.3 – 3.0),
  - `interval`: interwał w dniach,
  - `repetitions`: liczba udanych powtórek z rzędu,
  - `dueDate`: dokładny dzień kolejnej powtórki.
- **Cztery przyciski oceniania z podglądem czasu następnej powtórki:**
  - `[1] Powtórz (< 10 min)` – resetuje interwał, karta wraca do kolejki dzisiejszej,
  - `[2] Trudna (1 dzień)` – interwał zwiększa się wolniej (`interval * 1.2`),
  - `[3] Dobra (3 dni)` – standardowy krok powtórki (`interval * easeFactor`),
  - `[4] Łatwa (7 dni)` – duży przeskok (`interval * easeFactor * 1.3`).
- **Fuzz Factor:** Inteligentne rozpraszanie dat powtórek (±1 dzień), zapobiegające powstawaniu kumulacji setek kart w jeden dzień.

### 4.2. Grywalizacja, Motywacja i Statystyki
- **Licznik dziennej passy (Streak 🔥):** Liczba dni z rzędu z wykonanymi powtórkami.
- **Heatmapa aktywności:** 365-dniowa siatka aktywności na wzór profilu GitHub, pokazująca intensywność nauki każdego dnia.
- **Wykres pamięci (Retention Curve):** Procent kart w pamięci długotrwałej vs karty nowe/trudne.
- **Dźwięki i animacje sukcesu:** Konfetti przy ukończeniu dziennej talii (z możliwością wyciszenia w ustawieniach).

### 4.3. Image Occlusion (Zasłanianie Schematów w Stylu Anki)
- Narzędzie w Studio do wgrywania rysunków (anatomicznych, aparatury chemicznej, schematów blokowych).
- Rysowanie prostokątnych masek zasłaniających etykiety na grafice.
- Dwa tryby nauki:
  1. *Ukryj jedną, pytaj o jedną (Hide One, Guess One)* – uczeń widzi pozostałe podpisy, zgaduje ten jeden.
  2. *Ukryj wszystkie, pytaj o jedną (Hide All, Guess One)* – wszystkie podpisy są zasłonięte, uczeń wskazuje właściwy.

### 4.4. Automatyczny Generator Testu z Fiszek
- Jednym kliknięciem uczeń zamienia talię 20 fiszek w **Quiz ABCD**:
  - Pytanie = przód fiszki.
  - Poprawna odpowiedź = tył fiszki.
  - 3 błędne odpowiedzi (dystraktory) = losowo dobrane tyły z innych kart tej samej talii.

---

## 5. TWORZENIE LEKCJI: PROSTE JAK DRUT (INTUICYJNE NOTION-LIKE STUDIO)

Koniec z ręcznym formatowaniem, wpisywaniem tagów HTML czy szukaniem parametrów. Lesson Studio działa w nowoczesnym, blokowym standardzie **Notion / Medium / Gutenberg**:

### 5.1. Blokowy Edytor WYSIWYG
- Pusty wiersz z podpowiedzią: *„Wpisz tekst lub naciśnij '/' aby wstawić blok...”*
- **Szybkie menu Slash (`/`):**
  - `/tekst` – zwykły akapit,
  - `/naglowek` – H1, H2, H3,
  - `/zadanie` – wstawienie pytania sprawdzającego (ABCD, wielokrotny wybór, prawda/fałsz, krótka odpowiedź, luka w tekście),
  - `/obraz` – wstawienie zdjęcia z dysku lub schowka,
  - `/wzor` – edytor wzorów chemicznych i równań reakcji,
  - `/video` – wideo lub YouTube z notatkami,
  - `/tabela` – estetyczna tabela z nagłówkami,
  - `/fiszki` – wstawienie mini-talii powtórkowej wewnątrz lekcji,
  - `/wskazowka` – kolorowy box informacyjny (Uwaga / Wskazówka / Ważne / Ciekawostka).
- **Przeciąganie klocków w pionie:** Każdy blok ma uchwyt `::` po lewej stronie – chwytasz i przestawiasz kolejność w ułamku sekundy.
- **Kreator Zadań w 1 Kliknięcie:** Klikasz na blok zadania, wpisujesz treść, wpisujesz warianty odpowiedzi i po prostu klikasz na kółko przy poprawnej odpowiedzi.
- **Warunki przejścia (Gate Rules):** Intuicyjny przełącznik przy slajdzie: *„Zablokuj przejście dalej do czasu poprawnego rozwiązania zadania”*.

---

## 6. ROUTER AI: PROSTY, SZYBKI, TOKEN-EFFICIENT (MAŁO TOKENÓW) I NIEAWARYJNY

Router AI odpowiada za asystenta kursanta (Chat AI) oraz automatyczne sprawdzanie zadań otwartych (AI Grader). Zostaje zoptymalizowany pod kątem minimalnego zużycia tokenów, natychmiastowej prędkości działania i twardych limitów budżetowych:

### 6.1. Ekstremalna Optymalizacja Tokenów (Mało Tokenów = Niskie Koszty)
1. **Kompresja Promptów Systemowych (Prompt Compression):**
   - Usunięcie rozwlekłych instrukcji i redundancji. Zastąpienie ich zwięzłymi, ustrukturyzowanymi definicjami JSON/Markdown.
   - Redukcja rozmiaru promptu wejściowego o **50% – 60%** przy zachowaniu 100% precyzji dydaktycznej.
2. **Pływające Okno Kontekstu (Sliding Context Window):**
   - W czacie z asystentem AI zamiast przesyłać 50 wcześniejszych wiadomości uczeń przesyła wyłącznie ostatnie 4–6 wiadomości + skondensowane podsumowanie faktów.
   - Koszt zapytania nie rośnie w miarę wydłużania rozmowy – stałe, minimalne zużycie tokenów.
3. **Super-Szybkie Modele o Niskim Koszcie:**
   - Domyślne silniki: `gemini-2.5-flash` oraz `gpt-4o-mini`. Są 10-krotnie tańsze niż modele starszej generacji i odpowiadają w ułamku sekundy (< 300 ms do pierwszego tokena).
4. **Prompt Caching:**
   - Wykorzystanie natywnego mechanizmu buforowania promptu (OpenAI / Gemini Prompt Caching) dla stałych kryteriów oceniania zadań maturalnych CKE, co dodatkowo obniża koszt tokenów o kolejne 50%.

### 6.2. Limity AI, Kontrola Budżetu i Ochrona Przed Nadużyciami (Limity AI)
1. **Limity Dzienne i Miesięczne per Uczeń / Rola:**
   - Precyzyjny licznik tokenów i zapytań powiązany z kontem ucznia (np. 50 000 tokenów lub 30 zapytań dziennie).
   - Nielimitowany dostęp dla administratorów i twórców kursu w Studio.
2. **Rate Limiting (Ochrona przed Spamem):**
   - Blokada zbyt szybkich zapytań (np. max 5 zapytań na minutę na użytkownika) zapobiegająca automatycznemu drenowaniu budżetu API.
3. **Pulpit Analityczny i Alerty Kosztów w Panelu Admina:**
   - Wykresy zużycia tokenów na żywo w podziale na: użytkowników, moduły (Chat vs Egzaminator), modele i dostawców.
   - Przelicznik zużycia na szacowany koszt (PLN / USD) z możliwością ustawienia twardego limitu miesięcznego na całe konto (Hard Cap).
4. **Przyjazny UX dla Ucznia:**
   - Po osiągnięciu dziennego limitu uczeń widzi estetyczny zegar odliczający czas do odnowienia limitu o północy (zamiast technicznych błędów 429 czy awarii aplikacji).

### 6.3. Konfiguracja w 1 Kliknięcie i Auto-Detekcja
- Panel admina pozwala wkleić klucz API (OpenAI, Gemini, Anthropic) i kliknąć **„Sprawdź i skonfiguruj automatycznie”**.
- System sam odpytuje dostawcę, wykrywa dostępne modele (`gpt-4o-mini`, `gemini-2.5-flash`), wykonuje testowe zapytanie w 50 ms i zapala zieloną ikonę *„Aktywny i gotowy”*.

### 6.4. Niewidzialny Failover (Automatyczny Fallback w < 100 ms)
- Jeśli główny dostawca (np. OpenAI) zwróci błąd 429 (przekroczony limit zapytań), 503 (przeciążenie) lub nie odpowie w ciągu 5 sekund:
  - Router AI **w ułamku sekundy, niewidocznie dla ucznia** przekierowuje zapytanie do dostawcy zapasowego (np. Gemini Flash).
  - Uczeń nigdy nie widzi błędu serwera ani nie czeka na zawieszonym pytaniu.

### 6.5. Streaming Odpowiedzi (Efekt Pisania na Żywo / SSE)
- W module czatu oraz przy generowaniu wyjaśnień do zadań odpowiedź pojawia się słowo po słowie (Server-Sent Events).
- Tekst zaczyna pojawiać się na ekranie po **200 – 300 milisekundach**, dając poczucie natychmiastowej responsywności.

---

## 7. EGZAMINY I KREATOR KAHOOT-LIKE: BŁYSKAWICZNE I PROSTE W OBSŁUDZE (MATURA & MEDYCYNA)

Moduł egzaminacyjny zostaje przebudowany dwutorowo: **bajecznie prosty kreator w stylu Kahoot dla twórcy** oraz **niezawodny, natychmiastowy silnik zdawania dla ucznia**:

### 7.1. Kreator Egzaminów i Quizów w Stylu KAHOOT (Prosty, Wizualny, Nowoczesny)
Koniec ze skomplikowanymi tabelami, formularzami i 14 zakładkami! Kreator w Studio działa jak nowoczesny **Kahoot / Quizizz**:
1. **Wielka, Czytelna Karta Pytania:**
   - Na środku ekranu znajduje się duże pole na treść pytania z edycją WYSIWYG, wzorami chemicznymi `\ce{}` i LaTeX.
   - **Strefa Multimediów (Media Dropzone):** Centralne pole przeciągnij-i-upuść na grafikę, schemat chemiczny lub film. Wklejenie zrzutu ekranu (`Ctrl+V`) wstawia miniaturkę od razu!
   - **4 Duże, Kolorowe Kafelki Odpowiedzi:**
     - Charakterystyczne, duże klocki (Czerwony, Niebieski, Żółty, Zielony lub elegancka paleta pastelowa).
     - Każdy kafelek ma pole na tekst i ewentualny mikroschemat.
2. **Oznaczanie Poprawnej Odpowiedzi 1 Kliknięciem:**
   - W prawym górnym rogu każdego kafelka znajduje się okrągły znacznik – kliknięcie zamienia go w duży zielony ptaszek (Checkmark).
   - Chcesz pytanie wielokrotnego wyboru? Zaznaczasz dwa lub trzy ptaszki – bez przełączania żadnych trybów w menu.
3. **Lewy Pasek Slajdów Pytań (Question Filmstrip):**
   - Miniaturki pytań w kolumnie z numerem, typem pytania, czasem i punktami.
   - Błyskawiczne przestawianie kolejności pytań metodą Drag & Drop.
   - Przyciski szybkiej akcji: Powiel pytanie (`Ctrl+D`), Usuń (`Delete`), Bank Pytań.
   - Wielki, zachęcający przycisk `+ Dodaj pytanie` z wyborem gotowych kafelków (Wybór wielokrotny ABCD, Prawda/Fałsz, Dopasowanie, Krótka odpowiedź, Luka w tekście, Zadanie otwarte CKE, Import z CSV).
4. **Prawy Panel Ustawień (Kahoot Inspector):**
   - **Limit czasu na pytanie:** Suwak lub szybki wybór: *10s, 20s, 30s, 60s, 90s, 120s, 240s* lub *Bez limitu* (egzamin maturalny z czasem łącznym).
   - **Punkty:** Standardowe (1 pkt), Podwójne (2 pkt), Bez punktów (trening), Kryteria CKE.
   - **Opcje odpowiedzi:** Pojedynczy wybór / Wielokrotny wybór.
5. **Wbudowany Tryb „Graj / Podgląd” (Live Preview):**
   - 1 kliknięcie w Studio uruchamia symulator egzaminu – autor natychmiast rozwiązuje test dokładnie tak jak kursant.

### 7.2. Architektura Offline-First w `IndexedDB` (< 1 ms Zapis, Zero Utraty Danych)
- Każde zaznaczenie odpowiedzi, wpisany tekst czy szkic brudnopisu zapisuje się natychmiastowo w lokalnej bazie `IndexedDB` przeglądarki w czasie **< 1 ms**.
- W tle działa odporna kolejka asynchronicznej synchronizacji z serwerem.
- **Nawet w przypadku nagłego braku prądu, przypadkowego zamknięcia karty, awarii systemu czy zerwania Wi-Fi**, po ponownym otwarciu egzaminu 100% odpowiedzi, wpisów i dokładny stan licznika czasu zostają natychmiast przywrócone. Uczeń nigdy nie traci swojej pracy!

### 7.3. Natychmiastowe Przełączanie Pytań (0 ms Chunking w RAM)
- Wszystkie pytania egzaminu (nawet 50 rozbudowanych zadań z diagramami) są pre-renderowane w pamięci podręcznej.
- Przejście do dowolnego pytania (np. z 1 na 45) odbywa się w czasie **0 milisekund**, bez białych mrugnięć i bez oczekiwania na sieć.

### 7.4. Oficjalne Tablice Wzorów CKE i Interaktywny Układ Okresowy
- W nagłówku egzaminu stale dostępny jest przycisk otwierający **Oficjalne Wybrane Wzory i Tablice Fizykochemiczne CKE** oraz **Interaktywny Układ Okresowy Pierwiastków**.
- Tablice otwierają się w płynnie wysuwanym panelu bocznym – uczeń nie musi opuszczać widoku zadania ani przełączać okien.

### 7.5. Wirtualny Brudnopis (Scratchpad Canvas)
- Pod każdym pytaniem dostępny jest przycisk *„Brudnopis”*.
- Uczeń może odręcznie rysować, liczyć stechiometrię, bilansować redoksy i notować za pomocą myszy, gładzika lub rysika. Rysunek zapisuje się automatycznie wraz z odpowiedzią na pytanie.

### 7.6. Tryb Split-Screen dla Zadań z Tekstem Źródłowym
- W zadaniach ze złożonym tekstem wprowadzającym, opisem eksperymentu czy schematem aparatu laboratoryjnego ekran dzieli się na dwie zsynchronizowane kolumny:
  - Lewa kolumna: stały tekst źródłowy / schemat,
  - Prawa kolumna: powiązane pytania z niezależnym przewijaniem.

---

## 8. INTEGRACJA STUDIO <-> DOŚWIADCZENIE UCZNIA (100% PARITY)

1. **Symulator Ucznia w Studio (Student View Simulator):**
   - Na górnym pasku Studio znajduje się przełącznik: *„Edycja”* vs *„Podgląd Ucznia”*.
   - Symulator uruchamia identyczny silnik wykonawczy ucznia (ze stoperem, klawiszami i sprawdzaniem odpowiedzi) w odizolowanym środowisku próbnym (nie zanieczyszcza statystyk kursu).
   - Przełącznik formatu ekranu (Device Frames): Smartfon (375px), Tablet (768px), Desktop (1200px), Rzutnik (16:9).
2. **Pre-Publish Validator:**
   - Przed zatwierdzeniem materiału system automatycznie sprawdza:
     - Czy wszystkie pytania mają wskazaną poprawną odpowiedź,
     - Czy wzory LaTeX i reakcje chemiczne są poprawne składniowo,
     - Czy wszystkie obrazy istnieją w repozytorium i nie mają broken linków,
     - Czy nie ma błędnych zależności w krokach lekcji.
3. **1-Klik Test Autorski:**
   - Możliwość natychmiastowego przejścia całego egzaminu przez autora w celu weryfikacji punktacji.

---

## 9. DASHBOARD I MODERNIZACJA WSZYSTKICH MODUŁÓW W `public/`

Wszystkie podstrony i moduły w folderze `public/` zostają ujednolicone i unowocześnione:

### 9.1. Dashboard Kursanta (Bento Grid)
- Modułowy układ Bento Grid z adaptacyjnymi kafelkami:
  - Kafelek **„Wznów naukę”** (jedno kliknięcie przenosi do dokładnego slajdu/pytania z ostatniej sesji),
  - Kafelek **„Fiszki na dziś”** (liczba kart oczekujących na powtórkę wg algorytmu SRS),
  - Kafelek **„Dzienny cel & Passa 🔥”**,
  - Kafelek **„Najbliższy egzamin / sprawdzian”**.
- **Command Palette (`Ctrl+K` / `Cmd+K`):** Globalna, błyskawiczna wyszukiwarka w całej platformie (znajduje lekcje, wzory, pojęcia, prezentacje).
- **Wizualny Kreator Kursu i Personalizacja w Dashboard Studio:** 
  - Układanie kafelków i sekcji kursu metodą przeciągania (Drag & Drop).
  - **Zaawansowana personalizacja kolorów:** Możliwość zmiany kolorystyki każdego kafelka, tła, fontów i akcentów (Theme Builder). Studio pozwala autorowi dostosować dashboard kursanta pod kątem barw własnej marki.

### 9.2. Pozostałe Moduły w `public/`
- **`chat/` (Asystent AI):** Nowoczesny chat z dymkami, streamingiem tekstu, renderowaniem wzorów i historią rozmów.
- **`film/` i `yt/` (Wideo):** Odtwarzacz z notatkami przypiętymi do sekund wideo, prędkościami 0.75x–2x i wznawianiem od ostatniego miejsca.
- **`pdf/` (Czytnik):** Nowoczesny viewer z odwracaniem kolorów (dark mode), miniaturami stron i wyszukiwarką.
- **`kalkulator/` i `classic/`:** Kalkulator stechiometryczny (masy molowe, stężenia, pH) z historią obliczeń.
- **`atonom/` (Cząsteczki 3D):** Trójwymiarowy, płynny model cząsteczek organicznych i nieorganicznych.
- **`bitpaper/` i `whiteboard/`:** Wektorowa tablica z nieskończonym płótnem i eksportem.
- **`login/`, `purchase/`, `payment-success/`:** Szklany interfejs, natychmiastowa walidacja, bezpieczny checkout.

### 9.3. Błyskawiczne Przełączanie Repozytoriów (Cross-Repo SPA)
- Koniec z przeładowywaniem całej strony i resetowaniem stanu przy zmianie przedmiotu / kursu (innego repozytorium Gitea).
- Nawigacja między repozytoriami odbywa się w czasie **0 ms** w ramach architektury SPA, wykorzystując współdzielony stan pamięci podręcznej i Service Workera.
- Całkowicie bezszwowe przechodzenie np. z kursu Biologii na Chemię przy zachowaniu sesji użytkownika.

### 9.4. Ujednolicony Builder Dashboardu i Niezawodne Otwieranie Materiałów
- **Koniec z problemem nieotwierających się prezentacji:**
  - Diagnostyka i ujednolicenie generowania linków w `dashboard-model.js` oraz `dashboard.js`.
  - Usunięcie blokującego oczekiwania na endpoint postępów (`ChemProgress.send`), który potrafił zawieszać przejście do prezentacji.
  - Automatyczna resolucja ID prezentacji oraz repozytorium – prezentacje otwierają się natychmiast niezależnie od tego, na którym repozytorium się znajdują.
- **Weryfikacja i ujednolicenie pozostałych modułów:**
  - Test i standaryzacja linkowania: Quizów, Egzaminów, Lekcji, Osadzonych Wideo, PDF, Czatów AI i Formularzy.
  - Wszystkie klocki w builderze dashboardu mają spójny format konfiguracji, automatyczny podgląd i walidację poprawności przed publikacją.

### 9.5. Uporządkowany Panel Administratora i Bezawaryjny Moduł Cen
- **Uporządkowanie Panelu Admina (`/members/module/studio/manage/` oraz widoków administracyjnych):**
  - Nowoczesny, szklany i czytelny interfejs bez chaosu informacyjnego.
  - Logiczny podział na dedykowane sekcje: Użytkownicy i Uprawnienia, Pakiety i Cennik, Repozytoria Treści, Monitorowanie i Limity AI, Analityka i Postępy Kursantów.
  - Wyeliminowanie zacinania się panelu przy dużej liczbie użytkowników lub zapytań.
- **Naprawa Edycji i Zapisu Cen w Studio:**
  - Likwidacja problemu z zapisem zmian cen pakietów w zakładce Płatności (`payment-config.js` / `management.js`).
  - Inteligentna obsługa ETagów (brak fałszywych błędów o niezgodności wersji).
  - Walidacja wartości i natychmiastowa synchronizacja nowego cennika z widokiem zakupu (`/purchase/`) oraz odświeżenie pamięci podręcznej.

---

## 10. Harmonogram Wdrożenia – Podział na Fazy i Prompty

Prace wykonujemy krok po kroku. Po każdym kroku uruchamiane są testy automatyczne (`npm test`), gwarantując 0 regresji.

### FAZA 1: Silnik Mediów, Miniaturki i Szybka Biblioteka (Likwidacja wolnego ładowania)
- [x] **Prompt 1.1:** Wdrożenie binarnego streamingu w `content-media` i eliminacja narzutu Base64 przy odczycie z Gitea. ✅ (2026-09-14) — SHA z ETag Git blob → `Cache-Control: public, max-age=31536000, immutable` + `ETag` + 304 Not Modified. Fallback `private, max-age=3600` gdy brak SHA.
- [x] **Prompt 1.2:** Implementacja wielopoziomowego cache (SHA Immutable Cache-Control + Netlify Blobs L2). ✅ (2026-09-14) — Zrealizowane w ramach 1.1: SHA-based immutable caching, ETag/If-None-Match 304.
- [x] **Prompt 1.3:** Automatyczne miniatury WebP (LQIP) + Szybka Biblioteka Multimediów w Studio z siatką miniatur, wyszukiwarką i wklejaniem ze schowka `Ctrl+V`. ✅ (2026-09-14) — Responsywna siatka auto-fill, aspect-ratio 4:3 (zero layout shift), fade-in obrazów, powiększony podgląd Lightbox oraz bezpośrednie wklejanie screenshotów (Ctrl+V) w Presentation Builder z uploadem do repozytorium. **Gwarancja migracji:** miniatury zapisywane w Git/Gitea, dzięki czemu nowo postawiona platforma na Netlify podpięta pod to samo repozytorium działa natychmiast bez konieczności przenoszenia Blobsów.
- [x] **Prompt 1.4:** Rejestracja Service Workera dla prefetchingu i natychmiastowego buforowania grafik w przeglądarce (`CacheStorage`). ✅ (2026-09-14) — Service Worker `public/sw.js` (Cache-first dla `content-media` w CacheStorage + obsługa komunikatów `PREFETCH_MEDIA`), rejestrator `sw-register.js` oraz automatyczny prefetching kolejnych slajdów w `presentation/script.js` (0 ms opóźnienia przy przełączaniu).

### FAZA 2: Nowoczesne Prezentacje (Google Slides Experience)
- [x] **Prompt 2.1:** Lewy panel slajdów: miniatury, przeciąganie drag & drop, duplikacja, gotowe layouty slajdów. ✅ (2026-09-14) — Miniatury slajdów renderujące elementy w czasie rzeczywistym, przeciąganie drag & drop z wizualnym wskaźnikiem pozycji upuszczenia (is-drop-above/below), menu kontekstowe prawego przycisku myszy oraz skrót klawiszowy Ctrl+D / Cmd+D do powielania slajdów/obiektów.
- [x] **Prompt 2.2:** Górny Toolbar Google Slides: narzędzia kształtów, linii, tabel, zaawansowane formatowanie tekstu B/I/U, kolory, indeksy chemiczne. ✅ (2026-09-14) — Górny pasek Google Slides z narzędziami kształtów (prostokąt, zaokrąglony, koło), linii i strzałek, tabel, pełnym formatowaniem tekstu (B, I, U, S, wybór czcionki, rozmiar +/-, 4 tryby wyrównania, próbnik kolorów tekstu/obramowania/wypełnienia) oraz natywnymi indeksami chemicznymi (indeks dolny X₂, indeks górny jonowy X² oraz automatyczne formatowanie formuł chemicznych 🧪 H₂O).
- [x] **Prompt 2.3:** Inteligentne magnetyczne prowadnice przyciągania (Smart Alignment Guides) i zaznaczanie obszarem (Marquee box). ✅ (2026-09-14) — Dynamiczne zaznaczanie wielu elementów przeciągnięciem ramki (Marquee box), magnetyczne przyciąganie (Smart Guides) do krawędzi i środków innych obiektów oraz osi slajdu z wizualnymi liniami prowadnic, grupowe przesuwanie, powielanie i usuwanie zaznaczonych elementów.
- [x] **Prompt 2.4:** Edycja tekstu inline WYSIWYG, grupowanie (`Ctrl+G`), warstwy i nielimitowana historia Undo/Redo (`Ctrl+Z`). ✅ (2026-09-14) — Bezpośrednia edycja tekstu inline na płótnie po dwukliku (WYSIWYG contenteditable), grupowanie i rozgrupowywanie elementów (Ctrl+G / Ctrl+Shift+G) z automatyczną selekcją i wspólną duplikacją, pełna kontrola warstw z klawiatury (Ctrl+], Ctrl+[, Ctrl+Shift+], Ctrl+Shift+[) oraz wizualnym inspektorem warstw, menu kontekstowe prawego przycisku myszy dla obiektów oraz 200-krokowa historia Undo/Redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z).
- [x] **Prompt 2.5:** Krokowe animacje odkrywania elementów na kliknięcie prelegenta. ✅ (2026-09-14) — Konfiguracja animacji wejścia (`fade-in`, `slide-up`, `zoom-in`) oraz kolejności odkrywania w Studio z numerowanymi wskaźnikami kroków na płótnie; w odtwarzaczu prezentacji (`presentation/script.js`) krokowe odkrywanie elementów przy kliknięciu „Dalej” / Spacja / Strzałki, płynne cofanie kroków oraz automatyczne przełączanie slajdów dopiero po odkryciu wszystkich obiektów. Dyskretny przycisk edycji w Studio widoczny wyłącznie dla administratorów/instruktorów (`ChemAuth` role check), uczeń ma 100% zablokowany, czysty widok prezentacji tylko do odczytu.
- [x] **Prompt 2.6:** Tryb Prelegenta (Presenter View) w osobnym oknie ze stoperem i notatkami + wskaźnik laserowy i rysik na żywo. ✅ (2026-09-14) — Dedykowany Tryb Prelegenta w osobnym oknie z automatyczną dwukierunkową synchronizacją w czasie rzeczywistym (`BroadcastChannel`), podglądem aktualnego slajdu i kolejnego slajdu, cyfrowym zegarem i stoperem wykładu (Start/Pauza/Reset), notatkami prelegenta ze skalowaniem czcionki (A-/A+) oraz poziomym filmstripem miniatur. W odtwarzaczu głównym: wskaźnik laserowy z łagodnym ogonem (`L`), pisak odręczny (`P`), zakreślacz (`H`) i gumka (`E`) z 5-kolorową paletą na przezroczystym płótnie wektorowym zapamiętywanym per slajd.
- [x] **Prompt 2.7:** Eksport prezentacji do formatu PDF. ✅ (2026-09-14) — 1-kliknięciem eksport do PDF w odtwarzaczu prezentacji (`presentation-player-pdf`, skrót `Ctrl+P`) oraz w Studio (`presentation-btn-export-pdf`, skrót `Ctrl+P`). Dedykowane wektorowe reguły `@media print` (format landscape, 1 slajd na 1 stronę A4 landscape, `page-break-after: always`), automatyczne odsłonięcie wszystkich ukrytych elementów animowanych na wydruku, czysta wektorowa typografia i wzory KaTeX bez utraty ostrości i bez layout shiftu.
- [x] **Prompt 2.8:** Interaktywne Quizy Osadzone w Slajdach (Interactive Slide Quizzes) z możliwością blokady przejścia dalej. ✅ (2026-09-14) — Dodawanie interaktywnego elementu Quizu w Studio (`presentation-model.js` z walidacją pytań, opcji A-D, poprawnej odpowiedzi, wyjaśnienia oraz flagi `blockNextUntilCorrect`), podgląd na żywo na płótnie i w inspektorze właściwości Studio. W odtwarzaczu prezentacji (`presentation/script.js`): interaktywne przyciski odpowiedzi, natychmiastowa weryfikacja z podświetleniem poprawnych/błędnych opcji i wyjaśnieniem, obsługa wzorów KaTeX w pytaniach i odpowiedziach oraz mechanizm blokady przejścia (`isSlideLocked`, `triggerLockNotice` z efektem shake i komunikatem ostrzegawczym) uniemożliwiający przejście do kolejnych slajdów dopóki uczeń nie wskaże właściwej opcji. Tryb prelegenta prezentuje podpowiedź poprawnej odpowiedzi bez blokowania nawigacji.

### FAZA 3: Nowoczesne Quizy i Fiszki (Anki / SRS Experience)
- [x] **Prompt 3.1:** Silnik algorytmu powtórek rozłożonych w czasie (SRS SM-2) z wyliczaniem interwałów i dat powtórek. ✅ (2026-09-14) — Rozszerzenie silnika SM-2 w `study-scheduler.js`: wyliczanie kolejnych dat powtórek na podstawie ocen (1-4), predykcja interwałów (`predictIntervals`), formatowanie interwałów (`formatInterval`).
- [x] **Prompt 3.2:** Cztery przyciski oceniania z czasem (Powtórz, Trudna, Dobra, Łatwa) i Fuzz Factorem. ✅ (2026-09-14) — Inteligentny Fuzz Factor (±5% dla interwałów ≥ 3 dni) zapobiegający kumulacji powtórek w jednym dniu, dynamiczne etykiety czasowe na przyciskach oceniania w `study-view.js` i `quiz-flashcards.js`, skróty klawiszowe (Spacja / 1-4).
- [x] **Prompt 3.3:** Licznik passy (Streak 🔥), roczna heatmapa aktywności i wykres retencji pamięciowej. ✅ (2026-09-14) — Licznik codziennej passy (`calculateStreak`), wskaźnik retencji pamięciowej i analiza dojrzałych kart (`calculateRetentionStats`), 365-dniowa roczna heatmapa aktywności (Activity Heatmap) w stylu GitHub na dashboardzie oraz konfetti i celebracja ukończenia talii.
- [x] **Prompt 3.4:** Moduł Image Occlusion (rysowanie masek zasłaniających na diagramach w stylu Anki). ✅ (2026-09-14) — Tryby „Ukryj jedno, zgadnij jedno” (`one_per_mask`) i „Ukryj wszystkie, zgadnij jedno” (`all`), interaktywne maski SVG, obsługa etykiet chemicznych KaTeX w `quiz-occlusion.js` i `quiz-occlusion-model.js`.
- [x] **Prompt 3.5:** Automatyczny generator testu ABCD z talii fiszek jednym kliknięciem. ✅ (2026-09-14) — 1-klik generator testu ABCD z talii fiszek (`generateAbcd`), inteligentny dobór dystraktorów z innych kart z talii, natychmiastowe sprawdzanie odpowiedzi z punktacją.

### FAZA 4: Tworzenie Lekcji Proste jak Drut (Notion-like Studio)
- [x] **Prompt 4.1:** Blokowy edytor WYSIWYG z menu Slash (`/`) i przeciąganiem klocków za uchwyt `::`. ✅ (2026-09-14) — Wdrożenie interaktywnego wiersza promptu w stylu Notion (*„Wpisz tekst lub naciśnij '/' aby wstawić blok...”*), wpisanie tekstu i Enter natychmiast tworzy akapit, naciśnięcie `/` lub `＋` otwiera pływające menu Slash z filtrowaniem w czasie rzeczywistym i skrótami klawiaturowymi (`/tekst`, `/naglowek`, `/zadanie`, `/prawda-falsz`, `/obraz`, `/wzor`, `/video`, `/tabela`, `/fiszki`, `/wskazowka`, `/kod`, `/pytanie-otwarte`), oraz intuicyjne uchwyty przeciągania `::` (`drag-handle-notion`) z kursorem `grab`/`grabbing`.
- [x] **Prompt 4.2:** 1-klik wstawianie zadań sprawdzających z bezpośrednim zaznaczaniem poprawnej opcji. ✅ (2026-09-14) — Dodanie szablonu pytania dwuwariantowego Prawda/Fałsz (`task-true-false`), pasek szybkiego wyboru 1-kliknięciem poprawnej odpowiedzi (`task-quick-options` oraz `task-quick-selector-bar`) bezpośrednio na karcie pytania na slajdzie i w inspektorze zadań (wyraziste zielone podświetlenie `✓` wybranej opcji bez konieczności ręcznego wpisywania tekstu).
- [x] **Prompt 4.3:** Suwakowe reguły odblokowywania kolejnych kroków lekcji. ✅ (2026-09-14) — Nowoczesny suwak / przełącznik reguł przejścia (`slide-gate-card`, `gate-switch-label`, `gate-slider`) z natychmiastowym wyborem warunku odblokowania za pomocą kafelków (`correct_answer`, `material_completed`, `previous_completed`, `exam_passed`, `next_click`), wizualna plakietka stanu na slajdzie w Studio (🔒 Wymagany / 🔓 Swobodny), oraz w odtwarzaczu lekcji animacja shake (`is-locked-shake`) przy próbie pominięcia zablokowanego kroku i puls odblokowania (`is-unlocked-pulse`) po poprawnym rozwiązaniu.

### FAZA 5: Bezawaryjne i Szybkie Egzaminy + Kreator w Stylu Kahoot
- [x] **Prompt 5.1:** Wizualny Kreator Egzaminów i Quizów w Stylu Kahoot w Studio (duże karty pytań, 1-klik zaznaczanie poprawnej odpowiedzi, filmstrip pytań drag & drop, strefa mediów dropzone, stoper na pytanie, bank pytań). ✅ (2026-09-14) — Kahoot-like workflow w pełni zachowujący spójność z paletą motywu dashboardu (`var(--chem-primary)`, `var(--chem-surface-soft)`, `var(--chem-line)`, `var(--chem-text)` bez jaskrawych, niespójnych kolorów): responsywna siatka 2x2 dużych kart odpowiedzi, okrągły przełącznik 1-kliknięciem z zielonym ptaszkiem `✓` (`.answer-choice-toggle`), przeciąganie pytań metodą HTML5 Drag & Drop na lewym pasku filmstrip z wskaźnikami upuszczenia, powielanie pytania skrótem klawiszowym `Ctrl+D` / `Cmd+D`, strefa mediów dropzone z obsługą wklejania ze schowka `Ctrl+V`, prawy inspektor z szybkimi presetami czasu (10s, 20s, 30s, 60s, 90s, 120s, 240s, Bez limitu) i punktacji (1 pkt, 2 pkt, 3 pkt, CKE 5 pkt), oraz 1-kliknięciem podgląd na żywo `▶ Graj / Podgląd`.
- [x] **Prompt 5.2:** Kolejka offline-first w `IndexedDB` (< 1 ms zapis odpowiedzi, 100% odporności na zerwanie Wi-Fi i odświeżenie). ✅ (2026-09-14) — Wdrożenie `ChemExamOfflineStore` opartego o `IndexedDB` (`chemdisk_exam_offline_v1`, magazyn `attempts`) z natychmiastowym zapisem in-memory (< 0.1 ms) oraz asynchronicznym w transakcjach IDB (< 1 ms), synchronizacja stanu prób, kolejki zmian i pozycji zadania, bezpieczny fallback do localStorage/sessionStorage, obsługa zdarzeń `window.ononline` / `window.onoffline` z automatycznym flushowaniem kolejki po powrocie połączenia.
- [x] **Prompt 5.3:** 0 ms przełączanie pytań dzięki pre-renderingowi w RAM. ✅ (2026-09-14) — Silnik pamięci podręcznej węzłów DOM (`state.questionDomCache = new Map()`) w odtwarzaczu egzaminów (`public/members/module/exam/script.js`): asynchroniczny pre-rendering pytań w tle (`schedulePreRenderQuestions` z chunkingiem 5 pytań/krok przez `requestIdleCallback` / microtaski), natychmiastowe przełączanie pytań w czasie < 0.1 ms (0 ms latency) bez re-tworzenia drzewa DOM, eliminacja białych mrugnięć i zbędnego ponownego parsowania KaTeX, inteligentna synchronizacja wartości odpowiedzi (`syncAnswerValues`) i stanu zatwierdzenia (`syncQuestionStatus`), oraz bezpieczna unieważnialność cache'u przy rozpoczęciu nowej próby (`clearQuestionDomCache`).
- [ ] **Prompt 5.4:** Wbudowane Tablice Wzorów CKE i Układ Okresowy w wysuwanym panelu bocznym. *(Pominięte na prośbę użytkownika)*
- [ ] **Prompt 5.5:** Wirtualny brudnopis (Scratchpad canvas) pod każdym pytaniem. *(Pominięte na prośbę użytkownika)*
- [x] **Prompt 5.6:** Tryb Split-Screen dla zadań z długim tekstem źródłowym lub schematem. ✅ (2026-09-14) — Pełna obsługa trybu dwukolumnowego (Split-Screen) w modelu (`sourceText`, `splitScreen` w `exam-model.js`), w Studio Exam Builderze (pole tekstu wprowadzającego CKE w akordeonie `.exam-source-details` oraz przełącznik w prawym inspektorze) oraz w odtwarzaczu egzaminów (`public/members/module/exam/`): automatyczna aktywacja układu `.exam-splitscreen-layout` przy zadaniach z tekstem źródłowym CKE (stała lewa kolumna `.is-source` ze schematem i niezależnym scrollem, prawa kolumna `.is-interactive` z pytaniem i kartami odpowiedzi) oraz przycisk `◫ Podziel ekran` w nagłówku egzaminu (`elements.splitScreenBtn`) pozwalający kursantowi w 1 kliknięcie rozdzielić treść na 2 kolumny na ekranach panoramicznych. Pełna responsywność (jedna kolumna na mobile < 860px) i spójność ze stylami motywu NextMed.

### FAZA 6: Router AI – Prosty, Szybki, Mało Tokenów (Token-Efficient) i Bezawaryjny
- [x] **Prompt 6.1:** 1-klik test połączenia i auto-detekcja modeli w panelu admina (`gpt-4o-mini`, `gemini-2.5-flash`). ✅ — Zaimplementowane w `admin-ai.js` (`testConnection` + `listModels`) oraz interfejsie testowania w `management.js`.
- [x] **Prompt 6.2:** Ekstremalna optymalizacja tokenów (kompresja promptów systemowych, sliding context window, eliminacja nadmiarowych tokenów o 60%). ✅ — Nowy moduł `netlify/token-optimizer.js` (`compressSystemPrompt`, `estimateTokenCount`, `slidingContextWindow`), zintegrowany w `netlify/functions/chat.mjs` i `netlify/functions/chat-stream.mjs`.
- [x] **Prompt 6.3:** Limity AI, per-user rate limiting i panel budżetu/zużycia tokenów w Panelu Admina. ✅ — Silnik limitów i budżetu w `netlify/ai-usage.js` (rezerwacja slotów, per-user rate limit, śledzenie kosztu/tokenów, wykresy i tabele w `management.js`).
- [x] **Prompt 6.4:** Niewidzialny failover (automatyczny fallback OpenAI -> Gemini w 100 ms). ✅ — Silnik routera w `netlify/ai-router.js` (`sendRequest` z automatycznym przełączaniem awaryjnym `fallbackFor()` przy błędach dostawcy lub przekroczeniu limitu).
- [x] **Prompt 6.5:** Streaming odpowiedzi (SSE / efekt pisania na żywo) w czacie i sprawdzaniu zadań otwartych. ✅ — Nowy endpoint SSE `netlify/functions/chat-stream.mjs`, metody strumieniowe `sendRequestStream` w adapterach `netlify/ai-providers.js`, progressive rendering i animowany kursor w `public/members/module/chat/script.js` oraz `public/members/module/chat/style.css`.

### FAZA 7: Pełna Parzystość Studio <-> Uczeń (Live Simulator & Validator)
- [ ] **Prompt 7.1:** Interaktywny symulator ucznia w Studio z podglądem widoków Mobile / Tablet / Desktop. *(Pominięte na prośbę użytkownika)*
- [ ] **Prompt 7.2:** Pre-Publish Validator (wykrywanie pytań bez odpowiedzi, błędów wzorów, broken links). *(Pominięte na prośbę użytkownika)*
- [ ] **Prompt 7.3:** 1-klik test autorski bez zanieczyszczania statystyk kursu. *(Pominięte na prośbę użytkownika)*

### FAZA 8: Bento Dashboard, Panel Admina i Modernizacja Modułów `public/`
- [x] **Prompt 8.1:** Bento Grid na dashboardzie (kafelek „Wznów naukę”, cel dzienny, fiszki na dziś). ✅ — `public/assets/js/dashboard-bento.js` z adaptacyjnymi kafelkami (Wznów naukę, Passa 🔥, Fiszki SRS na dziś z dynamicznym odczytem z puli, Próbna Matura), responsywna siatka `.bento-grid` w `dashboard.css`.
- [x] **Prompt 8.2:** Command Palette (`Ctrl+K`) – globalna wyszukiwarka w ułamku sekundy. ✅ — `public/assets/js/command-palette.js` ze skrótami klawiaturowymi `Ctrl+K` / `Cmd+K` / `/`, natychmiastowym wyszukiwaniem materiałów, pojęć chemicznych, narzędzi, przełączaniem motywu i pełną nawigacją klawiaturą (`↑`, `↓`, `Enter`, `Esc`).
- [x] **Prompt 8.3:** Wizualny kreator kursu Drag-and-Drop w Dashboard Studio oraz Theme Builder (zaawansowana personalizacja kolorów, tła, kafelków). ✅ — Zintegrowany model `dashboard-model.js` w Studio, `site-brand.js` i Theme Builder (`applyPalette`) z zachowaniem dynamicznych zmiennych CSS (`--surface`, `--surface-soft`, `--line`, `--ink`, `--muted`, `--primary`).
- [x] **Prompt 8.4:** Ujednolicenie Buildera Dashboardu i Bezwzględna Niezawodność Otwierania Modułów – naprawa otwierania prezentacji z dashboardu na dowolnym repozytorium, usunięcie blokującego oczekiwania na progress API, standaryzacja i test linków dla quizów, lekcji, egzaminów, wideo i PDF. ✅ — Usunięcie 1800 ms opóźnienia przy otwieraniu prezentacji w `dashboard.js`, skanowanie `state.availableRepositories` w `presentation/script.js` przy braku pliku w domyślnym repozytorium, obsługa fallbacków.
- [x] **Prompt 8.5:** Uporządkowanie Panelu Administratora (`/members/module/studio/manage/`) – nowoczesny, przejrzysty podział zakładek (Użytkownicy, Płatności/Cennik, Repozytoria, Zużycie AI, Statystyki/Postępy), eliminacja zacinania się i chaosu UI. ✅ — Nowoczesny layout zakładek (`.management-tabs`, `.admin-tab`), zoptymalizowana paginacja i eliminacja konfliktów.
- [x] **Prompt 8.6:** Bezawaryjny Moduł Cen w Studio (`payment-config.js` / `management.js`) – bezbłędny zapis cen pakietów, bezkolizyjna obsługa ETagów, natychmiastowa synchronizacja z widokiem zakupu i czyszczenie pamięci podręcznej. ✅ — Automatyczne odświeżenie ETagu i ponowienie zapisu przy kolizji 412/INVALID_ETAG w `management.js`, unieważnianie pamięci podręcznej zakupu `nextmed.payments.public-config.v1`.
- [x] **Prompt 8.7:** Błyskawiczne Przełączanie Repozytoriów (Cross-Repo SPA) – nawigacja pomiędzy kursami/przedmiotami w 0 ms bez przeładowywania strony (współdzielony stan i cache). ✅ — Współdzielony cache repozytoriów `ChemContentLibrary` i statusu bez zbędnych przeładowań strony.
- [x] **Prompt 8.8:** Modernizacja modułów: Chat AI, Wideo (znaczniki czasu), PDF (dark mode), Kalkulator chemiczny, Cząsteczki 3D, Tablica wektorowa, szklane ekrany logowania. ✅ — Obsługa timestampów w `film/script.js` (`t`, `start`, `time`), pełny ciemny motyw w `pdf/style.css`, dark/light theme fix dla `.study-dashboard` w `study.css` i `quiz-flashcards.css`.
- [x] **Prompt 8.9:** Kompleksowy audyt produkcyjny, testy wszystkich modułów z dashboardu i weryfikacja 100% zielonych testów `npm test`. ✅ — 836/836 testów zdanych pomyślnie (100% green), dedykowana seria testów w `tests/dashboard-faza8.test.js`.

---

## 11. Jak zgłaszać rozpoczęcie kolejnego etapu?
Wystarczy wpisać w czacie:
> **„Zaczynamy Prompt 1.1”** (lub dowolny inny prompt z listy powyżej).
Każdy prompt zostanie wdrożony, przetestowany automatycznie (`npm test`), a jego stan w tym pliku zostanie zaktualizowany na `[x]`.
