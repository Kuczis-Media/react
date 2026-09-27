(function () {
  'use strict';
  const base = '/members/module/studio/';
  const groups = [
    ['Kursanci', [
      ['users', 'Użytkownicy i dostęp', 'admin/?tab=users'],
      ['forms', 'Formularze i wiadomości', 'admin/?tab=forms'],
      ['progress', 'Postępy i raporty', 'manage/?tab=progress'],
      ['payments', 'Płatności', 'manage/?tab=payments']
    ]],
    ['Platforma', [
      ['content', 'Biblioteki materiałów', 'admin/?tab=content'],
      ['dashboard-settings', 'Ustawienia panelu kursanta', 'admin/?tab=dashboard'],
      ['ai', 'Konfiguracja AI', 'admin/?tab=ai'],
      ['ai-usage', 'Limity i zużycie AI', 'manage/?tab=ai-usage'],
      ['landing', 'Publikacja strony', 'admin/?tab=landing'],
      ['env', 'Generator konfiguracji', 'env/']
    ]],
    ['Tworzenie', [
      ['lesson', 'Lekcje', '?mode=lesson'],
      ['exam', 'Egzaminy', '?mode=exam'],
      ['quiz', 'Quizy', '?mode=quiz'],
      ['presentation', 'Prezentacje', '?mode=presentation'],
      ['dashboard', 'Panel kursanta', '?mode=dashboard'],
      ['appearance', 'Wygląd strony głównej', 'landing/']
    ]]
  ];

  function init() {
    const page = document.body.dataset.studioPage;
    if (!page || document.querySelector('.studio-shell')) return;
    const content = document.createElement('div');
    content.className = 'studio-shell-content';
    const children = [...document.body.children].filter((node) => !['SCRIPT', 'TEMPLATE'].includes(node.tagName));
    content.append(...children);
    const shell = document.createElement('div');
    shell.className = 'studio-shell';
    const header = document.createElement('header');
    header.className = 'studio-shell-header';
    header.innerHTML = '<a class="studio-shell-brand" href="' + base + '"><span class="studio-shell-mark" aria-hidden="true">◫</span><span><strong>Studio</strong><small>Treści i zarządzanie</small></span></a>'
      + '<nav aria-label="Nawigacja główna"><a href="' + base + '">Wszystkie narzędzia</a><a href="/members/">Panel kursanta ↗</a><button type="button" class="studio-shell-theme" aria-label="Zmień motyw">◐</button></nav>';
    const nav = document.createElement('nav');
    nav.className = 'studio-shell-nav';
    nav.setAttribute('aria-label', 'Sekcje Studio');
    const mobileLabel = document.createElement('label');
    mobileLabel.className = 'studio-shell-mobile';
    mobileLabel.textContent = 'Przejdź do sekcji';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Przejdź do sekcji Studio');
    mobileLabel.append(select);
    nav.append(mobileLabel);
    for (const [title, links] of groups) {
      const section = document.createElement('div');
      section.className = 'studio-shell-group';
      const label = document.createElement('p');
      label.textContent = title;
      section.append(label);
      const optgroup = document.createElement('optgroup');
      optgroup.label = title;
      for (const [key, text, route] of links) {
        const link = document.createElement('a');
        link.href = base + route;
        link.textContent = text;
        link.dataset.studioSection = key;
        section.append(link);
        const option = document.createElement('option');
        option.value = link.href;
        option.textContent = text;
        option.dataset.section = key;
        optgroup.append(option);
      }
      select.append(optgroup);
      nav.append(section);
    }
    shell.append(header, nav, content);
    document.body.prepend(shell);
    document.body.classList.add('has-studio-shell');
    const currentSection = () => page === 'env' ? 'env' : page === 'landing' ? 'appearance'
      : new URL(window.location.href).searchParams.get('tab') || (page === 'manage' ? 'progress' : 'users');
    function sync(key = currentSection()) {
      if (page === 'admin' && key === 'dashboard') key = 'dashboard-settings';
      nav.querySelectorAll('[data-studio-section]').forEach((link) => {
        if (link.dataset.studioSection === key) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      const option = [...select.options].find((item) => item.dataset.section === key);
      if (option) select.value = option.value;
    }
    function navigate(href) {
      const url = new URL(href, window.location.href);
      if (url.pathname === window.location.pathname && url.searchParams.has('tab')) {
        const tab = url.searchParams.get('tab');
        const button = [...document.querySelectorAll('[data-admin-tab]')].find((node) => node.dataset.adminTab === tab);
        if (button && document.body.dataset.adminReady === 'true') {
          button.click();
          sync(tab);
          const heading = document.querySelector('#studio-admin-title, #management-title');
          heading?.focus({ preventScroll: true });
          return;
        }
      }
      window.location.assign(url.href);
    }
    nav.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-studio-section]');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(link.href);
    });
    select.addEventListener('change', () => navigate(select.value));
    document.addEventListener('studio-section-change', (event) => sync(event.detail));
    window.addEventListener('popstate', () => sync());
    header.querySelector('button').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      try { localStorage.setItem('chem.theme', dark ? 'dark' : 'light'); } catch (_) {}
      header.querySelector('button').setAttribute('aria-label', dark ? 'Włącz jasny motyw' : 'Włącz ciemny motyw');
    });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
