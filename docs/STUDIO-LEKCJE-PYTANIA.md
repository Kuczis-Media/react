# Pomijanie kroków i konfiguratory odpowiedzi

## Przełącznik lekcji

W **Studio → Konfigurator lekcji**, obok nazwy pliku i tytułu, znajduje się przełącznik **Pozwól uczestnikom pomijać kroki**. Wyłączony oznacza naukę po kolei; włączony pozwala przejść do innych kroków i wrócić do zadania później.

Zmiana dotyczy całej lekcji. Zastosuj ją przyciskiem **Opublikuj** lub **Opublikuj zmiany**. Studio zapisuje również manifest postępu; jeśli synchronizacja się nie powiedzie, pokazuje ostrzeżenie i przycisk **Ponów synchronizację postępów**, który nie publikuje lekcji ponownie. Pobranie samego Markdown nie synchronizuje manifestu serwera.

W **panelu admina → Postępy → raport ucznia → Ustawienia ucznia** można ustawić wyjątek:

- **Według lekcji** — respektuje przełącznik autora.
- **Pomijanie dozwolone** — ten uczeń może pomijać w lekcjach.
- **Pomijanie zabronione** — ten uczeń przechodzi po kolei.

Ręczna blokada konkretnego kroku ma pierwszeństwo przed zezwoleniem ucznia. Ręczne odblokowanie kroku pozwala wejść bez ukończenia poprzedniego. Administrator może pomijać kroki; jego przełącznik „Nauka po kolei” w odtwarzaczu jest tylko podglądem.

**Pomijanie nie jest zaliczeniem.** Samo przejście nie rozwiązuje zadania, nie sprawdza go AI i nie przyznaje punktów. Żeby ukończyć lekcję, trzeba nadal zaliczyć wymagane/liczone kroki. Postęp i wynik nie są sztucznie ustawiane na 100%.

Manifesty zapisują się również dla lekcji jeszcze nieumieszczonych w dashboardzie. Kolejna publikacja dashboardu zachowuje już opublikowane warunki i kolejność lekcji.

## Odpowiedzi bez ręcznych identyfikatorów

Egzamin oraz bank pytań mają konfiguratory odpowiednie do typu pytania:

- wybór: osobna treść odpowiedzi i kółko/checkbox poprawności;
- pary: lewa i prawa strona w osobnych polach;
- kolejność: osobne elementy, strzałki przesuwania;
- luki: fragmenty zdania i przycisk „Wstaw lukę tutaj”;
- tekst: lista dopuszczalnych wariantów z przyciskami dodawania/usuwania;
- pytanie otwarte: sposób oceniania, klucz i kryteria, punkty.

Identyfikatory odpowiedzi i przypisane obrazy są zachowywane podczas edycji. Usunięcie jedynej poprawnej odpowiedzi wymaga świadomego zaznaczenia nowej — edytor nie wybiera jej za autora. Niekompletne odpowiedzi i luki blokują publikację z komunikatem.

Quiz i zadania lekcji korzystają z tego samego układu osobnych pól dla wariantów tekstowych, a pytania wyboru i luki zachowują swoje wizualne konfiguratory. Dotychczasowe pliki pozostają obsługiwane; nie trzeba ręcznie przepisywać istniejących odpowiedzi.

Ocena AI nie uruchamia się od edytowania. W egzaminie uruchamia ją autor w raporcie; w quizie uczeń może wywołać sprawdzenie. Tryby ręczny i bez punktów nadal są dostępne.

## Formatowanie pytań egzaminacyjnych

W **Studio → Edytor egzaminów → Pytania** (także w banku pytań) edytor treści ma przyciski pogrubienia, kursywy, podkreślenia, indeksu dolnego i górnego dla zaznaczonego fragmentu. Poniżej wybierasz kolor, czcionkę, rozmiar i wyrównanie całego pytania, w tym justowanie. Próbka pokazuje rezultat, a przycisk **Kolor domyślny** usuwa własny kolor.

