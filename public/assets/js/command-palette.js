/**
 * command-palette.js – Global Command Palette (Ctrl+K / Cmd+K)
 * Prompt 8.2: Globalna, natychmiastowa wyszukiwarka materiałów, pojęć, wzorów i akcji.
 */
(function (root) {
  'use strict';

  const QUICK_ITEMS = [
    { title: 'Wznów ostatnią lekcję', category: 'Nawigacja', icon: '⚡', url: '/members/module/lesson/?repo=default&file=lekcja-1.json' },
    { title: 'Fiszki i powtórki SRS na dziś', category: 'Nauka', icon: '🧠', url: '/members/module/quiz/?study=due' },
    { title: 'Próbny Egzamin Maturalny', category: 'Egzamin', icon: '⏱️', url: '/members/module/exam/' },
    { title: 'Czat z Asystentem AI', category: 'Narzędzia', icon: '✨', url: '/members/module/chat/' },
    { title: 'Kalkulator stechiometryczny', category: 'Narzędzia', icon: '🧮', url: '/members/module/kalkulator/' },
    { title: 'Cząsteczki 3D (ATONOM)', category: 'Narzędzia', icon: '🔬', url: '/members/module/atonom/' },
    { title: 'Tablica wektorowa (Whiteboard)', category: 'Narzędzia', icon: '🎨', url: '/members/module/whiteboard/' },
    { title: 'Wzory i stałe chemiczne (Tablice CKE)', category: 'Materiały', icon: '📑', url: '/members/module/pdf/?doc=tablice-cke' },
    { title: 'Reakcja estryfikacji (mechanizm kwasowy)', category: 'Pojęcia chemiczne', icon: '🧪', url: '/members/module/lesson/?search=estryfikacja' },
    { title: 'Wiązanie peptydowe i białka', category: 'Pojęcia chemiczne', icon: '🧪', url: '/members/module/lesson/?search=peptydowe' },
    { title: 'Równanie kinetyczne i stała szybkości k', category: 'Pojęcia chemiczne', icon: '🧪', url: '/members/module/lesson/?search=kinetyka' },
    { title: 'Przełącz motyw (Ciemny / Jasny)', category: 'Ustawienia', icon: '🌓', action: 'toggle-theme' },
    { title: 'Pomoc i kontakt z nauczycielem', category: 'Pomoc', icon: '✉️', url: '/members/module/contact/' }
  ];

  let modal = null;
  let input = null;
  let resultsContainer = null;
  let activeIndex = 0;
  let currentResults = [];

  function initCommandPalette() {
    if (document.getElementById('command-palette-modal')) return;

    modal = document.createElement('div');
    modal.id = 'command-palette-modal';
    modal.className = 'command-palette-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Wyszukiwarka Command Palette');
    modal.hidden = true;

    modal.innerHTML = `
      <div class="command-palette-backdrop"></div>
      <div class="command-palette-dialog">
        <div class="command-palette-header">
          <span class="command-palette-icon" aria-hidden="true">⌕</span>
          <input type="text" class="command-palette-input" id="command-palette-input" placeholder="Wyszukaj lekcję, wzór, narzędzie lub wpisz polecenie…" autocomplete="off" spellcheck="false" />
          <kbd class="command-palette-esc">ESC</kbd>
        </div>
        <div class="command-palette-results" id="command-palette-results" role="listbox"></div>
        <div class="command-palette-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> Wybierz</span>
          <span><kbd>↵</kbd> Otwórz</span>
          <span><kbd>esc</kbd> Zamknij</span>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    input = modal.querySelector('#command-palette-input');
    resultsContainer = modal.querySelector('#command-palette-results');
    const backdrop = modal.querySelector('.command-palette-backdrop');

    backdrop.addEventListener('click', closePalette);

    input.addEventListener('input', () => {
      search(input.value.trim());
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCurrent();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      }
    });

    // Globalne skróty klawiaturowe: Ctrl+K, Cmd+K oraz '/' (poza polami tekstowymi)
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const triggerKey = isMac ? e.metaKey : e.ctrlKey;
      if (triggerKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
      } else if (e.key === '/' && !modal.hidden && document.activeElement !== input) {
        e.preventDefault();
        openPalette();
      }
    });

    // Powiązanie z wyszukiwarką w topbarze
    const topbarSearch = document.getElementById('resource-search');
    if (topbarSearch) {
      topbarSearch.addEventListener('focus', (e) => {
        e.preventDefault();
        topbarSearch.blur();
        openPalette();
      });
      topbarSearch.parentElement?.addEventListener('click', (e) => {
        e.preventDefault();
        openPalette();
      });
    }
  }

  function openPalette() {
    if (!modal) initCommandPalette();
    modal.hidden = false;
    document.body.classList.add('command-palette-open');
    input.value = '';
    search('');
    setTimeout(() => input.focus(), 50);
  }

  function closePalette() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('command-palette-open');
  }

  function togglePalette() {
    if (modal && !modal.hidden) {
      closePalette();
    } else {
      openPalette();
    }
  }

  function search(query) {
    const q = query.toLowerCase();
    if (!q) {
      currentResults = QUICK_ITEMS.slice(0, 8);
    } else {
      currentResults = QUICK_ITEMS.filter((item) =>
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    }
    activeIndex = 0;
    renderResults();
  }

  function renderResults() {
    resultsContainer.replaceChildren();
    if (!currentResults.length) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'Brak wyników wyszukiwania. Spróbuj innego hasła.';
      resultsContainer.appendChild(empty);
      return;
    }

    currentResults.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `command-palette-item ${index === activeIndex ? 'is-active' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === activeIndex));

      const icon = document.createElement('span');
      icon.className = 'command-item-icon';
      icon.textContent = item.icon || '✦';

      const copy = document.createElement('div');
      copy.className = 'command-item-copy';

      const title = document.createElement('span');
      title.className = 'command-item-title';
      title.textContent = item.title;

      const cat = document.createElement('span');
      cat.className = 'command-item-category';
      cat.textContent = item.category;

      copy.append(title, cat);
      row.append(icon, copy);

      row.addEventListener('click', () => {
        activeIndex = index;
        executeCurrent();
      });

      row.addEventListener('mouseenter', () => {
        activeIndex = index;
        updateActiveVisual();
      });

      resultsContainer.appendChild(row);
    });
  }

  function moveSelection(delta) {
    if (!currentResults.length) return;
    activeIndex = (activeIndex + delta + currentResults.length) % currentResults.length;
    updateActiveVisual();
  }

  function updateActiveVisual() {
    const items = resultsContainer.querySelectorAll('.command-palette-item');
    items.forEach((item, idx) => {
      const active = idx === activeIndex;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
      if (active) item.scrollIntoView({ block: 'nearest' });
    });
  }

  function executeCurrent() {
    const item = currentResults[activeIndex];
    if (!item) return;
    closePalette();
    if (item.action === 'toggle-theme') {
      const themeToggle = document.getElementById('theme-toggle');
      if (themeToggle) themeToggle.click();
    } else if (item.url) {
      window.location.assign(item.url);
    }
  }

  document.addEventListener('DOMContentLoaded', initCommandPalette);
  if (document.readyState !== 'loading') initCommandPalette();

  root.NextMedCommandPalette = { open: openPalette, close: closePalette, toggle: togglePalette };
})(window);

