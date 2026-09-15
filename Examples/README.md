# NextMed — warsztat wszystkich rodzajów materiałów

Gotowy zestaw demonstracyjny do otwarcia w Studio i przetestowania jako uczeń. Pliki są materiałami kursu, nie konfiguracją serwera. Nie zmieniają limitów AI, uprawnień ani ustawień Twojej platformy.

## Zacznij tutaj

1. Skopiuj zawartość katalogów `lessons`, `quizzes`, `exams`, `presentations`, `prompts` i `assets` do biblioteki treści, zachowując ścieżki. Nie dodawaj dodatkowego poziomu `Examples/`, jeśli nie wskazujesz go jako katalogu głównego biblioteki.
2. W Studio wybierz tę bibliotekę i odśwież listę materiałów. Możesz też importować pojedynczy MD/JSON w odpowiednim edytorze; obrazy wgraj osobno pod wskazane ścieżki.
3. Otwórz główną lekcję `lekcja-chemia-organiczna.md`. Swobodna nawigacja pozwala zobaczyć każdy przykład bez zaliczania poprzednich zadań.
4. Przejrzyj [mapę funkcji](FEATURES.md). Warianty wykluczających się ustawień są osobnymi materiałami.
5. Opcjonalnie zaimportuj `dashboard.md` w edytorze dashboardu. To propozycja katalogu kursu; nie zastępuj swojego dashboardu bez zachowania jego kopii.

Odwołania między materiałami używają identyfikatora biblioteki **`repo-testowe`**. Nie jest to nazwa właściciela ani repozytorium GitHub/Gitea. Jeśli Twoja biblioteka ma inne ID, zmień wszystkie wystąpienia `repo-testowe` w importowanej kopii. Pola `repo` i `repository` muszą wskazywać to samo ID.

Główne identyfikatory pozostają niezmienione: `lekcja-chemia-organiczna.md`, `quiz-chemia-organiczna`, `egzamin-chemia-organiczna`, `prezentacja-aldehydy`. Nazwa katalogu quizu/egzaminu/prezentacji musi pasować do ID w JSON. Powiązane materiały opublikuj przed udostępnieniem lekcji uczniom.

## Zawartość

| Materiał | Co pokazuje |
| --- | --- |
| `lessons/lekcja-chemia-organiczna.md` | 32 kroki: 26 rodzajów bloków, 6 rodzajów zadań, media, AI, odpowiedzi otwarte, style, canvas i Entery |
| `lessons/lekcja-sekwencyjna.md` | Blokowanie następnego kroku, wielowierszowe ABCD, odpowiedź z blokadą edycji, sam klucz bez AI |
| `quizzes/quiz-chemia-organiczna/quiz.json` | 7 pytań: 5 rodzajów, w tym otwarte ręczne, AI i niepunktowane |
| `quizzes/quiz-bez-ai/quiz.json` | Wynik lokalny, losowa kolejność, bez ponawiania i dodatkowych wyjaśnień; poprawne odpowiedzi po sprawdzeniu |
| `quizzes/quiz-refleksja/quiz.json` | Odpowiedź otwarta bez punktów i oczekiwania na ocenę |
| `exams/egzamin-chemia-organiczna/exam.json` | 11 pytań: wszystkie 9 rodzajów, formatowanie, wzory, ręczne punkty i AI na polecenie |
| Pozostałe katalogi `exams/egzamin-…` | Wynik od razu, pytania po kolei, zegary, losowanie, bank pytań, refleksja |
| `exams/question-bank.json` | Pytania współdzielone z wariantem `egzamin-z-banku` |
| `presentations/prezentacja-aldehydy/presentation.json` | 15 slajdów: 10 typów elementów, 11 układów, 17 czcionek, media, wzory i warstwy |
| Prezentacje `jasna`, `ciemna`, `minimalna` | Motywy, proporcje 16:9/4:3 i trzy sposoby liczenia postępu |
| `prompts/example-prompt.txt` | 4 osobne instrukcje wybierane numerem punktu |
| `prompts/example-prompt.json` | Jedna instrukcja JSON |
| `dashboard.md` | Katalog modułów i linki do materiałów |
| `assets/shared/example-diagram.svg` | Wspólna ilustracja; jeden plik używany w wielu materiałach |
| `lessons/lekcja-chemia-organiczna/photos/example-photo.svg` | Ilustracja lokalna przypisana do lekcji |

## Sprawdzanie egzaminu

Otwórz **Studio → Egzamin → zapisany egzamin → Sprawdzanie**.

- Lista ma filtr „Do sprawdzenia”, „Wszyscy” i „Ocenione”. Wyszukiwanie obejmuje wczytaną część listy; przycisk „Wczytaj kolejnych” pobiera następne próby.
- Wybierz osobę, a następnie jej próbę. Pytania otwarte są od razu rozwinięte.
- Odpowiedź ucznia, klucz i kryteria są opisane osobno. Przy mniejszej szerokości odpowiedź i klucz ustawiają się jeden pod drugim.
- Wpisz punkty i komentarz, kliknij „Zapisz punkty za pytania otwarte”. Możesz zapisać część ocen; puste pola punktów nie oznaczają zera.
- Niezapisane punkty i komentarze pozostają w pamięci przy przełączaniu prób. Nie przetrwają zamknięcia strony — przeglądarka ostrzeże przed opuszczeniem jej z niezapisanymi zmianami.
- Przycisk AI dotyczy oczekujących pytań ustawionych jako AI. Otwarcie listy lub odpowiedzi nie korzysta z AI. Najpierw zapisz ręczne zmiany.
- Uprawnienia są sprawdzane na serwerze. Ten panel wymaga konta z dostępem administracyjnym; samo posiadanie linku nie daje dostępu do cudzych odpowiedzi.

