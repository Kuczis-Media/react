/**
 * dashboard-bento.js – Bento Grid dla NextMed Dashboard
 * Adaptacyjny kafelek:
 *   1. Wznów naukę (ostatni materiał / slajd)
 *   (Passa oraz kafelek egzaminu zostały usunięte na życzenie użytkownika.
 *    Fiszki SRS znajdują się w osobnym module „Nauka / Fiszki”).
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
    return { resume: true, flashcards: true };
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

    if (cards.length === 0) {
      host.hidden = true;
      return;
    }

    const grid = getNode('div', null, 'bento-grid');
    grid.append(...cards);
    host.appendChild(grid);
    host.hidden = false;
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
