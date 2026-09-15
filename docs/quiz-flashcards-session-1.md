# Fiszki — sesja 1

## Istniejąca architektura i integracja

- Quiz: `public/members/module/quiz/`, komponenty `app/assessment/quiz.jsx` i API `netlify/functions/quiz.js`. Trasa pozostaje `/members/module/quiz/?repo=ID_BIBLIOTEKI&quiz=ID_PULI`.
- Edytor: `public/members/module/studio/quiz-builder.js`, `quiz-model.js`, HTML/CSS Studio oraz `app/studio/builders.jsx`. To rozszerzenie Quiz Buildera, nie osobna aplikacja fiszkowa.
- Lekcje: `studio/lesson-model.js` i `lesson/lesson-parser.js`; fiszki ponownie wykorzystują bezpieczny renderer Markdown lekcji oraz `assets/js/assessment-text.js` do LaTeX/chemii. Obsługiwane delimitery: `\(...\)`, `\[...\]`, `$$...$$`. Nie wykonujemy HTML wpisanego w treści.
- Kurs: katalog postępów dashboardu (`dashboard-model.js`, `netlify/progress-common.js`). Lista kursów dla autora pochodzi z istniejącego `admin-progress?view=config`. Jeśli dashboard nie ma jeszcze katalogu, istniejący identyfikator kursu zastępczego to `course`.
- Konta: Netlify Identity, kanoniczna weryfikacja użytkownika i ról w `netlify/admin-common.js`. Edycja, usuwanie i upload wymagają `admin`; odczyt wymaga dotychczasowego dostępu `active` lub ważnego dostępu czasowego. Nie ma nowego systemu ról. Przypisanie `courseId` jest relacją organizacyjną do obecnego kursu, nie nowym systemem płatnych uprawnień per kurs.
- Zapis definicji: dotychczasowe `content-library` → `content-repository.js` → `git-provider.js` (GitHub/Gitea). Ścieżka nadal `quizzes/<quizId>/quiz.json`, kontrola konfliktów przez SHA. Nie dodano nowego magazynu plików, endpointu ani zmiennych ENV.
- Obrazy: ten sam `ChemMediaManager`, `ChemContentLibrary`, `content-media`. Lokalne `quizzes/<quizId>/photos/*` lub wspólne `assets/shared/*`. Przed pierwszym zapisem używana jest biblioteka wspólna. Obsługuje wybór pliku, przeciąganie i wklejanie obrazu w otwartym oknie biblioteki; istniejący limit pliku 4 MB. Preview i uczeń korzystają z tych samych prywatnych referencji i cache.
- Postęp: istniejący `ChemProgress`, typ materiału `quiz`, zapis rozpoczęcia i ukończenia całej puli. Odsłanianie i samoocena karty nie wywołują API ani AI. Samooceny przechowywane są tylko w pamięci bieżącej sesji, nie przetrwają odświeżenia. Szczegółowe wyniki egzaminów/otwartych quizów pozostają w dotychczasowych Netlify Blobs.
- Brak ORM i relacyjnej bazy danych. Nie dodano tabel, migracji SQL ani resetu danych.

## Model

Format JSON pozostaje w wersji `1`. Stare quizy zachowują dotychczasowe pola. Nowa pula to quiz z `mode: "deck"`, `metadata.courseId` i `metadata.active`. Publikacja wymaga wskazania kursu oraz niepustych obu stron każdej fiszki. Nieaktywną pulę blokuje serwer; podgląd nieaktywnej puli lub szkicu jest dostępny tylko administratorowi z `preview=1`.

Nowy wariant `questions[]`:

```json
{
  "questionId": "fiszka-1",
  "type": "flashcard",
  "prompt": "Podaj wzór wody.",
  "points": 0,
  "required": false,
  "image": { "ref": "", "alt": "" },
  "options": [],
  "acceptedAnswers": [],
  "front": { "text": "Podaj **wzór wody**.", "images": [] },
  "back": {
    "text": "\\(\\ce{H2O}\\)",
    "images": [{ "ref": "assets/shared/woda.webp", "alt": "Model cząsteczki wody" }]
  },
  "explanation": "Dwa atomy wodoru i jeden atom tlenu."
}
```

`prompt` to krótka kopia tekstu frontu dla istniejących list. Treść strony może mieć do 10 000 znaków i 8 obrazów; wyjaśnienie do 3000 znaków. Strona może zawierać wyłącznie obraz. Pula ma do 200 kart oraz dotychczasowy limit rozmiaru pliku Quiz. Kolejność to kolejność `questions[]`, a `questionId` nie zmienia się podczas edycji/przesuwania. Duplikowanie tworzy nowy identyfikator.

Pozostaje jeden discriminator `type`. `CARD_TYPES` mapuje nazwy domenowe FLASHCARD, SINGLE_CHOICE, MULTIPLE_CHOICE, TEXT_COMPARE na istniejące wartości `flashcard`, `single`, `multiple`, `text`. Przyszłe IMAGE_OCCLUSION wymaga dodania kolejnego walidowanego wariantu; obecnie nie jest akceptowane ani zamieniane po cichu na inny typ. Pula w tej sesji zawiera wyłącznie fiszki. Zwykły quiz nadal obsługuje wszystkie stare typy oraz opcjonalne fiszki bez punktów.