Główny egzamin ma pytania oczekujące na ocenę. Dlatego nie jest przykładem „wyniku od razu” — do tego służy `egzamin-natychmiastowy`. Warianty egzaminów są zapisane jako **szkice**, aby przypadkiem nie uruchomić uczniowi limitu czasu lub zakończenia próby przy opuszczeniu strony. Opublikuj wybrane warianty świadomie.

## Entery w lekcji

Enter w treści pytania zachowuje nowy wiersz. Pusty wiersz tworzy osobny akapit. Dotyczy to podglądu w Studio i odtwarzacza ucznia.

Opcje ABCD i zwykłego wyboru mają pola wielowierszowe. Zapis nie rozbija jednej odpowiedzi na kilka. Pola `label_json`, `options_json`, `answer_json`, `hint_json` i `success_json` zachowują Entery w pliku MD. Studio generuje ten zapis automatycznie; nadal wczytuje starsze pola `label:`, `options:`, `answer:`, `hint:` i `success:`.

Przykład:

```text
:::task
type: abcd
options_json: ["Etanal\nCH₃CHO","Etanol\nCH₃CH₂OH","Propanon\nCH₃COCH₃","Metan\nCH₄"]
answer: A
success_json: "Poprawnie!\nPrzejdź do następnego kroku."
:::
```

Listy rozwijane w lukach korzystają z natywnego kontrolera przeglądarki — wielowierszowe są polecenie i tekst wokół luk, a wygląd samych pozycji listy zależy od przeglądarki.

## Zależności i koszty

W Studio → Lekcja lub Dashboard wybierz **Plik Google / Notebook**. Wklej link udostępniania (nie kod HTML), ustaw szerokość 20–100% i wysokość 20–150% okna przeglądarki. Na telefonie podgląd zajmie dostępną szerokość. Przykładowe wysokości: audio 25%, film 60%, dokument 90%. Uczeń może zmieniać wysokość przyciskami −/+ i włączyć pełny ekran. W lekcji podgląd jest w treści i ładuje się po kliknięciu „Pokaż materiał”. Kafelek dashboardu otwiera osobny widok, gdzie podgląd startuje od razu po sprawdzeniu dostępu; nie oznacza to automatycznego odtwarzania dźwięku. Plik ładuje się bezpośrednio z Google, bez proxy Netlify ani automatycznego odświeżania. Starsze rozmiary zapisane w pikselach są obsługiwane i przeliczane na procenty; nowe lekcje zapisują `height_percent`, a nowe kafelki parametr `heightPercent`.

Udostępnij plik właściwym osobom w Google albo ustaw „Każdy, kto ma link”, jeśli treść ma być publiczna. Nie każdy format ma podgląd w Drive — dostępny jest zawsze link „Otwórz w Google”. Odtwarzanie MP3/wideo zależy też od przetworzenia pliku i uprawnień Google. Notatniki i artefakty NotebookLM/Gemini Notebook otwierają się w nowej karcie (Google blokuje iframe). Aby osadzić wygenerowane audio, pobierz je z notatnika, wgraj na Drive i użyj linku do pliku. Nie da się odczytać czasu słuchania ani treści iframe; postęp kafelka Google oznacza otwarcie, nie odsłuchanie całego nagrania.

Quiz bez pytań otwartych pobiera pełny zestaw pytań i poprawnych odpowiedzi po sprawdzeniu dostępu do kursu. Przeglądarka liczy punkty lokalnie i pokazuje klucz przy błędnych odpowiedziach. Ponowne sprawdzenie nie pobiera definicji ponownie i nie wywołuje funkcji oceniania ani AI; zapis postępu nadal korzysta z serwera. Taki quiz służy do ćwiczeń, a nie do zabezpieczonego sprawdzianu — klucz jest dostępny na urządzeniu ucznia. Egzaminy zachowują ocenianie i ochronę klucza po stronie serwera.

Samo przeglądanie przykładu nie powinno uruchamiać oceny AI. W quizie ocenę wywołuje uczeń przy sprawdzaniu; w egzaminie — sprawdzający przyciskiem. Potrzebne są skonfigurowany model, uprawnienia i dostępny limit.

Materiały prywatne oraz zapis postępów nadal korzystają z mechanizmów serwera. Przykłady nie oznaczają zerowego zużycia Functions. Lista sprawdzania pobiera krótkie podsumowania partiami, nie pełne odpowiedzi wszystkich uczniów; szczegóły pobiera po wyborze osoby.

Zewnętrzne Google Slides, PDF, Forms i YouTube zachowują identyfikatory przekazane przez autora. Ich dostępność, zgoda na osadzenie, publikacja i uprawnienia muszą być ustawione w usłudze źródłowej. Testy lokalne tego nie potwierdzają. Tablica BitPaper i formularz kontaktowy również wymagają odpowiedniej konfiguracji.

## Sprawdzenie plików

`npm test -- tests/examples.test.js tests/studio-lesson.test.js tests/platform-react.test.js tests/exam-engine.test.js`

Testy obejmują poprawność formatów i wariantów, lokalne ścieżki mediów, odwołania do banku pytań, typy elementów, Entery oraz działanie panelu sprawdzania. Pełne `npm run build` najpierw buduje wymagany pakiet React, a potem uruchamia cały zestaw testów.
