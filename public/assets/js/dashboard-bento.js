/**
 * dashboard-bento.js – Bento Grid dla NextMed Dashboard
 * Adaptacyjne kafelki:
 *   1. Wznów naukę (ostatni materiał / slajd)
 *   2. Dzienny cel & Passa 🔥 (z możliwością edycji celu i dni)
 *   3. Fiszki na dziś (oczekujące SRS)
 *   (Kafelek egzaminu bento-card-exam został usunięty na życzenie użytkownika)
 */
(function (root) {
  'use strict';

  const host = document.getElementById('dashboard-bento');
  if (!host) return;

  function getNode(tag, text, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function getVisibilityConfig() {
    if (root.ChemBentoConfig && typeof root.ChemBentoConfig === 'object') {
      return root.ChemBentoConfig;
    }
    try {
      const saved = localStorage.getItem('chem.bento-visibility');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_) {}
    return { resume: true, streak: true, flashcards: true };
  }

  function getStreakData() {
    try {
      const saved = localStorage.getItem('chem.study-streak');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            days: Number.isFinite(parsed.days) ? Math.max(0, parsed.days) : 3,
            goal: Number.isFinite(parsed.goal) ? Math.max(1, parsed.goal) : 5,
            solved: Number.isFinite(parsed.solved) ? Math.max(0, parsed.solved) : 4
          };
        }
      }
    } catch (_) {}
    return { days: 3, goal: 5, solved: 4 };
  }

  function getLastStudied() {
    try {
      const saved = localStorage.getItem('chem.last-studied');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.title && parsed.url) {
          return {
            title: parsed.title,
            type: parsed.type || 'Lekcja',
            url: parsed.url,
            progress: Number.isFinite(parsed.progress) ? Math.max(0, Math.min(100, Math.round(parsed.progress))) : 0,
            isResume: true
          };
        }
      }
    } catch (_) {}

    // Dynamiczny fallback: pierwsza dostępna karta z dashboardu
    const firstCardLink = document.querySelector('.course-section .resource-card .card-link');
    if (firstCardLink) {
      const card = firstCardLink.closest('.resource-card');
      const title = card?.querySelector('h3')?.textContent || 'Rozpocznij naukę';
      const kind = card?.dataset?.kind;
      const type = kind === 'lesson' ? 'Lekcja' : kind === 'presentation' ? 'Prezentacja' : kind === 'quiz' ? 'Quiz' : 'Materiał';
      return {
        title,
        type,
        url: firstCardLink.getAttribute('href') || '/members/',
        progress: 0,
        isResume: false
      };
    }

    return null;
  }

  function renderStreakEditor(card, current) {
    card.replaceChildren();
    const badge = getNode('span', 'Edycja passy', 'bento-badge');
    const form = getNode('form', null, 'bento-streak-form');

    const rowDays = getNode('label', null, 'bento-streak-field');
    rowDays.append(getNode('span', 'Dni passy:'), getNode('input'));
    const inputDays = rowDays.querySelector('input');
    inputDays.type = 'number';
    inputDays.min = '0';
    inputDays.max = '999';
    inputDays.value = current.days;

    const rowGoal = getNode('label', null, 'bento-streak-field');
    rowGoal.append(getNode('span', 'Dzienny cel:'), getNode('input'));
    const inputGoal = rowGoal.querySelector('input');
    inputGoal.type = 'number';
    inputGoal.min = '1';
    inputGoal.max = '100';
    inputGoal.value = current.goal;

    const rowSolved = getNode('label', null, 'bento-streak-field');
    rowSolved.append(getNode('span', 'Rozwiązane:'), getNode('input'));
    const inputSolved = rowSolved.querySelector('input');
    inputSolved.type = 'number';
    inputSolved.min = '0';
    inputSolved.max = '100';
    inputSolved.value = current.solved;

    const actions = getNode('div', null, 'bento-streak-actions');
    const saveBtn = getNode('button', 'Zapisz', 'bento-btn bento-btn-primary');
    saveBtn.type = 'submit';
    const cancelBtn = getNode('button', 'Anuluj', 'bento-btn bento-btn-subtle');
    cancelBtn.type = 'button';

    actions.append(saveBtn, cancelBtn);
    form.append(rowDays, rowGoal, rowSolved, actions);
    card.append(badge, form);

    cancelBtn.addEventListener('click', () => renderBento());
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const newDays = parseInt(inputDays.value, 10);
      const newGoal = parseInt(inputGoal.value, 10);
      const newSolved = parseInt(inputSolved.value, 10);
      try {
        localStorage.setItem('chem.study-streak', JSON.stringify({
          days: Number.isFinite(newDays) ? Math.max(0, newDays) : current.days,
          goal: Number.isFinite(newGoal) ? Math.max(1, newGoal) : current.goal,
          solved: Number.isFinite(newSolved) ? Math.max(0, newSolved) : current.solved
        }));
      } catch (_) {}
      renderBento();
    });
  }

  function renderBento() {
    host.replaceChildren();

    const visibility = getVisibilityConfig();
    const cards = [];

    // 1. Kafelek: Wznów naukę (Ostatnia sesja)
    if (visibility.resume !== false) {
      const resume = getLastStudied();
      if (resume) {
        const resumeCard = getNode('article', null, 'bento-card bento-card-resume');
        const resumeBadge = getNode('span', resume.isResume ? 'Ostatnia sesja' : 'Rozpocznij naukę', 'bento-badge');
        const resumeTitle = getNode('h3', resume.title, 'bento-card-title');
        const resumeMeta = getNode('p', `${resume.type} · ${resume.progress}% ukończenia`, 'bento-card-meta');
        
        const progressBar = getNode('div', null, 'bento-progress-track');
        const progressFill = getNode('div', null, 'bento-progress-fill');
        progressFill.style.width = `${Math.max(5, Math.min(100, resume.progress))}%`;
        progressBar.appendChild(progressFill);

        const resumeBtn = getNode('a', resume.isResume ? 'Wznów naukę ➔' : 'Rozpocznij naukę ➔', 'bento-btn bento-btn-primary');
        resumeBtn.href = resume.url;

        resumeCard.append(resumeBadge, resumeTitle, resumeMeta, progressBar, resumeBtn);
        cards.push(resumeCard);
      }
    }

    // 2. Kafelek: Dzienny cel & Passa 🔥
    if (visibility.streak !== false) {
      const streakData = getStreakData();
      const streakCard = getNode('article', null, 'bento-card bento-card-streak');
      const streakHeader = getNode('div', null, 'bento-streak-header');
      const streakBadge = getNode('span', 'Twoja passa', 'bento-badge');
      const editBtn = getNode('button', 'Edytuj ✎', 'bento-streak-edit-btn');
      editBtn.type = 'button';
      editBtn.setAttribute('aria-label', 'Edytuj passę i cel dzienny');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderStreakEditor(streakCard, streakData);
      });
      streakHeader.append(streakBadge, editBtn);

      const streakVal = getNode('div', `${streakData.days} dni 🔥`, 'bento-stat-highlight');
      const streakSub = getNode('p', `Dzienny cel: ${streakData.solved} / ${streakData.goal} zadań rozwiązanych`, 'bento-card-meta');
      streakCard.append(streakHeader, streakVal, streakSub);
      cards.push(streakCard);
    }

    // 3. Kafelek: Fiszki na dziś (SRS)
    if (visibility.flashcards !== false) {
      const flashCard = getNode('article', null, 'bento-card bento-card-flashcards');
      const flashBadge = getNode('span', 'Fiszki SRS', 'bento-badge');
      const flashVal = getNode('div', '0 do powtórki', 'bento-stat-highlight');
      const flashSub = getNode('p', 'Algorytm SM-2 zaplanował powtórki na dziś', 'bento-card-meta');
      const flashBtn = getNode('a', 'Powtórz fiszki', 'bento-btn bento-btn-subtle');
      flashBtn.href = '/members/module/quiz/?study=due';
      flashCard.append(flashBadge, flashVal, flashSub, flashBtn);
      cards.push(flashCard);
    }

    // Kafelek egzaminu (bento-card-exam) został usunięty na życzenie użytkownika.

    if (cards.length === 0) {
      host.hidden = true;
      return;
    }

    const grid = getNode('div', null, 'bento-grid');
    grid.append(...cards);
    host.appendChild(grid);
    host.hidden = false;

    // Pobieraj dane Netlify TYLKO gdy fiszki są widoczne!
    if (visibility.flashcards !== false) {
      void enrichBentoData();
    }
  }

  async function enrichBentoData() {
    if (!root.ChemProgress?.studyRequest) return;
    try {
      const data = await root.ChemProgress.studyRequest('GET', null, { view: 'study-summary' });
      if (data && Array.isArray(data.decks)) {
        const totalDue = data.decks.reduce((sum, d) => sum + (d.due || 0), 0);
        const flashVal = host.querySelector('.bento-card-flashcards .bento-stat-highlight');
        if (flashVal) flashVal.textContent = `${totalDue} do powtórki`;
      }
    } catch (_) {}
  }

  // Automatyczne nasłuchiwanie na aktualizację ostatniej lekcji
  root.addEventListener('chem-progress-updated', (event) => {
    if (event.detail?.materialTitle && event.detail?.materialUrl) {
      try {
        localStorage.setItem('chem.last-studied', JSON.stringify({
          title: event.detail.materialTitle,
          type: event.detail.materialType || 'Lekcja',
          url: event.detail.materialUrl,
          progress: Number.isFinite(event.detail.progressPercent) ? event.detail.progressPercent : 0
        }));
        renderBento();
      } catch (_) {}
    }
  });

  // Nasłuchiwanie na zmianę konfiguracji widoczności z dashboardu
  root.addEventListener('chem-bento-config-updated', (event) => {
    if (event.detail && typeof event.detail === 'object') {
      renderBento();
    }
  });

  document.addEventListener('DOMContentLoaded', renderBento);
  if (document.readyState !== 'loading') renderBento();
})(window);
