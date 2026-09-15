'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { testEnvironment } = require('../scripts/run-tests.cjs');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts/run-tests.cjs');

test('build environment keeps runtime settings but removes all deployment configuration and secrets', () => {
  const inherited = {
    PATH: '/node/bin', TMPDIR: '/tmp', SystemRoot: 'C:\\Windows', CI: 'true',
    GIT_PROVIDER: 'gitea', GITEA_BASE_URL: 'https://deploy.invalid',
    GITEA_TOKEN: 'gitea-canary-secret', GITEA_CONTENT_REPOSITORIES: 'production-config',
    GITHUB_CONTENT_TOKEN: 'github-canary-secret', GITHUB_CONTENT_REPOSITORIES: 'legacy-production-config',
    GEMINI_API_KEY: 'gemini-canary-secret', OPENAI_API_KEY: 'openai-canary-secret',
    NETLIFY_API_TOKEN: 'netlify-canary-secret', NETLIFY_BLOBS_CONTEXT: 'blobs-canary-secret',
    STRIPE_SECRET_KEY: 'stripe-canary-secret', STRIPE_WEBHOOK_SECRET: 'webhook-canary-secret',
    SITE_ID: 'production-site', CONTEXT: 'production', URL: 'https://deploy.invalid',
    DEPLOY_PRIME_URL: 'https://deploy.invalid', LANDING_CONFIG_PATH: 'production.json',
    NODE_OPTIONS: '--env-file=.env', UNKNOWN_FUTURE_SERVICE_TOKEN: 'future-canary-secret'
  };
  const original = { ...inherited };
  const isolated = testEnvironment(inherited);
  assert.deepEqual(isolated, { PATH: '/node/bin', TMPDIR: '/tmp', SystemRoot: 'C:\\Windows', CI: 'true' });
  assert.deepEqual(inherited, original, 'The production/build environment itself must not be changed');
});

for (const provider of ['gitea', 'github']) {
  test(`build runner ignores inherited ${provider} settings and still tests both providers`, () => {
    const result = spawnSync(process.execPath, [runner, '--test-reporter=tap',
      'tests/chat.test.js', 'tests/content-library.test.js', 'tests/site-assets.test.js', 'tests/gitea-provider.test.js'
    ], {
      cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
      env: {
        ...testEnvironment(),
        GIT_PROVIDER: provider, GITEA_BASE_URL: 'https://gitea.deploy-fixture.invalid',
        GITEA_API_URL: 'https://gitea.deploy-fixture.invalid/api/v1',
        GITEA_TOKEN: 'deploy-gitea-canary-secret', GITEA_SITE_ASSETS_REPOSITORY: 'production/logos',
        GITEA_CONTENT_REPOSITORIES: JSON.stringify([
          { id: 'glowne', label: 'Production course', repository: 'production/nextmed', tokenEnv: 'GITEA_TOKEN', default: true }
        ]),
        GITHUB_CONTENT_TOKEN: 'deploy-github-canary-secret',
        GITHUB_CONTENT_REPOSITORIES: JSON.stringify([
          { id: 'glowne', label: 'Legacy production course', repository: 'production/legacy', default: true }
        ]),
        GEMINI_API_KEY: 'deploy-gemini-canary-secret', GEMINI_MODEL: 'production-model',
        OPENAI_API_KEY: 'deploy-openai-canary-secret', OPENAI_MODEL: 'production-model',
        NETLIFY_API_TOKEN: 'deploy-netlify-canary-secret', SITE_ID: 'production-site',
        STRIPE_SECRET_KEY: 'deploy-stripe-canary-secret', STRIPE_WEBHOOK_SECRET: 'deploy-webhook-canary-secret',
        URL: 'https://production.invalid', DEPLOY_PRIME_URL: 'https://preview.production.invalid', CONTEXT: 'production'
      }
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, output);
    assert.match(output, /# fail 0/);
    assert.match(output, /Gitea defaults, explicit switching and old GitHub aliases remain compatible/);
    assert.doesNotMatch(output, /deploy-[a-z]+-canary-secret|production\/nextmed|production\/legacy/);
  });
}

test('build runner propagates failure instead of allowing a failed test run to deploy', () => {
  const result = spawnSync(process.execPath, [runner, 'missing-fixture.test.js'], {
    cwd: root, env: testEnvironment(), encoding: 'utf8', timeout: 10_000
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
});
