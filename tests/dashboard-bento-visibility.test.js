'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

describe('Dashboard Bento Visibility & Section Controls', () => {
  const bentoJs = fs.readFileSync(path.join(__dirname, '../public/assets/js/dashboard-bento.js'), 'utf8');
  const studyJs = fs.readFileSync(path.join(__dirname, '../public/assets/js/study-dashboard.js'), 'utf8');
  const dashboardJs = fs.readFileSync(path.join(__dirname, '../public/members/dashboard.js'), 'utf8');

  function makeDom(html = '<section id="dashboard-bento"></section>') {
    return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
      url: 'https://example.com/members/',
      runScripts: 'dangerously'
    });
  }

  function runBento(dom) {
    dom.window.eval(bentoJs);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  }

  it('bento renderuje wyłącznie Ostatnia sesja (passa, fiszki SRS i egzamin usunięte z Bento)', () => {
    const dom = makeDom(`
      <section id="dashboard-bento"></section>
      <div class="course-section">
        <article class="resource-card" data-kind="lesson">
          <h3>Wstęp do chemii</h3>
          <a class="card-link" href="/members/module/lesson/?file=wstep.md">Otwórz</a>
        </article>
      </div>
    `);
    runBento(dom);

    const host = dom.window.document.getElementById('dashboard-bento');
    assert.ok(host.querySelector('.bento-card-resume'), 'powinien renderować resume');
    assert.equal(host.querySelector('.bento-card-streak'), null, 'passa powinna być trwale usunięta z bento');
    assert.equal(host.querySelector('.bento-card-flashcards'), null, 'kafelek fiszek bento powinien być usunięty');
    assert.equal(host.querySelector('.bento-card-exam'), null, 'kafelek egzaminu NIE powinien być w DOM');
  });

  it('bento ukrywa kafelek resume gdy konfiguracja go wyłącza i nie generuje zapytań', () => {
    const dom = makeDom('<section id="dashboard-bento"></section>');
    let studyRequestCalled = false;
    dom.window.ChemProgress = {
      studyRequest: async () => {
        studyRequestCalled = true;
        return { decks: [] };
      }
    };
    dom.window.localStorage.setItem('chem.bento-visibility', JSON.stringify({
      resume: false,
      flashcards: false
    }));
    runBento(dom);

    const host = dom.window.document.getElementById('dashboard-bento');
    assert.equal(host.hidden, true, 'bento powinno być całkowicie ukryte');
    assert.equal(host.querySelector('.bento-card-resume'), null, 'resume powinno być ukryte');
    assert.equal(studyRequestCalled, false, 'brak wywołań sieciowych');
  });

  it('study-dashboard nie wywołuje studyRequest gdy flashcards są ukryte', () => {
    const dom = makeDom('<section id="study-dashboard" hidden></section>');
    let studyRequestCalled = false;
    dom.window.ChemProgress = {
      studyRequest: async () => {
        studyRequestCalled = true;
        return { decks: [] };
      }
    };
    dom.window.ChemAuth = {
      ready: Promise.resolve({ authenticated: true, session: { ok: true } }),
      getUser: () => ({ id: 'test-user-123' })
    };
    dom.window.localStorage.setItem('chem.bento-visibility', JSON.stringify({
      resume: true,
      flashcards: false
    }));

    dom.window.eval(studyJs);

    const host = dom.window.document.getElementById('study-dashboard');
    assert.equal(host.hidden, true, 'study-dashboard powinien pozostać ukryty');
    assert.equal(studyRequestCalled, false, 'studyRequest NIE powinien być wywołany');
  });

  it('dashboard.js parsuje i wstrzykuje konfigurację bento oraz posiada szybki zapis', () => {
    assert.ok(dashboardJs.includes('extractBentoConfig'), 'zawiera funkcję extractBentoConfig');
    assert.ok(dashboardJs.includes('injectBentoConfig'), 'zawiera funkcję injectBentoConfig');
    assert.ok(dashboardJs.includes('applyBentoConfig'), 'zawiera funkcję applyBentoConfig');
    assert.ok(dashboardJs.includes('syncAdminBentoControls'), 'zawiera funkcję syncAdminBentoControls');
    assert.ok(dashboardJs.includes('quickSaveBentoConfig'), 'zawiera funkcję quickSaveBentoConfig');
  });
});
