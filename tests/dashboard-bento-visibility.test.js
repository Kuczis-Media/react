'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

describe('Dashboard Bento Visibility & Streak Editor', () => {
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

  it('bento nie renderuje kafelka egzaminu (bento-card-exam usunięty z DOM)', () => {
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
    assert.ok(host.querySelector('.bento-card-streak'), 'powinien renderować streak');
    assert.ok(host.querySelector('.bento-card-flashcards'), 'powinien renderować flashcards');
    assert.equal(host.querySelector('.bento-card-exam'), null, 'kafelek egzaminu NIE powinien być w DOM');
  });

  it('twoja passa zawiera przycisk edycji i formularz do zmiany dni i celu', () => {
    const dom = makeDom('<section id="dashboard-bento"></section>');
    dom.window.localStorage.setItem('chem.study-streak', JSON.stringify({ days: 7, goal: 10, solved: 6 }));
    runBento(dom);

    const host = dom.window.document.getElementById('dashboard-bento');
    const streakVal = host.querySelector('.bento-card-streak .bento-stat-highlight');
    assert.ok(streakVal.textContent.includes('7 dni'), 'wyświetla 7 dni');
    const streakMeta = host.querySelector('.bento-card-streak .bento-card-meta');
    assert.ok(streakMeta.textContent.includes('6 / 10'), 'wyświetla 6 / 10');

    const editBtn = host.querySelector('.bento-streak-edit-btn');
    assert.ok(editBtn, 'zawiera przycisk edycji');
    editBtn.click();

    const form = host.querySelector('.bento-streak-form');
    assert.ok(form, 'po kliknięciu pojawia się formularz edycji');

    // Wypełnij formularz i zapisz
    const inputs = form.querySelectorAll('input');
    inputs[0].value = '12'; // dni
    inputs[1].value = '8';  // cel
    inputs[2].value = '8';  // rozwiązane
    form.dispatchEvent(new dom.window.Event('submit'));

    const saved = JSON.parse(dom.window.localStorage.getItem('chem.study-streak'));
    assert.equal(saved.days, 12);
    assert.equal(saved.goal, 8);
    assert.equal(saved.solved, 8);
  });

  it('bento ukrywa kafelki zgodnie z konfiguracją i nie pobiera danych gdy flashcards są ukryte', () => {
    const dom = makeDom('<section id="dashboard-bento"></section>');
    let studyRequestCalled = false;
    dom.window.ChemProgress = {
      studyRequest: async () => {
        studyRequestCalled = true;
        return { decks: [] };
      }
    };
    // Ukryj wszystko oprócz passy
    dom.window.localStorage.setItem('chem.bento-visibility', JSON.stringify({
      resume: false,
      streak: true,
      flashcards: false
    }));
    runBento(dom);

    const host = dom.window.document.getElementById('dashboard-bento');
    assert.equal(host.querySelector('.bento-card-resume'), null, 'resume powinno być ukryte');
    assert.ok(host.querySelector('.bento-card-streak'), 'streak powinien być widoczny');
    assert.equal(host.querySelector('.bento-card-flashcards'), null, 'flashcards powinny być ukryte');
    assert.equal(studyRequestCalled, false, 'studyRequest nie powinien być wywołany, gdy fiszki są ukryte');
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
      streak: true,
      flashcards: false
    }));

    dom.window.eval(studyJs);

    const host = dom.window.document.getElementById('study-dashboard');
    assert.equal(host.hidden, true, 'study-dashboard powinien pozostać ukryty');
    assert.equal(studyRequestCalled, false, 'studyRequest NIE powinien być wywołany');
  });

  it('dashboard.js parsuje i wstrzykuje konfigurację bento w komentarzu markdown', () => {
    assert.ok(dashboardJs.includes('extractBentoConfig'), 'zawiera funkcję extractBentoConfig');
    assert.ok(dashboardJs.includes('injectBentoConfig'), 'zawiera funkcję injectBentoConfig');
    assert.ok(dashboardJs.includes('applyBentoConfig'), 'zawiera funkcję applyBentoConfig');
    assert.ok(dashboardJs.includes('syncAdminBentoControls'), 'zawiera funkcję syncAdminBentoControls');
  });
});

