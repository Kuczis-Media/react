# Mapa funkcji NextMed

To mapa formatów materiałów i ich ustawień, nie wszystkich możliwych kombinacji wartości. Część funkcji działa w edytorze lub zależy od prawdziwego konta, AI i zewnętrznych usług — te miejsca mają osobną instrukcję sprawdzenia.

## Lekcje

Główny plik: `lessons/lekcja-chemia-organiczna.md`. Nazwy `example-…` to stabilne identyfikatory kroków w komentarzach MD; w Studio znajdziesz je po tytułach slajdów.

| Miejsce | Widoczne funkcje |
| --- | --- |
| `example-intro`, `example-table-callouts` | Nagłówki, akapity, listy zwykłe/numerowane, cytat, 4 rodzaje wyróżnień, tabele z podpisem i wyrównaniem |
| `example-styles` | Wszystkie 9 czcionek lekcji, 4 rozmiary, kolor tekstu/tła, pogrubienie, wyrównanie do lewej/środka/prawej |
| `example-media` | Media wspólne i lokalne, właściciel obrazu, szerokość, ALT, wyrównanie, zewnętrzny HTTPS, blok kodu, skalowalny podgląd Google na kliknięcie |
| `example-containers` | Harmonijka zamknięta/otwarta, tekst i lista wewnątrz, fiszki, kolor fiszek |
| `example-formulas` | Matematyka i chemia, indeksy, reagent po obu stronach, wszystkie strzałki, opis nad/pod strzałką |
| `example-video-model` | Filmy YouTube i model ATONOM |
| `example-google-slides` | Google Slides z kontrolkami i bez; wymagany dostęp do pliku źródłowego |
| `example-native-materials` | Natywna prezentacja i quiz, ID materiału oraz biblioteki, powiązany postęp |
| `example-pdfs` | 5 trybów otwierania PDF; część wymaga zezwolenia źródła na osadzenie |
| `example-ai` | Prompt JSON, TXT punkt 1 i konfiguracja domyślna; dołączanie/wyłączanie slajdu i zadania, własny kontekst autora |
| `example-links` | Wszystkie 7 ikon linków, własny opis i tekst przycisku, otwarcie w tym/nowym oknie |
| `example-tools` | Tablica lokalna/BitPaper, formularz kontaktu, wstępnie wpisana wiadomość, nowa karta |
| `example-exams` | Egzamin opcjonalny, wymagane ukończenie, zaliczenie i wskazany próg wyniku |
| `example-canvas` | Położenie i rozmiar elementów w canvas, zagnieżdżony styl i obraz |
| `example-task-text` do `example-task-case-sensitive` | Tekst/liczba/wybór/ABCD/luki z listy/luki wpisywane; odpowiedzi, podpowiedź, sukces, wielkość liter, luki razem/osobno |
| `example-open-answer` i następne omówienia | Pole otwarte jedno-/wielowierszowe, limit długości i wysokość, wymagane/opcjonalne, zapis postępu lub sesyjny, klucz pierwszy/odpowiedź pierwsza, AI włączone/wyłączone, bogaty klucz z tabelą i obrazem |
| `example-enters-*` | Każdy z 6 rodzajów zadania z nowymi wierszami w poleceniu, etykiecie, podpowiedzi i komunikacie; ABCD/wybór z wielowierszowymi opcjami |
| `lekcja-sekwencyjna.md` | Uczeń idzie po kolei, wymagane poprawne zadanie, blokada ponownej edycji odpowiedzi, ukrycie odpowiedzi w omówieniu |

Przejścia `none/fade/rise/slide/zoom`, wszystkie tła, dekoracje i kontrasty rozłożono między krokami. Ustawienia postępu pokazują `ON/OFF/INHERIT`, krok wymagany/opcjonalny i warunki: kliknięcie, poprzedni krok, ukończony materiał/quiz/egzamin, zaliczenie, minimalny wynik i poprawna odpowiedź. `OFF` oznacza wyłączenie kroku z udziału w postępie, nie usunięcie treści z pliku.

