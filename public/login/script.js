    // UI helpers
    const flash = (msg, type = "") => {
      const box = document.getElementById("flash");
      box.textContent = msg || "";
      box.className = `flash ${type}`;
    };
    const setBusy = (btn, busy, label) => {
      if (!btn) return;
      if (!btn.dataset.label && label) btn.dataset.label = label;
      btn.disabled = !!busy;
      btn.dataset.busy = busy ? "1" : "0";
      if (btn.dataset.label) btn.textContent = busy ? "Przetwarzam..." : btn.dataset.label;
    };

    const MIN_PASSWORD_LENGTH = 10;
    const IDENTITY_OPERATION_TIMEOUT_MS = 20000;
    const withIdentityTimeout = async (factory) => {
      let timeoutId = null;
      try {
        return await Promise.race([
          Promise.resolve().then(factory),
          new Promise((_, reject) => {
            timeoutId = window.setTimeout(
              () => reject(new Error('Przekroczono czas odpowiedzi usługi logowania. Spróbuj ponownie.')),
              IDENTITY_OPERATION_TIMEOUT_MS
            );
          })
        ]);
      } finally {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
      }
    };
    const normalizePersonName = (value) => typeof value === "string"
      ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()
      : "";
    const validatePersonName = (value, label) => {
      const normalized = normalizePersonName(value);
      const validCharacters = /^[\p{L}\p{M}](?:[\p{L}\p{M} .'’\-]*[\p{L}\p{M}.])?$/u;
      if (normalized.length < 2 || normalized.length > 80 || !validCharacters.test(normalized)) {
        throw new Error(`${label} musi mieć od 2 do 80 znaków i może zawierać tylko litery, spacje, apostrof, kropkę lub łącznik.`);
      }
      return normalized;
    };

    const parseHashParams = () => {
      const hash = (location.hash || "").replace(/^#/, "");
      if (!hash) return {};
      return hash.split("&").reduce((acc, piece) => {
        if (!piece) return acc;
        const eqIndex = piece.indexOf("=");
        const rawKey = eqIndex === -1 ? piece : piece.slice(0, eqIndex);
        const rawValue = eqIndex === -1 ? "" : piece.slice(eqIndex + 1);
        let keyDecoded = rawKey || "";
        let valueDecoded = rawValue || "";
        try { keyDecoded = decodeURIComponent(rawKey || ""); } catch {}
        try { valueDecoded = decodeURIComponent(rawValue || ""); } catch {}
        if (!keyDecoded) return acc;
        acc[keyDecoded] = valueDecoded;
        return acc;
      }, {});
    };
    const decodeEmailFromToken = (token) => {
      if (!token || token.indexOf('.') === -1) return "";
      try {
        const base = token.split('.')[1];
        if (!base) return "";
        const normalized = base.replace(/-/g, '+').replace(/_/g, '/');
        const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
        const json = atob(normalized + padding);
        const payload = JSON.parse(json);
        const email = payload.email || payload.email_new || payload.new_email || payload.sub;
        return typeof email === 'string' ? email : "";
      } catch (e) {
        return "";
      }
    };
    const normalizeTokenValue = (value) => {
      if (typeof value !== "string") return "";
      const trimmed = value.trim();
      if (!trimmed) return "";
      const spacesFixed = trimmed.replace(/ /g, "+");
      return spacesFixed.replace(/[\r\n\t\f\v\u00a0]+/gi, "");
    };
    const detectIdentityFlow = () => {
      const hashParams = parseHashParams();
      let searchParams = null;
      try { searchParams = new URLSearchParams(location.search || ""); }
      catch { searchParams = new URLSearchParams(); }

      const recognized = new Set(['invite', 'recovery', 'confirm', 'email-change']);
      const flowParam = (searchParams.get('flow') || '').toLowerCase();
      const typeParam = (searchParams.get('type') || hashParams.type || '').toLowerCase();

      const getTokenFrom = (keys) => {
        for (const key of keys) {
          if (searchParams.has(key)) return searchParams.get(key) || '';
          if (hashParams[key]) return hashParams[key];
        }
        return '';
      };

      const resolveFlow = () => {
        if (recognized.has(flowParam)) return flowParam;
        if (hashParams.invite_token || (hashParams.token && typeParam === 'invite')) return 'invite';
        if (hashParams.recovery_token || typeParam === 'recovery') return 'recovery';
        if (hashParams.email_change_token || typeParam === 'email_change' || typeParam === 'email_change_confirm') return 'email-change';
        if (hashParams.confirmation_token || typeParam === 'confirmation' || typeParam === 'signup') return 'confirm';
        return '';
      };

      const flow = resolveFlow();
      if (!flow) {
        return {
          type: '',
          token: '',
          email: '',
          hashParams,
          searchParams,
          error: searchParams.get('error') || hashParams.error || '',
          errorDescription: searchParams.get('error_description') || hashParams.error_description || ''
        };
      }

      const token = normalizeTokenValue((() => {
        const baseToken = searchParams.get('token');
        if (baseToken) return baseToken;
        if (flow === 'invite') return getTokenFrom(['invite_token', 'token']);
        if (flow === 'recovery') return getTokenFrom(['recovery_token', 'token']);
        if (flow === 'confirm') return getTokenFrom(['confirmation_token', 'token']);
        if (flow === 'email-change') return getTokenFrom(['email_change_token', 'token']);
        return '';
      })());
      const email = (() => {
        const direct = searchParams.get('email') || searchParams.get('new_email');
        if (direct) return direct;
        const hashEmail = hashParams.email || hashParams.new_email || hashParams.email_new;
        if (hashEmail) return hashEmail;
        return decodeEmailFromToken(token);
      })();

      return {
        type: flow,
        token,
        email,
        rawType: typeParam,
        hashParams,
        searchParams,
        error: searchParams.get('error') || hashParams.error || '',
        errorDescription: searchParams.get('error_description') || hashParams.error_description || ''
      };
    };

    // Tokeny z maili Identity są potrzebne tylko w pamięci tej strony. Usuń
    // je z widocznego URL od razu po odczycie, aby nie zostały w historii,
    // referrerze ani logach kolejnych żądań same-origin.
    const rawFlow = detectIdentityFlow();
    window.__CHEM_IDENTITY_FLOW_ACTIVE__ = Boolean(
      rawFlow.type || rawFlow.token || rawFlow.error || rawFlow.errorDescription
    );
    const clearIdentitySecretsFromAddress = () => {
      if (!rawFlow.type && !rawFlow.token && !rawFlow.error && !rawFlow.errorDescription) return;
      try {
        const url = new URL(location.href);
        [
          'confirmation_token',
          'email',
          'email_change_token',
          'email_new',
          'error',
          'error_description',
          'flow',
          'invite_token',
          'new_email',
          'recovery_token',
          'token'
        ].forEach((key) => url.searchParams.delete(key));
        if (rawFlow.type || rawFlow.rawType) url.searchParams.delete('type');
        url.hash = '';
        history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } catch {}
    };
    clearIdentitySecretsFromAddress();

    const LOCAL_SESSION_KEY = "chem_session_id";
    const GOTRUE_STORAGE_KEY = "gotrue.user";
    const saveLocalSessionId = (sid) => { try { if (sid) localStorage.setItem(LOCAL_SESSION_KEY, sid); } catch {} };
    const clearLocalSessionId = () => { try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch {} };
    const clearIdentitySession = async (user) => {
      try {
        const current = user || (window.netlifyIdentity && netlifyIdentity.currentUser());
        if (current && typeof current.logout === 'function') {
          await withIdentityTimeout(() => current.logout());
        }
      } catch {}
      try { localStorage.removeItem(GOTRUE_STORAGE_KEY); } catch {}
      try {
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `nf_jwt=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
      } catch {}
      clearLocalSessionId();
    };
    const refreshIdentity = async () => {
      try { await withIdentityTimeout(() => netlifyIdentity.refresh()); }
      catch {}
    };
    const TIMED_ROLES = new Set(['hour', 'day', 'week', 'month', 'halfyear', 'year']);
    const parseTimestamp = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return 0;
    };
    const timedAccessState = (user) => {
      const meta = user && user.app_metadata ? user.app_metadata.timed_access : undefined;
      const rawRole = meta && typeof meta.role === 'string' ? meta.role.trim() : '';
      const role = rawRole && TIMED_ROLES.has(rawRole) ? rawRole : '';
      return {
        role,
        expiresAt: meta ? parseTimestamp(meta.expires_at) : 0,
        injectedActive: Boolean(meta && meta.injected_active)
      };
    };
    const hasAccess = (user) => {
      if (!user) return false;
      const roles = (user.app_metadata && user.app_metadata.roles) || [];
      if (roles.includes('admin')) return true;
      const timed = timedAccessState(user);
      if (timed.role && roles.includes(timed.role) && timed.expiresAt > Date.now()) return true;
      if (roles.includes('active') && !timed.injectedActive) return true;
      return false;
    };
    const setNFJwtCookie = async (user) => {
      if (!user || !hasAccess(user)) return false;
      try {
        const token = await withIdentityTimeout(() => user.jwt());
        if (!token) return false;
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `nf_jwt=${token}; Path=/; SameSite=Lax${secure}`;
        return true;
      } catch {
        return false;
      }
    };
    let showInactiveAccount = () => {};
    const afterLogin = async (user) => {
      if (!user) return 'missing';
      if (!hasAccess(user)) {
        showInactiveAccount(user);
        return 'inactive';
      }
      try {
        const sid = user.app_metadata && user.app_metadata.session_id;
        if (sid) saveLocalSessionId(sid); else clearLocalSessionId();
      } catch {}
      const cookieReady = await setNFJwtCookie(user);
      if (!cookieReady) {
        flash("Nie udało się utworzyć sesji. Spróbuj zalogować się ponownie.", "error");
        return 'error';
      }
      let selectedPlan = '';
      try { selectedPlan = new URLSearchParams(location.search || '').get('plan') || ''; } catch {}
      if (
        ['week', 'month', 'halfyear', 'year'].includes(selectedPlan) &&
        window.ChemPayments &&
        typeof window.ChemPayments.startCheckout === 'function'
      ) {
        flash("Zalogowano. Otwieram bezpieczną płatność Stripe…", "success");
        await window.ChemPayments.startCheckout(selectedPlan, null, document.querySelector('[data-pricing]'));
        return 'checkout';
      }
      flash("Zalogowano. Przenoszę...", "success");
      const returnTo = window.ChemAuth && typeof window.ChemAuth.getReturnTo === "function"
        ? window.ChemAuth.getReturnTo()
        : "/members/";
      setTimeout(() => { window.location.replace(returnTo); }, 250);
      return 'active';
    };

    document.addEventListener("DOMContentLoaded", () => {
      const tabs = Array.from(document.querySelectorAll(".tab-btn"));
      const tabsContainer = document.querySelector(".tabs");
      const forms = {
        login: document.getElementById("login-form"),
        signup: document.getElementById("signup-form"),
        token: document.getElementById("token-form"),
        inactive: document.getElementById("inactive-account")
      };
      const ensureWidgetHidden = () => {
        const widget = document.getElementById("netlify-identity-widget");
        if (widget) {
          widget.style.display = "none";
          widget.setAttribute("aria-hidden", "true");
        }
        if (window.netlifyIdentity && typeof netlifyIdentity.close === "function") {
          try { netlifyIdentity.close(); } catch {}
        }
      };
      let widgetGuardsBound = false;
      const guardIdentityWidget = () => {
        if (!window.netlifyIdentity || typeof netlifyIdentity.on !== "function") {
          ensureWidgetHidden();
          return false;
        }
        if (!widgetGuardsBound) {
          netlifyIdentity.on("open", ensureWidgetHidden);
          netlifyIdentity.on("init", ensureWidgetHidden);
          netlifyIdentity.on("login", ensureWidgetHidden);
          netlifyIdentity.on("logout", ensureWidgetHidden);
          widgetGuardsBound = true;
        }
        ensureWidgetHidden();
        return true;
      };
      if (!guardIdentityWidget()) {
        const retryGuard = window.setInterval(() => {
          if (guardIdentityWidget()) window.clearInterval(retryGuard);
        }, 150);
        window.setTimeout(() => window.clearInterval(retryGuard), 5000);
      }
      if ("MutationObserver" in window && document.body) {
        const observer = new MutationObserver(() => ensureWidgetHidden());
        observer.observe(document.body, { childList: true, subtree: true });
        window.setTimeout(() => observer.disconnect(), 4000);
      } else {
        window.setTimeout(() => ensureWidgetHidden(), 0);
      }
      const showForm = (target) => {
        const available = Object.keys(forms).filter((key) => forms[key]);
        if (!available.includes(target)) target = "login";
        tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.target === target));
        available.forEach((key) => {
          const form = forms[key];
          if (!form) return;
          if (key === target) form.classList.add("active"); else form.classList.remove("active");
        });
      };
      const toggleTabs = (visible) => {
        if (!tabsContainer) return;
        tabsContainer.style.display = visible ? "" : "none";
      };
      showInactiveAccount = (user) => {
        const metadata = user && user.user_metadata ? user.user_metadata : {};
        const fullName = String(metadata.full_name || metadata.name || '').trim();
        const wrapper = document.querySelector('.wrapper');
        if (wrapper) wrapper.classList.add('is-purchase');
        document.getElementById('inactive-user-name').textContent = fullName || 'Twoje konto';
        document.getElementById('inactive-user-email').textContent = user && user.email ? user.email : '';
        toggleTabs(false);
        showForm('inactive');
        flash('Wybierz pakiet. Płatność zostanie bezpiecznie obsłużona przez Stripe.', 'success');
        if (window.ChemPayments && typeof window.ChemPayments.renderAll === 'function') {
          window.ChemPayments.renderAll(false);
        }
      };

      tabs.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          showForm(btn.dataset.target || "login");
          flash("");
        });
      });
      Array.from(document.querySelectorAll(".to-login")).forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          toggleTabs(true);
          showForm("login");
          flash("");
        });
      });
      Array.from(document.querySelectorAll(".to-signup")).forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          toggleTabs(true);
          showForm("signup");
          flash("");
        });
      });

      const tokenForm = forms.token;
      const tokenTitle = document.getElementById("token-form-title");
      const tokenInfo = document.getElementById("token-form-info");
      const tokenEmailRow = document.getElementById("token-email-row");
      const tokenEmailInput = document.getElementById("token-email");
      const tokenPasswordRow = document.getElementById("token-password-row");
      const tokenPasswordInput = document.getElementById("token-password");
      const tokenPasswordLabel = document.getElementById("token-password-label");
      const tokenSubmit = document.getElementById("token-submit");
      const tokenCancel = document.getElementById("token-cancel");
      if (tokenSubmit) tokenSubmit.dataset.label = tokenSubmit.textContent;
      let tokenFlowState = { type: "", token: "", email: "" };
      let tokenFlowActive = false;

      const showElement = (el, visible) => {
        if (!el) return;
        el.style.display = visible ? "" : "none";
      };
      const resetTokenFlow = () => {
        tokenFlowActive = false;
        tokenFlowState = { type: "", token: "", email: "" };
        if (tokenPasswordInput) tokenPasswordInput.value = "";
        toggleTabs(true);
        showForm("login");
      };
      const configureTokenForm = (cfg) => {
        if (!tokenForm) return;
        tokenFlowActive = true;
        tokenFlowState = { type: cfg.type, token: normalizeTokenValue(cfg.token), email: cfg.email || "" };
        toggleTabs(false);
        showForm("token");
        if (tokenTitle) tokenTitle.textContent = cfg.title || "";
        if (tokenInfo) tokenInfo.textContent = cfg.info || "";
        if (tokenEmailInput) tokenEmailInput.value = cfg.email || "";
        showElement(tokenEmailRow, !!cfg.showEmailRow);
        const showPassword = cfg.showPasswordRow !== false;
        showElement(tokenPasswordRow, showPassword);
        if (tokenPasswordInput) {
          tokenPasswordInput.value = "";
          tokenPasswordInput.required = showPassword && cfg.requirePassword !== false;
          if (showPassword) {
            const minLen = typeof cfg.passwordMinLength === "number" ? cfg.passwordMinLength : MIN_PASSWORD_LENGTH;
            tokenPasswordInput.setAttribute("minlength", String(minLen));
          } else {
            tokenPasswordInput.removeAttribute("minlength");
          }
          if (cfg.passwordAutocomplete) tokenPasswordInput.setAttribute("autocomplete", cfg.passwordAutocomplete);
          else tokenPasswordInput.setAttribute("autocomplete", "new-password");
        }
        if (tokenPasswordLabel) tokenPasswordLabel.textContent = cfg.passwordLabel || "Hasło";
        if (tokenSubmit) {
          const label = cfg.submitLabel || "Zapisz";
          tokenSubmit.textContent = label;
          tokenSubmit.dataset.label = label;
        }
      };

      if (tokenCancel) {
        tokenCancel.addEventListener("click", (e) => {
          e.preventDefault();
          resetTokenFlow();
        });
      }

      if (rawFlow.error || rawFlow.errorDescription) {
        const errText = rawFlow.errorDescription || rawFlow.error;
        if (errText) flash(`Nie udało się przetworzyć linku: ${errText}`, "error");
      }

      const errorMsg = (err) => {
        if (!err) return "";
        const msg = (err && (err.message || err.msg)) ? String(err.message || err.msg) : String(err || "");
        return msg;
      };

      const handleInviteSubmit = async () => {
        if (!tokenSubmit || !tokenPasswordInput) return;
        const password = tokenPasswordInput.value;
        if (!password) return flash("Podaj hasło, aby kontynuować.", "warn");
        if (password.length < MIN_PASSWORD_LENGTH) return flash(`Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`, "warn");
        try {
          setBusy(tokenSubmit, true);
          const inviteToken = normalizeTokenValue(tokenFlowState.token);
          if (!inviteToken) {
            flash("Brakuje tokenu dla tej operacji. Otwórz ponownie link z wiadomości.", "error");
            return;
          }
          const user = await withIdentityTimeout(() => netlifyIdentity.gotrue.acceptInvite(inviteToken, password, true));
          await refreshIdentity();
          const current = netlifyIdentity.currentUser() || user;
          if (current) {
            await afterLogin(current);
            if (!hasAccess(current)) {
              resetTokenFlow();
            }
          } else {
            flash("Zaproszenie aktywowane. Zaloguj się nowym hasłem.", "success");
            resetTokenFlow();
          }
        } catch (err) {
          const msg = errorMsg(err).toLowerCase();
          if (msg.includes("invalid") || msg.includes("token")) {
            flash("Link zaproszeniowy jest nieprawidłowy lub został już użyty.", "error");
          } else if (msg.includes("expired")) {
            flash("Link zaproszeniowy wygasł. Poproś administratora o nowe zaproszenie.", "error");
          } else if (msg.includes('password') && (msg.includes('short') || msg.includes('weak') || msg.includes('min'))) {
            flash(`Hasło jest zbyt krótkie. Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`, "error");
          } else {
            flash("Nie udało się aktywować zaproszenia: " + (errorMsg(err) || "Nieznany błąd"), "error");
          }
        } finally {
          setBusy(tokenSubmit, false);
        }
      };

      const handleRecoverySubmit = async () => {
        if (!tokenSubmit || !tokenPasswordInput) return;
        const password = tokenPasswordInput.value;
        if (!password) return flash("Podaj nowe hasło.", "warn");
        if (password.length < MIN_PASSWORD_LENGTH) return flash(`Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`, "warn");
        try {
          setBusy(tokenSubmit, true);
          const recoveryToken = normalizeTokenValue(tokenFlowState.token);
          if (!recoveryToken) {
            flash("Brakuje tokenu dla tej operacji. Otwórz ponownie link z wiadomości.", "error");
            return;
          }
          const recoveredUser = await withIdentityTimeout(() => netlifyIdentity.gotrue.recover(recoveryToken, true));
          await refreshIdentity();
          let current = netlifyIdentity.currentUser() || recoveredUser;
          if (!current) {
            flash("Zalogowano, ale nie udało się pobrać danych użytkownika. Spróbuj zalogować się ręcznie.", "warn");
            resetTokenFlow();
            return;
          }
          try {
            await withIdentityTimeout(() => current.update({ password }));
            await refreshIdentity();
            current = netlifyIdentity.currentUser() || current;
          } catch (updateErr) {
            const updMsg = errorMsg(updateErr).toLowerCase();
            if (updMsg.includes('password')) {
              flash("Nie udało się ustawić hasła: " + (errorMsg(updateErr) || 'wymagania dotyczące hasła nie zostały spełnione.'), "error");
            } else {
              flash("Nie udało się ustawić hasła: " + (errorMsg(updateErr) || 'Nieznany błąd'), "error");
            }
            return;
          }

          if (current && hasAccess(current)) {
            flash("Hasło zostało zmienione. Logowanie...", "success");
            await afterLogin(current);
          } else if (current && !hasAccess(current)) {
            flash("Hasło zostało zmienione, ale konto nie jest aktywne. Skontaktuj się z administratorem.", "warn");
            await clearIdentitySession(current);
            resetTokenFlow();
          } else {
            flash("Hasło zostało zmienione. Zaloguj się nowym hasłem.", "success");
            resetTokenFlow();
          }
        } catch (err) {
          const msg = errorMsg(err).toLowerCase();
          if (msg.includes('password') && (msg.includes('short') || msg.includes('weak') || msg.includes('min'))) {
            flash(`Nie udało się ustawić hasła: hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`, "error");
          } else {
            flash("Nie udało się ustawić hasła: " + (errorMsg(err) || 'Nieznany błąd'), "error");
          }
        } finally {
          setBusy(tokenSubmit, false);
        }
      };

      if (tokenForm) {
        tokenForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!tokenFlowState.type) return;
          if (!tokenFlowState.token) {
            flash("Brakuje tokenu dla tej operacji. Otwórz ponownie link z wiadomości.", "error");
            return;
          }
          if (tokenFlowState.type === "invite") {
            await handleInviteSubmit();
          } else if (tokenFlowState.type === "recovery") {
            await handleRecoverySubmit();
          }
        });
      }

      const applyDefaultViewFromParams = () => {
        if (tokenFlowActive) return;
        try {
          const params = new URLSearchParams(location.search);
          if (params.has("signup") || params.get("view") === "signup") {
            toggleTabs(true);
            showForm("signup");
          } else {
            toggleTabs(true);
            showForm("login");
          }
          if (params.get('checkout') === 'cancelled') {
            flash('Płatność została anulowana. Nie pobrano opłaty — możesz wybrać pakiet ponownie.', 'warn');
          }
        } catch {
          toggleTabs(true);
          showForm("login");
        }
      };

      const handleConfirmationFlow = async () => {
        if (!rawFlow.token) {
          flash("Brakuje tokenu potwierdzającego. Spróbuj ponownie otworzyć link.", "error");
          return;
        }
        flash("Potwierdzam adres e‑mail...", "");
        try {
          const user = await withIdentityTimeout(() => netlifyIdentity.gotrue.confirm(rawFlow.token, true));
          await refreshIdentity();
          const current = netlifyIdentity.currentUser() || user;
          if (current) {
            await afterLogin(current);
          } else {
            flash("Adres e‑mail został potwierdzony. Możesz się zalogować.", "success");
          }
        } catch (err) {
          flash("Nie udało się potwierdzić adresu: " + (errorMsg(err) || 'Nieznany błąd'), "error");
        }
      };

      const handleEmailChangeFlow = async () => {
        if (!rawFlow.token) {
          flash("Brakuje tokenu potwierdzającego zmianę e‑maila.", "error");
          return;
        }
        flash("Potwierdzam zmianę adresu e‑mail...", "");
        try {
          await withIdentityTimeout(() => netlifyIdentity.gotrue.verify('email_change', rawFlow.token));
          const emailText = rawFlow.email ? `na ${rawFlow.email}` : '';
          flash(`Adres e‑mail został zmieniony ${emailText}. Zaloguj się nowym adresem.`, "success");
          await clearIdentitySession(netlifyIdentity.currentUser());
        } catch (err) {
          flash("Nie udało się potwierdzić zmiany adresu: " + (errorMsg(err) || 'Nieznany błąd'), "error");
        }
      };

      (async () => {
        if (!rawFlow.type) {
          applyDefaultViewFromParams();
          return;
        }
        if ((rawFlow.type === 'invite' || rawFlow.type === 'recovery' || rawFlow.type === 'confirm' || rawFlow.type === 'email-change') && !rawFlow.token) {
          flash("Brakuje tokenu w linku. Poproś o nowy link.", "error");
          applyDefaultViewFromParams();
          return;
        }
        if (rawFlow.type === 'invite') {
          configureTokenForm({
            type: 'invite',
            token: rawFlow.token,
            email: rawFlow.email,
            title: 'Aktywuj konto',
            info: rawFlow.email ? `Link zaproszeniowy dla adresu ${rawFlow.email}. Ustal hasło, aby dokończyć rejestrację.` : 'Link zaproszeniowy. Ustal hasło, aby dokończyć rejestrację.',
            showEmailRow: false,
            showPasswordRow: true,
            passwordLabel: 'Ustaw hasło',
            passwordMinLength: MIN_PASSWORD_LENGTH,
            submitLabel: 'Aktywuj konto',
            passwordAutocomplete: 'new-password'
          });
          return;
        }
        if (rawFlow.type === 'recovery') {
          configureTokenForm({
            type: 'recovery',
            token: rawFlow.token,
            email: rawFlow.email,
            title: 'Reset hasła',
            info: rawFlow.email ? `Ustal nowe hasło dla konta ${rawFlow.email}.` : 'Ustal nowe hasło dla swojego konta.',
            showEmailRow: false,
            showPasswordRow: true,
            passwordLabel: 'Nowe hasło',
            passwordMinLength: MIN_PASSWORD_LENGTH,
            submitLabel: 'Zapisz nowe hasło',
            passwordAutocomplete: 'new-password'
          });
          return;
        }
        toggleTabs(true);
        showForm('login');
        if (rawFlow.type === 'confirm') {
          await handleConfirmationFlow();
        } else if (rawFlow.type === 'email-change') {
          await handleEmailChangeFlow();
        } else {
          applyDefaultViewFromParams();
        }
      })();

      // Logowanie (bez popupa)
      const loginBtn = document.getElementById("login-submit");
      loginBtn.dataset.label = "Zaloguj się";
      document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        flash("");
        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;
        if (!email || !password) return flash("Uzupełnij email i hasło.", "warn");

        try {
          setBusy(loginBtn, true);
          await withIdentityTimeout(() => netlifyIdentity.gotrue.login(email, password, true));
          await refreshIdentity();
          const user = netlifyIdentity.currentUser();
          if (user) {
            await afterLogin(user);
          } else {
            flash("Zalogowano, ale nie udało się pobrać danych użytkownika.", "error");
          }
        } catch (err) {
          const msg = (err && (err.message || err.msg)) ? String(err.message || err.msg) : String(err || '');
          const lower = msg.toLowerCase();
          const isInvalidGrant = lower.includes('invalid_grant') || lower.includes('no user found') || lower.includes('password invalid');
          const isUnconfirmed = lower.includes('confirmation') || lower.includes('confirm') || lower.includes('email not confirmed');
          const isInactive = lower.includes('inactive') || lower.includes('nieaktywne') || lower.includes('unauthorized') || lower.includes('webhook');

          if (isInvalidGrant) {
            flash(`Nie ma takiego użytkownika z e‑mailem "${email}" lub hasło jest nieprawidłowe.`, "error");
          } else if (isInactive) {
            flash("Konto nie ma jeszcze aktywnego pakietu. Po zalogowaniu wybierz dostęp.", "warn");
          } else if (isUnconfirmed) {
            flash("Potwierdź swój adres e‑mail, zanim zalogujesz się do aplikacji.", "warn");
          } else {
            flash("Błąd logowania: " + (msg || 'Nieznany błąd'), "error");
          }
        } finally {
          setBusy(loginBtn, false);
        }
      });

      // Rejestracja
      const signupBtn = document.getElementById("signup-submit");
      if (signupBtn) signupBtn.dataset.label = "Załóż konto";
      document.getElementById("signup-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        flash("");
        let firstName = "";
        let lastName = "";
        try {
          firstName = validatePersonName(document.getElementById("signup-first-name").value, "Imię");
          lastName = validatePersonName(document.getElementById("signup-last-name").value, "Nazwisko");
        } catch (validationError) {
          return flash(validationError.message, "warn");
        }
        const email = document.getElementById("signup-email").value.trim();
        const password = document.getElementById("signup-password").value;
        if (!email || !password) return flash("Podaj email oraz hasło.", "warn");
        if (password.length < MIN_PASSWORD_LENGTH) return flash(`Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`, "warn");
        try {
          setBusy(signupBtn, true);
          const fullName = `${firstName} ${lastName}`;
          await withIdentityTimeout(() => netlifyIdentity.gotrue.signup(email, password, {
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
            name: fullName
          }));

          let autoLoginSucceeded = false;
          try {
            await withIdentityTimeout(() => netlifyIdentity.gotrue.login(email, password, true));
            await refreshIdentity();
            const user = netlifyIdentity.currentUser();
            if (user) {
              const result = await afterLogin(user);
              autoLoginSucceeded = ['active', 'checkout', 'inactive'].includes(result);
            }
          } catch (loginErr) {
            const loginMsg = (loginErr && (loginErr.message || loginErr.msg)) ? String(loginErr.message || loginErr.msg) : '';
            const lowerLoginMsg = loginMsg.toLowerCase();
            if (lowerLoginMsg.includes('confirm')) {
              flash("Konto utworzone. Sprawdź skrzynkę i potwierdź adres e‑mail, aby się zalogować.", "success");
            } else if (lowerLoginMsg.includes('inactive') || lowerLoginMsg.includes('nieaktywne') || lowerLoginMsg.includes('unauthorized') || lowerLoginMsg.includes('webhook')) {
              flash("Konto utworzone. Zaloguj się i wybierz pakiet dostępu.", "warn");
            } else {
              flash("Konto utworzone, ale nie udało się automatycznie zalogować. Spróbuj zalogować się ręcznie.", "warn");
            }
          }

          if (!autoLoginSucceeded) {
            toggleTabs(true);
            showForm("login");
          }
        } catch (err) {
          const msg = (err && (err.message || err.msg)) ? String(err.message || err.msg) : String(err || '');
          const lower = msg.toLowerCase();
          if (lower.includes('signups not allowed')) {
            flash("Rejestracja nowych kont jest wyłączona dla tej instancji.", "error");
          } else if (lower.includes('already been registered') || (lower.includes('email') && lower.includes('registered'))) {
            flash(`Konto z adresem "${email}" już istnieje.`, "error");
          } else if (lower.includes('email') && lower.includes('exists')) {
            flash(`Konto z adresem "${email}" już istnieje.`, "error");
          } else if (lower.includes('weak-password') || lower.includes('short')) {
            flash(`Hasło jest zbyt krótkie. Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`, "error");
          } else {
            flash("Nie udało się utworzyć konta: " + (msg || 'Nieznany błąd'), "error");
          }
        } finally {
          setBusy(signupBtn, false);
        }
      });

      // Reset hasła
      document.getElementById("recover-link").addEventListener("click", async (e) => {
        e.preventDefault();
        const email = document.getElementById("login-email").value.trim();
        if (!email) return flash("Podaj najpierw email w polu logowania.", "warn");
        try {
          await withIdentityTimeout(() => netlifyIdentity.gotrue.requestPasswordRecovery(email));
          flash("Wysłano link do resetu hasła. Sprawdź skrzynkę.", "success");
        } catch (err) {
          flash("Nie udało się wysłać linku: " + (err?.message || err), "error");
        }
      });

      document.getElementById('inactive-logout').addEventListener('click', async () => {
        try {
          if (window.ChemAuth && typeof window.ChemAuth.logout === 'function') {
            await window.ChemAuth.logout({ redirect: false });
          } else {
            await clearIdentitySession(netlifyIdentity.currentUser());
          }
        } catch {}
        window.location.replace('/login/?loggedout=1');
      });

      if (window.ChemAuth && window.ChemAuth.ready && typeof window.ChemAuth.ready.then === 'function') {
        window.ChemAuth.ready.then((state) => {
          const user = typeof window.ChemAuth.getUser === 'function' ? window.ChemAuth.getUser() : null;
          if (state && state.authenticated && user && !hasAccess(user) && !rawFlow.type) {
            showInactiveAccount(user);
          }
        }).catch(() => {});
      }

      if (!tokenFlowActive && !rawFlow.type) {
        applyDefaultViewFromParams();
      }
    });
