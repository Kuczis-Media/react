/* =========================================================
   ChemDisk – script.js (proxy do Netlify Functions, ENV key)
   ========================================================= */

const API = {
  PROXY_URL: '/.netlify/functions/chat',
  STREAM_URL: '/.netlify/functions/chat-stream',
  USAGE_URL: '/.netlify/functions/ai-usage',
  TEMPERATURE: 0.2
};

// Po zakodowaniu Base64 3 MB mieści się w limicie funkcji i żądania Netlify.
const IMAGE_SIZE_LIMIT = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_CHARS = 36_000;
const LESSON_CONTEXT_PREFIX = 'chem.lesson-ai-context.';
const LESSON_CONTEXT_MAX_AGE = 10 * 60 * 1000;
const LESSON_CONTEXT_MAX_CHARS = 12_000;

(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

  const els = {
    modeMaturaBtn: $('#matura-mode-btn'),
    chats: $('.chats-container'),
    promptForm: $('.prompt-form'),
    promptInput: $('.prompt-input'),
    sendBtn: $('#send-prompt-btn'),
    stopBtn: $('#stop-response-btn'),
    themeBtn: $('#theme-toggle-btn'),
    deleteChatsBtn: $('#delete-chats-btn'),
    fileInput: $('#file-input'),
    addFileBtn: $('#add-file-btn'),
    cancelFileBtn: $('#cancel-file-btn'),
    filePreview: $('.file-preview'),
    fileWrapper: $('.file-upload-wrapper'),
    fileName: $('#file-name'),
    suggestions: $('.suggestions'),
    promptStatus: $('#prompt-status'),
    lessonContextStatus: $('#lesson-context-status'),
    ownUsage: $('#ai-own-usage'),
    ownUsageTimezone: $('#ai-own-usage-timezone'),
    ownUsagePeriods: $('#ai-own-usage-periods'),
    promptModeLabel: $('#prompt-mode-label'),
  };

  function prefersDark(){
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch { return false; }
  }
  function loadInitialTheme(){
    try {
      const saved = localStorage.getItem('chem.theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return prefersDark() ? 'dark' : 'light';
  }

  const state = {
    matura: false,
    maturaAvailable: false,
    promptConfig: null,
    promptLabel: '',
    busy: false,
    aborter: null,
    messages: [],
    theme: loadInitialTheme(),
    attachment: null,
    attachmentPreviewUrl: '',
    lessonContext: null,
  };

  // ---------- Init ----------
  function applyTheme(theme, persist = true){
    const next = theme === 'dark' ? 'dark' : 'light';
    state.theme = next;
    if (persist) {
      try { localStorage.setItem('chem.theme', next); } catch {}
    }
    const dark = next === 'dark';
    document.body.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    updateThemeButton();
  }

  function updateThemeButton(){
    if (!els.themeBtn) return;
    const dark = state.theme === 'dark';
    const label = dark ? 'Włącz jasny motyw' : 'Włącz ciemny motyw';
    els.themeBtn.textContent = dark ? 'dark_mode' : 'light_mode';
    els.themeBtn.setAttribute('aria-label', label);
    els.themeBtn.title = label;
  }

  function bootstrap(){
    return bootstrapAuthenticated();
  }

  async function bootstrapAuthenticated(){
    const authState = await window.ChemAuth.ready;
    if (!authState?.authenticated || !authState.session?.ok) return;
    applyTheme(state.theme, false);
    updateMaturaButton();
    initMaturaPrompt();
    initLessonContext();
    loadOwnAiUsage();

    on(els.suggestions, 'click', (e) => {
      const item = e.target.closest('.suggestions-item'); if (!item) return;
      const text = $('.text', item)?.textContent?.trim() || '';
      els.promptInput.value = text;
      resizePromptInput();
      els.promptInput.focus();
    });

    on(els.modeMaturaBtn,'click',()=>{ if(!state.maturaAvailable) return; setMatura(!state.matura); });
    on(els.promptForm,'submit',handlePromptSubmit);
    on(els.stopBtn,'click',stopGeneration);
    on(els.promptInput,'keydown',(e)=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); els.promptForm.requestSubmit(); } });
    on(els.promptInput,'input',resizePromptInput);

    on(els.addFileBtn,'click',()=>els.fileInput.click());
    on(els.fileInput,'change',handleFileSelect);
    on(els.cancelFileBtn,'click',clearAttachment);
    enableDragAndDrop();

    on(els.themeBtn,'click',toggleTheme);
    on(els.deleteChatsBtn,'click',clearChats);
    resizePromptInput();
    if (window.matchMedia?.('(pointer: fine)').matches) els.promptInput?.focus();
  }

  // ---------- Instrukcja z lokalnego pliku ----------
  function initMaturaPrompt(){
    const loader = window.ChemPromptLoader;
    if (!loader) {
      setPromptStatus('error', 'Nie udało się uruchomić konfiguracji instrukcji.');
      disableMaturaMode({ keepStatus: true });
      return;
    }

    let request;
    try {
      request = loader.parsePromptRequest(window.location.href);
    } catch (err) {
      console.error('Nieprawidłowa konfiguracja instrukcji', err);
      setPromptStatus('error', friendlyPromptError(err));
      disableMaturaMode({ keepStatus: true });
      return;
    }

    if (!request) {
      disableMaturaMode();
      return;
    }

    enableMaturaMode(request);
  }

  function friendlyPromptError(error){
    const messages = {
      AMBIGUOUS_QUERY: 'Parametry instrukcji w linku powtarzają się.',
      AMBIGUOUS_SOURCE: 'Link wskazuje więcej niż jeden plik instrukcji.',
      INVALID_FILENAME: 'Nazwa pliku instrukcji w linku jest nieprawidłowa.',
      INVALID_REPOSITORY: 'Repozytorium instrukcji w linku jest nieprawidłowe.',
      INVALID_POINT: 'Numer punktu w linku jest nieprawidłowy.',
      POINT_NOT_ALLOWED: 'Parametr punkt można stosować tylko z plikiem TXT.',
      POINT_REQUIRED: 'Link do pliku TXT nie zawiera numeru punktu.'
    };
    return messages[error?.code] || 'Nie udało się wczytać instrukcji przypisanej do tego zadania.';
  }

  function enableMaturaMode(request){
    state.promptConfig = {
      filename: request.filename,
      repositoryId: request.repositoryId,
      point: request.point
    };
    state.maturaAvailable = true;
    state.promptLabel = request.format === 'txt'
      ? `Instrukcja · punkt ${request.point}`
      : 'Instrukcja zadania';
    if (els.modeMaturaBtn) {
      els.modeMaturaBtn.hidden = false;
    }
    if (els.promptModeLabel) els.promptModeLabel.textContent = state.promptLabel;
    // Link z konfiguracją ma od razu uruchamiać przypisaną instrukcję.
    // Użytkownik nadal może ją świadomie wyłączyć przyciskiem.
    setMatura(true);
  }

  function disableMaturaMode({ keepStatus = false } = {}){
    state.maturaAvailable = false;
    state.promptConfig = null;
    state.promptLabel = '';
    setMatura(false);
    if (els.modeMaturaBtn) {
      els.modeMaturaBtn.hidden = true;
    }
    if (!keepStatus) setPromptStatus('', '');
  }

  function setMatura(onOff){
    const enabled = state.maturaAvailable && !!onOff;
    state.matura = enabled;
    updateMaturaButton();
  }

  function updateMaturaButton(){
    const btn = els.modeMaturaBtn;
    if (!btn) return;
    btn.classList.toggle('selected', state.matura);
    btn.setAttribute('aria-pressed', state.matura ? 'true' : 'false');
    btn.disabled = state.busy || !state.maturaAvailable;
    if (state.maturaAvailable) {
      setPromptStatus(
        state.matura ? 'active' : 'inactive',
        state.matura
          ? `${state.promptLabel} jest aktywna i będzie kierować odpowiedziami AI.`
          : `${state.promptLabel} jest wyłączona.`
      );
    }
  }

  function setPromptStatus(status, message){
    if (!els.promptStatus) return;
    els.promptStatus.hidden = !message;
    els.promptStatus.dataset.state = status;
    els.promptStatus.textContent = message;
  }

  function initLessonContext(){
    let url;
    try {
      url = new URL(window.location.href);
    } catch {
      return;
    }

    const tokens = url.searchParams.getAll('lesson_context');
    url.searchParams.delete('lesson_context');
    try {
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {}

    if (tokens.length !== 1 || !/^[a-z0-9-]{8,80}$/i.test(tokens[0])) return;

    let raw = '';
    try {
      const key = `${LESSON_CONTEXT_PREFIX}${tokens[0]}`;
      raw = localStorage.getItem(key) || '';
      localStorage.removeItem(key);
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const value = JSON.parse(raw);
      const context = String(value?.context || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[\t\f\v ]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const title = String(value?.title || 'bieżący slajd').replace(/\s+/g, ' ').trim().slice(0, 180);
      const createdAt = Number(value?.createdAt);
      if (
        !context
        || context.length > LESSON_CONTEXT_MAX_CHARS
        || !Number.isFinite(createdAt)
        || createdAt > Date.now() + 60_000
        || Date.now() - createdAt > LESSON_CONTEXT_MAX_AGE
      ) return;

      state.lessonContext = { context, title };
      if (els.lessonContextStatus) {
        els.lessonContextStatus.hidden = false;
        els.lessonContextStatus.textContent =
          `AI otrzyma przygotowany kontekst lekcji „${title}” przy pierwszym pytaniu.`;
      }
    } catch {
      // Uszkodzony albo nieaktualny kontekst jest pomijany.
    }
  }

  // ---------- Messages UI ----------
  function messageEl(role, html){ const d=document.createElement('div'); d.className=`message ${role}`; d.innerHTML=html; return d; }
  function addUserMessage(text){ const el=messageEl('user',`<strong>Ty</strong><div class="md">${escapeHtml(text)}</div>`); els.chats.appendChild(el); updateConversationState(); typesetMath(el); scrollToBottom(); return el; }
  function addAssistantMessage(initial = '') { const el = messageEl('assistant', `<strong>Asystent AI</strong><div class="md">${initial || '<span class="typing"><i></i><i></i><i></i><span class="sr-only">Generowanie odpowiedzi…</span></span>'}</div>`); els.chats.appendChild(el); updateConversationState(); typesetMath(el); scrollToBottom(); return el; }
  function updateAssistantMessage(el, html, streaming = false) {
    el.innerHTML = `<strong>Asystent AI</strong><div class="md ${streaming ? 'typing-cursor' : ''}">${html}</div>`;
    if (!streaming) typesetMath(el);
    scrollToBottom();
  }
  function scrollToBottom(){ requestAnimationFrame(()=>window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})); }
  function clearChats(){ if(!state.messages.length && !els.chats?.children.length) return; if(!confirm('Wyczyścić całą rozmowę?')) return; els.chats.innerHTML=''; state.messages=[]; localStorage.removeItem('chem.messages'); updateConversationState(); els.promptInput?.focus(); }
  function updateConversationState(){ document.body.classList.toggle('has-conversation', !!els.chats?.children.length); }

  // ---------- Pliki ----------
  function handleFileSelect(){ const f=els.fileInput.files?.[0]||null; setAttachment(f); }
  function setAttachment(file){
    clearAttachment();

    if(file && ALLOWED_IMAGE_TYPES.has(file.type)){
      if(file.size > IMAGE_SIZE_LIMIT){
        alert('Zdjęcie może mieć maksymalnie 3 MB.');
        if(els.fileInput) els.fileInput.value='';
        els.filePreview.removeAttribute('src');
        return;
      }
      state.attachment = file;
      const url=URL.createObjectURL(file);
      state.attachmentPreviewUrl = url;
      els.filePreview.src=url;
      els.filePreview.alt=`Podgląd pliku ${file.name || 'obrazu'}`;
      if (els.fileName) els.fileName.textContent = file.name || 'Załączony obraz';
      els.fileWrapper?.classList.add('has-file');
      return;
    }

    if(file){
      alert('Możesz załączyć tylko obraz JPG, PNG, WebP lub GIF.');
    }
    els.filePreview.removeAttribute('src');
    els.filePreview.alt='';
    if (els.fileName) els.fileName.textContent='';
    els.fileWrapper?.classList.remove('has-file');
  }
  function clearAttachment(){
    state.attachment=null;
    if (state.attachmentPreviewUrl) URL.revokeObjectURL(state.attachmentPreviewUrl);
    state.attachmentPreviewUrl='';
    if(els.fileInput) els.fileInput.value='';
    els.filePreview.removeAttribute('src');
    els.filePreview.alt='';
    if (els.fileName) els.fileName.textContent='';
    els.fileWrapper?.classList.remove('has-file');
  }

  function enableDragAndDrop(){
    const zone = els.promptForm;
    const over = (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; zone.classList.add('drag-over'); };
    const leave = ()=> zone.classList.remove('drag-over');
    ['dragenter','dragover'].forEach(ev=>on(zone,ev,over));
    ['dragleave','dragend','drop'].forEach(ev=>on(zone,ev,leave));
    on(zone,'drop',async(e)=>{
      e.preventDefault();
      const dt = e.dataTransfer; if(!dt) return;
      if(dt.files && dt.files.length){ setAttachment(dt.files[0]); return; }
      const txt = dt.getData('text/plain');
      if(txt){
        const combined = (els.promptInput.value ? els.promptInput.value + '\n' : '') + txt;
        els.promptInput.value = combined.slice(0, Number(els.promptInput.maxLength) || 12000);
        resizePromptInput();
        els.promptInput.focus();
      }
    });
  }

  // ---------- Theme ----------
  function toggleTheme(){ applyTheme(state.theme === 'dark' ? 'light' : 'dark'); }

  // ---------- Submit ----------
  async function handlePromptSubmit(e){
    e.preventDefault(); if(state.busy) return;
    const text = (els.promptInput.value||'').trim(); if(!text && !state.attachment) return;
    const displayText = text || (state.attachment ? '[Załącznik]' : '');
    const firstMessageContext = state.messages.length === 0 ? state.lessonContext : null;
    const messageContent = firstMessageContext
      ? [
          `Kontekst slajdu „${firstMessageContext.title}”:`,
          firstMessageContext.context,
          '',
          'Pytanie ucznia:',
          displayText
        ].join('\n')
      : displayText;

    addUserMessage(displayText);
    els.promptInput.value='';
    resizePromptInput();
    state.messages.push({ role:'user', content:messageContent });
    if (firstMessageContext) {
      state.lessonContext = null;
      if (els.lessonContextStatus) els.lessonContextStatus.hidden = true;
    }
    trimConversation();

    setBusy(true);
    const assistantEl = addAssistantMessage();

    try{
      const promptConfig = state.matura ? state.promptConfig : null;
      state._currentAssistantEl = assistantEl;
      const resText = await chatGenerate({ messages: state.messages, promptConfig, attachment: state.attachment, assistantEl });
      updateAssistantMessage(assistantEl, renderMarkdown(resText || ''), false);
      state.messages.push({ role:'assistant', content: resText });
      trimConversation();
    }catch(err){
      console.error(err);
      if (err?.name === 'AbortError') {
        updateAssistantMessage(assistantEl, '<em>Generowanie zostało zatrzymane.</em>', false);
      } else {
        updateAssistantMessage(assistantEl, `<span class="response-error">${escapeHtml(err.message||'Wystąpił nieznany błąd.')}</span>`, false);
      }
    }finally{
      state._currentAssistantEl = null;
      setBusy(false); clearAttachment();
    }
  }

  function stopGeneration(){
    if(state.aborter){
      try { state.aborter.abort(); }
      catch {}
      state.aborter = null;
    }
    setBusy(false);
  }
  function trimConversation(){
    const totalChars = () => state.messages.reduce(
      (sum, message) => sum + String(message?.content || '').length,
      0
    );

    // Usuwaj najstarszą pełną turę (user + assistant), zamiast pojedynczej
    // wiadomości. Dzięki temu kontekst nigdy nie zaczyna się od osieroconej
    // odpowiedzi modelu po przekroczeniu limitu.
    while (
      state.messages.length > 1 &&
      (state.messages.length > MAX_HISTORY_MESSAGES || totalChars() > MAX_HISTORY_CHARS)
    ) {
      const removesPair = state.messages[0]?.role === 'user' && state.messages[1]?.role === 'assistant';
      state.messages.splice(0, removesPair ? 2 : 1);
    }

    // Napraw także historię zapisaną przez starszą wersję aplikacji.
    while (state.messages.length > 1 && state.messages[0]?.role !== 'user') {
      state.messages.shift();
    }
  }
  function setBusy(b){
    state.busy = b;
    if (els.stopBtn) els.stopBtn.disabled = !b;
    if (els.sendBtn) els.sendBtn.disabled = b;
    els.promptInput.disabled = b;
    document.body.classList.toggle('is-generating', b);
    updateMaturaButton();
  }

  function resizePromptInput(){
    if (!els.promptInput) return;
    els.promptInput.style.height = 'auto';
    els.promptInput.style.height = `${Math.min(els.promptInput.scrollHeight, 168)}px`;
  }

  // ---------- Backend: streaming / proxy ----------
  async function chatGenerate({ messages, promptConfig=null, attachment=null, assistantEl=null }){
    try {
      return await chatViaStream({ messages, promptConfig, attachment, assistantEl });
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.message === 'Generowanie zatrzymane')) throw err;
      return chatViaProxy({ messages, promptConfig, attachment });
    }
  }

  async function chatViaStream({ messages, promptConfig, attachment, assistantEl }){
    let attachmentInline = null;
    if (attachment && attachment.type?.startsWith('image/')) {
      attachmentInline = { mimeType: attachment.type, data: await fileToBase64(attachment) };
    }
    const payload = { messages, promptConfig, attachmentInline, options: { temperature: API.TEMPERATURE } };
    const auth = window.ChemAuth;
    if (!auth || typeof auth.getAccessToken !== 'function') throw new Error('Sesja wygasła. Zaloguj się ponownie.');
    let token = '';
    try { token = await auth.getAccessToken({ forceRefresh: true }); }
    catch { throw new Error('Nie udało się odświeżyć sesji. Zaloguj się ponownie.'); }

    const ac = new AbortController(); setAborter(ac);
    let res;
    try {
      res = await fetch(API.STREAM_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: ac.signal
      });
    } catch (err) {
      setAborter(null);
      throw err;
    }

    if (!res.ok) {
      setAborter(null);
      let responseBody = null;
      try { responseBody = await res.json(); } catch {}
      const detail = typeof responseBody?.error === 'string' ? responseBody.error : '';
      throw new Error(detail || `Błąd strumienia (${res.status})`);
    }

    if (!res.body || typeof res.body.getReader !== 'function') {
      setAborter(null);
      throw new Error('STREAM_UNSUPPORTED');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let chunk;
          try { chunk = JSON.parse(raw); } catch { continue; }
          if (chunk.done) break;
          if (typeof chunk.token === 'string') {
            fullText += chunk.token;
            if (assistantEl) {
              updateAssistantMessage(assistantEl, renderMarkdown(fullText), true);
            }
          }
        }
      }
    } finally {
      setAborter(null);
      try { reader.cancel(); } catch {}
    }

    loadOwnAiUsage();
    return fullText;
  }

  async function loadOwnAiUsage(){
    if (!els.ownUsage) return;
    const auth = window.ChemAuth;
    if (!auth || typeof auth.getAccessToken !== 'function') return;
    try {
      const token = await auth.getAccessToken();
      const response = await fetch(API.USAGE_URL, {
        method: 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (!payload?.visible) {
        els.ownUsage.hidden = true;
        return;
      }
      const policyLabel = payload.mode === 'disabled'
        ? 'AI wyłączone dla konta'
        : payload.mode === 'unlimited' ? 'bez limitów per użytkownik' : payload.mode === 'custom' ? 'własny limit' : 'limit domyślny';
      els.ownUsageTimezone.textContent = `${policyLabel} · okresy wg ${payload.timezone}`;
      const labels = { hour: 'Ta godzina', day: 'Dzisiaj', week: 'Ten tydzień', month: 'Ten miesiąc', lifetime: 'Łącznie' };
      const cards = ['hour', 'day', 'week', 'month', 'lifetime'].map((period) => {
        const data = payload.periods?.[period];
        const card = document.createElement('article');
        const requests = Number(data?.usage?.requests || 0);
        const tokens = Number(data?.usage?.totalTokens || 0);
        const requestLimit = data?.limits?.requests;
        const tokenLimit = data?.limits?.totalTokens;
        const remaining = (used, limit) => limit == null ? 'bez limitu' : `${Math.max(0, Number(limit) - used).toLocaleString('pl-PL')} pozostało`;
        card.dataset.warning = data?.warning?.level || 'ok';
        card.append(
          Object.assign(document.createElement('strong'), { textContent: labels[period] }),
          Object.assign(document.createElement('span'), { textContent: `${requests.toLocaleString('pl-PL')} żądań · ${remaining(requests, requestLimit)}` }),
          Object.assign(document.createElement('span'), { textContent: `${tokens.toLocaleString('pl-PL')} tokenów · ${remaining(tokens, tokenLimit)}` })
        );
        return card;
      });
      els.ownUsagePeriods.replaceChildren(...cards);
      els.ownUsage.hidden = false;
    } catch {
      // Informacja o limitach jest pomocnicza; awaria podglądu nie blokuje UI.
    }
  }

  async function chatViaProxy({ messages, promptConfig, attachment }){
    // Zamieniamy ewentualny obrazek na Base64 i wysyłamy JSON-em
    let attachmentInline = null;
    if (attachment && attachment.type?.startsWith('image/')) {
      attachmentInline = { mimeType: attachment.type, data: await fileToBase64(attachment) };
    }

    const payload = {
      messages,
      promptConfig,
      attachmentInline,
      options: { temperature: API.TEMPERATURE }
    };

    const auth = window.ChemAuth;
    if (!auth || typeof auth.getAccessToken !== 'function') {
      throw new Error('Sesja wygasła. Zaloguj się ponownie.');
    }

    let token = '';
    try {
      // identity-login rotates session_id. A forced JWT refresh ensures the
      // function receives that current identifier instead of a cached token.
      token = await auth.getAccessToken({ forceRefresh: true });
    } catch {
      throw new Error('Nie udało się odświeżyć sesji. Zaloguj się ponownie.');
    }

    const ac=new AbortController(); setAborter(ac);
    let res;
    try {
      res=await fetch(API.PROXY_URL,{
        method:'POST',
        headers:{
          'content-type':'application/json',
          'authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload),
        signal: ac.signal
      });
    } finally {
      setAborter(null);
    }

    let responseBody = null;
    try { responseBody = await res.json(); } catch {}
    const detail = typeof responseBody?.error === 'string' ? responseBody.error : '';

    if (res.status === 401) {
      const authErrors = {
        AUTH_REQUIRED: 'Serwer nie otrzymał danych zalogowanego użytkownika. Odśwież stronę i spróbuj ponownie.',
        AUTH_EXPIRED: 'Sesja wygasła. Zaloguj się ponownie.',
        SESSION_REPLACED: 'Ta sesja została zastąpiona logowaniem na innym urządzeniu.'
      };
      throw new Error(authErrors[detail] || 'Sesja wygasła. Zaloguj się ponownie.');
    }
    if (res.status === 403) {
      if (detail === 'AI_DISABLED_FOR_USER') throw new Error('Administrator wyłączył dostęp do AI dla tego konta.');
      if (detail === 'AI_PERMISSION_DENIED') throw new Error('Klucz API nie ma uprawnień do wybranego modelu lub projektu.');
      throw new Error('To konto nie ma dostępu do czatu.');
    }
    if (res.status === 429) {
      if (detail === 'AI_RATE_LIMITED') throw new Error('Dostawca AI chwilowo ogranicza ruch. Spróbuj ponownie później.');
      if (detail === 'AI_CONCURRENT_REQUEST_LIMIT_REACHED') throw new Error('Trwa zbyt wiele równoległych wywołań AI. Spróbuj ponownie za chwilę.');
      if (/^AI_(?:GLOBAL|USER|MODULE|PROVIDER|CONFIG)_[A-Z]+(?:_(?:INPUT_TOKEN|OUTPUT_TOKEN|TOKEN|COST))?_LIMIT_REACHED$/.test(detail)) {
        const period = { HOUR: 'godzinowy', DAY: 'dzienny', WEEK: 'tygodniowy', MONTH: 'miesięczny', LIFETIME: 'łączny' };
        const match = detail.match(/^AI_[A-Z]+_([A-Z]+)/);
        throw new Error(`Wykorzystano ${period[match?.[1]] || ''} limit AI na platformie. Spróbuj po rozpoczęciu nowego okresu albo skontaktuj się z administratorem.`);
      }
      throw new Error('Przekroczono limit AI na platformie. Spróbuj ponownie później.');
    }
    if(!res.ok) {
      const friendlyErrors = {
        CONVERSATION_TOO_LONG: 'Historia rozmowy jest zbyt długa. Wyczyść czat i spróbuj ponownie.',
        EMPTY_MODEL_RESPONSE: 'Asystent nie zwrócił odpowiedzi. Spróbuj ponownie.',
        INVALID_ATTACHMENT: 'Załącznik jest nieprawidłowy albo zbyt duży.',
        INVALID_MESSAGES: 'Nie udało się przygotować historii rozmowy.',
        MESSAGE_TOO_LONG: 'Wiadomość jest zbyt długa.',
        MODEL_UNAVAILABLE: 'Asystent jest chwilowo niedostępny. Spróbuj ponownie za moment.',
        SERVICE_UNAVAILABLE: 'Czat nie jest jeszcze skonfigurowany przez administratora.',
        SESSION_CHECK_UNAVAILABLE: 'Nie udało się potwierdzić bieżącej sesji. Spróbuj ponownie za chwilę.',
        CLIENT_SYSTEM_NOT_ALLOWED: 'Konfiguracja rozmowy została odrzucona.',
        INVALID_PROMPT_CONFIG: 'Link zawiera nieprawidłową konfigurację instrukcji.',
        PROMPT_FILE_INVALID: 'Plik instrukcji ma nieprawidłowy format.',
        PROMPT_FILE_TOO_LARGE: 'Plik instrukcji jest zbyt duży.',
        PROMPT_NOT_FOUND: 'Nie znaleziono instrukcji przypisanej do tego linku.',
        PROMPT_POINT_NOT_FOUND: 'Nie znaleziono wskazanego punktu instrukcji.',
        PROMPT_TOO_LONG: 'Wybrana instrukcja jest zbyt długa.',
        PROMPT_UNAVAILABLE: 'Instrukcja jest chwilowo niedostępna.',
        AI_NOT_CONFIGURED: 'Czat nie jest jeszcze skonfigurowany przez administratora.',
        AI_INVALID_KEY: 'Klucz dostawcy AI wymaga poprawienia przez administratora.',
        AI_MODEL_UNAVAILABLE: 'Wybrany model AI jest niedostępny.',
        AI_CREDIT_BALANCE_EXHAUSTED: 'Na koncie OpenAI zabrakło środków API. Administrator musi uzupełnić saldo.',
        AI_ORGANIZATION_SPEND_LIMIT_REACHED: 'Organizacja OpenAI osiągnęła ustawiony limit wydatków.',
        AI_PROJECT_SPEND_LIMIT_REACHED: 'Projekt OpenAI osiągnął ustawiony limit wydatków.',
        AI_ORGANIZATION_USAGE_LIMIT_REACHED: 'Organizacja OpenAI osiągnęła przyznany limit użycia API.',
        AI_QUOTA_EXHAUSTED: 'Konto OpenAI nie ma dostępnego limitu API. Administrator musi sprawdzić saldo i limity.',
        AI_PERMISSION_DENIED: 'Klucz API nie ma uprawnień do wybranego modelu lub projektu.',
        AI_PROVIDER_TIMEOUT: 'Dostawca AI nie odpowiedział w ciągu 45 sekund. Spróbuj ponownie.',
        AI_PROVIDER_ERROR: 'Dostawca AI jest chwilowo niedostępny.',
        AI_LIMIT_STORAGE_UNAVAILABLE: 'Serwer nie może teraz bezpiecznie sprawdzić limitu AI. Spróbuj ponownie później.',
        AI_USAGE_RECORD_FAILED: 'Nie udało się bezpiecznie zapisać użycia AI. Spróbuj ponownie.'
      };
      throw new Error(friendlyErrors[detail] || `Błąd usługi (${res.status})`);
    }
    loadOwnAiUsage();
    return typeof responseBody?.text === 'string' ? responseBody.text : '';
  }

  // ---------- Markdown (lekki) ----------
  function renderMarkdown(src) {
    const text = String(src || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    let out = '';
    let inPre = false, inUl = false, inOl = false;
    const closeLists = () => { if (inUl) { out += '</ul>'; inUl = false; } if (inOl) { out += '</ol>'; inOl = false; } };

    for (let raw of lines) {
      const line = raw;
      if (/^```/.test(line)) { if (inPre) { out += '</code></pre>'; inPre = false; } else { closeLists(); out += '<pre class="code"><code>'; inPre = true; } continue; }
      if (inPre) { out += escapeHtml(line) + '\n'; continue; }
      if (/^#{1,6}\s+/.test(line)) { closeLists(); const level=(line.match(/^#{1,6}/)||['#'])[0].length; const content=line.replace(/^#{1,6}\s+/, ''); out += `<h${level}>${mdInline(content)}</h${level}>`; continue; }
      if (/^\s*\d+[.)]\s+/.test(line)) { if (!inOl) { closeLists(); out += '<ol>'; inOl = true; } const content = line.replace(/^\s*\d+[.)]\s+/, ''); out += `<li>${mdInline(content)}</li>`; continue; }
      if (/^\s*[-*•]\s+/.test(line)) { if (!inUl) { closeLists(); out += '<ul>'; inUl = true; } const content = line.replace(/^\s*[-*•]\s+/, ''); out += `<li>${mdInline(content)}</li>`; continue; }
      if (/^\s*$/.test(line)) { closeLists(); continue; }
      closeLists(); out += `<p>${mdInline(line)}</p>`;
    }
    closeLists();
    return out;
  }
  function mdInline(source) {
    const tokens = [];
    const keep = (html) => `CHEMDISKTOKEN${tokens.push(html) - 1}END`;
    let s = String(source || '');

    // Najpierw odkładamy kod i linki do bezpiecznych tokenów; dzięki temu
    // linkifikacja nie modyfikuje wygenerowanych atrybutów HTML.
    s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
    s = s.replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s<>"']+)\)/gi,
      (_, label, url) => keep(makeSafeLink(label, url)));
    s = s.replace(/\bhttps?:\/\/[^\s<>"']+/gi, (rawUrl) => {
      const match = rawUrl.match(/^(.*?)([.,!?;:]*)$/);
      const url = match ? match[1] : rawUrl;
      const suffix = match ? match[2] : '';
      return keep(makeSafeLink(url, url)) + suffix;
    });

    s = escapeHtml(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return s.replace(/CHEMDISKTOKEN(\d+)END/g, (_, index) => tokens[Number(index)] || '');
  }

  function makeSafeLink(label, rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } catch {
      return escapeHtml(label);
    }
  }

  // ---------- Utils ----------
  function escapeHtml(s){
    return String(s)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }
  function setAborter(ac){ state.aborter = ac; }
  function fileToBase64(file){
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>{ const dataUrl=String(r.result||''); const base64=dataUrl.split(',')[1]||''; res(base64); };
      r.onerror=rej; r.readAsDataURL(file);
    });
  }

  function typesetMath(root){
    try{
      const mj = window.MathJax;
      if(!mj || typeof mj.typesetPromise !== 'function') return;
      const nodes = root ? (Array.isArray(root) ? root : [root]) : undefined;
      mj.typesetPromise(nodes).catch((err)=>{
        console.error('MathJax typeset failed', err);
      });
    }catch(err){
      console.error('MathJax error', err);
    }
  }

  window.addEventListener('chem-mathjax-ready', () => typesetMath(els.chats));

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
