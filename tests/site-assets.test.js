'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const siteAssets = require('../netlify/site-assets.js');
const adminSiteAssets = require('../netlify/functions/admin-site-assets.js');

const env = {
  GITHUB_SITE_ASSETS_TOKEN: 'github_pat_site_assets',
  GITHUB_SITE_ASSETS_DIRECTORY: 'branding'
};
const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK1sAAAAASUVORK5CYII=', 'base64');

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test.afterEach(() => siteAssets._test.resetPublicCheck());

test('landing publication uses an exact GitHub SHA, strips editor identity and does not depend on Blob writes', async () => {
  const model = require('../netlify/landing-content.js').defaultModel();
  model.updatedBy = 'private-admin-id';
  const sha = 'a'.repeat(40); const commit = 'b'.repeat(40);
  let write;
  const result = await siteAssets.publishLandingConfig(model, env, {
    expectedSha: null,
    fetchImpl: async (url, options) => {
      if (options.method === 'PUT') { write = JSON.parse(options.body); return response({ content: { sha }, commit: { sha: commit } }); }
      if (String(url).includes('/contents/')) return response({ message: 'Not Found' }, 404);
      if (String(url).includes('/branches/')) return response({ commit: { sha: commit } });
      return response({ private: false });
    }
  });
  assert.equal(result.sha, sha);
  assert.equal(result.model.revision, 1);
  assert.equal(write.branch, 'main');
  assert.equal(write.sha, undefined);
  const decoded = Buffer.from(write.content, 'base64').toString('utf8');
  assert.equal(JSON.parse(decoded).model.branding.brandName, 'NextMed');
  assert.doesNotMatch(decoded, /private-admin-id|github_pat/);
});

test('a stale landing publisher cannot overwrite newer content, but a timed-out identical publish is idempotent', async () => {
  const landing = require('../netlify/landing-content.js');
  const current = landing.defaultModel(); current.revision = 5;
  const sha = 'a'.repeat(40); let writes = 0;
  const options = {
    expectedSha: 'b'.repeat(40),
    fetchImpl: async (url, request) => {
      if (request.method === 'PUT') writes++;
      if (String(url).includes('/branches/')) return response({ commit: { sha } });
      if (!String(url).includes('/contents/')) return response({ private: false });
      return response({ sha, encoding: 'base64', type: 'file', content: Buffer.from(JSON.stringify({ active: true, model: landing.publicModel(current) })).toString('base64') });
    }
  };
  const retry = await siteAssets.publishLandingConfig(current, env, options);
  assert.equal(retry.unchanged, true); assert.equal(writes, 0);
  const stale = landing.defaultModel(); stale.sections[0].title = 'A stale editor';
  await assert.rejects(() => siteAssets.publishLandingConfig(stale, env, options), { code: 'LANDING_CONFLICT' });
  assert.equal(writes, 0);
});

test('site assets configuration exposes no token and builds a jsDelivr base', () => {
  const visible = siteAssets.publicConfiguration(env);
  assert.equal(visible.configured, true);
  assert.equal(visible.repository, 'Kuczis-Media/logo');
  assert.equal(visible.directory, 'branding');
  assert.equal(visible.cdnBaseUrl, 'https://cdn.jsdelivr.net/gh/Kuczis-Media/logo@main/branding');
  assert.equal(Object.hasOwn(visible, 'token'), false);
  assert.doesNotMatch(JSON.stringify(visible), /github_pat_site_assets/);
});

test('site assets support configured repository and ref without exposing tokens', () => {
  const customEnv = {
    ...env,
    GITHUB_SITE_ASSETS_REPOSITORY: 'school/branding',
    GITHUB_SITE_ASSETS_REF: 'release/site'
  };
  const configured = siteAssets.configuration(customEnv);
  const visible = siteAssets.publicConfiguration(customEnv);

  assert.equal(configured.repository, 'school/branding');
  assert.equal(configured.ref, 'release/site');
  assert.equal(visible.repository, 'school/branding');
  assert.equal(visible.ref, 'release/site');
  assert.equal(visible.cdnBaseUrl, 'https://cdn.jsdelivr.net/gh/school/branding@release%2Fsite/branding');
  assert.doesNotMatch(JSON.stringify(visible), /github_pat/);
});

test('site asset library fails closed when the configured repository is private', async () => {
  await assert.rejects(
    () => siteAssets.listAssets(env, { fetchImpl: async () => response({ private: true }) }),
    (error) => error.code === 'SITE_ASSETS_REPOSITORY_NOT_PUBLIC' && error.status === 409
  );
});

