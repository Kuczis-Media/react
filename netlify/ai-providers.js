'use strict';

const REQUEST_TIMEOUT_MS = 45_000;

class AiProviderError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'AiProviderError';
    this.code = code;
    this.status = status;
  }
}

function getAdapter(provider) {
  if (provider === 'openai') return openAiAdapter;
  if (provider === 'gemini') return geminiAdapter;
  throw new AiProviderError('INVALID_AI_PROVIDER', 400);
}

const geminiAdapter = Object.freeze({
  id: 'gemini',
  async sendRequest(config, request, runtime = {}) {
    const contents = request.messages.map((message, index) => {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      if (index === request.messages.length - 1) {
        for (const attachment of request.attachments || []) {
          parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
        }
      }
      return { role: message.role === 'assistant' ? 'model' : 'user', parts };
    });
    const payload = {
      contents,
      generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxOutputTokens }
    };
    if (request.system) payload.systemInstruction = { role: 'user', parts: [{ text: request.system }] };
    const response = await providerFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify(payload)
      }, runtime
    );
    const data = await readProviderJson(response);
    if (!response.ok) throw errorFromResponse(response, data);
    const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => typeof part.text === 'string' ? part.text : '').join('');
    if (!text) throw new AiProviderError('EMPTY_MODEL_RESPONSE', 502);
    return { text, usage: normalizeGeminiUsage(data?.usageMetadata) };
  },
  async testConnection(config, runtime = {}) {
    const response = await providerFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}`,
      { headers: { Accept: 'application/json', 'x-goog-api-key': config.apiKey } }, runtime
    );
    await consumeProviderResponse(response);
    return { status: 'ok' };
  },
  async listModels(config, runtime = {}) {
    const response = await providerFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { Accept: 'application/json', 'x-goog-api-key': config.apiKey }
    }, runtime);
    const data = await readProviderJson(response);
    if (!response.ok) throw errorFromResponse(response, data);
    return (Array.isArray(data?.models) ? data.models : [])
      .filter((item) => !Array.isArray(item.supportedGenerationMethods) || item.supportedGenerationMethods.includes('generateContent'))
      .map((item) => ({ id: String(item.name || '').replace(/^models\//, ''), name: String(item.displayName || item.name || '') }))
      .filter((item) => item.id);
  },
  async * sendRequestStream(config, request, runtime = {}) {
    const contents = request.messages.map((message, index) => {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      if (index === request.messages.length - 1) {
        for (const attachment of request.attachments || []) {
          parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
        }
      }
      return { role: message.role === 'assistant' ? 'model' : 'user', parts };
    });
    const payload = {
      contents,
      generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxOutputTokens }
    };
    if (request.system) payload.systemInstruction = { role: 'user', parts: [{ text: request.system }] };
    const fetchImpl = runtime.fetchImpl || global.fetch;
    if (typeof fetchImpl !== 'function') throw new AiProviderError('AI_PROVIDER_ERROR', 502);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs || REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted || error?.name === 'AbortError') throw new AiProviderError('AI_PROVIDER_TIMEOUT', 504);
      throw new AiProviderError('AI_PROVIDER_ERROR', 502);
    }
    if (!response.ok) {
      clearTimeout(timeout);
      const data = await readProviderJson(response);
      throw errorFromResponse(response, data);
    }
    let usage = null;
    try {
      for await (const line of readSseLines(response)) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(raw); } catch { continue; }
        const token = (chunk?.candidates?.[0]?.content?.parts || [])
          .map((p) => typeof p.text === 'string' ? p.text : '').join('');
        if (chunk?.usageMetadata) usage = normalizeGeminiUsage(chunk.usageMetadata);
        if (token) yield { token, done: false };
      }
    } finally {
      clearTimeout(timeout);
    }
    yield { token: '', done: true, usage };
  },
  normalizeUsage: normalizeGeminiUsage,
  normalizeError
});

const openAiAdapter = Object.freeze({
  id: 'openai',
  async sendRequest(config, request, runtime = {}) {
    const input = request.messages.map((message, index) => {
      if (index === request.messages.length - 1 && (request.attachments || []).length) {
        const content = [];
        if (message.content) content.push({ type: 'input_text', text: message.content });
        (request.attachments || []).forEach((attachment) => content.push({
          type: 'input_image', image_url: `data:${attachment.mimeType};base64,${attachment.data}`
        }));
        return { role: message.role, content };
      }
      return { role: message.role, content: message.content };
    });
    const response = await providerFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        instructions: request.system || undefined,
        input,
        max_output_tokens: request.maxOutputTokens,
        store: false
      })
    }, runtime);
    const data = await readProviderJson(response);
    if (!response.ok) throw errorFromResponse(response, data);
    const text = (Array.isArray(data?.output) ? data.output : [])
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .map((part) => part?.type === 'output_text' && typeof part.text === 'string' ? part.text : '')
      .join('');
    if (!text) throw new AiProviderError('EMPTY_MODEL_RESPONSE', 502);
    return { text, usage: normalizeOpenAiUsage(data?.usage) };
  },
  async testConnection(config, runtime = {}) {
    const response = await providerFetch(`https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${config.apiKey}` }
    }, runtime);
    await consumeProviderResponse(response);
    return { status: 'ok' };
  },
  async listModels(config, runtime = {}) {
    const response = await providerFetch('https://api.openai.com/v1/models', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${config.apiKey}` }
    }, runtime);
    const data = await readProviderJson(response);
    if (!response.ok) throw errorFromResponse(response, data);
    return (Array.isArray(data?.data) ? data.data : [])
      .map((item) => ({ id: String(item.id || ''), name: String(item.id || '') }))
      .filter((item) => item.id)
      .sort((left, right) => left.id.localeCompare(right.id));
  },
  async * sendRequestStream(config, request, runtime = {}) {
    const input = request.messages.map((message, index) => {
      if (index === request.messages.length - 1 && (request.attachments || []).length) {
        const content = [];
        if (message.content) content.push({ type: 'input_text', text: message.content });
        (request.attachments || []).forEach((attachment) => content.push({
          type: 'input_image', image_url: `data:${attachment.mimeType};base64,${attachment.data}`
        }));
        return { role: message.role, content };
      }
      return { role: message.role, content: message.content };
    });
    const fetchImpl = runtime.fetchImpl || global.fetch;
    if (typeof fetchImpl !== 'function') throw new AiProviderError('AI_PROVIDER_ERROR', 502);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs || REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          instructions: request.system || undefined,
          input,
          max_output_tokens: request.maxOutputTokens,
          store: false,
          stream: true
        }),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted || error?.name === 'AbortError') throw new AiProviderError('AI_PROVIDER_TIMEOUT', 504);
      throw new AiProviderError('AI_PROVIDER_ERROR', 502);
    }
    if (!response.ok) {
      clearTimeout(timeout);
      const data = await readProviderJson(response);
      throw errorFromResponse(response, data);
    }
    let usage = null;
    try {
      for await (const line of readSseLines(response)) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(raw); } catch { continue; }
        if (chunk?.type === 'response.output_text.delta' && typeof chunk.delta === 'string') {
          if (chunk.delta) yield { token: chunk.delta, done: false };
        } else if (chunk?.type === 'response.completed' && chunk?.response?.usage) {
          usage = normalizeOpenAiUsage(chunk.response.usage);
        } else if (chunk?.choices?.[0]?.delta?.content) {
          yield { token: chunk.choices[0].delta.content, done: false };
        }
      }
    } finally {
      clearTimeout(timeout);
    }
    yield { token: '', done: true, usage };
  },
  normalizeUsage: normalizeOpenAiUsage,
  normalizeError
});

