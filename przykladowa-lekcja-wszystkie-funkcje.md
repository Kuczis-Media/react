:::slide
transition: fade
:::

# ChemDisk — przykładowa lekcja ze wszystkimi funkcjami

Ta lekcja pokazuje wszystkie rodzaje treści, multimediów, wzorów, przejść i zadań dostępnych w Lesson Builderze.

:::style font=georgia color=#173f35 background=#dff7ed bold=true size=large align=center
## Tekst ze stylem i tłem

Ten blok ma własną czcionkę, kolor, tło, rozmiar, wyrównanie i pogrubienie.
:::

W zwykłym tekście można stosować **pogrubienie**, *kursywę*, ^indeks górny^ oraz ~indeks dolny~, np. ^14^C i H~2~O.

Można również dodać [zwykły bezpieczny link](https://example.com).

---

:::slide
transition: rise
:::

## Obrazy, listy, cytaty i komunikaty

![Przykładowy schemat chemiczny](https://placehold.co/1200x675/png?text=Schemat%20chemiczny)

### Lista punktowana

- atom;
- cząsteczka;
- jon.

### Lista numerowana

1. Przeczytaj polecenie.
2. Wykonaj obliczenia.
3. Sprawdź jednostkę.

> Nauka jest najskuteczniejsza, gdy uczeń aktywnie sprawdza swoją wiedzę.

> **Zapamiętaj:** liczba atomowa Z jest równa liczbie protonów w jądrze.

---

:::slide
transition: slide
:::

## Wzór i reakcja chemiczna

:::formula
mode: chemistry
title: Synteza amoniaku — temperatura nad strzałką i katalizator pod nią
left: N2 + 3 H2
arrow: <=>
above: 450 °C
below: kat. Fe
right: 2 NH3
:::

:::formula
mode: chemistry
title: Pojedynczy wzór ze stanem skupienia
left: H2SO4 (aq)
arrow:
above:
below:
right:
:::

:::accordion Jak czytać równanie reakcji? open=true
### Objaśnienie

Współczynniki stechiometryczne mówią, w jakich proporcjach reagują cząsteczki. Warunek nad strzałką opisuje temperaturę, a warunek pod nią może wskazywać katalizator.
:::

---

:::slide
transition: zoom
:::

## Matematyka, potęgi, indeksy i kod

:::formula
mode: math
title: Wzór kwadratowy
expression: x_{1,2} = \frac{-b \pm \sqrt{b^{2} - 4ac}}{2a}
:::

:::formula
mode: math
title: Suma pierwszych n liczb naturalnych
expression: \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
:::

Przykładowy blok kodu:

```js
const liczbaMoli = masa / masaMolowa;
const stezenie = liczbaMoli / objetosc;
```

---

:::slide
transition: fade
:::

## Multimedia i interaktywny model

:::youtube
id: M7lc1UVf-VE
title: Przykładowy film YouTube osadzony w lekcji
:::

:::atonom
formula: kwas octowy
title: Interaktywny model kwasu octowego
:::

ATONOM najpierw pokaże niewielki kafelek. Model zostanie załadowany dopiero po kliknięciu przycisku.

---

:::slide
transition: none
:::

## Kafelki z linkami i fiszki

:::linkcard
title: Otwórz tablicę ChemDisk
description: Wewnętrzny materiał otwierany w tej samej karcie.
url: /members/module/whiteboard/
icon: chemistry
color: #0e665a
new_tab: false
:::

:::linkcard
title: Przejdź do materiału zewnętrznego
description: Przykład linku HTTPS otwieranego bezpiecznie w nowej karcie.
url: https://example.com
icon: external
color: #2563eb
new_tab: true
:::

:::flashcards
title: Fiszki — kliknij, aby odwrócić
color: #7c3aed
H2O => woda
CO2 => tlenek węgla(IV)
NaCl => chlorek sodu
NH3 => amoniak
:::

Ten slajd ma wyłączone przejście.

---

:::slide
transition: fade
:::

## Zapytaj AI o treść slajdu

Uczeń może poprosić asystenta o wyjaśnienie dokładnie tego materiału, który ogląda. Jako przykład przyjmijmy reakcję zobojętniania:

:::formula
mode: chemistry
title: Reakcja kwasu solnego z wodorotlenkiem sodu
left: HCl (aq) + NaOH (aq)
arrow: ->
above:
below:
right: NaCl (aq) + H2O (l)
:::

:::aihelp
title: Masz pytanie do reakcji zobojętniania?
description: Otwórz asystenta i zapytaj o substraty, produkty, jony albo sposób bilansowania. Treść tego slajdu zostanie użyta jako kontekst pierwszej odpowiedzi.
button: Zapytaj AI o ten slajd
repository:
prompt:
point: 1
:::

Pola repozytorium i promptu są w tym przykładzie puste, dlatego otworzy się zwykły asystent ChemDisk. W Studio można przypisać własny prompt JSON albo wybrany punkt z pliku TXT.

---

:::slide
transition: rise
:::

## Tablice interaktywne

Wybierz prostą białą tablicę tldraw do szybkiego szkicowania albo rozbudowaną tablicę BitPaper do rysowania, tekstu, zaznaczania oraz importowania plansz.

:::board
title: Rozpisz rozwiązanie na białej tablicy
description: Otwórz prostą tablicę do szkicowania wzorów, mechanizmów reakcji i notatek.
button: Otwórz białą tablicę
variant: whiteboard
path:
new_tab: true
:::

:::board
title: Otwórz rozbudowaną tablicę BitPaper
description: Użyj narzędzi rysowania, tekstu i zaznaczania albo zaimportuj wcześniej przygotowaną planszę JSON.
button: Otwórz BitPaper
variant: bitpaper
path:
new_tab: true
:::

Puste pole planszy tworzy nową przestrzeń roboczą. Dla BitPaper można w Studio wpisać również nazwę gotowego pliku `.json`.

---

:::slide
transition: rise
:::

## Quiz ABCD

:::question
Który symbol oznacza tlen?
:::

:::task
type: abcd
label: Zaznacz jedną poprawną odpowiedź
options: H | O | N | C
answer: B
hint: Tlen ma symbol składający się z jednej wielkiej litery.
success: Poprawnie — symbolem tlenu jest O.
:::

---

:::slide
transition: slide
:::

## Wybór jednej odpowiedzi

:::question
Który typ wiązania polega na uwspólnieniu pary elektronowej?
:::

:::task
type: choice
label: Wybierz rodzaj wiązania
options: wiązanie jonowe | wiązanie kowalencyjne | wiązanie metaliczne
answer: wiązanie kowalencyjne
hint: Poszukaj odpowiedzi związanej ze wspólną parą elektronów.
success: Dobrze — jest to wiązanie kowalencyjne.
:::

---

:::slide
transition: zoom
:::

## Odpowiedź tekstowa z aliasami

:::question
Podaj nazwę pierwiastka o symbolu C.
:::

:::task
type: text
label: Nazwa pierwiastka
placeholder: Wpisz nazwę albo symbol
answer: węgiel | wegiel | C
case_sensitive: false
hint: To pierwiastek będący podstawą chemii organicznej.
success: Poprawnie — chodzi o węgiel.
:::

---

:::slide
transition: fade
:::

## Odpowiedź liczbowa

:::question
Ile moli znajduje się w 9 g wody, jeśli jej masa molowa wynosi 18 g/mol?
:::

:::task
type: number
label: Liczba moli
placeholder: Możesz użyć przecinka albo kropki
answer: 0.5
hint: Podziel masę próbki przez masę molową.
success: Tak — 9 ÷ 18 = 0,5 mola.
:::

---

:::slide
transition: rise
:::

## Uzupełnianie luk z listy

:::question
Wybierz poprawne odpowiedzi z rozwijanych list.
:::

:::task
type: gaps
label: Uzupełnij obie luki
options: alkoholem | aldehydem | hydroksylowa | karboksylowa
text: Etanol jest {{typ związku}}, a jego grupa funkcyjna to grupa {{nazwa grupy}}.
answer: alkoholem | hydroksylowa
hint: Nazwa etanolu kończy się na „-ol”.
success: Wszystkie odpowiedzi są poprawne.
:::

---

:::slide
transition: slide
:::

## Luki tekstowe sprawdzane osobno

:::question
Wpisz odpowiedź do każdej luki i sprawdzaj je po kolei.
:::

:::task
type: gaps-text
label: Uzupełnij wzór i masę molową
text: Woda ma wzór {{wzór}}, a jej masa molowa wynosi około {{masa}} g/mol.
check_mode: each
answer: H2O | 18
case_sensitive: true
hint: Zwróć uwagę na wielką literę H oraz O.
success: Obie luki są poprawne.
:::

---

:::slide
transition: zoom
:::

## Luki tekstowe sprawdzane razem

:::question
Uzupełnij zdanie, a następnie sprawdź wszystkie pola jednym przyciskiem.
:::

:::task
type: gaps-text
label: Uzupełnij nazwę i wzór
text: Chlorek sodu ma wzór {{wzór}} i jest potocznie nazywany {{nazwa}}.
check_mode: all
answer: NaCl | solą
case_sensitive: false
hint: To najczęściej używana sól kuchenna.
success: Całe zadanie zostało rozwiązane poprawnie.
:::

---

:::slide
transition: none
:::

## Podsumowanie

W tej przykładowej lekcji użyto:

- wszystkich pięciu ustawień przejścia slajdu;
- tekstu, stylów, kolorów, tła i formatowania;
- obrazu, list, cytatu, komunikatu i bloku kodu;
- wzorów chemicznych i matematycznych;
- harmonijki, YouTube, ATONOM, kafelków z linkami, pomocy AI, obu tablic i fiszek;
- quizu ABCD, wyboru z listy, odpowiedzi tekstowej i liczbowej;
- luk z listy oraz luk tekstowych sprawdzanych osobno i razem.

Możesz zaimportować ten plik do Lesson Buildera, edytować każdy klocek i zapisać wynik w swoim repozytorium materiałów.