test('site asset library distinguishes a missing ref from an empty directory', async () => {
  let calls = 0;
  await assert.rejects(
    () => siteAssets.listAssets(env, {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return response({ private: false });
        return response({ message: 'Branch not found' }, 404);
      }
    }),
    (error) => error.code === 'SITE_ASSETS_REF_NOT_FOUND' && error.status === 404
  );
  assert.equal(calls, 2);

  siteAssets._test.resetPublicCheck();
  calls = 0;
  const empty = await siteAssets.listAssets(env, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ private: false });
      if (calls === 2) return response({ commit: { sha: '7'.repeat(40) } });
      return response({ message: 'Not Found' }, 404);
    }
  });
  assert.equal(calls, 3);
  assert.deepEqual(empty.assets, []);
});

test('site asset list returns direct CDN links without proxying image bytes through a Function', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return response({ private: false });
    if (calls.length === 2) return response({ commit: { sha: '9'.repeat(40) } });
    return response([{ name: 'Logo.svg', type: 'file', size: 401, sha: 'a'.repeat(40), html_url: 'https://github.com/Kuczis-Media/logo/blob/main/branding/Logo.svg' }]);
  };
  const result = await siteAssets.listAssets(env, { fetchImpl });
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /\/branches\/main$/);
  assert.match(calls[2].url, /\/contents\/branding\?ref=main$/);
  assert.equal(result.assets[0].filename, 'Logo.svg');
  assert.equal(result.assets[0].cdnUrl, `https://cdn.jsdelivr.net/gh/Kuczis-Media/logo@${'9'.repeat(40)}/branding/Logo.svg`);
  assert.equal(result.assets[0].branchCdnUrl, 'https://cdn.jsdelivr.net/gh/Kuczis-Media/logo@main/branding/Logo.svg');
  assert.equal(result.assets[0].mimeType, 'image/svg+xml');
});

test('site asset upload validates image bytes and returns an immutable commit URL', async () => {
  const calls = [];
  const commitSha = 'b'.repeat(40);
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return response({ private: false });
    if (calls.length === 2) return response({ commit: { sha: 'a'.repeat(40) } });
    return response({
      content: { sha: 'c'.repeat(40) },
      commit: { sha: commitSha, html_url: `https://github.com/Kuczis-Media/logo/commit/${commitSha}` }
    }, 201);
  };
  const result = await siteAssets.uploadAsset({
    filename: 'logo-test.png',
    contentBase64: VALID_PNG.toString('base64'),
    mimeType: 'image/png'
  }, env, { fetchImpl });

  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.method, 'PUT');
  assert.doesNotMatch(calls[2].url, /[?&]ref=/);
  assert.equal(JSON.parse(calls[2].options.body).branch, 'main');
  assert.equal(result.cdnUrl, `https://cdn.jsdelivr.net/gh/Kuczis-Media/logo@${commitSha}/branding/logo-test.png`);
  assert.equal(result.branchCdnUrl, 'https://cdn.jsdelivr.net/gh/Kuczis-Media/logo@main/branding/logo-test.png');
});

test('site asset upload does not classify an unrelated 422 response as an existing file', async () => {
  let calls = 0;
  await assert.rejects(
    () => siteAssets.uploadAsset({
      filename: 'logo-validation.png',
      contentBase64: VALID_PNG.toString('base64'),
      mimeType: 'image/png'
    }, env, {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return response({ private: false });
        if (calls === 2) return response({ commit: { sha: '6'.repeat(40) } });
        return response({ message: 'Validation Failed', errors: [{ resource: 'Commit', field: 'path', code: 'invalid' }] }, 422);
      }
    }),
    (error) => error.code === 'SITE_ASSETS_WRITE_REJECTED'
      && error.code !== 'SITE_ASSET_ALREADY_EXISTS'
      && error.status === 409
  );
  assert.equal(calls, 3);
});

test('site asset upload rejects non-image data before making any GitHub request', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response({ private: false });
  };
  await assert.rejects(
    () => siteAssets.uploadAsset({
      filename: 'fake.png',
      contentBase64: Buffer.from('not an image').toString('base64'),
      mimeType: 'image/png'
    }, env, { fetchImpl }),
    (error) => error.code === 'SITE_ASSET_INVALID' && error.status === 422
  );
  assert.equal(calls, 0);
});