Admin może pomijać kroki. Wyjątek konkretnego ucznia ustawiasz w raporcie postępów, a nie w treści MD. W prezentacji Google przełączenie na wersję opublikowaną wymaga prawdziwego identyfikatora publikacji — nie wolno zastąpić nim automatycznie zwykłego ID dokumentu.

## Egzaminy

Główny egzamin ma komplet typów: `single_choice`, `multiple_choice`, `true_false`, `short_text`, `number`, `matching`, `ordering`, `fill_blanks`, `open_answer`. Otwarta odpowiedź ręczna, AI i niepunktowana to trzy osobne pytania. Punktacja jest różna; przykład liczbowy ma tolerancję ±0,05.

| Plik / pytanie | Ustawienia do obejrzenia |
| --- | --- |
| Główny egzamin | Strony po 3 pytania, swobodne cofanie/pomijanie/flagi, brak zegara, nielimitowane próby, najlepszy wynik, pełny raport po wysłaniu |
| `exam-single-aldehyde-group` | Obraz pytania i opcji, wielowierszowe polecenie, pogrubienie |
| `exam-short-text-ethanal` | Kilka uznawanych odpowiedzi, ignorowanie wielkości liter, kursywa/podkreślenie/indeks dolny |
| Pytania 1–4 | Kolor, 4 czcionki, 4 rozmiary, pogrubienie i wszystkie wyrównania — w tym justowanie |
| Dopasowanie/kolejność/luki | Osobne ID, właściwa kolejność, obraz pary, akceptowane odpowiedzi i rozróżnianie wielkości liter dla luki |
| `exam-open-manual` | Wielowierszowy klucz oraz kryteria, częściowe punkty i komentarz sprawdzającego |
| `exam-open-ai` | Indeksy górne/dolne, równanie redukcji srebra, klucz i instrukcja AI; wywołanie tylko przyciskiem |
| `exam-open-ungraded` | Jednowierszowa refleksja, zero punktów, bez czekania na ocenę |
| `egzamin-natychmiastowy` | Wszystkie pytania naraz, informacja natychmiastowa, punktowanie za opcje, ostatni wynik, rejestrowanie opuszczenia strony |
| `egzamin-sekwencyjny` | Jedno pytanie naraz, brak cofania/pomijania/flag, wymagana odpowiedź, limit na pytanie, odliczanie, równe punkty, bez punktów ujemnych/częściowych, jedna próba, pierwszy wynik, zakończenie po opuszczeniu strony, dostęp od daty |
| `egzamin-losowany` | Limit czasu całego egzaminu, zegar rosnący, losowanie kolejności pytań/odpowiedzi, 5 pytań z limitami kategorii, 3 próby, przerwa między próbami, średni wynik, ostrzeganie po opuszczeniu strony, dostęp do daty, wynik i klucz ukryte |
| `egzamin-z-banku` | Odwołania do `exams/question-bank.json`, zakres dat dostępności |
| `egzamin-refleksja` | Brak punktowanych pytań — brak sztucznego oczekiwania na sprawdzającego |

Metadata obejmują nazwę/opis, instrukcję, okładkę, komunikaty przed i po, próg zaliczenia, tagi i kategorie. Przykład losowania nie jest głównym katalogiem — inaczej mógłby losowo ukryć funkcję, którą chcesz obejrzeć.

**Wybór odbiorców:** w zakładce Dostęp przełącz na wybranych użytkowników i wskaż prawdziwe konto. Przykłady celowo nie zawierają fikcyjnych UUID uczniów. **Raport/Sprawdzanie:** wyślij próbę jako uczeń, następnie otwórz ją uprawnionym kontem; sprawdź filtr, wyszukiwanie, kolejną partię, zmianę próby, ręczne oceny, komentarze, AI i reset pojedynczej próby. Sygnały typu kopiowanie lub wyjście kursorem nie są dowodem niesamodzielnej pracy.

## Quizy

`quiz-chemia-organiczna` pokazuje wszystkie 5 typów, punkty, wymagane/opcjonalne odpowiedzi, obrazy i okładkę, wyjaśnienia, tagi, próg zaliczenia i 3 tryby pytań otwartych. Główny quiz ma stałą kolejność, możliwość ponowienia i widoczną informację zwrotną.

