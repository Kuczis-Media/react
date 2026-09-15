# Landing NextMed i wspólna marka

Otwórz **Studio → Edytor strony głównej**. Zmień nazwę marki, firmę, logo, favicon, kolory i kontakt, a następnie treść poszczególnych sekcji. Podgląd reaguje podczas pisania; zmiana kolejności i wyłączenie sekcji nie wymagają edytowania kodu. Ciemny motyw panelu zachowuje własną paletę dla czytelności.

Samo pisanie i podgląd nie wywołują Functions. Szkic ma lokalną kopię w przeglądarce. **Zapisz szkic** zapisuje go na serwerze, a **Opublikuj** udostępnia nową wersję odwiedzającym. Edycja i eksport są dostępne również wtedy, gdy serwerowy zapis jest niedostępny.

Gotowy link do logo (np. jsDelivr) wkleisz w pole logo albo w oknie **Wybierz / wgraj → Gotowy link do obrazu → Użyj linku**. Nie wymaga to repozytorium ani tokenu GitHuba. Biblioteka jest sprawdzana dopiero po kliknięciu **Przeglądaj bibliotekę**; błąd jej konfiguracji nie blokuje używania linków ani nie wywołuje ponownych prób przy otwieraniu okna. Publikacja konfiguracji nadal korzysta z osobno wybranego magazynu. Załadowane logo zastępuje stary symbol panelu (nie jest nakładane na niego), a landing pozostawia odstęp między obrazem i podpisem. Zmiana treści podglądu nie tworzy ponownie tego samego obrazu logo.

W **Studio → Lekcja** szerokość prawego panelu ustawień zmienisz, przeciągając uchwyt na jego lewej krawędzi. Po ustawieniu fokusu na uchwycie strzałki lewo/prawo zmieniają szerokość, Home/End wybierają skrajne wartości, a dwuklik przywraca domyślną. Panel ma zakres 300–680 px, ograniczony dostępną szerokością okna; zapisuje preferencję tylko lokalnie, bez Functions. Na telefonie pozostaje układ pionowy.

## Osobne kolory dashboardu i studia

W **Studio → Builder dashboardu → Kolory dashboardu i studia** jest skrót otwierający konfigurator w nowej karcie (nie zamyka pracy nad układem). W **Marka i kolory → Gdzie zmienić kolory?** wybierz landing, dashboard, studio albo konto i płatności. Kolor tekstu, tła, kart, akcenty i gotowe palety zmieniają wyłącznie wybrany obszar. Próbka pokazuje jego kolory; ramka z pełną stroną nadal pokazuje landing.

Stare konfiguracje zachowują dotychczasową paletę: przy wczytaniu do edytora jest ona kopiowana do niezależnych `branding.palettes.dashboard`, `studio` i `account`. Nie ma dalszego automatycznego dziedziczenia zmian z landingu. Przycisk **Skopiuj kolory z landingu** pozwala świadomie ujednolicić jeden obszar. **Przywróć kolory NextMed** resetuje tylko wybraną paletę. Nazwa firmy, logo i favicon pozostają wspólne. Kolory pojedynczych sekcji dotyczą wyłącznie landingu, a treść lekcji, quizów i egzaminów nie jest przemalowywana.

Zmiany palet są zapisywane w tym samym JSON i publikowane razem z konfiguracją landingu — przez dotychczasowy zapis z kontrolą konfliktów. Nie ma osobnego endpointu ani dodatkowego odpytywania dla kolorów. Dotyczą jasnego motywu; ciemny zachowuje własną paletę. Zdjęcie w tle logowania pozostaje bez zmian, paleta konta zmienia formularz. Po publikacji odśwież otwarte widoki (obowiązuje opisany niżej cache).

## Ruchomy model i kolory formularza

W sekcji **Start / Hero → Grafika na początku strony** wybierz **Model 3D — obok tekstu (obecny układ)**, **Model 3D — na cały baner** albo **Obraz — własne zdjęcie / ilustracja platformy**. Domyślnie, także dla wcześniejszych konfiguracji bez tego ustawienia, używany jest model obok tekstu. Dotychczasowy adres obrazu pozostaje w konfiguracji; wybór trybu obrazu go przywraca. Przełącznik zapisuje się jako `heroVisual` w sekcji `home` (`biomolecule`, `biomolecule-banner` lub `image`) i działa w podglądzie, publikacji oraz eksporcie.

