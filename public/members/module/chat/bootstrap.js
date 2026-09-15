(function loadStoredTheme() {
        try {
          var stored = localStorage.getItem('chem.theme');
          if (!stored && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            stored = 'dark';
          }
          document.documentElement.dataset.theme = stored === 'dark' ? 'dark' : 'light';
        } catch (err) {
          document.documentElement.dataset.theme = 'light';
        }
      })();