Rozwiń **Kreator równań** i wybierz **Chemia** lub **Matematyka**. Dla reakcji wpisz substraty, produkty, wybierz strzałkę i opcjonalny warunek. Możesz pisać zwyczajnie `H2O` — w podglądzie od razu pojawi się H₂O, bez zmiany współczynników przed wzorem. Kliknij pole substratów albo produktów, aby skierować do niego przyciski indeksów, ładunków jonów i stanów skupienia. Zaznaczony fragment możesz zmienić w indeks, a wstawioną domyślną cyfrę od razu nadpisać. **Zamień strony** zamienia również kierunek strzałki, zachowując sens reakcji. Przykłady obejmują wodę, zobojętnianie, równowagę, osad i spalanie; wybrany przykład zastępuje zapis dopiero po kliknięciu **Użyj przykładu**.

Dla matematyki wybierz przykład (ułamek, pierwiastek, potęga, suma, wzór kwadratowy) i dostosuj zapis, korzystając z przycisków. Przełączanie trybów zachowuje oba robocze wzory do czasu zamknięcia edytowanego pytania. Duży **Podgląd na żywo** pokazuje wygląd dla uczestnika. **Wstaw równanie do pytania** wstawia je w miejscu kursora lub zastępuje zaznaczony fragment. Niepełne nawiasy i puste strony reakcji wymagają poprawienia przed wstawieniem; kreator nie sprawdza bilansu chemicznego. Formatowanie zapisuje się razem z egzaminem i bankiem oraz trafia do odtwarzacza i raportu, także w odpowiedziach i objaśnieniach. Rozpoczęta już próba zachowuje wcześniejszą migawkę pytań.

Obsługiwane zapisy tekstowe: `**pogrubienie**`, `*kursywa*`, `__podkreślenie__`, `H~2~O`, `x^2^`; wzory mają delimitery `\(...\)` albo `\[...\]`. Renderer nie wykonuje HTML, JavaScript ani dowolnych poleceń TeX. Typowe reakcje, indeksy, ułamki i pierwiastki mają natychmiastowy lokalny podgląd, działający również bez sieci. Pełny moduł równań jest statyczny i ładuje się dopiero, gdy jest potrzebny (Studio może już mieć wspólny MathJax); obsługuje też bardziej zaawansowany zapis. Błąd pobrania nie usuwa lokalnego podglądu i nie ponawia pobierania po każdym naciśnięciu klawisza. Kreator nie korzysta z AI ani Functions.

## Czytelny raport i ocena AI

Szczegóły próby pokazują osobne ramki **Odpowiedź ucznia**, **Klucz odpowiedzi**, kryteria i komentarz. Odpowiedzi wyboru są nazwami wariantów, pary pokazują dopasowania, a kolejność — ponumerowane pozycje. Klucz pozostaje dostępny tylko administratorowi; uczeń nadal widzi wyłącznie informacje dozwolone ustawieniami egzaminu.

W pytaniu otwartym wybierz **Autor uruchamia ocenę AI w raporcie** i uzupełnij klucz. W **Raporty → wybrana zakończona próba** użyj **Sprawdź oczekujące odpowiedzi za pomocą AI**. Konfigurację dostawcy przypisuje się do `aiGrader` w **AI / Modele**; operacja autora korzysta z jego limitu, a nie limitu ucznia. Jedno kliknięcie zleca jedną ograniczoną partię; pozostałe pytania można sprawdzić kolejnym kliknięciem lub ręcznie. Powtórzenie już zapisanej operacji nie wywołuje AI ponownie.

Parser akceptuje także poprawny JSON otoczony komentarzem modelu, ale nie zgaduje ocen z niejednoznacznych albo błędnych wyników. Przy błędzie lub przekroczeniu czasu odpowiedzi ucznia pozostają zapisane. Po utracie połączenia odśwież próbę przed ponownym kliknięciem — poprzednia ocena mogła zostać zapisana. Limity, brak klucza, brak środków i niedostępny model mają komunikaty diagnostyczne; punkty zawsze można przyznać ręcznie.
