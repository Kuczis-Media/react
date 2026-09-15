/**
 * dashboard-bento.js – Bento Grid dla NextMed Dashboard
 * Prompt 8.1: Adaptacyjne kafelki:
 *   1. Wznów naukę (ostatni materiał / slajd)
 *   2. Dzienny cel & Passa 🔥
 *   3. Fiszki na dziś (oczekujące SRS)
 *   4. Najbliższy egzamin / sprawdzian
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

  function getStreakDays() {
    try {
      const saved = localStorage.getItem('chem.study-streak');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Number.isFinite(parsed.days)) return parsed.days;
      }
    } catch (_) {}
    return 3; // Przyjazna wartość startowa
  }

  function getLastStudied() {
    try {
      const saved = localStorage.getItem('chem.last-studied');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.title && parsed.url) return parsed;
      }
    } catch (_) {}
    return {
      title: 'Wstęp do chemii organicznej',
      type: 'Lekcja',
      url: '/members/module/lesson/?repo=default&file=lekcja-1.json',
      progress: 65
    };
  }

  function renderBento() {
    host.replaceChildren();

    const grid = getNode('div', null, 'bento-grid');

    // 1. Kafelek: Wznów naukę (duży kafelek 2x1)
    const resume = getLastStudied();
    const resumeCard = getNode('article', null, 'bento-card bento-card-resume');
    const resumeBadge = getNode('span', 'Ostatnia sesja', 'bento-badge');
    const resumeTitle = getNode('h3', resume.title, 'bento-card-title');
    const resumeMeta = getNode('p', `${resume.type} · Ukończono w ${resume.progress}%`, 'bento-card-meta');
    
    const progressBar = getNode('div', null, 'bento-progress-track');
    const progressFill = getNode('div', null, 'bento-progress-fill');
    progressFill.style.width = `${Math.max(5, Math.min(100, resume.progress))}%`;
    progressBar.appendChild(progressFill);

    const resumeBtn = getNode('a', 'Wznów naukę ➔', 'bento-btn bento-btn-primary');
    resumeBtn.href = resume.url;

    resumeCard.append(resumeBadge, resumeTitle, resumeMeta, progressBar, resumeBtn);

    // 2. Kafelek: Dzienny cel & Passa 🔥
    const streakDays = getStreakDays();
    const streakCard = getNode('article', null, 'bento-card bento-card-streak');
    const streakBadge = getNode('span', 'Twoja passa', 'bento-badge');
    const streakVal = getNode('div', `${streakDays} dni 🔥`, 'bento-stat-highlight');
    const streakSub = getNode('p', 'Dzienny cel: 4 / 5 zadań rozwiązanych', 'bento-card-meta');
    streakCard.append(streakBadge, streakVal, streakSub);

    // 3. Kafelek: Fiszki na dziś (SRS)
    const flashCard = getNode('article', null, 'bento-card bento-card-flashcards');
    const flashBadge = getNode('span', 'Fiszki SRS', 'bento-badge');
    const flashVal = getNode('div', '12 do powtórki', 'bento-stat-highlight');
    const flashSub = getNode('p', 'Algorytm SM-2 zaplanował powtórki na dziś', 'bento-card-meta');
    const flashBtn = getNode('a', 'Powtórz fiszki', 'bento-btn bento-btn-subtle');
    flashBtn.href = '/members/module/quiz/?study=due';
    flashCard.append(flashBadge, flashVal, flashSub, flashBtn);

    // 4. Kafelek: Najbliższy egzamin
    const examCard = getNode('article', null, 'bento-card bento-card-exam');
    const examBadge = getNode('span', 'Egzamin', 'bento-badge');
    const examTitle = getNode('h3', 'Próbna Matura Maj 2026', 'bento-card-title');
    const examMeta = getNode('p', 'Zegar 180 min · 40 pytań CKE', 'bento-card-meta');
    const examBtn = getNode('a', 'Przejdź do egzaminu', 'bento-btn bento-btn-subtle');
    examBtn.href = '/members/module/exam/?exam=matura-maj-2026';
    examCard.append(examBadge, examTitle, examMeta, examBtn);

    grid.append(resumeCard, streakCard, flashCard, examCard);
    host.appendChild(grid);
    host.hidden = false;
    void enrichBentoData();
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
          progress: event.detail.progressPercent || 50
        }));
        renderBento();
      } catch (_) {}
    }
  });

  document.addEventListener('DOMContentLoaded', renderBento);
  if (document.readyState !== 'loading') renderBento();
})(window);
