'use strict';

const {
  json,
  mutationGuard,
  parseJsonBody,
  plainObject,
  requireAdmin,
  requireCourseAccess,
  responseForFailure
} = require('../admin-common');
const contentRepository = require('../content-repository');

exports.handler = async function contentLibraryHandler(event = {}, context = {}) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
        Vary: 'Origin'
      },
      body: ''
    };
  }
  if (!['GET', 'PUT', 'DELETE'].includes(event.httpMethod)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, DELETE' });
  }

  if (event.httpMethod === 'PUT' || event.httpMethod === 'DELETE') {
    const guard = mutationGuard(event, { maxBodyBytes: 6_200_000 });
    if (!guard.ok) return responseForFailure(guard);
    const authorization = await requireAdmin(event, context);
    if (!authorization.ok) return responseForFailure(authorization);
    return mutateContent(event);
  }

  const query = event.queryStringParameters || {};
  const action = typeof query.action === 'string' ? query.action : 'list';
  const kind = typeof query.kind === 'string' ? query.kind : 'lesson';
  const repositoryId = typeof query.repo === 'string' ? query.repo : '';
  const adminOnly = ['status', 'studio-bootstrap', 'list-media'].includes(action)
    || ['prompt', 'exam', 'question_bank', 'presentation', 'quiz'].includes(kind)
    || query.refresh === '1';
  const authorization = adminOnly
    ? await requireAdmin(event, context)
    : await requireCourseAccess(event, context);
  if (!authorization.ok) return responseForFailure(authorization);

  try {
    if (action === 'status') {
      const configuration = contentRepository.publicConfiguration(process.env, repositoryId);
      const repositories = contentRepository.publicConfigurations();
      let counts = { lessons: 0, prompts: 0, exams: 0, presentations: 0, quizzes: 0 };
      let connection = configuration.configured ? 'pending' : 'not_configured';
      let error = '';
      if (configuration.configured) {
        try {
          const assets = await contentRepository.listAssetBundle({
            force: query.refresh === '1',
            repositoryId: configuration.id
          });
          counts = {
            lessons: assets.lesson.length,
            prompts: assets.prompt.length,
            exams: assets.exam.length,
            presentations: assets.presentation.length,
            quizzes: assets.quiz.length
          };
          connection = 'ready';
        } catch (statusError) {
          connection = 'error';
          error = errorCode(statusError);
        }
      }
      return json({ configuration, repositories, connection, counts, error });
    }

    if (action === 'studio-bootstrap') {
      const repository = contentRepository.publicConfiguration(process.env, repositoryId);
      const assets = await contentRepository.listAssetBundle({
        force: query.refresh === '1',
        repositoryId: repository.id
      });
      return json({
        repositories: contentRepository.publicConfigurations(),
        repository,
        assets
      });
    }

    if (action === 'repositories') {
      return json({ repositories: contentRepository.publicConfigurations() });
    }

    if (action === 'list') {
      const assets = await contentRepository.listAssets(kind, {
        force: query.refresh === '1',
        repositoryId
      });
      return json({
        assets,
        kind,
        repository: contentRepository.publicConfiguration(process.env, repositoryId)
      });
    }

    if (action === 'list-media') {
      const scope = typeof query.scope === 'string' ? query.scope : 'local';
      const materialKind = typeof query.materialKind === 'string' ? query.materialKind : '';
      const materialId = typeof query.materialId === 'string' ? query.materialId : '';
      const media = await contentRepository.listMedia(scope, materialKind, materialId, {
        force: query.refresh === '1',
        repositoryId
      });
      let references = 0;
      let source = '';
      if (scope !== 'shared' && query.usage === '1') {
        try {
          const asset = await contentRepository.readAsset(materialKind, materialId, { repositoryId });
          source = asset.content;
        } catch (error) {
          if (!(error instanceof contentRepository.ContentRepositoryError && error.status === 404)) throw error;
        }
      }
      const assets = media.map((item) => {
        const escaped = item.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const usageCount = source ? (source.match(new RegExp(escaped, 'g')) || []).length : 0;
        references += usageCount;
        return { ...item, usageCount };
      });
      return json({
        assets,
        scope,
        materialKind,
        materialId,
        references,
        repository: contentRepository.publicConfiguration(process.env, repositoryId)
      });
    }

    if (action === 'read' && ['lesson', 'prompt', 'exam', 'question_bank', 'presentation', 'quiz'].includes(kind)) {
      const asset = await contentRepository.readAsset(kind, query.file, { repositoryId });
      return json(asset);
    }

    return json({ error: 'INVALID_CONTENT_ACTION' }, 400);
  } catch (error) {
    const status = error instanceof contentRepository.ContentRepositoryError
      ? error.status
      : 503;
    return json({ error: errorCode(error) }, status);
  }
};

