# Obrazy z maskami — sesja 3

Rozszerzenie istniejącego Quiz Buildera i pul nauki. Bez nowego storage, endpointów, ENV, migracji i zmian w egzaminatorze. Stare quizy oraz karty z sesji 1–2 zachowują swój format i działanie.

## Administrator — krok po kroku

1. Wejdź w **Studio → Quiz**. Otwórz pulę albo wybierz **Nowa pula fiszek**, uzupełnij tytuł i kurs. Usuń pustą domyślną fiszkę, jeżeli chcesz mieć wyłącznie obrazy z maskami.
2. W palecie pytań wybierz **Obraz z maskami**. Ten typ można dodać także do zwykłego quizu, jako ćwiczenie bez punktów.
3. Kliknij **Wybierz obraz źródłowy**. Używany jest dotychczasowy Media Manager: istniejący obraz, wybór pliku, przeciąganie pliku i wklejanie w bibliotece. Niezapisana pula korzysta ze wspólnych obrazów; zapisana może też korzystać ze swojego folderu `photos/`.
4. Po wczytaniu obrazu włącz **Rysuj maskę** i przeciągnij prostokąt po podpisie lub fragmencie. Możesz narysować wiele masek. Alternatywnie kliknij **Dodaj maskę na środku** i ustaw jej pozycję procentowo.
5. Wyłącz rysowanie. Kliknij maskę na obrazie albo jej przycisk pod obrazem. Żółte obramowanie wskazuje aktywną maskę. Przeciągnij ją, aby przesunąć; uchwyt **↘** zmienia szerokość i wysokość. Obsługiwane są mysz, dotyk i rysik.
6. Pola **Od lewej / Od góry / Szerokość / Wysokość (%)** pozwalają precyzyjnie dopasować mały obszar na telefonie. Strzałki na klawiaturze przesuwają zaznaczoną maskę o 0,5%; Shift + strzałki zmieniają rozmiar. **Usuń zaznaczoną maskę** usuwa tylko maskę.
7. Uzupełnij opcjonalną nazwę, odpowiedź i wyjaśnienie. Przy poleceniu, odpowiedzi i wyjaśnieniu działa istniejący **fx · Dodaj równanie**, z podglądem oraz wstawianiem do wybranego pola. Odpowiedź i wyjaśnienie obsługują Markdown i LaTeX. Puste pola są dozwolone — odpowiedzią może być sam odsłonięty fragment obrazu. Nazwa jest etykietą tekstową i nie zdradza odpowiedzi przed odsłonięciem.
8. Wybierz tryb nauki oraz jeden z czterech kolorów masek. Sprawdź podgląd ucznia, następnie **Zapisz szkic** lub **Opublikuj**. Publikacja wymaga obrazu i co najmniej jednej maski.

Podmiana na inny obraz wymaga potwierdzenia wyczyszczenia masek, żeby nie wskazywały błędnych miejsc. Ponowne wybranie tego samego pliku zachowuje maski. Odpięcie obrazu/maski nie usuwa pliku z biblioteki. Rysowanie i przesuwanie zapisują zmianę dopiero po zakończeniu gestu; anulowany dotyk nie dopisuje przypadkowej maski.

## Trzy tryby

- **Jedna maska = jedna karta**: podczas nauki powstaje osobna karta dla każdej maski, w kolejności listy. Wszystkie fragmenty są zasłonięte, ale na danej karcie odsłaniasz tylko aktywną maskę. Pozostałe nie podpowiadają odpowiedzi.
- **Wszystkie maski na jednym obrazie**: jedna karta; każdą maskę można odsłonić osobno lub wszystkie przyciskiem **Pokaż odpowiedź**. Samoocena staje się dostępna po odsłonięciu wszystkich.
- **Losowa maska**: jedna maska wybrana przy rozpoczęciu nauki. Nie losuje się ponownie podczas zwykłej nawigacji ani aktualizacji otaczającego widoku React. **Ucz się ponownie** rozpoczyna nową sesję z ponownym losowaniem.

## Uczeń — krok po kroku

1. Otwiera pulę przez dotychczasowy kafelek **Quiz** na dashboardzie albo jej link `/members/module/quiz/?repo=ID_BIBLIOTEKI&quiz=ID_PULI`.
2. Widzi obraz z nieprzezroczystymi maskami; aktywne mają wyróżnione obramowanie. Może kliknąć maskę, większy przycisk **Odsłoń maskę…** pod obrazem albo **Pokaż odpowiedź**.
3. Fragment zostaje odsłonięty. Pod obrazem pojawiają się odpowiedź i wyjaśnienie z Markdown/LaTeX. Ponowne kliknięcie zakrywa fragment.
4. W puli wybiera **Nie pamiętam / Trudne / Dobre / Łatwe** i przechodzi dalej. To samoocena wyłącznie na czas bieżącej sesji, bez punktów i planowania powtórek. Zwykły quiz zachowuje swoje dotychczasowe sprawdzanie pytań punktowanych; maski nie zmieniają wyniku.

