# Media Manager

W Studio otwórz bibliotekę obrazów lub wybór obrazu w edytorze. Pole **Repozytorium** wskazuje źródło listy i miejsce nowych uploadów. W innym repozytorium dostępny jest folder wspólny; folder **W tym materiale** należy do repozytorium aktualnie edytowanego materiału.

- Wyszukiwanie obejmuje wszystkie nazwy i nazwy plików w wybranym folderze, także poza bieżącą stroną. Ignoruje wielkość liter i polskie znaki diakrytyczne.
- Strona pokazuje najwyżej 24 obrazy. Strzałki w stopce przełączają strony.
- **Zmień nazwę** zapisuje nazwę w bibliotece. Fizyczna ścieżka pozostaje stała, więc obrazy użyte w materiałach nie tracą odwołań. Nazwy mogą zawierać spacje i polskie znaki.
- Obrazy przesłane Media Managerem są sortowane od najnowszych. Datę odczytujemy z istniejącego znacznika czasu w wygenerowanej nazwie pliku. Starsze pliki dodane zewnętrznie bez daty trafiają na koniec, alfabetycznie; nie odpytujemy historii każdego pliku.
- Wklejenie do otwartego Media Managera dodaje obraz do biblioteki. Dopiero **Wybierz** wstawia go do materiału. Wklejenie bezpośrednio na slajd prezentacji dodaje jeden obraz do slajdu, na którym rozpoczęto wklejanie.

## Przechowywanie i koszty

Nazwy zapisuje pojedynczy plik `.media-library.json` w danym folderze obrazów, maksymalnie 1 MiB. Zapis sprawdza SHA i ponawia konflikt indeksu najwyżej dwa razy, zachowując cudze zmiany. Operacja wymaga uprawnień administratora po stronie serwera. Nie zmienia ani nie kopiuje oryginału i nie tworzy obiektów w Netlify Blobs.

Samo wpisywanie nazwy w wyszukiwarkę nie wywołuje backendu. Lista nazw jest pobierana dla jednego repozytorium i folderu. Gdy GitHub zwraca graniczne 1000 wpisów, pobieramy drzewo tego folderu; nie skanujemy zawartości całego repozytorium.

Miniatury pobierają się dopiero w widocznym obszarze, maksymalnie trzy równocześnie. Nierozpoczęte zadania są odrzucane po zmianie strony, wyszukiwania lub repozytorium. Miniatury mają ograniczony cache w pamięci i są zwalniane przy zamknięciu. Cache oryginalnych plików w kliencie ma limit 24 MiB/96 wpisów.

Pierwszy podgląd nadal wymaga pobrania oryginalnego pliku, po czym przeglądarka tworzy małą miniaturę w pamięci. Przechowywanie osobnych miniaturek na serwerze nie jest częścią tej zmiany. Nie ma okresowego odpytywania, zadań w tle po zamknięciu ani użycia AI. Pojedyncze żądanie już w toku może się zakończyć po zamknięciu; wynik nie jest wtedy wyświetlany ani przechowywany przez okno.

## Kontrola ręczna

1. Otwórz bibliotekę z minimum dwóch repozytoriów; szybko przełącz źródła i sprawdź nazwę repozytorium w stopce.
2. W bibliotece 1000 obrazów wyszukaj nazwę spoza pierwszej strony. Wyczyść filtr i przejdź na następną stronę.
3. Zmień nazwę używanego obrazu, odśwież listę, następnie sprawdź dotychczasową lekcję/prezentację.
4. Wklej obraz do biblioteki przy otwartym edytorze prezentacji. Wstaw go przyciskiem **Wybierz**, także klikając szybko dwa razy: ma powstać jeden element.
5. Wklej obraz na slajd i przełącz slajd przed zakończeniem uploadu: obraz powinien pozostać na slajdzie źródłowym.
6. Wstaw wspólny obraz z drugiego repozytorium jako tło i element prezentacji oraz do fiszki/quizu/egzaminu. Zapisz, otwórz ponownie i sprawdź podgląd ucznia.
