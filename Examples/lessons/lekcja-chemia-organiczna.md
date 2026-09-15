<!-- chemdisk-lesson:{"navigation":"free"} -->

<!-- chemdisk-step:{"id":"example-intro","includeInLesson":"ON","requiredToAdvance":true,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: fade
background: default
decoration: molecules
text_tone: auto
:::

# Chemia organiczna — kompletny warsztat NextMed

## Wprowadzenie

To katalog funkcji: swobodna nawigacja pozwala obejrzeć każdy przykład. Osobna lekcja `lekcja-sekwencyjna.md` pokazuje wymagane kroki. Ukończenie kroku powiązanego z quizem lub egzaminem wymaga rozwiązania materiału, nie samego otwarcia.

Ta lekcja prowadzi od rozpoznawania grup funkcyjnych do reakcji aldehydów i ketonów. Jest także katalogiem możliwości edytora lekcji NextMed.

### W tym przykładzie znajdziesz

- tekst, nagłówki, cytaty, listy, tabele, kod i wyróżnienia,
- obrazy z Media Managera oraz zewnętrznego adresu HTTPS,
- multimedia, prezentacje, quiz, PDF, egzamin, AI i tablice,
- wszystkie rodzaje pytań oraz ustawienia postępu ucznia.

1. Otwórz lekcję w Studio.
2. Klikaj kolejne slajdy i sprawdzaj ustawienia inspektora.
3. Rozwiąż zadania, zapisz odpowiedź otwartą, porównaj ją z kluczem i zakończ egzamin.

> Wiedza jest najbardziej użyteczna wtedy, gdy potrafimy ją zastosować.

> **Ważne:** Identyfikatory Google Slides, PDF, Forms i YouTube w tym pliku są prawdziwymi identyfikatorami przekazanych materiałów. Ich osadzenie wymaga ustawienia dostępu „każdy, kto ma link”.

---

<!-- chemdisk-step:{"id":"example-table-callouts","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"previous_completed","materialId":"","minimumScore":0}} -->

:::slide
transition: rise
background: paper
decoration: bubbles
text_tone: dark
:::

## Mapa grup funkcyjnych

:::table
caption: Najważniejsze grupy funkcyjne
align: left
headers: Klasa | Grupa | Przykład
row: Alkohol | –OH | etanol
row: Aldehyd | –CHO | etanal
row: Keton | >C=O | propanon
:::

:::table
caption: Produkty łagodnego utleniania alkoholi
align: center
headers: Alkohol | Produkt | Klasa produktu
row: pierwszorzędowy | aldehyd | związek karbonylowy
row: drugorzędowy | keton | związek karbonylowy
:::

:::table
caption: Przykłady homologów
align: right
headers: Związek | Wzór półstrukturalny
row: Metanal | HCHO
row: Etanal | CH₃CHO
:::

> **Ważne:** W aldehydzie atom węgla grupy karbonylowej jest związany przynajmniej z jednym atomem wodoru.

> **Wskazówka:** Końcówka `-al` pomaga rozpoznać aldehyd, a `-on` — keton.

> **Uwaga:** Nie utożsamiaj każdego związku zawierającego tlen z alkoholem.

> **Brawo:** Umiejętność rozpoznawania grupy funkcyjnej pozwala przewidywać właściwości związku.

---

<!-- chemdisk-step:{"id":"example-styles","includeInLesson":"INHERIT","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: slide
background: grid
decoration: glow
text_tone: dark
:::

## Nazewnictwo — ten sam temat w różnych stylach

:::style font=sans size=small align=left color=#17324d background=#eef8f5
Metanal to najprostszy aldehyd.
:::

:::style font=arial size=normal align=center bold=true color=#0e665a
Etanal ma wzór CH₃CHO.
:::

:::style font=verdana size=large align=right
Propanon jest najprostszym ketonem.
:::

:::style font=serif size=xlarge align=left
Końcówka aldehydów: -al.
:::

:::style font=georgia size=normal align=left
Końcówka ketonów: -on.
:::

:::style font=times size=normal align=left
Grupa karbonylowa: C=O.
:::

:::style font=rounded size=normal align=left
Grupa aldehydowa: –CHO.
:::

:::style font=mono size=normal align=left
CH3CH2OH → CH3CHO
:::

:::style font=courier size=normal align=left
CH3CHO → CH3COOH
:::

---

<!-- chemdisk-step:{"id":"example-media","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: zoom
background: dots
decoration: none
text_tone: auto
:::

## Obrazy, pliki Google i kod

:::googlemedia
url: https://drive.google.com/file/d/1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF/view
title: Plik Google — skalowalny podgląd
width: 100
height_percent: 75
:::

Ten sam klocek przyjmuje link do audio MP3, filmu, dokumentu lub folderu Google. Wklej własny udostępniony plik w ustawieniach. Link do notatnika Google otworzy nową kartę, ponieważ Google blokuje osadzanie notatników.

:::image
ref: assets/shared/example-diagram.svg
repository: repo-testowe
alt: Cztery pola przedstawiają grupy funkcyjne alkoholu –OH, aldehydu –CHO, ketonu >C=O i kwasu karboksylowego –COOH
width: 70
align: center
:::

:::image
ref: photos/example-photo.svg
repository: repo-testowe
owner: lekcja-chemia-organiczna.md
alt: Lokalny schemat próby Tollensa; kolba z warstwą srebra symbolizującą dodatni wynik dla aldehydu
width: 35
align: left
:::

:::image
ref: photos/example-photo.svg
repository: repo-testowe
owner: lekcja-chemia-organiczna.md
alt: Ten sam schemat próby Tollensa wyrównany do prawej
width: 35
align: right
:::

![Miniatura zewnętrznego filmu użytego w lekcji](https://i.ytimg.com/vi/sU6epNBjvzo/hqdefault.jpg)

Opis ALT obrazu z Media Managera jest dostępny dla czytników ekranu i trafia do kontekstu AI. Przykłady wyżej pokazują współdzielony zasób, lokalne zdjęcie lekcji, szerokość oraz wszystkie trzy wyrównania: `left`, `center` i `right`.

```javascript
const suffixByGroup = { '-CHO': '-al', '>C=O': '-on', '-COOH': '-owy' };
console.log(suffixByGroup['-CHO']); // -al
```

---

<!-- chemdisk-step:{"id":"example-containers","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: none
background: mint
decoration: molecules
text_tone: dark
:::

## Harmonijki i fiszki

:::accordion Dlaczego aldehydy utleniają się łatwiej? 
Atom wodoru przy węglu karbonylowym umożliwia przejście do grupy karboksylowej.

- etanal utlenia się do kwasu etanowego,
- dodatnia próba Tollensa może dać „lustro srebrne”.
:::

:::accordion Aldehyd a keton — szybkie porównanie open=true
Aldehyd ma grupę karbonylową na końcu łańcucha, a keton — wewnątrz łańcucha. Ta harmonijka jest domyślnie otwarta.
:::

:::flashcards
title: Fiszki — grupy i nazwy
color: #7c3aed
–OH => grupa hydroksylowa
–CHO => grupa aldehydowa
>C=O => grupa karbonylowa ketonu
–COOH => grupa karboksylowa
:::

---

<!-- chemdisk-step:{"id":"example-formulas","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: fade
background: sky
decoration: bubbles
text_tone: dark
:::

## Wzory matematyczne i chemiczne

:::formula
mode: math
title: Przykład wzoru matematycznego
expression: \frac{-b \pm \sqrt{b^{2}-4ac}}{2a}
:::

:::formula
mode: chemistry
title: Sam zapis chemiczny — bez strzałki
left: CH_{3}CHO
arrow: 
above: 
below: 
right: 
:::

:::formula
mode: chemistry
title: Reakcja w prawo
left: CH_{3}CH_{2}OH + [O]
arrow: ->
above: łagodne utlenianie
below: 
right: CH_{3}CHO + H_{2}O
:::

:::formula
mode: chemistry
title: Reakcja w lewo — demonstracja strzałki
left: aldehyd
arrow: <-
above: 
below: redukcja
right: alkohol pierwszorzędowy
:::

:::formula
mode: chemistry
title: Addycja i eliminacja
left: alken + H_{2}O
arrow: <->
above: 
below: 
right: alkohol
:::

:::formula
mode: chemistry
title: Estryfikacja — równowaga
left: CH_{3}COOH + C_{2}H_{5}OH
arrow: <=>
above: katalizator kwasowy
below: ogrzewanie
right: CH_{3}COOC_{2}H_{5} + H_{2}O
:::

:::formula
mode: chemistry
title: Równowaga przesunięta w prawo — wariant zapisu
left: substraty organiczne
arrow: <=>>
above: 
below: 
right: produkt główny
:::

:::formula
mode: chemistry
title: Równowaga przesunięta w lewo — wariant zapisu
left: substraty
arrow: <<=>
above: 
below: 
right: produkty
:::

---

<!-- chemdisk-step:{"id":"example-video-model","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"material_completed","materialId":"yt:sU6epNBjvzo","minimumScore":0}} -->

:::slide
transition: rise
background: lavender
decoration: glow
text_tone: dark
:::

## Film i model związku organicznego

:::youtube
id: sU6epNBjvzo
title: Ciekawostka chemiczna — film 1
:::

:::youtube
id: PG6fB57aAoA
title: Ciekawostka chemiczna — film 2
:::

:::youtube
id: kOoRildWO0s
title: Ciekawostka chemiczna — film 3
:::

:::atonom
formula: etanal
title: Interaktywny model etanalu w ATONOM
:::

---

<!-- chemdisk-step:{"id":"example-google-slides","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"material_completed","materialId":"slides:1rxPm5CJl2LDzrzq89fogz-_PWwO_BbqF","minimumScore":0}} -->

:::slide
transition: slide
background: sand
decoration: none
text_tone: dark
:::

## Google Slides — sterowanie włączone i wyłączone

:::googleslides
id: 1rxPm5CJl2LDzrzq89fogz-_PWwO_BbqF
published: false
controls: true
title: Aldehydy — prezentacja Google z przyciskami sterowania
:::

:::googleslides
id: 1rxPm5CJl2LDzrzq89fogz-_PWwO_BbqF
published: false
controls: false
title: Aldehydy — ta sama standardowa prezentacja bez przycisków sterowania
:::

Google Slides działa w zewnętrznym iframe. AI nie może odczytać jego zawartości bezpośrednio, dlatego dokładny opis slajdów znajduje się w polu ręcznego kontekstu klocka AI na kolejnym slajdzie.

---

<!-- chemdisk-step:{"id":"example-native-materials","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"quiz_completed","materialId":"quiz:repo-testowe:quiz-chemia-organiczna","minimumScore":0}} -->

:::slide
transition: zoom
background: gradient
decoration: molecules
text_tone: dark
:::

## Materiały NextMed wewnątrz lekcji

:::presentation
repository: repo-testowe
presentation: prezentacja-aldehydy
title: Aldehydy — prezentacja NextMed
description: Otwiera dołączoną prezentację `prezentacja-aldehydy/presentation.json` i zapisuje jej postęp.
button: Otwórz prezentację
:::

:::quiz
repository: repo-testowe
quiz: quiz-chemia-organiczna
title: Chemia organiczna — quiz przekrojowy
description: Otwiera `quiz-chemia-organiczna/quiz.json`, zawierający wszystkie cztery typy pytań.
button: Rozpocznij quiz
:::

:::quiz
repository: repo-testowe
quiz: pula-chemia
study: true
title: Powtórka / Fiszki — grupy funkcyjne
description: Otwórz pulę nauki w nowej karcie. Wybierz nowe karty lub powtórki na dziś; ta lekcja pozostanie na bieżącym kroku.
button: Rozpocznij powtórkę
:::

---

<!-- chemdisk-step:{"id":"example-pdfs","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"material_completed","materialId":"pdf:1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF","minimumScore":0}} -->

:::slide
transition: none
background: night
decoration: glow
text_tone: light
:::

## Cykloaddycja — PDF w pięciu trybach

:::pdf
id: 1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF
protection: 1
title: Cykloaddycja — chroniony podgląd
description: Dokument wskazany prawdziwym identyfikatorem Google Drive.
button: Otwórz PDF
:::

:::pdf
id: 1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF
protection: 2
title: Cykloaddycja — pobieranie
description: Wariant uruchamiający pobranie dokumentu.
button: Otwórz PDF
:::

:::pdf
id: 1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF
protection: 3
title: Cykloaddycja — zwykły podgląd
description: Wariant podglądu bez ograniczonego interfejsu.
button: Otwórz PDF
:::

:::pdf
id: https://drive.google.com/file/d/1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF/view?usp=sharing
protection: 4
title: Cykloaddycja — pełny link HTTPS, tryb 4
description: Ten sam prawdziwy plik przekazany jako pełny adres HTTPS.
button: Otwórz PDF
:::

:::pdf
id: https://drive.google.com/file/d/1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF/view?usp=sharing
protection: 5
title: Cykloaddycja — pełny link HTTPS, tryb 5
description: Ten sam dokument otwierany alternatywnym sposobem.
button: Otwórz PDF
:::

---

<!-- chemdisk-step:{"id":"example-ai","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"correct_answer","materialId":"","minimumScore":0}} -->

:::slide
transition: fade
background: custom
background_color: #edfdf8
decoration: bubbles
text_tone: dark
:::

## AI z pełnym kontekstem

AI nie uruchamia się od oglądania slajdu. Wywołanie następuje po wysłaniu pytania; wymaga dostępnego modelu i limitu w platformie.

:::aihelp
title: Jeden prompt JSON
description: Osobny wariant instrukcji — plik JSON zamiast punktów TXT.
button: Otwórz asystenta
repository: repo-testowe
prompt: example-prompt.json
point: 1
include_slide: true
include_task: false
context_json: "Pomóż porównać etanal i propanon.\nNie znasz wyników ucznia ani zawartości osadzonych plików."
:::

:::aihelp
title: Zapytaj AI o treść, obraz i zadanie
description: AI otrzyma tekst slajdu, opisy ALT mediów, bieżące zadanie oraz dodatkowy opis autora.
button: Zapytaj AI
repository: repo-testowe
prompt: example-prompt.txt
point: 1
include_slide: true
include_task: true
context_json: "Na diagramie porównano cztery grupy funkcyjne: –OH alkoholu, –CHO aldehydu, wewnętrzną >C=O ketonu oraz –COOH kwasu karboksylowego. Lokalna ilustracja pokazuje symboliczne lustro srebrne w próbie Tollensa. Prezentacja Google na poprzednim slajdzie dotyczy aldehydów; autor powinien tu dopisać szczegóły konkretnych slajdów, których AI nie może odczytać z iframe ani z obrazu."
:::

:::aihelp
title: AI tylko z opisem autora
description: Ten wariant celowo nie dołącza automatycznie treści slajdu ani zadania.
button: Otwórz AI
repository: 
prompt: 
point: 1
include_slide: false
include_task: false
context_json: "Autor może podać osobny, wielowierszowy opis dla każdego klocka AI. Przykład: po lewej znajduje się etanal, strzałka jest opisana odczynnikiem Tollensa, a po prawej zaznaczono kwas etanowy i srebrny osad."
:::

:::question
Aldehydy zawierają końcową grupę karbonylową.
:::

:::task
type: choice
label: Wybierz Prawda albo Fałsz
options: Prawda | Fałsz
answer: Prawda
hint: Porównaj położenie grupy C=O w aldehydzie i ketonie.
success: Dobrze! Zaznaczenie zostanie pokazane na zielono, a błędne na czerwono.
:::

---

<!-- chemdisk-step:{"id":"example-links","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: rise
background: paper
decoration: none
text_tone: auto
:::

## Kafelki linków — wszystkie ikony

:::linkcard
title: Test szybkości reakcji — Google Forms
description: Wewnętrzny moduł Forms; po otwarciu z lekcji pokaże przycisk powrotu.
url: /members/module/forms/?id=1FAIpQLSeKEXX7ooRB7ZaPJ8UwnqNlPsucgjwnQFzmSlZ3OvrdFlURsA
icon: link
color: #0e665a
new_tab: false
:::

:::linkcard
title: Cykloaddycja — materiał do czytania
description: Oryginalny link Google Drive do przekazanego PDF.
url: https://drive.google.com/file/d/1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF/view?usp=sharing
icon: book
color: #2563eb
new_tab: true
:::

:::linkcard
title: Ciekawostka chemiczna 1
description: Pierwszy z przekazanych filmów YouTube.
url: https://www.youtube.com/watch?v=sU6epNBjvzo
icon: video
color: #dc2626
new_tab: true
:::

:::linkcard
title: Aldehydy — prezentacja źródłowa
description: Oryginalny link do przekazanej prezentacji Google.
url: https://docs.google.com/presentation/d/1rxPm5CJl2LDzrzq89fogz-_PWwO_BbqF/edit?usp=drive_link
icon: chemistry
color: #059669
new_tab: true
:::

:::linkcard
title: Szybkość reakcji — ćwiczenie
description: Formularz sprawdzający wpływ warunków na szybkość reakcji.
url: https://docs.google.com/forms/d/e/1FAIpQLSeKEXX7ooRB7ZaPJ8UwnqNlPsucgjwnQFzmSlZ3OvrdFlURsA/viewform?usp=sharing
icon: math
color: #7c3aed
new_tab: true
:::

:::linkcard
title: Cykloaddycja — plik
description: Pełny adres HTTPS dokumentu z Dysku Google.
url: https://drive.google.com/file/d/1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF/view?usp=sharing
icon: file
color: #d97706
new_tab: true
:::

:::linkcard
title: Ciekawostka chemiczna 2
description: Drugi z przekazanych filmów YouTube, otwierany jako link zewnętrzny.
url: https://www.youtube.com/watch?v=PG6fB57aAoA
icon: external
color: #475569
new_tab: true
:::

---

<!-- chemdisk-step:{"id":"example-tools","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: slide
background: grid
decoration: molecules
text_tone: dark
:::

## Tablice i kontakt

:::board
title: Biała tablica NextMed
description: Szkicuj wzory i rozwiązania bez wychodzenia z lekcji.
button: Otwórz tablicę
variant: whiteboard
path: 
new_tab: false
:::

:::board
title: Plansza BitPaper
description: Otwórz wcześniej przygotowaną planszę w nowej karcie.
button: Otwórz BitPaper
variant: bitpaper
path: 
new_tab: true
:::

:::contactform
title: Zapytaj prowadzącego
description: Otwiera wewnętrzny formularz kontaktowy platformy.
button: Napisz wiadomość
internal: Pytanie do lekcji „Chemia organiczna” — slajd „Tablice i kontakt”.
new_tab: false
:::

:::contactform
title: Formularz w nowej karcie
description: Ten wariant otwiera formularz osobno.
button: Otwórz formularz
internal: Proszę o pomoc z materiałem o aldehydach i ketonach.
new_tab: true
:::

---

<!-- chemdisk-step:{"id":"example-exams","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"exam_passed","materialId":"exam:repo-testowe:egzamin-chemia-organiczna","minimumScore":0}} -->

:::slide
transition: zoom
background: dots
decoration: bubbles
text_tone: dark
:::

## Egzamin w lekcji — wszystkie wymagania

:::exam
repository: repo-testowe
exam: egzamin-chemia-organiczna
title: Egzamin opcjonalny
description: Karta nie blokuje przejścia dalej.
button: Otwórz egzamin
requirement: optional
minimum_score: 0
:::

:::exam
repository: repo-testowe
exam: egzamin-chemia-organiczna
title: Wymagane ukończenie egzaminu
description: Uczeń musi zakończyć próbę.
button: Rozpocznij egzamin
requirement: completed
minimum_score: 0
:::

:::exam
repository: repo-testowe
exam: egzamin-chemia-organiczna
title: Wymagane zaliczenie egzaminu
description: Uczeń musi osiągnąć próg zapisany w exam.json.
button: Rozpocznij egzamin
requirement: passed
minimum_score: 0
:::

:::exam
repository: repo-testowe
exam: egzamin-chemia-organiczna
title: Wymagany własny próg
description: Uczeń musi zdobyć co najmniej 80 procent.
button: Rozpocznij egzamin
requirement: minimum_score
minimum_score: 80
:::

---

<!-- chemdisk-step:{"id":"example-canvas","includeInLesson":"ON","requiredToAdvance":true,"condition":{"type":"minimum_score","materialId":"exam:repo-testowe:egzamin-chemia-organiczna","minimumScore":80}} -->

:::slide
transition: none
layout: canvas
background: mint
decoration: glow
text_tone: dark
:::

:::layout id=canvas-title x=4 y=3 width=92 height=14
## Układ canvas
:::

:::layout id=canvas-left x=5 y=23 width=42 height=52
:::style font=rounded color=#0e665a background=#ffffff bold=true size=large align=center
Klocek można ustawić przez współrzędne X i Y oraz szerokość i wysokość.
:::
:::

:::layout id=canvas-right x=53 y=23 width=42 height=52
:::image
ref: assets/shared/example-diagram.svg
repository: repo-testowe
alt: Schemat grup funkcyjnych umieszczony po prawej stronie slajdu canvas
width: 100
align: center
:::
:::

---

<!-- chemdisk-step:{"id":"example-task-text","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"correct_answer","materialId":"","minimumScore":0}} -->

:::slide
transition: fade
background: sky
decoration: none
text_tone: dark
:::

## Zadanie tekstowe

:::question
Podaj skrótowy zapis grupy aldehydowej bez kreski poprzedzającej.
Możesz wpisać wielkie albo małe litery, ponieważ sprawdzanie wielkości liter jest wyłączone.
:::

:::task
type: text
label: Grupa aldehydowa
placeholder: Wpisz CHO
answer: CHO
hint: Grupa zawiera atom węgla, wodoru i tlenu.
success: Poprawnie — aldehydy zawierają grupę –CHO.
:::

---

<!-- chemdisk-step:{"id":"example-task-number","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"correct_answer","materialId":"","minimumScore":0}} -->

:::slide
transition: rise
background: lavender
decoration: molecules
text_tone: dark
:::

## Zadanie liczbowe

Ile atomów węgla znajduje się w cząsteczce 2-metylopropanalu?

:::task
type: number
label: Liczba atomów węgla
placeholder: Wpisz liczbę
answer: 4
hint: Łańcuch propanalu ma trzy atomy węgla, a podstawnik metylowy wnosi jeszcze jeden.
success: Zgadza się — 2-metylopropanal ma łącznie 4 atomy węgla.
:::

---

<!-- chemdisk-step:{"id":"example-task-abcd","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"correct_answer","materialId":"","minimumScore":0}} -->

:::slide
transition: slide
background: sand
decoration: bubbles
text_tone: dark
:::

## Zadanie ABCD

:::question
Jaki jest produkt łagodnego utleniania etanolu?
:::

:::task
type: abcd
label: Wybierz jedną odpowiedź
options: eten | etanal | etanon | kwas metanowy
answer: B
hint: Alkohol pierwszorzędowy przechodzi najpierw w aldehyd o tej samej liczbie atomów węgla.
success: Dobrze — łagodne utlenianie etanolu prowadzi do etanalu.
:::

---

<!-- chemdisk-step:{"id":"example-task-gaps","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"correct_answer","materialId":"","minimumScore":0}} -->

:::slide
transition: zoom
background: gradient
decoration: glow
text_tone: dark
:::

## Luki z listą rozwijaną

Uzupełnij zdanie, wybierając pojęcia z listy. Każda luka jest wyświetlana w osobnym wierszu, dzięki czemu pola nie nakładają się na tekst.

:::task
type: gaps
label: Wybierz odpowiedzi
options: końcu | wewnątrz | hydroksylowa | aminowa
text_json: "W aldehydzie grupa karbonylowa znajduje się na {{położenie aldehydu}} łańcucha.\nW ketonie grupa karbonylowa znajduje się {{położenie ketonu}} łańcucha."
answer: końcu | wewnątrz
hint: Porównaj wzory R–CHO oraz R–CO–R′.
success: Obie luki uzupełniono poprawnie.
:::

---

<!-- chemdisk-step:{"id":"example-task-gaps-text","includeInLesson":"INHERIT","requiredToAdvance":true,"condition":{"type":"correct_answer","materialId":"","minimumScore":0}} -->

:::slide
transition: none
background: night
decoration: molecules
text_tone: light
:::

## Luki wpisywane ręcznie — Enter kontrolowany przez autora

Wielowierszowy tekst jest zapisany w `text_json`. Autor sam decyduje, gdzie wstawić znak nowej linii; kreator nie dodaje Enterów automatycznie.

:::task
type: gaps-text
label: Wpisz brakujące pojęcia
text_json: "Etanol utlenia się łagodnie do {{aldehyd}}.\nDalsze utlenianie prowadzi do {{kwas}}."
check_mode: each
answer: etanalu | kwasu etanowego
case_sensitive: false
hint: Użyj nazw systematycznych produktów utleniania związku dwuwęglowego.
success: Wszystkie wpisane odpowiedzi są poprawne.
:::

---

<!-- chemdisk-step:{"id":"example-task-case-sensitive","includeInLesson":"OFF","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: fade
background: custom
background_color: #fff7ed
decoration: none
text_tone: dark
:::

## Dodatkowy wariant zadania tekstowego

Ten krok ma `includeInLesson: OFF`, żeby pokazać możliwość wyłączenia go z organizera postępu. W Studio nadal można go edytować.

:::question
Wpisz dokładnie zapis `CH3CHO`, zachowując wielkość liter.
:::

:::task
type: text
label: Wzór etanalu
placeholder: CH3CHO
answer: CH3CHO
case_sensitive: true
hint: Wielkość liter ma znaczenie.
success: Zapis jest poprawny.
:::

---

<!-- chemdisk-step:{"id":"example-open-answer","includeInLesson":"ON","requiredToAdvance":true,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: fade
background: mint
decoration: molecules
text_tone: dark
:::

## Pytanie otwarte — odpowiedź zapisywana w postępie

Ten przykład pokazuje odpowiedź wielowierszową, wymagany wpis, limit znaków, możliwość późniejszej edycji i zapis w istniejącym postępie lekcji.

:::studentanswer
question_id: q_organic_aldehyde_vs_ketone
question_json: "Dlaczego aldehydy zwykle utleniają się łatwiej niż ketony? Odwołaj się do budowy grupy karbonylowej i atomu wodoru przy węglu karbonylowym."
label: Twoja odpowiedź
placeholder_json: "Napisz własne wyjaśnienie w kilku zdaniach…"
min_height: 220
multiline: true
max_length: 1400
required: true
save_progress: true
allow_edit: true
button: Zapisz odpowiedź
:::

---

<!-- chemdisk-step:{"id":"example-answer-review","includeInLesson":"ON","requiredToAdvance":true,"condition":{"type":"previous_completed","materialId":"","minimumScore":0}} -->

:::slide
transition: rise
background: paper
decoration: glow
text_tone: dark
:::

## Omówienie odpowiedzi — samodzielne porównanie i opcjonalne AI

Najpierw pojawia się dokładnie zapisana odpowiedź ucznia, potem bogaty klucz autora. Żaden request do AI nie jest wykonywany przy otwarciu slajdu — analiza rusza wyłącznie po kliknięciu przycisku.

:::answerreview
question_id: q_organic_aldehyde_vs_ketone
question_json: "Dlaczego aldehydy zwykle utleniają się łatwiej niż ketony? Odwołaj się do budowy grupy karbonylowej i atomu wodoru przy węglu karbonylowym."
show_student_answer: true
ai_enabled: true
ai_instruction_json: "Oceniaj poprawność merytoryczną, a nie identyczność słów. Sprawdź, czy uczeń wskazał atom wodoru przy węglu karbonylowym aldehydu, możliwość utworzenia grupy –COOH oraz brak takiego wodoru w typowym ketonie."
order: student-first
key_json: "### Poprawna odpowiedź / klucz\n\nW aldehydzie atom węgla grupy karbonylowej jest związany z **atomem wodoru**. Utlenienie może zastąpić ten wodór grupą –OH, tworząc kwas karboksylowy. W ketonie węgiel karbonylowy jest połączony z dwiema grupami węglowymi, więc analogiczne utlenienie wymagałoby rozerwania wiązania C–C.\n\n- aldehyd: **R–CHO** — łatwo przechodzi w R–COOH,\n- keton: **R–CO–R′** — zwykle nie daje próby Tollensa,\n- dodatnia próba Tollensa może prowadzić do powstania lustra srebrnego.\n\nZapis CH~3~CHO pokazuje obsługę indeksu dolnego, a Ag^+^ — indeksu górnego.\n\n:::formula\nmode: chemistry\ntitle: Utlenianie aldehydu\nleft: RCHO + [O]\narrow: ->\nabove: utlenianie\nbelow: \nright: RCOOH\n:::\n\n:::table\ncaption: Porównanie związków karbonylowych\nalign: center\nheaders: Cecha | Aldehyd | Keton\nrow: Wzór ogólny | R–CHO | R–CO–R′\nrow: Wodór przy C=O | tak | nie\nrow: Próba Tollensa | zwykle dodatnia | zwykle ujemna\n:::\n\n:::image\nref: assets/shared/example-diagram.svg\nrepository: repo-testowe\nalt: Diagram grup funkcyjnych użyty również w kluczu odpowiedzi\nwidth: 42\nalign: center\n:::"
:::

---

<!-- chemdisk-step:{"id":"example-open-answer-optional","includeInLesson":"INHERIT","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

:::slide
transition: slide
background: sky
decoration: none
text_tone: dark
:::

## Pytanie otwarte — wariant jednowierszowy i sesyjny

Ten wariant jest opcjonalny, ma jedno pole tekstowe bez limitu ustawionego przez autora i nie zapisuje treści do profilu ucznia. Po zapisaniu blokuje ponowną edycję.

:::studentanswer
question_id: q_organic_aldehyde_suffix
question_json: "Jaką końcówką kończą się systematyczne polskie nazwy aldehydów?"
label: Krótka odpowiedź
placeholder_json: "Np. -…"
min_height: 80
multiline: false
max_length: 0
required: false
save_progress: false
allow_edit: false
button: Zachowaj w tej sesji
:::

---

<!-- chemdisk-step:{"id":"example-answer-review-without-ai","includeInLesson":"INHERIT","requiredToAdvance":false,"condition":{"type":"previous_completed","materialId":"","minimumScore":0}} -->

:::slide
transition: zoom
background: lavender
decoration: bubbles
text_tone: dark
:::

## Omówienie odpowiedzi — klucz pierwszy, bez AI

Alternatywny układ może pokazywać najpierw klucz, ukryć odpowiedź ucznia i całkowicie wyłączyć przycisk AI.

:::answerreview
question_id: q_organic_aldehyde_suffix
question_json: "Jaką końcówką kończą się systematyczne polskie nazwy aldehydów?"
show_student_answer: false
ai_enabled: false
ai_instruction_json: ""
order: key-first
key_json: "### Klucz odpowiedzi\n\nSystematyczne polskie nazwy aldehydów kończą się na **-al**, np. metanal i etanal."
:::

---

<!-- chemdisk-step:{"id":"example-summary","includeInLesson":"ON","requiredToAdvance":true,"condition":{"type":"exam_completed","materialId":"exam:repo-testowe:egzamin-chemia-organiczna","minimumScore":0}} -->

:::slide
transition: rise
background: default
decoration: bubbles
text_tone: auto
:::

## Koniec przykładu

W lekcji użyto wszystkich obsługiwanych typów klocków i zadań. Powiązany `quiz-chemia-organiczna` zawiera wszystkie typy pytań quizowych, a `egzamin-chemia-organiczna` — wszystkie typy pytań egzaminacyjnych oraz pełny zestaw ustawień.

> **Brawo:** Możesz skopiować wybrane slajdy i traktować je jako wzorce dla własnych materiałów.

:::contactform
title: Zgłoś pytanie do przykładu
description: Wyślij wiadomość do prowadzącego bez opuszczania platformy.
button: Napisz do prowadzącego
internal: Pytanie dotyczące kompletnego przykładu lekcji.
new_tab: false
:::

---

<!-- chemdisk-step:{"id":"example-enters-text","includeInLesson":"ON","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

# Nowa lekcja

## Entery w pytaniu: text

:::question
Pierwszy wiersz: rozpoznaj aldehyd.
Drugi wiersz: odwołaj się do grupy CH~3~CHO.

Nowy akapit z **wyróżnieniem**.
:::

:::task
type: text
label_json: "Twoja odpowiedź\nWybierz lub wpisz poniżej."
answer: etanal
hint_json: "Końcówka nazwy: -al.\nW zadaniu liczbowym podaj liczbę atomów węgla w etanalu: 2."
success_json: "Poprawnie!\nZachowaliśmy nowe wiersze."
:::

---

<!-- chemdisk-step:{"id":"example-enters-number","includeInLesson":"ON","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

## Entery w pytaniu: number

:::question
Pierwszy wiersz: rozpoznaj aldehyd.
Drugi wiersz: odwołaj się do grupy CH~3~CHO.

Nowy akapit z **wyróżnieniem**.
:::

:::task
type: number
label_json: "Twoja odpowiedź\nWybierz lub wpisz poniżej."
answer: 2
hint_json: "Końcówka nazwy: -al.\nW zadaniu liczbowym podaj liczbę atomów węgla w etanalu: 2."
success_json: "Poprawnie!\nZachowaliśmy nowe wiersze."
:::

---

<!-- chemdisk-step:{"id":"example-enters-choice","includeInLesson":"ON","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

## Entery w pytaniu: choice

:::question
Pierwszy wiersz: rozpoznaj aldehyd.
Drugi wiersz: odwołaj się do grupy CH~3~CHO.

Nowy akapit z **wyróżnieniem**.
:::

:::task
type: choice
label_json: "Twoja odpowiedź\nWybierz lub wpisz poniżej."
options_json: ["Etanal\nCH₃CHO","Propanon\nCH₃COCH₃","Etanol\nCH₃CH₂OH","Metan\nCH₄"]
answer_json: ["Etanal\nCH₃CHO"]
hint_json: "Końcówka nazwy: -al.\nW zadaniu liczbowym podaj liczbę atomów węgla w etanalu: 2."
success_json: "Poprawnie!\nZachowaliśmy nowe wiersze."
:::

---

<!-- chemdisk-step:{"id":"example-enters-abcd","includeInLesson":"ON","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

## Entery w pytaniu: abcd

:::question
Pierwszy wiersz: rozpoznaj aldehyd.
Drugi wiersz: odwołaj się do grupy CH~3~CHO.

Nowy akapit z **wyróżnieniem**.
:::

:::task
type: abcd
label_json: "Twoja odpowiedź\nWybierz lub wpisz poniżej."
options_json: ["Etanal\nCH₃CHO","Propanon\nCH₃COCH₃","Etanol\nCH₃CH₂OH","Metan\nCH₄"]
answer: A
hint_json: "Końcówka nazwy: -al.\nW zadaniu liczbowym podaj liczbę atomów węgla w etanalu: 2."
success_json: "Poprawnie!\nZachowaliśmy nowe wiersze."
:::

---

<!-- chemdisk-step:{"id":"example-enters-gaps","includeInLesson":"ON","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

## Entery w pytaniu: gaps

:::question
Pierwszy wiersz: rozpoznaj aldehyd.
Drugi wiersz: odwołaj się do grupy CH~3~CHO.

Nowy akapit z **wyróżnieniem**.
:::

:::task
type: gaps
label_json: "Twoja odpowiedź\nWybierz lub wpisz poniżej."
options_json: ["Etanal\nCH₃CHO","Propanon\nCH₃COCH₃","Etanol\nCH₃CH₂OH","Metan\nCH₄"]
text_json: "Związek CH₃CHO to {{nazwa}}.\nTa linia pozostaje osobnym wierszem."
answer_json: ["Etanal\nCH₃CHO"]
hint_json: "Końcówka nazwy: -al.\nW zadaniu liczbowym podaj liczbę atomów węgla w etanalu: 2."
success_json: "Poprawnie!\nZachowaliśmy nowe wiersze."
:::

---

<!-- chemdisk-step:{"id":"example-enters-gaps-text","includeInLesson":"ON","requiredToAdvance":false,"condition":{"type":"next_click","materialId":"","minimumScore":0}} -->

## Entery w pytaniu: gaps-text

:::question
Pierwszy wiersz: rozpoznaj aldehyd.
Drugi wiersz: odwołaj się do grupy CH~3~CHO.

Nowy akapit z **wyróżnieniem**.
:::

:::task
type: gaps-text
label_json: "Twoja odpowiedź\nWybierz lub wpisz poniżej."
text_json: "Związek CH₃CHO to {{nazwa}}.\nTa linia pozostaje osobnym wierszem."
check_mode: all
answer: etanal
hint_json: "Końcówka nazwy: -al.\nW zadaniu liczbowym podaj liczbę atomów węgla w etanalu: 2."
success_json: "Poprawnie!\nZachowaliśmy nowe wiersze."
:::
