'use strict';

const contentRepository = require('../content-repository.js');
const { normalizeDefinition, SAFE_ID } = require('../presentation-common.js');
const {
  json,
  requireCourseAccess,
  responseForFailure
} = require('../admin-common.js');

const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

exports.handler = async function presentationHandler(event = {}, context = {}) {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        Vary: 'Origin'
      },
      body: ''
    };
  }
  if (method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, OPTIONS' });
  const auth = await requireCourseAccess(event, context);
  if (!auth.ok) return responseForFailure(auth);
  const query = event.queryStringParameters || {};
  const allowed = new Set(['repo', 'presentation', 'preview']);
  if (Object.keys(query).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_QUERY' }, 400);
  const presentationId = String(query.presentation || '').trim().toLowerCase();
  const repositoryId = String(query.repo || 'default').trim().toLowerCase() || 'default';
  const preview = query.preview === '1';
  if (!SAFE_ID.test(presentationId) || !SAFE_REPOSITORY_ID.test(repositoryId)) {
    return json({ error: 'INVALID_PRESENTATION_REFERENCE' }, 400);
  }
  if (preview && !auth.roles.includes('admin')) return json({ error: 'ADMIN_REQUIRED' }, 403);
  try {
    const asset = await contentRepository.readAsset('presentation', presentationId, { repositoryId });
    const definition = normalizeDefinition(JSON.parse(asset.content), presentationId);
    if (definition.presentationId !== presentationId) return json({ error: 'PRESENTATION_FILE_INVALID' }, 422);
    if (definition.metadata.status !== 'published' && !preview) return json({ error: 'PRESENTATION_NOT_PUBLISHED' }, 404);
    return json({ presentation: definition, repositoryId, sha: preview ? asset.sha : undefined });
  } catch (error) {
    const status = error instanceof contentRepository.ContentRepositoryError ? error.status : 503;
    const code = error instanceof contentRepository.ContentRepositoryError
      ? error.code
      : error instanceof SyntaxError ? 'PRESENTATION_FILE_INVALID' : 'CONTENT_REPOSITORY_UNAVAILABLE';
    return json({ error: code }, code === 'PRESENTATION_FILE_INVALID' ? 422 : status);
  }
};