async function providerFetch(url, options, runtime) {
  const fetchImpl = runtime.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new AiProviderError('AI_PROVIDER_ERROR', 502);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new AiProviderError('AI_PROVIDER_TIMEOUT', 504);
    }
    throw new AiProviderError('AI_PROVIDER_ERROR', 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function consumeProviderResponse(response) {
  if (!response.ok) {
    const data = await readProviderJson(response);
    throw errorFromResponse(response, data);
  }
  try { await response.text(); } catch {}
}

async function readProviderJson(response) {
  try { return await response.json(); } catch { return null; }
}

function errorFromResponse(response, data) {
  const providerCode = String(data?.error?.code || data?.error?.status || '').toLowerCase();
  const providerType = String(data?.error?.type || '').toLowerCase();
  if (response.status === 401 || providerCode.includes('api_key_invalid') || providerCode === 'invalid_api_key') {
    return new AiProviderError('AI_INVALID_KEY', 400);
  }
  if (response.status === 403) return new AiProviderError('AI_PERMISSION_DENIED', 403);
  if (response.status === 404) return new AiProviderError('AI_MODEL_UNAVAILABLE', 400);
  if (response.status === 429) {
    if (providerCode === 'credit_balance_exhausted') return new AiProviderError('AI_CREDIT_BALANCE_EXHAUSTED', 402);
    if (providerCode === 'organization_spend_limit_exceeded') return new AiProviderError('AI_ORGANIZATION_SPEND_LIMIT_REACHED', 402);
    if (providerCode === 'project_spend_limit_exceeded') return new AiProviderError('AI_PROJECT_SPEND_LIMIT_REACHED', 402);
    if (providerCode === 'organization_usage_limit_exceeded') return new AiProviderError('AI_ORGANIZATION_USAGE_LIMIT_REACHED', 402);
    if (['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active', 'usage_limit_reached'].includes(providerCode)
      || providerType === 'insufficient_quota') return new AiProviderError('AI_QUOTA_EXHAUSTED', 402);
    return new AiProviderError('AI_RATE_LIMITED', 429);
  }
  return new AiProviderError('AI_PROVIDER_ERROR', 502);
}

function normalizeError(error) {
  const code = error && error.code;
  if (code === 'AI_INVALID_KEY') return { status: 'invalid_key', code };
  if (code === 'AI_PERMISSION_DENIED') return { status: 'permission_denied', code };
  if (code === 'AI_MODEL_UNAVAILABLE') return { status: 'model_unavailable', code };
  if (code === 'AI_RATE_LIMITED') return { status: 'rate_limited', code };
  if (code === 'AI_PROVIDER_TIMEOUT') return { status: 'timeout', code };
  if (['AI_CREDIT_BALANCE_EXHAUSTED', 'AI_ORGANIZATION_SPEND_LIMIT_REACHED', 'AI_PROJECT_SPEND_LIMIT_REACHED',
    'AI_ORGANIZATION_USAGE_LIMIT_REACHED', 'AI_QUOTA_EXHAUSTED'].includes(code)) return { status: 'billing_required', code };
  return { status: 'provider_error', code: 'AI_PROVIDER_ERROR' };
}

function normalizeGeminiUsage(value) {
  return {
    inputTokens: finiteInteger(value?.promptTokenCount),
    outputTokens: finiteInteger(value?.candidatesTokenCount),
    totalTokens: finiteInteger(value?.totalTokenCount)
  };
}

function normalizeOpenAiUsage(value) {
  return {
    inputTokens: finiteInteger(value?.input_tokens),
    outputTokens: finiteInteger(value?.output_tokens),
    totalTokens: finiteInteger(value?.total_tokens)
  };
}

function finiteInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function* readSseLines(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) yield line;
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
  } else if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of response.body) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) yield line;
    }
  } else if (typeof response.text === 'function') {
    const text = await response.text();
    for (const line of text.split('\n')) yield line;
  }
  if (buffer.trim()) yield buffer;
}

module.exports = { AiProviderError, getAdapter, geminiAdapter, normalizeError, openAiAdapter, readSseLines };

