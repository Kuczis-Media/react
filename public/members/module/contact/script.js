// Autouzupełnianie e‑maila zalogowanego użytkownika Netlify Identity
      document.addEventListener('DOMContentLoaded', async () => {
        const authState = await window.ChemAuth.ready;
        if (!authState?.authenticated || !authState.session?.ok) return;
        const ID = window.netlifyIdentity;
        const emailInput = document.getElementById('email');
        const nameInput = document.getElementById('name');
        if (!ID || !emailInput) return;

        const applyEmail = () => {
          try {
            const user = ID.currentUser();
            if (!user) return;
            const email = user.email || (user.user_metadata && user.user_metadata.email);
            const metadata = user.user_metadata || {};
            const fullName = metadata.full_name || metadata.name || '';
            if (email) {
              emailInput.value = email;
              emailInput.readOnly = true; // zablokuj zmianę e‑maila konta
            }
            if (nameInput && !nameInput.value && fullName) nameInput.value = fullName;
          } catch {}
        };

        try { ID.on('init', applyEmail); } catch {}
        try { ID.on('login', applyEmail); } catch {}
        setTimeout(applyEmail, 200);
      });

// Wysyłka formularza z dynamicznym przekierowaniem po sukcesie
      document.addEventListener('DOMContentLoaded', async () => {
        const authState = await window.ChemAuth.ready;
        if (!authState?.authenticated || !authState.session?.ok) return;
        const form = document.forms['members-contact'];
        if (!form) return;

        const internalField = form.querySelector('input[name="internal_note"]');
        const banner = document.getElementById('internal-banner');
        const bannerText = document.getElementById('internal-banner-text');
        const defaultInternal = internalField ? internalField.value : '';
        const STORAGE_KEY = 'chem.contact.internal';

        const storeInternal = (note) => {
          try {
            if (note) sessionStorage.setItem(STORAGE_KEY, note);
            else sessionStorage.removeItem(STORAGE_KEY);
          } catch {}
        };
        const loadStoredInternal = () => {
          try { return sessionStorage.getItem(STORAGE_KEY) || ''; }
          catch { return ''; }
        };

        const applyInternalParam = () => {
          let note = defaultInternal;
          let highlight = false;
          let fromParam = false;
          try {
            const params = new URLSearchParams(location.search);
            const raw = (params.get('internal') || '').trim();
            if (raw) {
              note = raw.slice(0, 240);
              highlight = true;
              fromParam = true;
            }
            if (fromParam) {
              params.delete('internal');
              const qs = params.toString();
              const next = qs ? `?${qs}` : location.pathname;
              history.replaceState({}, '', next);
            }
          } catch {}
          if (!fromParam) {
            const stored = loadStoredInternal();
            if (stored) {
              note = stored;
              highlight = true;
            }
          }
          if (internalField) internalField.value = note;
          if (banner && bannerText) {
            if (highlight) {
              bannerText.textContent = note;
              banner.hidden = false;
            } else {
              banner.hidden = true;
              bannerText.textContent = '';
            }
          }
          if (note !== defaultInternal) storeInternal(note);
          else storeInternal('');
        };

        applyInternalParam();

        const encode = (data) => {
          return Object.keys(data)
            .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
            .join('&');
        };

        form.addEventListener('submit', async (e) => {
          const submit = form.querySelector('input[type="submit"]');
          try {
            e.preventDefault();
            if (submit) { submit.disabled = true; submit.value = 'Wysyłanie…'; }
            const formData = new FormData(form);
            // Upewnij się, że form-name jest w payload
            if (!formData.get('form-name')) {
              formData.set('form-name', form.getAttribute('name') || 'members-contact');
            }
            // Zbuduj payload x-www-form-urlencoded (Netlify wymaga takiego formatu)
            const payload = {};
            for (const [key, value] of formData.entries()) {
              payload[key] = value;
            }

            const res = await fetch('/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: encode(payload),
            });

            if (!res.ok) throw new Error('Form submit failed');

            // Wybierz przekierowanie na podstawie stanu Identity
            const ID = window.netlifyIdentity;
            let target = '/login/';
            try { if (ID && ID.currentUser()) target = '/members/'; } catch {}
            storeInternal('');
            location.replace(target);
          } catch (err) {
            // W razie błędu, zrób normalny submit jako fallback
            storeInternal('');
            if (submit) { submit.disabled = false; submit.value = 'Wyślij'; }
            form.submit();
          }
        }, { passive: false });
      });
