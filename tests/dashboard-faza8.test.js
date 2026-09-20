'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('FAZA 8: Bento Grid i Command Palette', () => {
  it('dashboard-bento.js poprawnie renderuje kafelek wznowienia sesji', () => {
    const code = fs.readFileSync(path.join(__dirname, '../public/assets/js/dashboard-bento.js'), 'utf8');
    assert.ok(code.includes('bento-card-resume'), 'zawiera kafelek wznowienia');
  });

  it('command-palette.js udostępnia skróty i globalną wyszukiwarkę', () => {
    const code = fs.readFileSync(path.join(__dirname, '../public/assets/js/command-palette.js'), 'utf8');
    assert.ok(code.includes('command-palette-modal'), 'tworzy okno modalne');
    assert.ok(code.includes('QUICK_ITEMS'), 'zawiera szybkie skróty');
    assert.ok(code.includes('NextMedCommandPalette'), 'eksportuje API palety poleceń');
  });

  it('dashboard.css definiuje responsywną siatkę bento i modal command palette', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/members/dashboard.css'), 'utf8');
    assert.ok(css.includes('.bento-grid'), 'zawiera .bento-grid');
    assert.ok(css.includes('.bento-card'), 'zawiera .bento-card');
    assert.ok(css.includes('.command-palette-modal'), 'zawiera .command-palette-modal');
    assert.ok(css.includes('.command-palette-dialog'), 'zawiera .command-palette-dialog');
  });

  it('index.html zawiera kontener dashboard-bento oraz skrypty bento i command palette', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/members/index.html'), 'utf8');
    assert.ok(html.includes('id="dashboard-bento"'), 'zawiera sekcję dashboard-bento');
    assert.ok(html.includes('src="/assets/js/dashboard-bento.js"'), 'dołącza dashboard-bento.js');
    assert.ok(html.includes('src="/assets/js/command-palette.js"'), 'dołącza command-palette.js');
  });
});

describe('FAZA 8: Niezawodność modułów i brak blokującego oczekiwania', () => {
  it('dashboard.js nie blokuje przejścia do prezentacji przez 1800ms await', () => {
    const code = fs.readFileSync(path.join(__dirname, '../public/members/dashboard.js'), 'utf8');
    assert.ok(!code.includes('window.setTimeout(resolve, 1800)'), 'usunięto blokujący timeout 1800ms');
    assert.ok(code.includes('window.location.assign(destination)'), 'nawigacja następuje bezpośrednio');
  });

  it('presentation script.js skanuje dostępne repozytoria przy błędzie 404', () => {
    const code = fs.readFileSync(path.join(__dirname, '../public/members/module/presentation/script.js'), 'utf8');
    assert.ok(code.includes('state.availableRepositories'), 'wykorzystuje listę dostępnych repozytoriów');
    assert.ok(code.includes('fetchPresentation(targetId'), 'próbuje wczytać prezentację z alternatywnego repozytorium');
  });

  it('film script.js obsługuje znaczniki czasu t/start/time', () => {
    const code = fs.readFileSync(path.join(__dirname, '../public/members/module/film/script.js'), 'utf8');
    assert.ok(code.includes("params.get('t')"), 'odczytuje parametr t');
    assert.ok(code.includes("query.set('start'"), 'ustawia start w odtwarzaczu');
  });

  it('pdf style.css posiada dedykowane reguły ciemnego motywu', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/members/module/pdf/style.css'), 'utf8');
    assert.ok(css.includes('html[data-theme="dark"]'), 'zawiera reguły dla ciemnego motywu');
    assert.ok(css.includes('.viewer-stage'), 'stylizuje tło sceny w ciemnym motywie');
  });
});

describe('Poprawka motywu Dashboardu: Fiszki i Powtórki (study.css)', () => {
  it('study.css używa zmiennych CSS dashboardu dla spójności jasnego i ciemnego motywu', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/assets/css/study.css'), 'utf8');
    assert.ok(css.includes('var(--surface'), 'używa var(--surface)');
    assert.ok(css.includes('var(--surface-soft'), 'używa var(--surface-soft)');
    assert.ok(css.includes('var(--ink'), 'używa var(--ink)');
    assert.ok(css.includes('var(--muted'), 'używa var(--muted)');
    assert.ok(css.includes('var(--line'), 'używa var(--line)');
    assert.ok(css.includes('html[data-theme="dark"] .study-dashboard'), 'zawiera ciemny motyw dla study-dashboard');
    assert.ok(css.includes('html[data-theme="dark"] .study-dashboard-card'), 'zawiera ciemny motyw dla kart');
  });
});