test('site asset validation accepts a normal XML-prefixed SVG and rejects active SVG content', async () => {
  const safe = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h2v2z"/></svg>');
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return response({ private: false });
    if (calls === 2) return response({ commit: { sha: 'a'.repeat(40) } });
    return response({ content: { sha: 'e'.repeat(40) }, commit: { sha: 'f'.repeat(40) } }, 201);
  };
  const uploaded = await siteAssets.uploadAsset({
    filename: 'safe-logo.svg',
    contentBase64: safe.toString('base64'),
    mimeType: 'image/svg+xml'
  }, env, { fetchImpl });
  assert.equal(uploaded.mimeType, 'image/svg+xml');
  assert.equal(calls, 3);

  siteAssets._test.resetPublicCheck();
  calls = 0;
  const unsafe = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(
    () => siteAssets.uploadAsset({
      filename: 'unsafe.svg',
      contentBase64: unsafe.toString('base64'),
      mimeType: 'image/svg+xml'
    }, env, { fetchImpl }),
    (error) => error.code === 'MEDIA_SVG_UNSAFE' && error.status === 422
  );
  assert.equal(calls, 0);
});

test('site asset upload rejects a truncated bitmap before contacting GitHub', async () => {
  let calls = 0;
  const truncated = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await assert.rejects(
    () => siteAssets.uploadAsset({
      filename: 'truncated.png',
      contentBase64: truncated.toString('base64'),
      mimeType: 'image/png'
    }, env, { fetchImpl: async () => { calls += 1; return response({ private: false }); } }),
    (error) => error.code === 'SITE_ASSET_INVALID' && error.status === 422
  );
  assert.equal(calls, 0);
});

test('site asset Function requires a canonical admin and same-origin JSON for uploads', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => {
    calls += 1;
    return response({ id: 'user-1', app_metadata: { roles: ['active'] } });
  };
  const context = {
    clientContext: {
      user: { id: 'user-1', app_metadata: { roles: ['active'] } },
      identity: { url: 'https://course.example/.netlify/identity' }
    }
  };

  let result = await adminSiteAssets.handler({ httpMethod: 'GET', headers: {} }, context);
  assert.equal(result.statusCode, 401);
  assert.equal(calls, 0);

  result = await adminSiteAssets.handler({
    httpMethod: 'PUT',
    headers: {
      authorization: 'Bearer identity-token',
      'content-type': 'application/json',
      origin: 'https://evil.example',
      host: 'course.example'
    },
    body: '{}'
  }, context);
  assert.equal(result.statusCode, 403);
  assert.equal(JSON.parse(result.body).error, 'SAME_ORIGIN_REQUIRED');
  assert.equal(calls, 0);

  result = await adminSiteAssets.handler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer identity-token' }
  }, context);
  assert.equal(result.statusCode, 403);
  assert.equal(JSON.parse(result.body).error, 'ADMIN_REQUIRED');
  assert.equal(calls, 1);
});

test('site asset Function lists public CDN metadata without exposing either token', async (t) => {
  const originalFetch = global.fetch;
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  t.after(() => {
    global.fetch = originalFetch;
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });
  Object.assign(process.env, env);
  const requests = [];
  global.fetch = async (url) => {
    const value = String(url);
    requests.push(value);
    if (value.includes('/.netlify/identity/user')) {
      return response({ id: 'admin-1', app_metadata: { roles: ['admin'] } });
    }
    if (/\/repos\/Kuczis-Media\/logo$/.test(value)) return response({ private: false });
    if (/\/branches\/main$/.test(value)) return response({ commit: { sha: '8'.repeat(40) } });
    return response([{ name: 'brand.svg', type: 'file', size: 200, sha: 'd'.repeat(40), html_url: 'https://github.com/Kuczis-Media/logo/blob/main/branding/brand.svg' }]);
  };

  const result = await adminSiteAssets.handler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer identity-token' },
    queryStringParameters: {}
  }, {
    clientContext: {
      user: { id: 'admin-1', app_metadata: { roles: ['admin'] } },
      identity: { url: 'https://course.example/.netlify/identity' }
    }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(requests.length, 4);
  assert.equal(JSON.parse(result.body).assets[0].cdnUrl, `https://cdn.jsdelivr.net/gh/Kuczis-Media/logo@${'8'.repeat(40)}/branding/brand.svg`);
  assert.doesNotMatch(result.body, /github_pat_site_assets|identity-token/);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});
