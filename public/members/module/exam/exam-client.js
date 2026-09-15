(function exposeExamClient(root) {
  'use strict';
  const ENDPOINT = '/.netlify/functions/exam';

  async function token(forceRefresh) {
    const value = await root.ChemAuth?.getAccessToken?.({ forceRefresh: Boolean(forceRefresh) });
    if (!value) throw new Error('AUTH_REQUIRED');
    return value;
  }

  async function request(params, options = {}) {
    const url = new URL(ENDPOINT, root.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== '' && value != null) url.searchParams.set(key, String(value));
    });
    const accessToken = await token(options.forceRefresh);
    let response;
    try {
      response = await root.fetch(url, {
        method: options.method || 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: Boolean(options.keepalive),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
      });
    } catch {
      throw new Error('EXAM_UNAVAILABLE');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !options.forceRefresh) return request(params, { ...options, forceRefresh: true });
      const error = new Error(payload.error || 'EXAM_UNAVAILABLE');
      error.code = payload.error || 'EXAM_UNAVAILABLE';
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function reference(input) {
    return {
      repo: input.repositoryId || 'default',
      exam: input.examId,
      ...(input.materialId ? { material: input.materialId } : {})
    };
  }

  const api = {
    bootstrap(input) {
      return request({}, {
        method: 'POST',
        body: {
          action: 'bootstrap',
          repositoryId: input.repositoryId || 'default',
          examId: input.examId,
          preview: Boolean(input.preview),
          ...(input.materialId ? { materialId: input.materialId } : {})
        }
      });
    },
    definition(input) { return request({ action: 'definition', ...reference(input), preview: input.preview ? '1' : '' }); },
    attempt(input) { return request({ action: 'attempt', ...reference(input), attemptId: input.attemptId, preview: input.preview ? '1' : '' }); },
    result(input) { return request({ action: 'result', ...reference(input), attemptId: input.attemptId, preview: input.preview ? '1' : '' }); },
    mutate(action, input, options = {}) {
      return request({}, {
        method: 'POST',
        keepalive: options.keepalive,
        body: { action, repositoryId: input.repositoryId || 'default', examId: input.examId, preview: Boolean(input.preview), ...input.body }
      });
    },
    imageUrl(input, ref) {
      const params = new URLSearchParams({ action: 'image', repo: input.repositoryId || 'default', exam: input.examId, ref });
      if (input.preview) params.set('preview', '1');
      return `${ENDPOINT}?${params}`;
    }
  };
  root.ChemExamClient = api;
})(window);