async function mutateContent(event) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const validation = validateMutationBody(parsed.value, event.httpMethod);
  if (!validation.ok) return json({ error: validation.code }, validation.status || 400);

  try {
    if (event.httpMethod === 'PUT') {
      if (validation.value.kind === 'media') {
        await ensureMediaOwner(validation.value);
        const savedMedia = await contentRepository.saveMedia(
          validation.value.scope,
          validation.value.materialKind,
          validation.value.materialId,
          validation.value.filename,
          validation.value.contentBase64,
          validation.value.mimeType,
          { repositoryId: validation.value.repositoryId }
        );
        return json(savedMedia, 201);
      }
      if (validation.value.kind === 'exam_media') {
        await contentRepository.readAsset('exam', validation.value.examId, {
          repositoryId: validation.value.repositoryId
        });
        const savedMedia = await contentRepository.saveExamMedia(
          validation.value.examId,
          validation.value.filename,
          validation.value.contentBase64,
          validation.value.mimeType,
          { repositoryId: validation.value.repositoryId }
        );
        return json(savedMedia, 201);
      }
      if (validation.value.kind === 'exam') {
        await validateExamQuestionReferences(validation.value.content, validation.value.repositoryId);
      }
      const saved = await contentRepository.saveAsset(
        validation.value.kind,
        validation.value.filename,
        validation.value.content,
        {
          expectedSha: validation.value.expectedSha,
          repositoryId: validation.value.repositoryId
        }
      );
      return json(saved, saved.created ? 201 : 200);
    }
    if (validation.value.kind === 'media') {
      const deletedMedia = await contentRepository.deleteMedia(
        validation.value.scope,
        validation.value.materialKind,
        validation.value.materialId,
        validation.value.reference,
        validation.value.expectedSha,
        { repositoryId: validation.value.repositoryId }
      );
      return json(deletedMedia);
    }
    const deleted = await contentRepository.deleteAsset(
      validation.value.kind,
      validation.value.filename,
      validation.value.expectedSha,
      { repositoryId: validation.value.repositoryId }
    );
    return json(deleted);
  } catch (error) {
    const status = error instanceof contentRepository.ContentRepositoryError
      ? error.status
      : 503;
    return json({ error: errorCode(error) }, status);
  }
}

async function ensureMediaOwner(value) {
  if (value.scope === 'shared') return;
  if (!['lesson', 'exam', 'presentation', 'quiz'].includes(value.materialKind)) return;
  await contentRepository.readAsset(value.materialKind, value.materialId, {
    repositoryId: value.repositoryId
  });
}

async function validateExamQuestionReferences(rawContent, repositoryId) {
  let parsed;
  try { parsed = JSON.parse(rawContent); }
  catch { return; }
  const { normalizeDefinition, normalizeQuestionBank, resolveExamQuestions } = require('../exam-common.js');
  const definition = normalizeDefinition(parsed, parsed?.examId);
  let bank = { questions: [] };
  if (definition.questionRefs.length) {
    try {
      const asset = await contentRepository.readAsset('question_bank', 'question-bank.json', { repositoryId });
      bank = normalizeQuestionBank(JSON.parse(asset.content));
    } catch (error) {
      if (error instanceof contentRepository.ContentRepositoryError && error.code === 'CONTENT_FILE_NOT_FOUND') {
        throw new contentRepository.ContentRepositoryError('EXAM_QUESTION_REFERENCE_MISSING', 422);
      }
      throw error;
    }
  }
  const questions = resolveExamQuestions(definition, bank);
  if (questions.length !== definition.questions.length + definition.questionRefs.length) {
    throw new contentRepository.ContentRepositoryError('EXAM_QUESTION_REFERENCE_MISSING', 422);
  }
  for (const quota of definition.randomization.categoryQuotas) {
    if (questions.filter((question) => question.categories.includes(quota.category)).length < quota.count) {
      throw new contentRepository.ContentRepositoryError('EXAM_CATEGORY_POOL_TOO_SMALL', 422);
    }
  }
  const requested = definition.randomization.totalQuestions;
  if (requested && requested > questions.length) {
    throw new contentRepository.ContentRepositoryError('EXAM_QUESTION_POOL_TOO_SMALL', 422);
  }
}

