'use strict';

// A self-contained, local-only copy of the Studio generator. No production
// credentials, .env files, linked Netlify projects or APIs are read here.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, 'public', file), 'utf8');

function renderSetupPage(nonce) {
  const base = 'members/module/studio/env/';
  let html = read(`${base}index.html`)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*name="x-members"[^>]*>/gi, '')
    .replace('data-studio-page="env"', 'class="setup-standalone"')
    .replace('<a class="back-link" href="/members/module/studio/">← Studio</a>', '<span class="local-setup-label">Konfiguracja lokalna</span>')
    .replace('<small>Narzędzie administratora</small>', '<small>Nowa instalacja platformy</small>')
    .replace('Generator jest dostępny wyłącznie dla administratora.', 'Przygotowuję lokalny kreator konfiguracji.')
    .replace('Stawiasz platformę od zera?', 'Działa lokalnie, bez logowania')
    .replace('W katalogu projektu uruchom <code>npm run setup</code>. Otworzysz ten sam kreator lokalnie, jeszcze przed wdrożeniem i utworzeniem konta administratora.', 'Wypełnij formularz i pobierz .env. Dane pozostają w tej karcie; lokalny serwer udostępnia tylko kreator i nie otrzymuje wpisanych wartości.');
  const styles = read('members/module/theme.css') + '\n' + read(`${base}style.css`);
  html = html.replace('</head>', `<style>${styles}</style></head>`);
  const auth = `window.ChemAuth = { ready: Promise.resolve({ authenticated: true, session: { ok: true } }), getUser: () => ({ app_metadata: { roles: ['admin'] } }) };`;
  const scripts = [read('members/module/theme.js'), auth, ...['env-model.js', 'setup-model.js', 'setup.js', 'script.js'].map((file) => read(base + file))];
  const scriptMarkup = scripts.map((code) => `<script nonce="${nonce}">${code.replace(/<\/script/gi, '<\\/script')}</script>`).join('\n');
  return html.replace('</body>', `${scriptMarkup}\n</body>`);
}

function createSetupServer() {
  return http.createServer((req, res) => {
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1:\d+$/.test(host) || !['GET', 'HEAD'].includes(req.method) || req.url !== '/') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nie znaleziono strony.');
      return;
    }
    const nonce = crypto.randomBytes(18).toString('base64');
    const page = renderSetupPage(nonce);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
    });
    res.end(req.method === 'HEAD' ? undefined : page);
  });
}

if (require.main === module) {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  const port = portArg ? Number(portArg.slice(7)) : 4319;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Podaj port od 0 do 65535: npm run setup -- --port=4319');
    process.exitCode = 1;
  } else {
    const server = createSetupServer();
    server.on('error', (error) => {
      console.error(error.code === 'EADDRINUSE' ? 'Ten port jest zajęty. Spróbuj: npm run setup -- --port=4320' : 'Nie udało się uruchomić lokalnego kreatora.');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Kreator konfiguracji: http://127.0.0.1:${server.address().port}/`);
      console.log('Otwórz adres w przeglądarce. Wpisane dane pozostają w karcie. Zatrzymaj serwer: Ctrl+C.');
    });
  }
}

module.exports = { renderSetupPage, createSetupServer };
