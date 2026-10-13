'use strict';
const contentRepository = require('./content-repository.js');
const MAX_PROMPT_FILE_BYTES = 256 * 1024;
const MAX_PROMPT_CHARS = 10_000;
const SAFE_PROMPT_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(json|txt)$/i;
const PROMPT_POINT_HEADER = /^::punkt[ \t]+([1-9]\d{0,3})[ \t]*$/i;
const SIMPLE_PROMPT_POINT_HEADER = /^([1-9]\d{0,3})[.)][ \t]+(.+)$/;

class PromptFileError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'PromptFileError';
    this.code = code;
    this.status = status;
  }
}

function validatePromptConfig(raw) {
  if (raw == null) return { ok: true, value: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'INVALID_PROMPT_CONFIG' };
  }

  const keys = Object.keys(raw);
  if (keys.some((key) => !['filename', 'point', 'repositoryId'].includes(key))) {
    return { ok: false, code: 'INVALID_PROMPT_CONFIG' };
  }

  const filename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
  if (!SAFE_PROMPT_FILENAME.test(filename)) {
    return { ok: false, code: 'INVALID_PROMPT_CONFIG' };
  }

  const repositoryId = typeof raw.repositoryId === 'string'
    ? raw.repositoryId.trim().toLowerCase()
    : '';
  if (repositoryId && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(repositoryId)) {
    return { ok: false, code: 'INVALID_PROMPT_CONFIG' };
  }

  const format = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  if (format === 'txt' && raw.point != null) {
    if (!Number.isSafeInteger(raw.point) || raw.point < 1 || raw.point > 9_999) {
      return { ok: false, code: 'INVALID_PROMPT_CONFIG' };
    }
    return { ok: true, value: { filename, repositoryId, format, point: raw.point } };
  }

  if (raw.point != null) return { ok: false, code: 'INVALID_PROMPT_CONFIG' };
  return { ok: true, value: { filename, repositoryId, format, point: null } };
}

function parseNumberedPromptFile(rawText, selectedPoint) {
  const text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.includes('\0')) throw new PromptFileError('PROMPT_FILE_INVALID');

  // `::punkt N` is the preferred, unambiguous format. A file without any
  // explicit headers may also use the convenient `1. instruction` syntax.
  // Mixing both syntaxes is intentionally not supported.
  const lines = text.split('\n');
  const usesExplicitHeaders = lines.some((line) => PROMPT_POINT_HEADER.test(line));
  const firstLine = lines.find(line => line.trim()) || '';
  if (!usesExplicitHeaders && !SIMPLE_PROMPT_POINT_HEADER.test(firstLine)) {
    if (!text.trim()) throw new PromptFileError('PROMPT_FILE_INVALID');
    if (selectedPoint !== 1) throw new PromptFileError('PROMPT_POINT_NOT_FOUND');
    return text.trim();
  }

  const points = new Map();
  let currentNumber = null;
  let currentLines = [];

  const saveCurrent = () => {
    if (currentNumber === null) return;
    const content = currentLines.join('\n').trim();
    if (!content || points.has(currentNumber)) throw new PromptFileError('PROMPT_FILE_INVALID');
    points.set(currentNumber, content);
  };

  for (const line of lines) {
    const header = usesExplicitHeaders
      ? PROMPT_POINT_HEADER.exec(line)
      : SIMPLE_PROMPT_POINT_HEADER.exec(line);
    if (header) {
      saveCurrent();
      const number = Number(header[1]);
      if (points.has(number)) throw new PromptFileError('PROMPT_FILE_INVALID');
      currentNumber = number;
      currentLines = usesExplicitHeaders ? [] : [header[2].trim()];
      continue;
    }

    if (currentNumber === null) {
      if (line.trim()) throw new PromptFileError('PROMPT_FILE_INVALID');
      continue;
    }
    currentLines.push(line);
  }
  saveCurrent();

  if (!points.size) throw new PromptFileError('PROMPT_FILE_INVALID');
  const selected = points.get(selectedPoint);
  if (!selected) throw new PromptFileError('PROMPT_POINT_NOT_FOUND');
  return selected;
}

function extractJsonPrompt(data) {
  if (typeof data === 'string') return data.trim();
  if (Array.isArray(data)) return data.filter((item) => typeof item === 'string').join('\n').trim();
  if (data && typeof data === 'object') {
    for (const key of ['prompt', 'instructions', 'instruction', 'system', 'systemInstruction', 'text', 'value', 'content']) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        const joined = value.filter((item) => typeof item === 'string').join('\n').trim();
        if (joined) return joined;
      }
    }
  }
  return '';
}

function parsePromptFile(buffer, promptConfig) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength > MAX_PROMPT_FILE_BYTES) {
    throw new PromptFileError('PROMPT_FILE_TOO_LARGE');
  }

  let rawText;
  try {
    rawText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new PromptFileError('PROMPT_FILE_INVALID');
  }
  let selected = '';
  if (promptConfig.format === 'txt') {
    selected = promptConfig.point == null
      ? rawText.replace(/^\uFEFF/, '').trim()
      : parseNumberedPromptFile(rawText, promptConfig.point);
    if (!selected || selected.includes('\0')) throw new PromptFileError('PROMPT_FILE_INVALID');
  } else {
    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/^\uFEFF/, ''));
    } catch {
      throw new PromptFileError('PROMPT_FILE_INVALID');
    }
    selected = extractJsonPrompt(parsed);
    if (!selected) throw new PromptFileError('PROMPT_FILE_INVALID');
  }

  if (selected.length > MAX_PROMPT_CHARS) throw new PromptFileError('PROMPT_TOO_LONG');
  return selected;
}

async function loadPromptInstruction(promptConfig, options = {}) {
  if (!promptConfig) return '';
  const readPrompt = typeof options.readPrompt === 'function'
    ? options.readPrompt
    : async (filename, repositoryId) => contentRepository.readAsset(
      'prompt',
      filename,
      { repositoryId }
    );
  try {
    const asset = await readPrompt(promptConfig.filename, promptConfig.repositoryId);
    const content = asset && typeof asset.content === 'string' ? asset.content : '';
    if (!content) throw new PromptFileError('PROMPT_FILE_INVALID');
    return parsePromptFile(Buffer.from(content, 'utf8'), promptConfig);
  } catch (error) {
    if (error instanceof PromptFileError) throw error;
    if (
      error instanceof contentRepository.ContentRepositoryError &&
      error.code === 'CONTENT_FILE_NOT_FOUND'
    ) {
      throw new PromptFileError('PROMPT_NOT_FOUND', 404);
    }
    throw new PromptFileError('PROMPT_UNAVAILABLE', 503);
  }
}

module.exports = { PromptFileError, validatePromptConfig, parseNumberedPromptFile, parsePromptFile, loadPromptInstruction };