To materiał do samodzielnej nauki, nie mechanizm zabezpieczenia odpowiedzi egzaminacyjnych: klient otrzymuje źródłowy obraz i odpowiedzi. Dostęp i edycja korzystają z istniejących uprawnień kursanta/administratora, a odczyt puli uwzględnia publikację i aktywację.

## Model i koszt

`CARD_TYPES.IMAGE_OCCLUSION` zapisuje się jako `type: "image_occlusion"` w istniejącym modelu Quiz v1. Wspólne pola: `questionId`, `prompt`, `image: { ref, alt }`, `explanation`, `points: 0`, `required: false`, puste `options` i `acceptedAnswers`. Pole `occlusion`:

```json
{
  "mode": "one_per_mask",
  "color": "teal",
  "masks": [
    {
      "maskId": "mask-1",
      "x": 0.22,
      "y": 0.35,
      "width": 0.18,
      "height": 0.08,
      "name": "Jądro",
      "answer": "Jądro komórkowe",
      "explanation": "Zawiera materiał genetyczny."
    }
  ]
}
```

Współrzędne odnoszą się do pełnego obrazu, bez przycinania i bez zapisu pikseli. Walidacja frontend/backend sprawdza granice 0–1, skończone liczby, unikalność ID w obrębie pytania i maksymalnie 50 masek na obraz. Minimalny rozmiar to 0,5% osi. Obowiązuje istniejący limit 200 pytań oraz 2 MiB na plik quizu.

Tryb jednej maski tworzy jedynie wirtualne karty w pamięci — obraz i dane nie są kopiowane do nowych plików. Uczeń ogląda jedną kartę puli naraz, korzystając z istniejącego cache obrazów. Nie ma AI ani wywołania funkcji przy każdym odsłonięciu, ruchu maski czy samoocenie. Postęp puli jest zapisywany jak dotąd przy rozpoczęciu i ukończeniu. Nie powstają nowe logi per maska w Blobs. Błąd obrazu pokazuje ręczny przycisk ponowienia, bez pętli żądań.

## Pliki

- Nowe: `public/assets/js/quiz-occlusion-model.js` (współrzędne, walidacja, wirtualne karty), `public/assets/js/quiz-occlusion.js` (edytor i uczeń), `public/assets/css/quiz-occlusion.css` (responsywne nakładki).
- Model i walidacja: `public/members/module/studio/quiz-model.js`, `public/assets/js/quiz-practice.js`, `netlify/quiz-common.js`.
- Studio: `public/members/module/studio/index.html`, `quiz-builder.js`, `app/studio/builders.jsx`.
- Uczeń: `public/members/module/quiz/index.html`, `script.js`, `public/assets/js/quiz-flashcards.js`, `app/assessment/quiz.jsx`.
- Testy: nowy `tests/quiz-occlusion.test.js`, rozszerzony `tests/platform-react.test.js`, aktualizacja nieobsługiwanego typu w `tests/quiz-flashcards.test.js`.
- Dodatkowa poprawka zapisu: po zastąpieniu szkicu znormalizowaną definicją po publikacji edytory ponownie wiążą się z aktualnymi obiektami pytań. Dalsze zmiany nie trafiają już do odłączonej kopii pytania.

## Weryfikacja

- `npm test`: 757/757 po podstawowej implementacji; końcowy `npm run build`: **758/758**, w tym dodatkowy test zachowania losowej maski przy aktualizacjach React.
- `node --check`: 11 zmienionych/nowych plików JS. JSX kompiluje istniejący esbuild. `git diff --check`: poprawny.
- `npm run lint` i `npm run typecheck` uruchomiono: projekt nie ma takich skryptów (`Missing script`). Nie zastąpiono ich pozornymi sprawdzeniami ani nie dodano nowego stosu narzędzi.
- Izolowany Chrome: 1440 i 390 px, porównanie prostokątów masek z obrazem, brak poziomego przewijania, rysowanie/przesuwanie/rozmiar prawdziwymi zdarzeniami myszy i emulowanego dotyku, zapis współrzędnych, odsłanianie, ukończenie puli. Sprawdzono zarówno lokalny podgląd wzorów, jak i rzeczywisty MathJax z dotychczasowego CDN.
- Konta, biblioteka i zapis były testowe. Nie wykonano publikacji do produkcyjnego repozytorium ani wdrożenia. Test emulowanego dotyku nie zastępuje testu na fizycznym iPadzie/telefonie.

Nie dodano schedulera/spaced repetition, importu CSV ani rozbudowanych statystyk.