Tryb całego banera rozciąga tę samą scenę na tło sekcji Start. Tekst i przyciski pozostają nad modelem, z przyciemnieniem tła dla czytelności. Można nadal ustawić własny kolor tekstu sekcji; bez niego tekst jest jasny. Sterowanie modelem znajduje się w prawym dolnym rogu (na telefonie poniżej treści). Zmiana między układami 3D nie tworzy drugiej sceny i nie zmienia kamery, ruchu ani fizyki. Nie dodaje też wywołań Functions.

Model to ta sama scena `https://prod.spline.design/1gCKLbyQZHQvxlYX/scene.splinecode` i ten sam Spline Viewer `1.10.31`, które wskazano w dostarczonym `generatebiomedicine/index.html`. Kod nie zmienia jej kamery, parametrów fizyki, zdarzeń ani materiałów. Nie przeniesiono analityki ani pozostałych skryptów referencyjnej witryny. Folder `generatebiomedicine` nie jest potrzebny do wdrożenia — strona pobiera scenę i odtwarzacz bezpośrednio z ich publicznych adresów. Ich dostępność zależy od zewnętrznego hostingu.

Odtwarzacz pobiera się dopiero po wyświetleniu obszaru modelu, po rozstrzygnięciu konfiguracji strony i tylko przy włączonych animacjach. Po opuszczeniu obszaru, ukryciu karty albo wyłączeniu ruchu zasoby sceny są zwalniane. Powrót rozpoczyna scenę ponownie z oryginalnymi ustawieniami. Awaria sieci lub WebGL pokazuje zastępczą planszę i przycisk ponowienia; nie blokuje kursu, cennika ani kontaktu. Model działa też w podglądzie Studio i eksporcie HTML; wymaga WebGL i połączenia z internetem. Zobacz [dokumentację Spline Viewer](https://docs.spline.design/exporting-your-scene/web/exporting-as-spline-viewer).

W sekcji **Kontakt → Formularz — tło pól i kolory** oddzielnie ustawisz tło formularza, tło pól, wpisywany tekst, obramowania, wyróżnienie aktywnego pola i etykiety. Panel jest domyślnie rozwinięty. **Tło pól do wpisywania** dotyczy imienia, e-maila, tematu i wiadomości, również przy autouzupełnianiu. **Tło całej sekcji (nie pól)** to osobne ustawienie. **Użyj palety** usuwa tylko wskazany własny kolor. Ustawienia dotyczą wyłącznie formularza na końcu landingu — nie przemalowują strony, logowania ani panelu. Są zapisywane, publikowane i eksportowane w tym samym JSON; nie dodają żadnych żądań do Functions. Eksport samodzielnego HTML nadal zastępuje wysyłany formularz odnośnikiem do kontaktu, ponieważ nie ma backendu do wysyłania wiadomości.

Nad modelem kółko myszy i gest przewijania gładzikiem przewijają stronę zamiast trafiać do sterowania kamerą Spline. Lokalny pasywny listener w fazie capture nie wywołuje `preventDefault` ani ręcznego przewijania; zachowuje natywne przewijanie i powiększanie strony. Ruch kursora i przeciąganie nadal trafiają do oryginalnej sceny.

Małe loga w nagłówkach dashboardu, studia, zakupu i dostępu są pobierane z **Marka i kolory → Logo, favicon, kontakt i SEO → Favicon i wspólne logo paneli** (`branding.faviconUrl`). Bez konfiguracji używają faviconu zadeklarowanego w HTML. Wykorzystują ten sam publiczny plik konfiguracji i cache, bez nowego endpointu. Osobne `branding.logoUrl` nadal służy do szerokiego logo na landingu. Błąd pobrania ikony pozostawia widoczny znak zastępczy; spóźnione pobranie starego obrazu nie nadpisuje nowego. Przyciski wysłania formularza na landingu i w panelu mają 24 px odstępu nad sobą, również po CAPTCHA.

## Publikacja i zmienne

W builderze wybierz **Gdzie opublikować?**, a następnie **Opublikuj**:

- **Netlify Blobs — bez GitHuba**: wymaga `SITE_ID` i `NETLIFY_API_TOKEN`. Nie potrzebuje tokenu GitHuba do publikacji treści. Szkic jest osobny; aktywna publikacja znajduje się w rekordzie `publication.json` magazynu `chemdisk-landing`.
- **GitHub — publiczny plik JSON**: wymaga `GITHUB_SITE_ASSETS_TOKEN` z **Contents: Read and write** do publicznego `Kuczis-Media/logo` oraz wybranego repozytorium JSON. Domyślna ścieżka to `landing/config.json`.

Rekord aktywnego źródła w Blobs rozstrzyga, którą publikację wyświetlać. Stare pliki GitHuba nie przesłaniają aktywnej wersji Blobs, a błąd GitHuba nie uruchamia automatycznej publikacji do innego miejsca. Zmiana z aktywnych Blobs na GitHub wymaga działającego magazynu, aby zapisać zmianę źródła. Starsza karta buildera nie może zastąpić nowszej publikacji; przy konflikcie zachowaj JSON i odśwież edytor.

Generator `.env` opisuje obie możliwości. Sekrety zostają na serwerze; nie wpisuj ich w treściach strony. Bez konfiguracji serwerowej nadal działa edycja lokalna i eksport HTML.

`GITHUB_SITE_ASSETS_DIRECTORY` opcjonalnie wybiera katalog przesyłanych obrazów. Nie zmienia ścieżki konfiguracji strony. Serwerowy szkic wymaga też działającego magazynu Blobs (`SITE_ID` i `NETLIFY_API_TOKEN`). Po zmianie zmiennych środowiskowych wykonaj deploy aplikacji.

Skuteczna publikacja treści nie wymaga nowego deploya. Nazwa, logo i favicon z aktywnej konfiguracji są także używane przez główne ekrany panelu, Studio, logowania, zakupów i statusu dostępu. Nowy kod aplikacji wymaga jednorazowego wdrożenia; później wystarczy publikować z buildera.

Aktywne źródło ma 60-sekundowy cache CDN i przeglądarki. Zmiana może pojawić się przy kolejnym wejściu z opóźnieniem około 1–2 minut, a dla GitHuba dochodzi jego cache. Sama treść GitHuba ma 15-minutowy cache lokalny, ale nowa wersja publikacji z buildera wymusza wcześniejsze odświeżenie. Ręczne zmiany JSON poza builderem pozostają zależne od tego 15-minutowego cache. Publikujący otrzymuje lokalną kopię od razu. Obrazy przesłane w Studio mają linki CDN przypięte do wersji pliku.

## Inna domena i własna ścieżka JSON

W **Panel admina → Landing** dostępne są:

- **Używaj landingu z innej domeny** i adres, np. `start.netlify.app`. Po zapisaniu wejście na stronę główną przekierowuje przeglądarkę na ten adres HTTPS. Wyłączenie przełącznika przywraca lokalny landing. Panel `/members/`, logowanie `/login/` i kurs nie są przekierowywane. Parametry i fragment wejściowego adresu, w tym tokeny logowania, nie są przekazywane obcej domenie.
- **Plik JSON** w formacie `właściciel/repozytorium/ścieżka.json`, np. `Kuczis-Media/repo/strona.json`, oraz **Gałąź GitHuba**, np. `main`. Repozytorium i gałąź muszą już istnieć, repozytorium musi być publiczne. Obok można skopiować gotowy publiczny URL. Nie trzeba zmieniać `.env` ani robić deploya po każdej zmianie ścieżki.

Przy zapisie do nieistniejącego pliku aplikacja najpierw kopiuje obecną publikację GitHuba (lub domyślny landing, jeśli jeszcze nie ma takiej publikacji), dopiero potem zmienia źródło dla trybu GitHub. Wybór ścieżki nie wyłącza aktywnej publikacji Blobs — tryb wybierasz osobno w builderze. Poprzedni plik zostaje na miejscu. Istniejący poprawny landing jest używany bez nadpisania; niepowiązany lub uszkodzony JSON powoduje błąd. W razie konfliktu przy przełączeniu źródła nowa kopia może już istnieć, ale stary plik i aktywne ustawienia nie są usuwane. Po zmianie źródła odśwież otwarte Studio — publikacja ze starej karty zostanie zablokowana. Szkic edytora jest oddzielny od publikacji: sprawdź jego treść przed opublikowaniem w nowym miejscu.

Mały plik startowy `Kuczis-Media/logo@main/landing/route.json` przechowuje adres zewnętrzny i wskazanie wybranego JSON. Ta ścieżka jest stała i zarezerwowana, żeby wszystkie strony wiedziały, skąd odczytać ustawienia. Repozytorium obrazów pozostaje `Kuczis-Media/logo`; zmiana lokalizacji JSON nie przenosi obrazów. Token musi mieć dostęp zarówno do repozytorium ustawień, jak i do docelowego repozytorium JSON.

Strona główna najpierw ustala źródło, potem odczytuje JSON i renderuje treść. W czasie oczekiwania pokazuje krótki komunikat ładowania. Odczyty mają timeouty; przy awarii używana jest poprawna kopia z cache lub strona dołączona do wdrożenia. Plik startowy ma 1-minutowy cache przeglądarki, sama treść i marka — 15-minutowy. Cache treści jest przypisany do pełnego adresu JSON, więc zmiana repozytorium nie wczytuje poprzedniej marki. Dochodzi do tego czas odświeżenia cache GitHuba. Aktywne źródło jest dodatkowo sprawdzane przez cache’owany endpoint opisany niżej; w panelu funkcja uruchamia się przy wczytaniu lub zapisie ustawień, bez cyklicznego odpytywania.

Zewnętrzny landing jest niezależną stroną, a nie ramką w aplikacji. Musi mieć własny kod odczytu i renderowania wybranego JSON; samo wpisanie domeny nie dodaje takiego kodu. Kopia tej aplikacji NextMed korzysta z tego samego pliku startowego i pomija przekierowanie na własną domenę. Eksport **Pobierz stronę HTML** pozostaje natomiast samodzielną migawką, nie odczytuje późniejszych zmian JSON.

## Samodzielny plik HTML

**Pobierz stronę HTML** tworzy gotową stronę z osadzonym stylem, skryptem animacji i bieżącą treścią. Można udostępnić ją na zwykłym hostingu statycznym, bez Node, Functions, tokenu GitHuba czy serwera aplikacji. Obrazy nadal korzystają ze swoich publicznych URL-i, więc do ich wyświetlenia potrzebny jest internet.

Linki do kursu, konta i zakupu prowadzą do oryginalnej aplikacji. Kontakt używa skonfigurowanego adresu e-mail lub odsyła do strony aplikacji. Plik eksportu jest migawką: późniejsza publikacja w Studio go nie zmieni. Pobierz i umieść nowy HTML, aby zaktualizować taką kopię. **Pobierz JSON** służy natomiast do kopii zapasowej i ponownego importu w edytorze.

## Koszt odczytów

Animacje przewijania, efekt pisania i lokalna edycja nie wywołują Functions. Aktywne źródło jest pobierane przez `/.netlify/functions/landing`, z 60-sekundowym cache przeglądarki i współdzielonym cache CDN. W trybie Blobs ta sama odpowiedź zawiera treść, bez drugiego żądania. W trybie GitHub treść pochodzi ze statycznego JSON. Nie ma odpytywania w tle podczas przewijania. Nie oznacza to zerowego kosztu Functions — cache ogranicza liczbę wykonań. Zapis szkicu i publikacja wykonują pojedyncze żądanie administracyjne, które może wewnętrznie wykonać kilka operacji magazynu lub GitHuba.

Na głównej stronie aktualny cennik pobiera się automatycznie, bez kliknięcia. Odczyt cen ma cache i limit czasu; w razie problemu można go ponowić. Podgląd w builderze i eksport HTML nie pobierają cen. Logowanie, checkout, sprawdzanie uprawnień i działanie samego kursu pozostają funkcjami aplikacji, a nie statycznej strony. Nie należy więc interpretować statycznego landingu jako wyłączenia kosztu całego backendu.

## Wygląd i sesja

Landing ma szeryfowe nagłówki, animowane wejścia, paralaksę, jednorazowy efekt pisania i opcjonalny model 3D. Przełącznik animacji w builderze oraz ustawienie ograniczonego ruchu w systemie wyłączają ruch. Efekty tekstu i paralaksy nie mają stale działającej pętli JavaScript; model ma własną pętlę renderowania tylko wtedy, gdy jest aktywny. Żaden z tych efektów nie wywołuje AI ani Functions.

Na tej samej domenie informacja o lokalnej sesji zmienia przycisk na **Przejdź do kursu** bez odpytywania Identity. To wskazówka interfejsu, nie potwierdzenie uprawnień — kurs nadal sprawdza sesję i dostęp. Obce odnośniki i CTA prowadzące do cennika nie są zmieniane. Podgląd w builderze pokazuje etykietę autora. Osobna domena nie ma dostępu do sesji platformy.

Techniczne nazwy istniejących repozytoriów, magazynów danych i kluczy sesji nie zostały przemianowane: zmiana widocznej marki nie wymaga migracji kont ani materiałów.