function validateMutationBody(value, method) {
  if (!plainObject(value)) return { ok: false, code: 'INVALID_CONTENT_REQUEST' };
  if (value.kind === 'media') {
    const allowed = method === 'PUT'
      ? new Set(['kind', 'scope', 'materialKind', 'materialId', 'filename', 'contentBase64', 'mimeType', 'repositoryId'])
      : new Set(['kind', 'scope', 'materialKind', 'materialId', 'reference', 'expectedSha', 'repositoryId']);
    const scope = typeof value.scope === 'string' ? value.scope : '';
    const materialKind = typeof value.materialKind === 'string' ? value.materialKind : '';
    const materialId = typeof value.materialId === 'string' ? value.materialId : '';
    if (
      Object.keys(value).some((key) => !allowed.has(key))
      || !['local', 'shared'].includes(scope)
      || (scope === 'local' && !['lesson', 'exam', 'presentation', 'quiz'].includes(materialKind))
      || (scope === 'local' && !materialId)
      || (scope === 'shared' && (materialKind || materialId))
      || (value.repositoryId != null && typeof value.repositoryId !== 'string')
    ) return { ok: false, code: 'INVALID_CONTENT_REQUEST' };
    if (method === 'PUT' && (
      typeof value.filename !== 'string'
      || typeof value.contentBase64 !== 'string'
      || typeof value.mimeType !== 'string'
    )) return { ok: false, code: 'INVALID_CONTENT_REQUEST' };
    if (method === 'DELETE' && (
      typeof value.reference !== 'string'
      || typeof value.expectedSha !== 'string'
      || !value.expectedSha
    )) return { ok: false, code: 'INVALID_CONTENT_REQUEST' };
    return {
      ok: true,
      value: {
        kind: 'media',
        scope,
        materialKind,
        materialId,
        filename: method === 'PUT' ? value.filename : '',
        contentBase64: method === 'PUT' ? value.contentBase64 : '',
        mimeType: method === 'PUT' ? value.mimeType : '',
        reference: method === 'DELETE' ? value.reference : '',
        expectedSha: method === 'DELETE' ? value.expectedSha : '',
        repositoryId: typeof value.repositoryId === 'string' ? value.repositoryId : ''
      }
    };
  }
  if (value.kind === 'exam_media') {
    const allowed = new Set(['kind', 'examId', 'filename', 'contentBase64', 'mimeType', 'repositoryId']);
    if (
      method !== 'PUT'
      || Object.keys(value).some((key) => !allowed.has(key))
      || typeof value.examId !== 'string'
      || typeof value.filename !== 'string'
      || typeof value.contentBase64 !== 'string'
      || typeof value.mimeType !== 'string'
      || (value.repositoryId != null && typeof value.repositoryId !== 'string')
    ) return { ok: false, code: 'INVALID_CONTENT_REQUEST' };
    return {
      ok: true,
      value: {
        kind: 'exam_media',
        examId: value.examId,
        filename: value.filename,
        contentBase64: value.contentBase64,
        mimeType: value.mimeType,
        repositoryId: typeof value.repositoryId === 'string' ? value.repositoryId : ''
      }
    };
  }
  const allowed = method === 'PUT'
    ? new Set(['kind', 'filename', 'content', 'expectedSha', 'repositoryId'])
    : new Set(['kind', 'filename', 'expectedSha', 'repositoryId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return { ok: false, code: 'INVALID_CONTENT_REQUEST' };
  }
  if (!['lesson', 'prompt', 'exam', 'question_bank', 'presentation', 'quiz'].includes(value.kind)) {
    return { ok: false, code: 'INVALID_CONTENT_KIND' };
  }
  if (typeof value.filename !== 'string') {
    return { ok: false, code: 'INVALID_CONTENT_FILENAME' };
  }
  if (method === 'PUT' && typeof value.content !== 'string') {
    return { ok: false, code: 'CONTENT_FILE_INVALID', status: 422 };
  }
  if (
    value.expectedSha != null &&
    typeof value.expectedSha !== 'string'
  ) {
    return { ok: false, code: 'INVALID_CONTENT_SHA' };
  }
  if (method === 'DELETE' && !value.expectedSha) {
    return { ok: false, code: 'INVALID_CONTENT_SHA' };
  }
  if (value.repositoryId != null && typeof value.repositoryId !== 'string') {
    return { ok: false, code: 'INVALID_CONTENT_REPOSITORY' };
  }
  return {
    ok: true,
    value: {
      kind: value.kind,
      filename: value.filename,
      content: method === 'PUT' ? value.content : '',
      expectedSha: typeof value.expectedSha === 'string' ? value.expectedSha : '',
      repositoryId: typeof value.repositoryId === 'string' ? value.repositoryId : ''
    }
  };
}

function errorCode(error) {
  return error instanceof contentRepository.ContentRepositoryError
    ? error.code
    : 'CONTENT_REPOSITORY_UNAVAILABLE';
}

exports._test = { ensureMediaOwner, errorCode, validateExamQuestionReferences, validateMutationBody };
