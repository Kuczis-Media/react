(function initializeLandingBuilder() {
  'use strict';

  const API_URL = '/.netlify/functions/admin-landing';
  const ASSET_API_URL = '/.netlify/functions/admin-site-assets';
  const LOCAL_DRAFT_KEY = 'chem.landing.builder.recovery.v3';
  const LEGACY_LOCAL_DRAFT_KEY = 'chem.landing.builder.recovery.v2';
  const REQUEST_TIMEOUT_MS = 30_000;
  const MAX_ASSET_BYTES = 4 * 1024 * 1024;
  const ACCEPTED_ASSETS = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);
  const SECTION_LABELS = { home: 'Start / Hero', about: 'O nas', services: 'Kursy i moduły', pricing: 'Cennik', skills: 'Jak zacząć', contact: 'Kontakt' };
  const appearance = window.NextMedAppearance;
  const PALETTE_LABELS = { landing: 'Landing', dashboard: 'Dashboard', studio: 'Studio', account: 'Konto i płatności' };
  const PALETTE_INPUTS = { primary: 'primaryColor', secondary: 'secondaryColor', brandAccent: 'accentColor', brandBackground: 'backgroundColor', surface: 'surfaceColor', brandText: 'textColor', muted: 'mutedColor' };
  const CONTACT_COLORS = { formBackgroundColor: 'form-background', fieldBackgroundColor: 'field-background', fieldTextColor: 'field-text', fieldBorderColor: 'field-border', fieldFocusColor: 'field-focus', labelTextColor: 'label-text' };
  const ids = ['enabled', 'title', 'subtitle', 'body', 'image', 'image-alt', 'cta-label', 'cta-href', 'background', 'text', 'accent'];
  const elements = Object.fromEntries(ids.map((id) => [camel(id), document.getElementById(`section-${id}`)]));
  Object.assign(elements, {
    builder: document.getElementById('builder'), access: document.getElementById('access-state'), list: document.getElementById('section-list'),
    status: document.getElementById('status'), editorTitle: document.getElementById('editor-title'), preview: document.getElementById('landing-preview'),
    previewPanel: document.querySelector('.preview-panel'), motion: document.getElementById('branding-motion'),
    paletteScope: document.getElementById('palette-scope'), paletteNote: document.getElementById('palette-scope-note'),
    paletteLegend: document.getElementById('palette-legend'), paletteSample: document.getElementById('palette-sample'),
    paletteSampleTitle: document.getElementById('palette-sample-title'), paletteCopy: document.getElementById('palette-copy-landing'), paletteReset: document.getElementById('palette-reset'),
    imagePreview: document.getElementById('image-preview'), logoPreview: document.getElementById('logo-preview'),
    brandName: document.getElementById('branding-name'), tagline: document.getElementById('branding-tagline'),
    primary: document.getElementById('branding-primary'), secondary: document.getElementById('branding-secondary'), brandAccent: document.getElementById('branding-accent'),
    brandBackground: document.getElementById('branding-background'), surface: document.getElementById('branding-surface'), brandText: document.getElementById('branding-text'), muted: document.getElementById('branding-muted'),
    logo: document.getElementById('branding-logo'), logoAlt: document.getElementById('branding-logo-alt'), favicon: document.getElementById('branding-favicon'), siteTitle: document.getElementById('branding-site-title'),
    company: document.getElementById('branding-company'), email: document.getElementById('branding-email'), phone: document.getElementById('branding-phone'), address: document.getElementById('branding-address'), footerText: document.getElementById('branding-footer'),
    siteDescription: document.getElementById('branding-site-description'), copyLogo: document.getElementById('copy-logo-url'),
    save: document.getElementById('save-draft'), publish: document.getElementById('publish'), restore: document.getElementById('restore-published'),
    publishMode: document.getElementById('publication-mode'), publishModeNote: document.getElementById('publication-mode-note'),
    share: document.getElementById('share-page'), exportHtml: document.getElementById('export-html'), exportConfig: document.getElementById('export-config'), importConfig: document.getElementById('import-config'), importFile: document.getElementById('import-file'),
    recover: document.getElementById('recover-local'), assetDialog: document.getElementById('asset-dialog'), assetClose: document.getElementById('asset-close'),
    assetDrop: document.getElementById('asset-drop'), assetFile: document.getElementById('asset-file'), assetFileButton: document.getElementById('asset-file-button'),
    assetSearch: document.getElementById('asset-search'), assetRefresh: document.getElementById('asset-refresh'), assetStatus: document.getElementById('asset-status'),
    assetGrid: document.getElementById('asset-grid'), assetUrl: document.getElementById('asset-url'), assetUseUrl: document.getElementById('asset-use-url')
  });

  let model = null;
  let publishedModel = null;
  let recoveryDraft = null;
  let currentAdminId = '';
  let selectedId = 'home';
  const requestedPalette = new URLSearchParams(location.search).get('palette');
  let selectedPalette = Object.hasOwn(PALETTE_LABELS, requestedPalette) ? requestedPalette : 'landing';
  let draggedId = '';
  let assetTarget = 'section';
  let assetItems = [];
  let assetsLoaded = false;
  let assetBusy = false;
  let dirty = false;
  let serverStorageAvailable = true;
  let staticConfigUrl = '';
  let renderFrame = 0;
  let previewTimer = 0;
  let localSaveTimer = 0;
  let imagePreviewTimer = 0;
  let logoPreviewTimer = 0;
  let imagePreviewRequestId = 0;
  let logoPreviewRequestId = 0;
  let defaultModel = null;
  let previewReady = false;
  const previewToken = crypto.randomUUID();
  let publication = { available: false, sha: null };
  let exportTemplatePromise = null;

  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });

  async function bootstrap() {
    try {
      const authState = await window.ChemAuth.ready;
      const user = window.ChemAuth.getUser?.();
      const roles = user?.app_metadata?.roles || [];
      if (!authState?.authenticated || !authState.session?.ok || !roles.includes('admin')) {
        throw new Error('Edytor strony jest dostępny tylko dla administratora.');
      }
      currentAdminId = String(user.id || '');
      recoveryDraft = readRecovery(currentAdminId);
      const defaultResponse = await fetch('/assets/data/landing-default.json', { cache: 'no-cache' });
      if (!defaultResponse.ok) throw new Error('Nie udało się wczytać szablonu strony. Odśwież Studio.');
      defaultModel = await defaultResponse.json();
      if (!isLocalModel(defaultModel)) throw new Error('Szablon strony jest niepoprawny.');
      let payload = null;
      let bootstrapWarning = '';
      try {
        payload = await requestLanding('GET');
        publication = payload.publication || { available: false, sha: null };
        elements.publishMode.value = publication.mode || 'netlify-blobs';
        serverStorageAvailable = payload.storage?.available !== false;
        staticConfigUrl = safeHttpsUrl(payload.staticConfigUrl);
        model = normalizeLocalModel(payload.draft);
        publishedModel = payload.published ? normalizeLocalModel(payload.published) : null;
        if (!model && staticConfigUrl) {
          const staticModel = await loadStaticPublished(staticConfigUrl);
          if (staticModel) {
            model = staticModel;
            publishedModel = clone(staticModel);
          }
        }
        if (!serverStorageAvailable) {
          bootstrapWarning = 'Szkic zapisujesz na tym urządzeniu. Nadal możesz opublikować stronę w publicznej bibliotece lub pobrać gotową stronę HTML.';
        }
      } catch (error) {
        serverStorageAvailable = false;
        model = recoveryDraft?.model ? normalizeLocalModel(recoveryDraft.model) : createDefaultModel();
        bootstrapWarning = `${error.message} Edytor działa lokalnie — możesz pobrać JSON i nie stracisz zmian.`;
      }
      elements.access.hidden = true;
      elements.builder.hidden = false;
      bindEvents();
      initializeLivePreview();
      renderAll();
      updatePublicationControls();
      const previewUrl = document.getElementById('preview-url');
      if (previewUrl) previewUrl.textContent = location.host || 'twoja-strona.pl';
      syncRecoveryButton();
      elements.restore.hidden = !publishedModel;
      setStatus(bootstrapWarning || (!publication.available ? 'Możesz edytować i pobrać gotową stronę HTML. Aby publikować online, dokończ konfigurację miejsca zapisu w ustawieniach platformy.' : publishedModel
        ? 'Wczytano szkic. Odwiedzający zobaczą zmiany dopiero po publikacji.'
        : 'Wczytano wersję startową. Zapisz szkic lub opublikuj.'), bootstrapWarning ? 'warning' : 'success');
      if (new URLSearchParams(location.search).get('assets') === '1') void openAssetLibrary('logo');
    } catch (error) {
      elements.access.querySelector('h1').textContent = 'Nie udało się otworzyć edytora';
      elements.access.querySelector('p').textContent = error.message;
    }
  }

  function bindEvents() {
    document.getElementById('edit-contact-colors').addEventListener('click', () => {
      selectedId = 'contact';
      selectedPalette = 'landing';
      renderAll();
      renderPreview(true);
      document.getElementById('contact-colors').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    document.getElementById('section-hero-visual').addEventListener('change', (event) => updateSelected('heroVisual', event.target.value));
    bindContactColorEvents();
    const mapping = {
      title: 'title', subtitle: 'subtitle', body: 'body', image: 'imageUrl', imageAlt: 'imageAlt',
      ctaLabel: 'ctaLabel', ctaHref: 'ctaHref', background: 'backgroundColor', text: 'textColor', accent: 'accentColor'
    };
    elements.enabled.addEventListener('change', () => updateSelected('enabled', elements.enabled.checked));
    elements.motion.addEventListener('change', () => updateBranding('motionEnabled', elements.motion.checked));
    Object.entries(mapping).forEach(([elementName, field]) => {
      elements[elementName].addEventListener('input', () => updateSelected(field, elements[elementName].value));
    });
    [elements.image, elements.logo, elements.favicon].forEach((input) => input.addEventListener('blur', () => normalizeUrlInput(input)));
    const brandingMapping = {
      brandName: 'brandName', tagline: 'tagline', logo: 'logoUrl', logoAlt: 'logoAlt', favicon: 'faviconUrl',
      company: 'companyName', email: 'contactEmail', phone: 'contactPhone', address: 'contactAddress', footerText: 'footerText',
      siteTitle: 'siteTitle', siteDescription: 'siteDescription'
    };
    Object.entries(brandingMapping).forEach(([elementName, field]) => {
      elements[elementName].addEventListener('input', () => updateBranding(field, elements[elementName].value));
    });
    Object.entries(PALETTE_INPUTS).forEach(([elementName, field]) => {
      elements[elementName].addEventListener('input', () => updatePalette({ [field]: elements[elementName].value }));
    });
    elements.paletteScope.addEventListener('change', () => {
      selectedPalette = Object.hasOwn(PALETTE_LABELS, elements.paletteScope.value) ? elements.paletteScope.value : 'landing';
      renderPalette();
    });
    elements.paletteCopy.addEventListener('click', () => updatePalette(appearance.paletteFor(model.branding, 'landing')));
    elements.paletteReset.addEventListener('click', () => updatePalette(appearance.paletteFor(defaultModel.branding, 'landing')));
    document.querySelectorAll('[data-clear-color]').forEach((button) => button.addEventListener('click', () => {
      selectedSection()[button.dataset.clearColor] = '';
      renderEditor();
      schedulePreview();
      markDirty('Kolor przywrócony — zapisz szkic albo opublikuj.');
    }));
    document.querySelectorAll('[data-open-assets]').forEach((button) => button.addEventListener('click', () => void openAssetLibrary(button.dataset.openAssets)));
    document.querySelectorAll('[data-preview-size]').forEach((button) => button.addEventListener('click', () => setPreviewSize(button.dataset.previewSize)));
    document.querySelectorAll('[data-palette]').forEach((button) => button.addEventListener('click', () => applyPalette(button.dataset.palette)));
    elements.copyLogo.addEventListener('click', () => void copyText(model.branding?.logoUrl || '', 'Skopiowano URL logo.'));
    elements.share.addEventListener('click', () => void copyText(new URL('/', location.origin).toString(), 'Skopiowano publiczny adres landingu.'));
    elements.exportConfig.addEventListener('click', exportConfiguration);
    elements.exportHtml.addEventListener('click', () => void exportStandalonePage());
    elements.importConfig.addEventListener('click', () => elements.importFile.click());
    elements.importFile.addEventListener('change', () => { void importConfiguration(elements.importFile.files?.[0]); elements.importFile.value = ''; });
    elements.save.addEventListener('click', saveDraft);
    elements.publish.addEventListener('click', publish);
    elements.publishMode.addEventListener('change', updatePublicationControls);
    elements.restore.addEventListener('click', restorePublished);
    elements.recover.addEventListener('click', recoverLocalDraft);
    window.addEventListener('beforeunload', (event) => {
      if (!dirty) return;
      writeRecoveryNow();
      event.preventDefault();
      event.returnValue = '';
    });
    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (!elements.save.disabled) void saveDraft();
    });
    bindAssetDialog();
  }

  function bindAssetDialog() {
    elements.assetUseUrl.addEventListener('click', useAssetUrl);
    elements.assetUrl.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); useAssetUrl(); } });
    elements.assetClose.addEventListener('click', () => elements.assetDialog.close());
    elements.assetDialog.addEventListener('click', (event) => { if (event.target === elements.assetDialog) elements.assetDialog.close(); });
    elements.assetFileButton.addEventListener('click', (event) => { event.stopPropagation(); elements.assetFile.click(); });
    elements.assetDrop.addEventListener('click', (event) => { if (!event.target.closest('button')) elements.assetFile.click(); });
    elements.assetDrop.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      elements.assetFile.click();
    });
    elements.assetFile.addEventListener('change', () => { void uploadAssets(elements.assetFile.files); elements.assetFile.value = ''; });
    ['dragenter', 'dragover'].forEach((name) => elements.assetDrop.addEventListener(name, (event) => {
      event.preventDefault();
      elements.assetDrop.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach((name) => elements.assetDrop.addEventListener(name, (event) => {
      event.preventDefault();
      elements.assetDrop.classList.remove('is-dragging');
    }));
    elements.assetDrop.addEventListener('drop', (event) => void uploadAssets(event.dataTransfer?.files));
    elements.assetDialog.addEventListener('paste', (event) => {
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      void uploadAssets(files);
    });
    elements.assetSearch.addEventListener('input', renderAssets);
    elements.assetRefresh.addEventListener('click', () => void loadAssets(true));
  }

  function selectedSection() {
    return model.sections.find((section) => section.id === selectedId) || model.sections[0];
  }

  function bindContactColorEvents() {
    Object.entries(CONTACT_COLORS).forEach(([key, id]) => {
      const input = document.getElementById(`contact-${id}`);
      const hex = document.getElementById(`contact-${id}-hex`);
      const update = () => {
        // A native color dialog can commit with change only. Never write its
        // result into a newly selected section or the global page palette.
        if (selectedId !== 'contact' || selectedSection()[key] === input.value) return;
        updateSelected(key, input.value);
        hex.value = input.value;
        hex.setCustomValidity('');
        renderContactSample();
      };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
      hex.addEventListener('input', () => {
        const value = hex.value.trim();
        if (!/^#[0-9a-f]{6}$/i.test(value)) { hex.setCustomValidity('Wpisz kolor w formacie #RRGGBB.'); return; }
        hex.setCustomValidity('');
        input.value = value.toLowerCase();
        update();
      });
    });
  }

  function renderContactSample() {
    const sample = document.getElementById('contact-color-sample');
    Object.values(CONTACT_COLORS).forEach((id) => sample.style.setProperty(`--contact-${id}`, document.getElementById(`contact-${id}`).value));
  }

  function updateSelected(field, value) {
    selectedSection()[field] = value;
    renderList();
    if (field === 'imageUrl') {
      scheduleImagePreview();
      schedulePreview(350);
    } else {
      if (field === 'imageAlt') renderImagePreview();
      schedulePreview();
    }
    markDirty('Masz niezapisane zmiany.');
  }

  function updateBranding(field, value) {
    model.branding = model.branding || {};
    const previous = model.branding[field];
    model.branding[field] = value;
    if (field === 'brandName') {
      const next = String(value || '').trim();
      if (!model.branding.logoAlt || model.branding.logoAlt === previous) model.branding.logoAlt = next;
      if (!model.branding.companyName || model.branding.companyName === previous) model.branding.companyName = next;
      if (!model.branding.footerText || String(model.branding.footerText).startsWith(`${previous} ·`)) model.branding.footerText = `${next} · kursy maturalne`;
      if (!model.branding.siteTitle || String(model.branding.siteTitle).startsWith(`${previous} —`)) model.branding.siteTitle = `${next} — kursy maturalne online`;
      elements.logoAlt.value = model.branding.logoAlt;
      elements.company.value = model.branding.companyName;
      elements.footerText.value = model.branding.footerText;
      elements.siteTitle.value = model.branding.siteTitle;
    }
    if (field === 'logoUrl') {
      scheduleBrandingPreview();
      schedulePreview(350);
    } else if (field === 'logoAlt') {
      renderBrandingPreview();
      schedulePreview();
    } else schedulePreview();
    markDirty('Wygląd marki zmieniony — zapisz szkic albo opublikuj.');
  }

  function markDirty(message) {
    dirty = true;
    scheduleRecoveryWrite();
    setStatus(message, '');
  }

  function applyPalette(name) {
    const palettes = {
      nextmed: { primaryColor: '#0f766e', secondaryColor: '#2563eb', accentColor: '#f59e0b', backgroundColor: '#f6f8fc', surfaceColor: '#ffffff', textColor: '#0f172a', mutedColor: '#5f6b7c' },
      ocean: { primaryColor: '#0369a1', secondaryColor: '#0891b2', accentColor: '#f59e0b', backgroundColor: '#f4f9fc', surfaceColor: '#ffffff', textColor: '#0c2133', mutedColor: '#52697a' },
      violet: { primaryColor: '#6d28d9', secondaryColor: '#db2777', accentColor: '#f59e0b', backgroundColor: '#f8f6fc', surfaceColor: '#ffffff', textColor: '#1f1633', mutedColor: '#6b617c' },
      graphite: { primaryColor: '#1f2937', secondaryColor: '#475569', accentColor: '#f97316', backgroundColor: '#f5f6f8', surfaceColor: '#ffffff', textColor: '#111827', mutedColor: '#64748b' }
    };
    if (!palettes[name]) return;
    updatePalette(palettes[name]);
  }

  function updatePalette(changes) {
    appearance.updatePalette(model.branding, selectedPalette, changes);
    renderPalette();
    if (selectedPalette === 'landing') schedulePreview();
    markDirty(`${PALETTE_LABELS[selectedPalette]}: zmieniono tylko kolory tego obszaru. Zapisz szkic albo opublikuj.`);
  }

  function renderPalette() {
    const palette = appearance.paletteFor(model.branding, selectedPalette);
    elements.paletteScope.value = selectedPalette;
    elements.paletteLegend.textContent = `Kolory: ${PALETTE_LABELS[selectedPalette]}`;
    elements.paletteNote.textContent = `Edytujesz: ${PALETTE_LABELS[selectedPalette]}. Zmiany kolorów i gotowe palety nie zmienią pozostałych obszarów.`;
    elements.paletteCopy.hidden = selectedPalette === 'landing';
    elements.paletteSampleTitle.textContent = PALETTE_LABELS[selectedPalette];
    Object.entries(PALETTE_INPUTS).forEach(([elementName, field]) => {
      const value = palette[field] || appearance.DEFAULT_PALETTE[field];
      elements[elementName].value = value;
      elements.paletteSample.style.setProperty(`--sample-${field}`, value);
    });
  }

  function renderAll() {
    renderList();
    renderEditor();
    renderPreview();
  }

  function renderList() {
    if (window.NextMedUI?.render('studio-landing-sections', elements.list, {
      sections: model.sections, selected: selectedId, labels: SECTION_LABELS, onMove: moveTo, onReorder: reorder,
      onSelect(id) { selectedId = id; renderAll(); renderPreview(true); }
    })) return;
    const items = model.sections.map((section, index) => {
      const item = document.createElement('article');
      item.className = `section-item${section.id === selectedId ? ' is-selected' : ''}${section.enabled ? '' : ' is-disabled'}`;
      item.draggable = true;
      item.dataset.sectionId = section.id;
      item.addEventListener('dragstart', (event) => {
        draggedId = section.id;
        event.dataTransfer?.setData('text/plain', section.id);
      });
      item.addEventListener('dragend', () => { draggedId = ''; });
      item.addEventListener('dragover', (event) => event.preventDefault());
      item.addEventListener('drop', (event) => { event.preventDefault(); reorder(draggedId, section.id); });
      const drag = Object.assign(document.createElement('span'), { className: 'section-drag', textContent: '⠿', title: 'Przeciągnij sekcję' });
      const select = Object.assign(document.createElement('button'), { className: 'section-select', type: 'button' });
      select.append(
        Object.assign(document.createElement('strong'), { textContent: SECTION_LABELS[section.id] || section.id }),
        Object.assign(document.createElement('small'), { textContent: section.title || 'Bez tytułu' })
      );
      select.addEventListener('click', () => { selectedId = section.id; renderAll(); renderPreview(true); });
      const controls = document.createElement('span');
      controls.className = 'section-order';
      [['↑', index - 1], ['↓', index + 1]].forEach(([label, target]) => {
        const button = Object.assign(document.createElement('button'), { type: 'button', textContent: label, disabled: target < 0 || target >= model.sections.length });
        button.setAttribute('aria-label', label === '↑' ? 'Przenieś wyżej' : 'Przenieś niżej');
        button.addEventListener('click', () => moveTo(index, target));
        controls.append(button);
      });
      item.append(drag, select, controls);
      return item;
    });
    elements.list.replaceChildren(...items);
  }

  function renderEditor() {
    const section = selectedSection();
    document.getElementById('hero-visual-field').hidden = section.id !== 'home';
    document.getElementById('section-hero-visual').value = ['image', 'biomolecule-banner'].includes(section.heroVisual) ? section.heroVisual : 'biomolecule';
    document.getElementById('contact-colors').hidden = section.id !== 'contact';
    const contactDefaults = { formBackgroundColor: model.branding?.surfaceColor, fieldBackgroundColor: model.branding?.surfaceColor, fieldTextColor: model.branding?.textColor, fieldBorderColor: '#d5dee9', fieldFocusColor: model.branding?.primaryColor, labelTextColor: model.branding?.mutedColor };
    Object.entries(CONTACT_COLORS).forEach(([key, id]) => {
      const value = section[key] || contactDefaults[key] || '#ffffff';
      document.getElementById(`contact-${id}`).value = value;
      const hex = document.getElementById(`contact-${id}-hex`);
      hex.value = value; hex.setCustomValidity('');
    });
    renderContactSample();
    elements.editorTitle.textContent = SECTION_LABELS[section.id] || section.id;
    elements.enabled.checked = section.enabled !== false;
    elements.title.value = section.title || '';
    elements.subtitle.value = section.subtitle || '';
    elements.body.value = section.body || '';
    elements.image.value = section.imageUrl || '';
    elements.imageAlt.value = section.imageAlt || '';
    elements.ctaLabel.value = section.ctaLabel || '';
    elements.ctaHref.value = section.ctaHref || '';
    elements.background.value = section.backgroundColor || '#ffffff';
    elements.text.value = section.textColor || model.branding?.textColor || '#0f172a';
    elements.accent.value = section.accentColor || model.branding?.primaryColor || '#0f766e';
    model.branding = model.branding || {};
    elements.motion.checked = model.branding.motionEnabled !== false;
    elements.brandName.value = model.branding.brandName || '';
    elements.tagline.value = model.branding.tagline || '';
    renderPalette();
    elements.logo.value = model.branding.logoUrl || '';
    elements.logoAlt.value = model.branding.logoAlt || '';
    elements.favicon.value = model.branding.faviconUrl || '';
    elements.company.value = model.branding.companyName || '';
    elements.email.value = model.branding.contactEmail || '';
    elements.phone.value = model.branding.contactPhone || '';
    elements.address.value = model.branding.contactAddress || '';
    elements.footerText.value = model.branding.footerText || '';
    elements.siteTitle.value = model.branding.siteTitle || '';
    elements.siteDescription.value = model.branding.siteDescription || '';
    renderImagePreview();
    renderBrandingPreview();
  }

  function scheduleImagePreview() {
    window.clearTimeout(imagePreviewTimer);
    imagePreviewTimer = window.setTimeout(renderImagePreview, 350);
  }

  function scheduleBrandingPreview() {
    window.clearTimeout(logoPreviewTimer);
    logoPreviewTimer = window.setTimeout(renderBrandingPreview, 350);
  }

  function renderImagePreview() {
    const url = safeImageUrl(selectedSection().imageUrl);
    const image = elements.imagePreview.querySelector('img');
    image.alt = selectedSection().imageAlt || 'Podgląd obrazu sekcji';
    elements.imagePreview.hidden = !url;
    if (!url) {
      imagePreviewRequestId += 1;
      elements.imagePreview.dataset.state = '';
      delete image.dataset.previewUrl;
      image.removeAttribute('src');
      return;
    }
    if (image.dataset.previewUrl === url) return;
    const requestId = ++imagePreviewRequestId;
    elements.imagePreview.dataset.state = '';
    image.decoding = 'async';
    image.fetchPriority = 'low';
    image.onload = () => {
      if (requestId === imagePreviewRequestId) elements.imagePreview.dataset.state = 'ready';
    };
    image.onerror = () => {
      if (requestId === imagePreviewRequestId) elements.imagePreview.dataset.state = 'error';
    };
    image.dataset.previewUrl = url;
    image.src = url;
  }

  function renderBrandingPreview() {
    const url = safeImageUrl(model.branding?.logoUrl);
    const image = elements.logoPreview.querySelector('img');
    elements.logoPreview.hidden = !url;
    image.alt = model.branding?.logoAlt || 'Podgląd logo';
    if (!url) {
      logoPreviewRequestId += 1;
      elements.logoPreview.dataset.state = '';
      delete image.dataset.previewUrl;
      image.removeAttribute('src');
      return;
    }
    if (image.dataset.previewUrl === url) return;
    const requestId = ++logoPreviewRequestId;
    elements.logoPreview.dataset.state = '';
    image.decoding = 'async';
    image.fetchPriority = 'low';
    image.onload = () => {
      if (requestId === logoPreviewRequestId) elements.logoPreview.dataset.state = 'ready';
    };
    image.onerror = () => {
      if (requestId === logoPreviewRequestId) elements.logoPreview.dataset.state = 'error';
    };
    image.dataset.previewUrl = url;
    image.src = url;
  }

  function initializeLivePreview() {
    const frame = elements.preview;
    frame.addEventListener('load', () => {
      previewReady = false;
      frame.contentWindow?.postMessage({ type: 'nextmed:landing-preview:init', token: previewToken }, location.origin);
    });
    window.addEventListener('message', (event) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.token !== previewToken) return;
      if (event.data.type !== 'nextmed:landing-preview:ready') return;
      previewReady = true;
      renderPreview();
    });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(resizePreview).observe(document.getElementById('preview-viewport'));
    }
    frame.src = '/?landing-preview=1';
    resizePreview();
  }

  function renderPreview(scroll = false) {
    if (!previewReady || !model) return;
    elements.preview.contentWindow?.postMessage({
      type: 'nextmed:landing-preview:model', token: previewToken,
      model: normalizeLocalModel(model), selectedId, scroll
    }, location.origin);
  }

  function resizePreview() {
    const viewport = document.getElementById('preview-viewport');
    const available = viewport.clientWidth || 600;
    const width = elements.previewPanel.dataset.previewSize === 'mobile' ? 390 : 1280;
    const scale = Math.min(1, available / width);
    const height = Math.min(780, Math.max(440, window.innerHeight - 240));
    elements.preview.style.width = `${width}px`;
    elements.preview.style.height = `${height / scale}px`;
    elements.preview.style.transform = `scale(${scale})`;
    viewport.style.height = `${height}px`;
  }

  function schedulePreview(delay = 0) {
    window.clearTimeout(previewTimer);
    cancelAnimationFrame(renderFrame);
    const render = () => { renderFrame = requestAnimationFrame(() => renderPreview()); };
    if (delay) previewTimer = window.setTimeout(render, delay);
    else render();
  }

  function setPreviewSize(size) {
    const selected = size === 'mobile' ? 'mobile' : 'desktop';
    elements.previewPanel.dataset.previewSize = selected;
    document.querySelectorAll('[data-preview-size]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.previewSize === selected)));
    resizePreview();
  }

  function safePreviewHref(value) {
    const raw = String(value || '').trim();
    const hash = /^#([A-Za-z][A-Za-z0-9_-]{0,79})$/.exec(raw);
    if (hash) return model.sections.some((section) => section.id === hash[1] && section.enabled !== false) ? raw : '';
    if (/^\/(?!\/)[^\s\\]*$/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.hostname ? url.toString() : '';
    } catch { return ''; }
  }
  function safeImageUrl(value) {
    const raw = normalizeGitHubUrl(value);
    if (/^\/(?!\/)[^\s\\]*$/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.hostname ? url.toString() : '';
    } catch { return ''; }
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' && url.hostname ? url.toString() : '';
    } catch { return ''; }
  }

  function moveTo(from, to) {
    if (from === to || to < 0 || to >= model.sections.length) return;
    const [section] = model.sections.splice(from, 1);
    model.sections.splice(to, 0, section);
    normalizeOrder();
  }

  function reorder(sourceId, targetId) {
    const from = model.sections.findIndex((section) => section.id === sourceId);
    const to = model.sections.findIndex((section) => section.id === targetId);
    if (from >= 0 && to >= 0) moveTo(from, to);
  }

  function normalizeOrder() {
    model.sections.forEach((section, index) => { section.order = index; });
    renderList();
    renderPreview();
    markDirty('Kolejność zmieniona — zapisz szkic albo opublikuj.');
  }

  function normalizeUrlInput(input) {
    const normalized = normalizeGitHubUrl(input.value);
    if (!normalized || normalized === input.value) return;
    input.value = normalized;
    if (input === elements.logo) updateBranding('logoUrl', normalized);
    else if (input === elements.favicon) updateBranding('faviconUrl', normalized);
    else updateSelected('imageUrl', normalized);
    setStatus('Link przygotowano do szybkiego wyświetlania obrazu.', 'success');
  }

  function normalizeGitHubUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.hostname === 'github.com' && parts.length >= 5 && parts[2] === 'blob') {
        const [owner, repository, , ref, ...path] = parts;
        return `https://cdn.jsdelivr.net/gh/${owner}/${repository}@${ref}/${path.join('/')}`;
      }
      if (url.hostname === 'raw.githubusercontent.com' && parts.length >= 4) {
        const [owner, repository, ref, ...path] = parts;
        return `https://cdn.jsdelivr.net/gh/${owner}/${repository}@${ref}/${path.join('/')}`;
      }
    } catch {}
    return raw;
  }

  async function saveDraft() {
    if (!validateModelForSave()) return;
    if (!dirty) {
      setStatus('Nie ma nowych zmian do zapisania.', 'success');
      return;
    }
    if (!serverStorageAvailable) {
      const saved = writeRecoveryNow();
      if (saved) dirty = false;
      setStatus(saved ? 'Szkic zapisany na tym urządzeniu. Możesz też pobrać kopię ustawień.' : 'Przeglądarka nie pozwala zapisać kopii. Pobierz ustawienia, aby zachować zmiany.', saved ? 'success' : 'error');
      return;
    }
    setBusy(true);
    setStatus('Zapisywanie szkicu…', '');
    try {
      const payload = await requestLanding('PUT', { model });
      if (!isLocalModel(payload?.draft)) throw new Error('Nie udało się potwierdzić zapisu szkicu. Zmiany pozostały w edytorze.');
      model = normalizeLocalModel(payload.draft);
      dirty = false;
      clearRecovery();
      renderAll();
      serverStorageAvailable = true;
      setStatus('Szkic zapisano. Odwiedzający zobaczą zmiany dopiero po publikacji.', 'success');
    } catch (error) {
      if (error.code === 'LANDING_STORAGE_UNAVAILABLE') {
        writeRecoveryNow();
        setStatus('Zapis szkicu na platformie nie jest dostępny. Kopia pozostała na tym urządzeniu; możesz opublikować stronę w publicznej bibliotece plików.', 'warning');
      } else setStatus(error.message, 'error');
    }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!validateModelForSave()) return;
    const publishMode = elements.publishMode.value;
    if (!canPublish()) { setStatus('Wybrany magazyn jest niedostępny. Wybierz drugi sposób publikacji lub pobierz HTML.', 'error'); return; }
    if (!window.confirm('Opublikować te zmiany na stronie głównej? Zastąpią obecnie widoczną wersję strony.')) return;
    setBusy(true);
    setStatus('Publikowanie strony…', '');
    try {
      const payload = await requestLanding('POST', { action: 'publish', model, publishMode, expectedPublishedSha: publication.sha ?? null, expectedRouteSha: publication.routeSha ?? null, expectedPublicationVersion: publication.version ?? null });
      if (!isLocalModel(payload?.published) || payload?.publication?.mode !== publishMode
        || (publishMode === 'static-github' ? payload?.delivery?.static !== true || !payload.publication.sha : !payload.publication.version)) throw new Error('Serwer nie potwierdził publikacji. Zachowano bieżące zmiany.');
      publication = { ...publication, ...payload.publication };
      // Draft and publication revisions are independent (the static page may
      // have been published from another device without Blob storage).
      model = normalizeLocalModel(payload.draft || payload.published);
      publishedModel = clone(payload.published);
      elements.restore.hidden = false;
      dirty = false;
      cachePublishedLocally(publishedModel);
      clearRecovery();
      renderAll();
      serverStorageAvailable = payload.storage?.available !== false;
      updatePublicationControls();
      setStatus(`Opublikowano ${new Date(publishedModel.publishedAt).toLocaleString('pl-PL')}. ${publishMode === 'netlify-blobs' ? 'U Ciebie zmiany są widoczne od razu. U innych odwiedzających odświeżenie może potrwać do 10 minut.' : 'Odświeżenie strony u wszystkich odwiedzających może potrwać do 15 minut.'}${payload.draftWarning ? ' Nie udało się zsynchronizować szkicu na serwerze; kolejne zmiany zapiszesz na tym urządzeniu.' : ''}`, payload.draftWarning ? 'warning' : 'success');
    } catch (error) { setStatus(error.message, 'error'); }
    finally { setBusy(false); }
  }

  function restorePublished() {
    if (!publishedModel || !window.confirm('Przywrócić w edytorze ostatnią opublikowaną wersję? Nie zostanie opublikowana ponownie, dopóki nie klikniesz „Opublikuj”.')) return;
    const currentRevision = model.revision;
    model = clone(publishedModel);
    model.revision = currentRevision;
    if (!model.sections.some((section) => section.id === selectedId)) selectedId = model.sections[0]?.id || 'home';
    renderAll();
    markDirty('Przywrócono opublikowaną treść w edytorze. Zapisz lub opublikuj zmianę.');
  }

  function recoverLocalDraft() {
    if (!recoveryDraft?.model || !window.confirm('Odzyskać lokalną kopię niezapisanych zmian? Zastąpi ona bieżący widok edytora.')) return;
    const serverRevision = model.revision;
    const recovered = clone(recoveryDraft.model);
    const revisionChanged = recovered.revision !== serverRevision;
    recovered.revision = serverRevision;
    model = normalizeLocalModel(recovered);
    recoveryDraft = null;
    elements.recover.hidden = true;
    if (!model.sections.some((section) => section.id === selectedId)) selectedId = model.sections[0]?.id || 'home';
    renderAll();
    markDirty(revisionChanged
      ? 'Odzyskano treść lokalnej kopii i przeniesiono ją na aktualną rewizję. Sprawdź podgląd i zapisz.'
      : 'Odzyskano kopię z tego urządzenia. Zapisz szkic, aby zachować ją na serwerze.');
  }

  function scheduleRecoveryWrite() {
    window.clearTimeout(localSaveTimer);
    localSaveTimer = window.setTimeout(writeRecoveryNow, 350);
  }

  function writeRecoveryNow() {
    try {
      localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), userId: currentAdminId, origin: location.origin, model }));
      return true;
    } catch { return false; }
  }

  function readRecovery(userId) {
    for (const key of [LOCAL_DRAFT_KEY, LEGACY_LOCAL_DRAFT_KEY]) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        if (!isLocalModel(parsed?.model)) continue;
        if (!userId || parsed.userId !== userId || parsed.origin !== location.origin) continue;
        return parsed;
      } catch {}
    }
    return null;
  }

  function clearRecovery() {
    window.clearTimeout(localSaveTimer);
    recoveryDraft = null;
    elements.recover.hidden = true;
    try { localStorage.removeItem(LOCAL_DRAFT_KEY); localStorage.removeItem(LEGACY_LOCAL_DRAFT_KEY); } catch {}
  }

  function cachePublishedLocally(published) {
    try {
      const blobMode = publication.mode === 'netlify-blobs';
      const publicState = publication.version ? { mode: publication.mode, version: publication.version, active: blobMode, ...(blobMode ? { model: published } : {}) } : null;
      localStorage.setItem('nextmed.landing.publication.v1', JSON.stringify({ publication: publicState, checkedAt: Date.now() }));
      localStorage.setItem('chem.landing.public.v3', JSON.stringify({ model: published, checkedAt: Date.now(), source: 'builder', configUrl: blobMode ? '/.netlify/functions/landing' : staticConfigUrl, publicationVersion: publication.version || '' }));
      localStorage.removeItem('chem.landing.public.v2');
    } catch {}
  }

  function syncRecoveryButton() {
    elements.recover.hidden = !recoveryDraft;
    if (recoveryDraft?.savedAt) elements.recover.title = `Kopia z ${new Date(recoveryDraft.savedAt).toLocaleString('pl-PL')}`;
  }

  function exportConfiguration() {
    if (!validateModelForSave()) return;
    const artifact = JSON.stringify({ active: true, model: normalizeLocalModel(model) }, null, 2);
    const blob = new Blob([artifact], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    const name = String(model.branding?.brandName || 'landing').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'landing';
    link.href = URL.createObjectURL(blob);
    link.download = `${name}-landing.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    setStatus('Pobrano kopię ustawień JSON. Aby hostować gotową stronę, wybierz „Pobierz stronę HTML”.', 'success');
  }

  async function importConfiguration(file) {
    if (!file) return;
    if (file.size > 128 * 1024) {
      setStatus('Plik konfiguracji jest zbyt duży.', 'error');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const imported = parsed?.model || parsed;
      if (!isLocalModel(imported)) throw new Error('Nie rozpoznano poprawnego modelu landingu.');
      const revision = model.revision;
      model = normalizeLocalModel(imported);
      model.revision = revision;
      selectedId = model.sections.some((section) => section.id === selectedId) ? selectedId : 'home';
      renderAll();
      markDirty('Wczytano konfigurację. Sprawdź podgląd, a następnie zapisz albo opublikuj.');
    } catch (error) {
      setStatus(error.message || 'Nie udało się odczytać pliku JSON.', 'error');
    }
  }

  async function loadStaticPublished(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.active === true && isLocalModel(payload.model) ? normalizeLocalModel(payload.model) : null;
    } catch { return null; }
    finally { window.clearTimeout(timeout); }
  }

  function isLocalModel(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.sections)) return false;
    const ids = new Set();
    for (const section of value.sections) {
      if (!section || typeof section !== 'object' || Array.isArray(section) || !SECTION_LABELS[section.id] || ids.has(section.id)) return false;
      ids.add(section.id);
    }
    return ids.size === Object.keys(SECTION_LABELS).length;
  }

  function normalizeLocalModel(value) {
    const defaults = createDefaultModel();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const sourceBranding = value.branding && typeof value.branding === 'object' && !Array.isArray(value.branding) ? value.branding : {};
    const branding = { ...defaults.branding };
    Object.keys(branding).forEach((key) => {
      if (typeof sourceBranding[key] === 'string') branding[key] = sourceBranding[key].slice(0, key.includes('Description') ? 320 : 1_000);
    });
    branding.motionEnabled = sourceBranding.motionEnabled !== false;
    branding.palettes = appearance.normalizePalettes({ ...branding, palettes: sourceBranding.palettes }, true);
    const sourceSections = new Map((Array.isArray(value.sections) ? value.sections : []).filter((section) => section && typeof section === 'object' && SECTION_LABELS[section.id]).map((section) => [section.id, section]));
    const sections = defaults.sections.map((fallback) => {
      const source = sourceSections.get(fallback.id) || {};
      const section = { ...fallback };
      ['title', 'subtitle', 'body', 'imageUrl', 'imageAlt', 'backgroundColor', 'textColor', 'accentColor', 'ctaLabel', 'ctaHref'].forEach((key) => {
        if (typeof source[key] === 'string') section[key] = source[key];
      });
      if (section.id === 'home') section.heroVisual = ['image', 'biomolecule-banner'].includes(source.heroVisual) ? source.heroVisual : 'biomolecule';
      if (section.id === 'contact') Object.keys(CONTACT_COLORS).forEach((key) => { section[key] = typeof source[key] === 'string' ? source[key] : ''; });
      section.enabled = source.enabled !== false;
      section.order = Number.isSafeInteger(source.order) && source.order >= 0 ? source.order : fallback.order;
      return section;
    }).sort((left, right) => left.order - right.order).map((section, order) => ({ ...section, order }));
    return {
      version: 3,
      revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
      branding,
      sections,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
      updatedBy: null,
      publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null
    };
  }

  function createDefaultModel() {
    const value = clone(defaultModel);
    value.branding.palettes = appearance.normalizePalettes(value.branding);
    return value;
  }

  function validationIssue(value) {
    if (!isLocalModel(value)) return 'Konfiguracja musi zawierać wszystkie sześć sekcji strony.';
    const branding = value.branding || {};
    if (!String(branding.brandName || '').trim()) return 'Wpisz nazwę marki.';
    if (branding.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(branding.contactEmail.trim())) return 'Wpisz poprawny adres e-mail.';
    if (branding.contactPhone && !/^\+?[0-9 ()-]{5,40}$/.test(branding.contactPhone.trim())) return 'Wpisz poprawny numer telefonu.';
    for (const key of ['logoUrl', 'faviconUrl']) {
      if (branding[key] && !safeImageUrl(branding[key])) return 'Logo i favicon wymagają adresu HTTPS albo ścieżki /assets/…';
    }
    for (const key of ['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedColor']) {
      if (branding[key] && !/^#[0-9a-f]{6}$/i.test(branding[key])) return 'Kolory muszą mieć format #RRGGBB.';
    }
    try { appearance.normalizePalettes(branding, true); }
    catch { return 'Kolory obszarów muszą mieć format #RRGGBB. Sprawdź palety dashboardu, studia i konta.'; }
    const active = new Set(value.sections.filter((section) => section.enabled !== false).map((section) => section.id));
    if (!active.size) return 'Pozostaw co najmniej jedną widoczną sekcję.';
    for (const section of value.sections) {
      if (section.id === 'home' && section.heroVisual != null && !['biomolecule', 'biomolecule-banner', 'image'].includes(section.heroVisual)) return 'Start: wybierz model 3D albo obraz.';
      if (section.imageUrl && !safeImageUrl(section.imageUrl)) return `${SECTION_LABELS[section.id]}: obraz wymaga adresu HTTPS albo ścieżki /assets/…`;
      for (const key of ['backgroundColor', 'textColor', 'accentColor', ...(section.id === 'contact' ? Object.keys(CONTACT_COLORS) : [])]) {
        if (section[key] && !/^#[0-9a-f]{6}$/i.test(section[key])) return `${SECTION_LABELS[section.id]}: niepoprawny kolor.`;
      }
      if (section.ctaHref) {
        const hash = /^#([A-Za-z][A-Za-z0-9_-]{0,79})$/.exec(section.ctaHref.trim());
        if (hash && section.enabled !== false && !active.has(hash[1])) return `${SECTION_LABELS[section.id]}: przycisk prowadzi do wyłączonej sekcji. Zmień link lub włącz sekcję.`;
        if (!hash && !/^\/(?!\/)[^\s\\]*$/.test(section.ctaHref) && !safeHttpsUrl(section.ctaHref)) return `${SECTION_LABELS[section.id]}: wpisz poprawny link przycisku.`;
      }
      if (section.enabled !== false && section.ctaLabel && !section.ctaHref) return `${SECTION_LABELS[section.id]}: uzupełnij link przycisku lub usuń jego tekst.`;
    }
    return '';
  }

  function validateModelForSave() {
    const issue = validationIssue(model);
    if (issue) { setStatus(issue, 'error'); return false; }
    model = normalizeLocalModel(model);
    return true;
  }

  function serializeEmbeddedModel(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\\u2028/g, '\\u2028').replace(/\\u2029/g, '\\u2029');
  }

  async function fetchStaticText(path) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, { cache: 'no-cache', signal: controller.signal });
      if (!response.ok) throw new Error('Nie udało się wczytać plików strony. Spróbuj ponownie.');
      return await response.text();
    } finally { window.clearTimeout(timeout); }
  }

  function loadExportTemplate() {
    if (!exportTemplatePromise) {
      exportTemplatePromise = Promise.all([
        fetchStaticText('/index.html'), fetchStaticText('/assets/start_site/style.css'),
        fetchStaticText('/assets/payments/payments.css'), fetchStaticText('/assets/start_site/script.js'),
        fetchStaticText('/assets/js/landing-runtime.js'), fetchStaticText('/assets/js/landing-biomolecule.js')
      ]).catch((error) => { exportTemplatePromise = null; throw error; });
    }
    return exportTemplatePromise;
  }

  async function exportStandalonePage() {
    if (!validateModelForSave()) return;
    setBusy(true);
    setStatus('Przygotowuję samodzielną stronę HTML…', '');
    try {
      const [html, css, paymentCss, motionJs, runtimeJs, moleculeJs] = await loadExportTemplate();
      const page = new DOMParser().parseFromString(html, 'text/html');
      page.querySelectorAll('script, link[rel="stylesheet"], meta[name="nextmed-landing-config"], base').forEach((node) => node.remove());
      page.title = model.branding.siteTitle || model.branding.brandName;
      const description = page.querySelector('meta[name="description"]');
      if (description) description.content = model.branding.siteDescription || '';
      const marker = page.createElement('meta');
      marker.name = 'nextmed-landing-export'; marker.content = '1'; page.head.prepend(marker);
      const origin = page.createElement('meta');
      origin.name = 'nextmed-landing-origin'; origin.content = location.origin; page.head.append(origin);
      for (const source of [css, paymentCss]) {
        const style = page.createElement('style');
        style.textContent = source.replace(/url\(\s*(['"]?)(\/[^)'"\s]+)\1\s*\)/g, (_, quote, path) => `url("${new URL(path, location.origin).href}")`);
        page.head.append(style);
      }
      page.querySelectorAll('[href], [src], [poster]').forEach((node) => {
        for (const attr of ['href', 'src', 'poster']) {
          const value = node.getAttribute(attr);
          if (value?.startsWith('/') && !value.startsWith('//')) node.setAttribute(attr, new URL(value, location.origin).href);
        }
      });
      page.querySelectorAll('form').forEach((form) => {
        const action = page.createElement('a');
        action.className = 'landing-section-cta';
        action.dataset.contactAction = '';
        action.href = model.branding.contactEmail ? `mailto:${model.branding.contactEmail}` : `${location.origin}/#contact`;
        action.textContent = model.branding.contactEmail ? 'Napisz do nas' : 'Przejdź do kontaktu';
        form.replaceWith(action);
      });
      page.querySelectorAll('[data-pricing]').forEach((pricing) => {
        const action = page.createElement('a');
        action.className = 'landing-section-cta';
        action.href = `${location.origin}/#pricing`;
        action.textContent = 'Zobacz aktualną ofertę i ceny ↗';
        pricing.replaceChildren(action);
        pricing.removeAttribute('data-pricing');
      });
      const data = page.createElement('script');
      data.type = 'application/json'; data.id = 'nextmed-landing-model';
      data.textContent = serializeEmbeddedModel(normalizeLocalModel(model));
      page.body.append(data);
      for (const source of [motionJs, runtimeJs, moleculeJs]) {
        const script = page.createElement('script');
        script.textContent = source.replace(/<\/script/gi, '<\\/script');
        page.body.append(script);
      }
      const blob = new Blob(['<!doctype html>\n', page.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = 'index.html';
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setStatus('Pobrano gotową stronę index.html. Możesz ją hostować statycznie; obrazy pozostają pod swoimi adresami, a kurs i płatności otwierają Twoją obecną platformę.', 'success');
    } catch (error) {
      setStatus(error.message || 'Nie udało się przygotować strony HTML.', 'error');
    } finally { setBusy(false); }
  }

  async function openAssetLibrary(target) {
    assetTarget = target === 'logo' ? 'logo' : 'section';
    elements.assetDialog.querySelector('h2').textContent = assetTarget === 'logo' ? 'Wybierz logo strony' : `Wybierz obraz: ${SECTION_LABELS[selectedId] || selectedId}`;
    elements.assetUrl.value = assetTarget === 'logo' ? model.branding?.logoUrl || '' : selectedSection().imageUrl || '';
    if (!elements.assetDialog.open) elements.assetDialog.showModal();
    if (!assetsLoaded) setAssetStatus('Wklej gotowy link lub wybierz „Przeglądaj bibliotekę”.');
    renderAssets();
  }

  function useAssetUrl() {
    const url = safeImageUrl(elements.assetUrl.value);
    if (!url) { setAssetStatus('Wklej poprawny link HTTPS do pliku obrazu.', 'error'); return; }
    chooseAsset({ cdnUrl: url, filename: 'obraz z linku' });
  }

  async function loadAssets(refresh) {
    if (assetBusy) return;
    assetBusy = true;
    setAssetStatus(refresh ? 'Odświeżanie biblioteki obrazów…' : 'Otwieranie biblioteki obrazów…');
    renderAssets(true);
    try {
      const payload = await requestAssets('GET');
      assetItems = Array.isArray(payload.assets) ? payload.assets : [];
      assetsLoaded = true;
      elements.assetRefresh.textContent = '↻ Odśwież bibliotekę';
      const locationLabel = [payload.configuration?.repository, payload.configuration?.directory].filter(Boolean).join('/');
      setAssetStatus(`${assetItems.length} ${assetItems.length === 1 ? 'plik' : 'plików'} · ${locationLabel || 'publiczne repozytorium'}`);
    } catch (error) {
      setAssetStatus(error.message, 'error');
    } finally {
      assetBusy = false;
      renderAssets();
    }
  }

  function renderAssets(loading = false) {
    if (loading) {
      const placeholder = document.createElement('div');
      placeholder.className = 'asset-empty';
      placeholder.textContent = 'Pobieranie plików…';
      elements.assetGrid.replaceChildren(placeholder);
      return;
    }
    const query = elements.assetSearch.value.trim().toLocaleLowerCase('pl');
    const assets = assetItems.filter((asset) => !query || String(asset.filename || '').toLocaleLowerCase('pl').includes(query));
    if (!assets.length) {
      const empty = document.createElement('div');
      empty.className = 'asset-empty';
      empty.textContent = !assetsLoaded ? 'Biblioteka jest opcjonalna. Gotowy link do obrazu możesz dodać powyżej.' : query ? 'Brak plików pasujących do wyszukiwania.' : 'Biblioteka nie ma jeszcze obrazów. Wgraj plik lub użyj gotowego linku.';
      elements.assetGrid.replaceChildren(empty);
      return;
    }
    elements.assetGrid.replaceChildren(...assets.map(assetCard));
  }

  function assetCard(asset) {
    const card = document.createElement('article');
    card.className = 'asset-card';
    const image = document.createElement('img');
    image.src = asset.cdnUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.fetchPriority = 'low';
    const copy = document.createElement('div');
    copy.append(
      Object.assign(document.createElement('strong'), { textContent: asset.filename || 'obraz' }),
      Object.assign(document.createElement('small'), { textContent: `${formatSize(asset.size)} · ${(asset.mimeType || 'image').replace('image/', '').toUpperCase()}` })
    );
    const actions = document.createElement('div');
    actions.className = 'asset-card-actions';
    const choose = Object.assign(document.createElement('button'), { type: 'button', textContent: assetTarget === 'logo' ? 'Ustaw logo' : 'Użyj' });
    choose.addEventListener('click', () => chooseAsset(asset));
    const copyButton = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Kopiuj URL' });
    copyButton.addEventListener('click', () => void copyText(asset.cdnUrl, `Skopiowano URL: ${asset.filename}`));
    actions.append(choose, copyButton);
    card.append(image, copy, actions);
    return card;
  }

  function chooseAsset(asset) {
    if (!asset?.cdnUrl) return;
    if (assetTarget === 'logo') {
      model.branding = model.branding || {};
      model.branding.logoUrl = asset.cdnUrl;
      elements.logo.value = asset.cdnUrl;
      renderBrandingPreview();
    } else {
      selectedSection().imageUrl = asset.cdnUrl;
      elements.image.value = asset.cdnUrl;
      renderImagePreview();
    }
    renderPreview();
    markDirty(`Wybrano ${asset.filename}. Zapisz szkic albo opublikuj.`);
    elements.assetDialog.close();
  }

  async function uploadAssets(rawFiles) {
    const files = Array.from(rawFiles || []);
    if (!files.length || assetBusy) return;
    const invalid = files.find((file) => !ACCEPTED_ASSETS.has(file.type) || file.size <= 0 || file.size > MAX_ASSET_BYTES);
    if (invalid) {
      setAssetStatus(`„${invalid.name}” ma nieobsługiwany format albo przekracza 4 MB.`, 'error');
      return;
    }
    assetBusy = true;
    elements.assetRefresh.disabled = true;
    try {
      let last = null;
      for (let index = 0; index < files.length; index += 1) {
        const original = files[index];
        setAssetStatus(`Optymalizacja ${index + 1}/${files.length}: ${original.name}…`);
        const file = await optimizeAsset(original, assetTarget);
        setAssetStatus(`Zapisywanie ${index + 1}/${files.length}: ${file.name}${file !== original ? ` (${formatSize(original.size)} → ${formatSize(file.size)})` : ''}…`);
        const payload = await requestAssets('PUT', {
          filename: safeFilename(file, assetTarget),
          contentBase64: await fileBase64(file),
          mimeType: file.type
        });
        last = payload.asset;
        if (last) assetItems = [last, ...assetItems.filter((asset) => asset.path !== last.path)];
      }
      assetsLoaded = true;
      renderAssets();
      if (files.length === 1 && last) {
        chooseAsset(last);
        setStatus(`Obraz ${last.filename} dodano do biblioteki i wybrano w edytorze.`, 'success');
      } else {
        setAssetStatus(`Zapisano ${files.length} plików. Wybierz ten, którego chcesz użyć.`);
      }
    } catch (error) {
      setAssetStatus(error.message, 'error');
    } finally {
      assetBusy = false;
      elements.assetRefresh.disabled = false;
    }
  }

  function safeFilename(file, target) {
    const dot = file.name.lastIndexOf('.');
    const rawStem = dot > 0 ? file.name.slice(0, dot) : target === 'logo' ? 'logo' : 'obraz';
    const fallbackExtension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' })[file.type] || '';
    const extension = (dot > 0 ? file.name.slice(dot + 1) : fallbackExtension).toLowerCase().replace('jpeg', 'jpg');
    const stem = rawStem.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 62) || (target === 'logo' ? 'logo' : 'obraz');
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    return `${target === 'logo' && !stem.startsWith('logo') ? `logo-${stem}` : stem}-${suffix}.${extension}`;
  }

  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('Nie udało się odczytać pliku.'));
      reader.readAsDataURL(file);
    });
  }

  async function optimizeAsset(file, target) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size < 280 * 1024 || typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const maximum = target === 'logo' ? 1_000 : 1_920;
      const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', target === 'logo' ? .88 : .82));
      if (!blob || blob.size >= file.size * .94) return file;
      const stem = file.name.replace(/\.[^.]+$/, '') || (target === 'logo' ? 'logo' : 'obraz');
      return new File([blob], `${stem}.webp`, { type: 'image/webp', lastModified: file.lastModified });
    } catch { return file; }
    finally { bitmap?.close?.(); }
  }

  async function copyText(value, successMessage) {
    if (!value) {
      setStatus('Najpierw wybierz albo wklej adres pliku.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      if (elements.assetDialog.open) setAssetStatus(successMessage);
      else setStatus(successMessage, 'success');
    } catch {
      if (elements.assetDialog.open) setAssetStatus('Nie udało się skopiować automatycznie. Użyj menu przeglądarki.', 'error');
      else setStatus('Nie udało się skopiować automatycznie. Zaznacz adres i skopiuj go ręcznie.', 'error');
    }
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  async function requestLanding(method, body) {
    return authenticatedRequest(API_URL, method, body, {
      INVALID_LANDING_MODEL: 'Konfiguracja landingu jest niepełna albo uszkodzona. Wczytaj poprawny JSON lub odśwież edytor.',
      INVALID_LANDING_BRAND_NAME: 'Nazwa marki nie może być pusta.',
      INVALID_LANDING_IMAGE_URL: 'Adres obrazu musi być ścieżką lokalną albo adresem HTTPS.',
      INVALID_LANDING_LINK: 'Link przycisku musi być kotwicą, ścieżką lokalną albo adresem HTTPS.',
      INVALID_LANDING_LINK_TARGET: 'Link CTA prowadzi do wyłączonej lub nieistniejącej sekcji. Włącz sekcję albo zmień link.',
      INVALID_LANDING_COLOR: 'Kolor musi mieć format #RRGGBB.',
      INVALID_LANDING_EMAIL: 'Wpisz poprawny adres e-mail albo zostaw pole puste.',
      INVALID_LANDING_PHONE: 'Numer telefonu może zawierać cyfry, spacje, nawiasy, myślnik i znak +.',
      LANDING_STORAGE_UNAVAILABLE: 'Brakuje NETLIFY_API_TOKEN lub SITE_ID. Zmiany nadal są zachowane lokalnie.',
      SITE_ASSETS_NOT_CONFIGURED: 'Do publikacji statycznej dodaj token publicznych assetów wybranego dostawcy z dostępem do repozytorium ustawień i docelowego JSON.',
      LANDING_DESTINATION_CHANGED: 'Miejsce publikacji zmieniono w panelu admina. Zachowaj kopię JSON, odśwież Studio i sprawdź aktualną ścieżkę.',
      SITE_ASSETS_TOKEN_REJECTED: 'Token repozytorium nie ma dostępu do publicznego repozytorium landingu.',
      SITE_ASSETS_WRITE_REJECTED: 'Token repozytorium wymaga uprawnienia Contents: Read and write.',
      LANDING_STATIC_PUBLISH_FAILED: 'Serwer repozytorium odrzucił publikację statycznego pliku. Spróbuj ponownie.',
      LANDING_CONFLICT: 'Landing został zmieniony w innej karcie. Odśwież stronę, sprawdź treść i spróbuj ponownie.'
    });
  }

  async function requestAssets(method, body) {
    return authenticatedRequest(ASSET_API_URL, method, body, {
      SITE_ASSETS_NOT_CONFIGURED: 'Dodaj w Netlify token publicznych assetów wybranego dostawcy dla publicznego repozytorium assetów.',
      SITE_ASSETS_REPOSITORY_NOT_PUBLIC: 'Repozytorium assetów musi być publiczne, aby jsDelivr mógł je odczytać.',
      SITE_ASSETS_REPOSITORY_NOT_FOUND: 'Nie znaleziono skonfigurowanego repozytorium assetów albo gałęzi.',
      SITE_ASSETS_REF_NOT_FOUND: 'Nie znaleziono gałęzi main w repozytorium Kuczis-Media/logo.',
      SITE_ASSETS_RATE_LIMITED: 'Serwer repozytorium chwilowo ograniczył liczbę zapytań. Odczekaj moment i spróbuj ponownie.',
      SITE_ASSETS_TOKEN_REJECTED: 'Token repozytorium nie ma dostępu do repozytorium assetów.',
      SITE_ASSETS_WRITE_REJECTED: 'Token repozytorium wymaga uprawnienia Contents: Read and write do repozytorium assetów.',
      SITE_ASSET_ALREADY_EXISTS: 'Plik o tej nazwie już istnieje. Spróbuj przesłać go ponownie.',
      SITE_ASSET_INVALID: 'Plik nie jest poprawnym obrazem albo ma niezgodne rozszerzenie.',
      MEDIA_SVG_UNSAFE: 'SVG zawiera aktywną lub zewnętrzną treść i nie może zostać zapisany.',
      CONTENT_FILE_TOO_LARGE: 'Plik przekracza limit 4 MB.'
    });
  }

  async function authenticatedRequest(url, method, body, messages) {
    const token = await window.ChemAuth.getAccessToken({ forceRefresh: method !== 'GET' });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Serwer zbyt długo nie odpowiadał. Spróbuj ponownie.');
      throw new Error('Nie udało się połączyć z serwerem. Sprawdź internet i spróbuj ponownie.');
    } finally {
      window.clearTimeout(timeout);
    }
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const code = payload?.error || '';
      const error = new Error(messages[code] || `Nie udało się wykonać operacji (${response.status}).`);
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function canPublish() {
    return publication.available && (publication.modes ? publication.modes[elements.publishMode.value] === true : elements.publishMode.value === publication.mode);
  }

  function updatePublicationControls() {
    for (const option of elements.publishMode.options) option.disabled = publication.modes ? publication.modes[option.value] !== true : option.value !== publication.mode;
    const blobMode = elements.publishMode.value === 'netlify-blobs';
    elements.publish.disabled = !canPublish();
    elements.publish.title = canPublish() ? '' : 'Magazyn jest niedostępny. Sprawdź konfigurację lub pobierz stronę HTML.';
    elements.publishModeNote.textContent = blobMode
      ? 'Strona jest publikowana bezpośrednio na platformie. Pamięć podręczna ogranicza wywołania serwera; inni odwiedzający mogą zobaczyć zmiany z opóźnieniem do 10 minut. Szkic pozostaje prywatny.'
      : 'Ustawienia i treści strony zostaną zapisane w publicznym pliku. Nie dodawaj do nich haseł ani prywatnych danych. Zmiany pojawią się po odświeżeniu pamięci podręcznej.';
    const publicationLocation = document.getElementById('landing-publication-location');
    const url = blobMode ? new URL('/.netlify/functions/landing', location.origin).href : staticConfigUrl;
    if (publicationLocation) {
      publicationLocation.textContent = blobMode ? 'Ta platforma' : staticConfigUrl || 'Brak połączenia z biblioteką';
      if (url) publicationLocation.href = url; else publicationLocation.removeAttribute('href');
    }
  }

  function setBusy(busy) {
    elements.builder.inert = busy;
    elements.builder.setAttribute('aria-busy', String(busy));
    elements.save.disabled = busy;
    elements.publish.disabled = busy || !canPublish();
    elements.restore.disabled = busy;
    elements.recover.disabled = busy;
    elements.exportHtml.disabled = busy;
    elements.exportConfig.disabled = busy;
    elements.importConfig.disabled = busy;
  }

  function setStatus(message, state) {
    elements.status.textContent = message;
    elements.status.dataset.state = state;
  }

  function setAssetStatus(message, state = '') {
    elements.assetStatus.textContent = message;
    elements.assetStatus.dataset.state = state;
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function camel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
})();
