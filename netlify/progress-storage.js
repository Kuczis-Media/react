'use strict';

const crypto = require('node:crypto');
const { normalizeCatalog, normalizeUserDocument } = require('./progress-common.js');

const STORE_NAME = 'chemdisk-progress';
const CATALOG_KEY = 'config/catalog.json';
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_WRITE_RETRIES = 6;
let injectedStoreFactory = null;

function storageConfig() {
  const token = typeof process.env.NETLIFY_API_TOKEN === 'string'
    ? process.env.NETLIFY_API_TOKEN.trim() : '';
  const siteId = typeof process.env.SITE_ID === 'string' ? process.env.SITE_ID.trim() : '';
  if (
    token.length < 16 || token.length > 4_096 || /[\s\u0000-\u001f\u007f]/.test(token)
    || !OPAQUE_ID_PATTERN.test(siteId)
  ) return null;
  return { token, siteId };
}

function getProgressStore() {
  if (injectedStoreFactory) return injectedStoreFactory();
  const config = storageConfig();
  if (!config) throw new Error('Progress Blob store is not configured');
  const { getStore } = require('@netlify/blobs');
  return getStore({
    name: STORE_NAME,
    siteID: config.siteId,
    token: config.token,
    consistency: 'strong'
  });
}

function encodeId(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function userKey(userId) {
  return `users/${encodeId(userId)}.json`;
}

function auditKey(timestamp = Date.now()) {
  const newestFirst = String(9_999_999_999_999 - Number(timestamp)).padStart(13, '0');
  return `audit/${newestFirst}-${crypto.randomBytes(8).toString('hex')}.json`;
}

async function readEntry(store, key) {
  const entry = await store.getWithMetadata(key, { type: 'text', consistency: 'strong' });
  if (entry == null) return null;
  if (typeof entry.data !== 'string' || !entry.etag) throw new Error('Invalid progress Blob entry');
  let value;
  try { value = JSON.parse(entry.data); } catch { throw new Error('Invalid progress Blob JSON'); }
  return { value, etag: entry.etag, metadata: entry.metadata || {} };
}

async function readCatalog(store) {
  const entry = await readEntry(store, CATALOG_KEY);
  return entry ? normalizeCatalog(entry.value) : normalizeCatalog({});
}

async function readUser(store, userId, profile) {
  const entry = await readEntry(store, userKey(userId));
  return {
    document: normalizeUserDocument(entry && entry.value, userId, profile),
    etag: entry && entry.etag || null
  };
}

async function conditionalSet(store, key, value, etag, metadata) {
  const options = {
    metadata: metadata || {},
    ...(etag ? { onlyIfMatch: etag } : { onlyIfNew: true })
  };
  const result = await store.set(key, JSON.stringify(value), options);
  return Boolean(result && result.modified === true);
}

async function updateJson(store, key, initialValue, updater, metadataFactory) {
  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt += 1) {
    const current = await readEntry(store, key);
    const base = current ? current.value : initialValue;
    const outcome = await updater(base, current, attempt);
    if (outcome && outcome.abort) return { ...outcome, modified: false };
    const value = outcome && Object.prototype.hasOwnProperty.call(outcome, 'value') ? outcome.value : outcome;
    const metadata = typeof metadataFactory === 'function' ? metadataFactory(value) : metadataFactory;
    if (await conditionalSet(store, key, value, current && current.etag, metadata)) {
      return { modified: true, value, result: outcome && outcome.result };
    }
  }
  const error = new Error('Concurrent progress update conflict');
  error.code = 'PROGRESS_CONFLICT';
  throw error;
}

async function updateUser(store, userId, profile, updater) {
  return updateJson(
    store,
    userKey(userId),
    normalizeUserDocument(null, userId, profile),
    async (input, current, attempt) => {
      const document = normalizeUserDocument(input, userId, profile);
      const outcome = await updater(document, { current, attempt });
      if (outcome && outcome.abort) return outcome;
      const next = outcome && outcome.document ? outcome.document : document;
      next.version = 1;
      next.revision = document.revision + 1;
      next.createdAt = document.createdAt || new Date().toISOString();
      next.updatedAt = new Date().toISOString();
      return { value: next, result: outcome && outcome.result };
    },
    (document) => ({
      userId: encodeId(userId),
      updatedAt: document.updatedAt,
      lastActivityAt: document.lastActivityAt || ''
    })
  );
}

async function writeCatalog(store, catalog, adminId) {
  const normalized = normalizeCatalog({ ...catalog, updatedAt: new Date().toISOString() });
  return updateJson(
    store,
    CATALOG_KEY,
    normalizeCatalog({}),
    () => ({ value: normalized }),
    { updatedAt: normalized.updatedAt, updatedBy: encodeId(adminId) }
  );
}

async function appendAudit(store, entry) {
  const value = {
    version: 1,
    adminId: String(entry.adminId || ''),
    targetUserId: entry.targetUserId == null ? null : String(entry.targetUserId),
    action: String(entry.action || ''),
    materialId: entry.materialId == null ? null : String(entry.materialId),
    previousValue: entry.previousValue == null ? null : entry.previousValue,
    newValue: entry.newValue == null ? null : entry.newValue,
    timestamp: new Date().toISOString()
  };
  const key = auditKey();
  const result = await store.set(key, JSON.stringify(value), {
    onlyIfNew: true,
    metadata: { action: value.action, timestamp: value.timestamp }
  });
  if (!result || result.modified !== true) throw new Error('Could not append audit log');
  return value;
}

async function listEntries(store, options = {}) {
  const requestedLimit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const cursorMatch = String(options.cursor || '').match(/^offset:(\d{1,9})$/);
  const offset = cursorMatch ? Number(cursorMatch[1]) : 0;
  const listing = store.list({
    prefix: options.prefix || '',
    paginate: true
  });
  const pages = listing && typeof listing[Symbol.asyncIterator] === 'function'
    ? listing
    : [await listing];
  const selected = [];
  let seen = 0;
  let hasMore = false;
  outer: for await (const page of pages) {
    const blobs = Array.isArray(page) ? page : Array.isArray(page?.blobs) ? page.blobs : [];
    for (const blob of blobs) {
      if (seen < offset) {
        seen += 1;
        continue;
      }
      if (selected.length >= requestedLimit) {
        hasMore = true;
        break outer;
      }
      selected.push(blob);
      seen += 1;
    }
  }
  const entries = [];
  for (let batchStart = 0; batchStart < selected.length; batchStart += 12) {
    const batch = await Promise.all(selected.slice(batchStart, batchStart + 12).map(async (blob) => {
      const key = typeof blob === 'string' ? blob : blob.key;
      if (!key) return null;
      const entry = await readEntry(store, key);
      return entry ? { key, ...entry } : null;
    }));
    entries.push(...batch.filter(Boolean));
  }
  return {
    entries,
    cursor: hasMore ? `offset:${offset + selected.length}` : null
  };
}

function setStoreFactory(factory) {
  injectedStoreFactory = typeof factory === 'function' ? factory : null;
}

module.exports = {
  CATALOG_KEY,
  STORE_NAME,
  appendAudit,
  auditKey,
  encodeId,
  getProgressStore,
  listEntries,
  readCatalog,
  readEntry,
  readUser,
  setStoreFactory,
  storageConfig,
  updateJson,
  updateUser,
  userKey,
  writeCatalog
};
