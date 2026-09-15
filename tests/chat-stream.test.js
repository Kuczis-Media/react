'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const aiUsage = require('../netlify/ai-usage.js');

class MemoryStore {
  constructor() { this.entries = new Map(); this.revision = 0; }
  async getWithMetadata(key) {
    const entry = this.entries.get(key);
    return entry ? { data: entry.data, etag: entry.etag, metadata: entry.metadata || {} } : null;
  }
  async set(key, data, options = {}) {
    const current = this.entries.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && (!current || current.etag !== options.onlyIfMatch)) return { modified: false };
    this.revision += 1;
    this.entries.set(key, { data, etag: `etag-${this.revision}`, metadata: options.metadata || {} });
    return { modified: true, etag: `etag-${this.revision}` };
  }
  async list(options = {}) {
    return { blobs: Array.from(this.entries.keys()).filter((key) => key.startsWith(options.prefix || '')).sort().map((key) => ({ key })) };
  }
}

let chatStream;
test.before(async () => {
  const stores = { config: new MemoryStore(), usage: new MemoryStore() };
  aiUsage._test.setStoreFactory(() => stores);
  chatStream = await import('../netlify/functions/chat-stream.mjs');
});
test.after(() => aiUsage._test.resetStoreFactory());

const activeUser = {
  sub: 'user-stream-1',
  app_metadata: {
    roles: ['active'],
    session_id: 'session-stream-1'
  }
};

const streamEventFor = (overrides = {}) => ({
  httpMethod: 'POST',
  headers: { authorization: 'Bearer signed-token' },
  clientContext: { user: activeUser },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Co to jest reakcja estryfikacji?' }],
    options: { temperature: 0.2 }
  }),
  ...overrides
});

test('chat-stream returns CORS headers on OPTIONS', async () => {
  const res = await chatStream.handler({ httpMethod: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
  assert.match(res.headers['Access-Control-Allow-Methods'], /POST/);
});

test('chat-stream rejects non-POST methods', async () => {
  const res = await chatStream.handler({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('chat-stream rejects unauthenticated requests', async () => {
  const res = await chatStream.handler(streamEventFor({ headers: {}, clientContext: {} }));
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'AUTH_REQUIRED');
});

test('chat-stream rejects invalid JSON body', async () => {
  const res = await chatStream.handler(streamEventFor({ body: '{invalid-json' }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'INVALID_JSON');
});

test('chat-stream validates payload messages', async () => {
  const res = await chatStream.handler(streamEventFor({ body: JSON.stringify({ messages: [] }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'INVALID_MESSAGES');
});

test('chat-stream configuration publishes an edge limiter and path', () => {
  assert.equal(chatStream.config.path, '/.netlify/functions/chat-stream');
  assert.deepEqual(chatStream.config.rateLimit.aggregateBy, ['ip', 'domain']);
});