## Obsługa

1. Administrator: Studio → Quiz → **Nowa pula fiszek**. Wpisz ID, tytuł, opis i wybierz kurs. Dodawaj kolejne karty przyciskiem **Fiszka — przód i tył**.
2. Wpisz treść obu stron. **Dodaj obraz — przód/tył** otwiera istniejącą bibliotekę. Wybierz lub prześlij plik, potem wybierz go do fiszki. Można podmienić obraz, usunąć jego powiązanie oraz edytować opis alternatywny. Usunięcie z fiszki nie usuwa pliku używanego w innych materiałach.
3. Podgląd karty jest w rozwijanym panelu przy karcie, a tryb nauki w prawym panelu. Strzałki przy kartach zmieniają kolejność. **Zapisz szkic** lub **Opublikuj** używa dotychczasowego publikowania. Wyłączenie **Pula aktywna** i ponowna publikacja blokuje odczyt przez ucznia.
4. Wszystkie pule i quizy są na wspólnej liście w lewej części narzędzia. Wybierz materiał do edycji lub usunięcia. Nie ma dodatkowych zapytań pobierających każdą definicję tylko w celu wyświetlenia tej listy.
5. W Dashboard Builderze dodaj kafelek **Quiz**, wybierz bibliotekę i ID puli, nadaj tytuł i opublikuj dashboard. Uczeń otwiera kafelek jak dotychczasowy quiz. Obowiązują obecne reguły dostępu i kolejności materiałów.
6. Uczeń: **Pokaż odpowiedź**, następnie **Nie pamiętam / Trudne / Dobre / Łatwe**. Samoocena przechodzi do następnej nieprzejrzanej karty. Dopiero po przejrzeniu wszystkich kart zapisuje się ukończenie puli, bez wyniku punktowego.

Dezaktywacja blokuje nowe pobrania, ale nie może odebrać treści już pobranej do przeglądarki — tak samo jak w dotychczasowych quizach ćwiczeniowych. Widok puli montuje jedną kartę naraz. Cache URL-i obrazów utrzymuje do 32 wpisów / 64 MB, z wyjątkiem obrazów aktualnie widocznych; po zmianie materiału lub zamknięciu strony zwalnia URL-e. Pobieranie korzysta z dotychczasowego cache biblioteki mediów.

## Poza zakresem

Nie dodano schedulera, spaced repetition, image occlusion, CSV, historii ocen fiszek ani rozbudowanych statystyk. Nie przebudowano egzaminów, kont ani płatności.

## Weryfikacja

Testy: `tests/quiz-flashcards.test.js`, test rzeczywistego Quiz Buildera w `tests/platform-react.test.js`, dotychczasowe `tests/studio-quiz.test.js` oraz pełny `npm run build` (buduje React i uruchamia wszystkie testy).

Projekt jest JavaScript/JSX i nie ma skonfigurowanych skryptów `lint` / `typecheck` ani TypeScript. Nie dodano pozornych skryptów zastępujących te narzędzia. Składnię zmienionych plików JS można sprawdzić `node --check`; składnię JSX sprawdza istniejący build esbuild.

Wynik sesji: `npm run build` — 734 testy zakończone powodzeniem. `node --check` dla zmienionych plików JS oraz `git diff --check` — bez błędów. Próby `npm run lint` i `npm run typecheck` potwierdziły brak tych skryptów. Kontrola w izolowanym Chrome: Studio i uczeń na szerokościach 1440 i 390 px, odsłanianie odpowiedzi, responsywne obrazy i ukończenie puli. Konta, repozytorium i zapis postępu w teście przeglądarkowym były zastąpione lokalnymi danymi testowymi; nie jest to potwierdzenie wdrożenia produkcyjnego.

## Pliki tej sesji

- Modele i serwer: `public/members/module/studio/quiz-model.js`, `netlify/quiz-common.js`, `netlify/functions/quiz.js`.
- Edytor: `public/members/module/studio/index.html`, `public/members/module/studio/quiz-builder.js`, `app/studio/builders.jsx`.
- Uczeń i komponenty współdzielone: `public/members/module/quiz/index.html`, `public/members/module/quiz/script.js`, `app/assessment/quiz.jsx`, nowe `public/assets/js/quiz-flashcards.js` i `public/assets/css/quiz-flashcards.css`.
- Testy: nowe `tests/quiz-flashcards.test.js`, rozszerzone `tests/platform-react.test.js`. W `tests/google-media.test.js` i istniejącym teście Google w `tests/platform-react.test.js` uaktualniono stare oczekiwania dotyczące pikseli/otwierania, aby odpowiadały wcześniejszej implementacji procentów i automatycznego podglądu.
- Dokumentacja: ten plik. Zastane zmiany w przykładach i `dashboard-model.js` pozostawiono bez nadpisywania.