`quiz-bez-ai` pokazuje przeciwne ustawienia: losowanie kolejności, brak ponowienia, brak wyjaśnień pytań. Wynik jest automatyczny. `quiz-refleksja` pokazuje quiz bez punktów. Odpowiedzi ręczne w głównym quizie wymagają sprawdzającego; AI wymaga konfiguracji i limitu. Ustawienie `ungraded` nie uruchamia AI.

## Prezentacje

`prezentacja-aldehydy` zawiera 10 elementów: tekst, nagłówek, obraz, kształt, wzór, ikona, tabela, przycisk, kod i osadzenie. Zobacz kolejne slajdy galerii:

- „Kadrowanie”: cover/contain, przycięcie, punkt ostrości, proporcje, przezroczystość, zaokrąglenie, biblioteka i ALT.
- „Własny układ”: prostokąt/zaokrąglenie/koło/linia, obrys, grubość, wypełnienie, obrót, warstwy i blokada elementu.
- Trzy slajdy „Czcionki”: wszystkie 17 rodzin, wielkość/grubość, bold, kursywa, podkreślenie, wyrównanie poziome/pionowe, odstęp liter i interlinia.
- „Wzory”: chemia i matematyka, rozmiar oraz kolor.
- „Tabela”: nagłówek, kolory, wiersze, rozmiar tekstu.
- „Materiały”: przyciski z adresami wewnętrznymi/zewnętrznymi oraz osadzony film.

Wszystkie 11 układów ma osobny przykład. Tła obejmują kolor, gradient z kątem, obraz i motyw. Slajdy mają notatki prowadzącego i przełącznik wymagalności. Krótkie warianty prezentacji pokazują motywy light/dark/minimal (główna: chemistry), 16:9/4:3, numery i pełny ekran włączone/wyłączone, postęp highest/visited/all_required.

W edytorze sprawdź także: dodanie, duplikowanie i usuwanie slajdu/elementu, przesuwanie warstw, resize, obrót, blokowanie, wyrównywanie, cofanie/ponawianie i podgląd. Plik zapisuje efekt tych działań, nie historię kliknięć.

## Prompty i dashboard

TXT zawiera 4 punkty: pomoc z kontekstem, pytania naprowadzające, bilansowanie równań oraz konsultację kryteriów oceniania. JSON pokazuje pojedynczą instrukcję. W Studio wypróbuj zmianę formatu, dodawanie/usuwanie/numerowanie punktów, kopiowanie, import, pobieranie i publikację. Prompt czatu nie daje uprawnień do zmiany oceny.

`dashboard.md` pokazuje sekcje i zagnieżdżenie, tekst, wyróżnienie, organizer sekwencyjny, wszystkie rodzaje modułów, różne kalkulatory i tablice, link zewnętrzny, odwołania TXT/JSON i postęp. Wygląd/kafelki/logo edytujesz osobno w ustawieniach dashboardu; ten Markdown nie nadpisuje firmowej identyfikacji ani konfiguracji landing page.

## Rzeczy do sprawdzenia ręcznie po publikacji

1. Otwórz przykład jako uczeń, nie tylko administrator. Administrator ma inne uprawnienia do pomijania kroków.
2. Wpisz Entery w poleceniu i w odpowiedzi ABCD. Sprawdź podgląd Studio, podgląd w nowym oknie oraz ponowne otwarcie opublikowanego pliku.
3. Zakończ egzamin. Przy pytaniach otwartych sprawdź status oczekiwania, częściowy zapis ocen, komentarze i ostateczny wynik po ocenie ostatniej odpowiedzi.
4. Otwórz samą zakładkę Sprawdzanie: nie powinno nastąpić żadne wywołanie AI. Przyciski AI sprawdź osobno z dostępnym modelem i limitem.
5. Sprawdź linki Google/YouTube, uprawnienia źródłowych plików, wysłanie formularza, zapis postępów i prywatne obrazy na rzeczywistym wdrożeniu.
6. W edytorach sprawdź import/eksport, przeciąganie elementów, zmianę szerokości inspektora, zapis szkicu, cofanie/ponawianie i publikację. Zewnętrzne uprawnienia oraz konfiguracja usług nie są zapisane w plikach przykładów.
