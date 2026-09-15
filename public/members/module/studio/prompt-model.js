(function exposePromptStudioModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemPromptStudioModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptStudioModel() {
  'use strict';

  const SAFE_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(json|txt)$/i;
  const EXPLICIT_HEADER = /^::punkt[ \t]+([1-9]\d{0,3})[ \t]*$/i;
  const SIMPLE_HEADER = /^([1-9]\d{0,3})[.)][ \t]+(.+)$/;
  const MAX_FILE_BYTES = 256 * 1024;
  const MAX_PROMPT_CHARS = 10_000;
  const MAX_POINTS = 100;
  let uidCounter = 0;

  function uid(prefix) {
    uidCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
  }

  function cleanString(value) {
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : '';
  }

  function formatFromFilename(filename) {
    return /\.txt$/i.test(String(filename || '')) ? 'txt' : 'json';
  }

  function validateFilename(value) {
    const filename = typeof value === 'string' ? value.trim() : '';
    return SAFE_FILENAME.test(filename) ? filename : '';
  }

  function filenameForFormat(value, format) {
    const selected = format === 'txt' ? 'txt' : 'json';
    const filename = String(value || '').trim();
    const stem = filename.replace(/\.(?:json|txt)$/i, '') || 'nowy-prompt';
    return `${stem}.${selected}`;
  }

  function createPoint(source = {}, index = 0) {
    const requestedNumber = Number(source.number);
    return {
      id: typeof source.id === 'string' && source.id ? source.id : uid('prompt-point'),
      number: Number.isSafeInteger(requestedNumber) && requestedNumber >= 1 && requestedNumber <= 9999
        ? requestedNumber
        : index + 1,
      content: cleanString(source.content)
    };
  }

  function createPrompt(source = {}) {
    const requestedFormat = source.format === 'txt' || source.format === 'json'
      ? source.format
      : '';
    const requestedFilename = validateFilename(source.filename);
    const format = requestedFormat || (requestedFilename ? formatFromFilename(requestedFilename) : 'json');
    const filename = requestedFilename || `nowy-prompt.${format}`;
    const points = Array.isArray(source.points)
      ? source.points.slice(0, MAX_POINTS).map(createPoint)
      : [];
    return {
      filename,
      format,
      instruction: cleanString(source.instruction),
      points: format === 'txt'
        ? (points.length ? points : [createPoint({ number: 1, content: '' })])
        : points
    };
  }

  function extractJsonPrompt(value) {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === 'string').join('\n').trim();
    }
    if (value && typeof value === 'object') {
      for (const key of ['prompt', 'system', 'text', 'value', 'content']) {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        if (Array.isArray(candidate)) {
          const joined = candidate.filter((item) => typeof item === 'string').join('\n').trim();
          if (joined) return joined;
        }
      }
    }
    return '';
  }

  function parseTxt(source) {
    const text = cleanString(source).replace(/^\uFEFF/, '');
    const lines = text.split('\n');
    const explicit = lines.some((line) => EXPLICIT_HEADER.test(line));
    const points = [];
    const seen = new Set();
    let currentNumber = null;
    let currentLines = [];

    const save = () => {
      if (currentNumber === null) return;
      const content = currentLines.join('\n').trim();
      if (!content || seen.has(currentNumber)) {
        throw new Error('Każdy punkt TXT musi mieć unikalny numer i niepustą instrukcję.');
      }
      seen.add(currentNumber);
      points.push(createPoint({ number: currentNumber, content }, points.length));
    };

    for (const line of lines) {
      const header = explicit ? EXPLICIT_HEADER.exec(line) : SIMPLE_HEADER.exec(line);
      if (header) {
        save();
        currentNumber = Number(header[1]);
        currentLines = explicit ? [] : [header[2].trim()];
        continue;
      }
      if (currentNumber === null) {
        if (line.trim()) {
          throw new Error('Plik TXT musi rozpoczynać się od nagłówka „::punkt 1”.');
        }
        continue;
      }
      currentLines.push(line);
    }
    save();
    if (!points.length) throw new Error('Plik TXT nie zawiera żadnego punktu.');
    return points;
  }

  function parsePrompt(source, rawFilename) {
    const filename = validateFilename(rawFilename);
    if (!filename) throw new Error('Nieprawidłowa nazwa pliku promptu.');
    const format = formatFromFilename(filename);
    if (format === 'json') {
      let parsed;
      try {
        parsed = JSON.parse(cleanString(source).replace(/^\uFEFF/, ''));
      } catch {
        throw new Error('Plik JSON nie zawiera poprawnego JSON.');
      }
      const instruction = extractJsonPrompt(parsed);
      if (!instruction) throw new Error('JSON nie zawiera pola prompt, system, text, value ani content.');
      return createPrompt({ filename, format, instruction });
    }
    return createPrompt({ filename, format, points: parseTxt(source) });
  }

  function byteLength(value) {
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8');
    return new TextEncoder().encode(value).byteLength;
  }

  function serializeUnchecked(prompt) {
    if (prompt.format === 'json') {
      return `${JSON.stringify({ prompt: prompt.instruction.trim() }, null, 2)}\n`;
    }
    return `${prompt.points
      .map((point) => `::punkt ${point.number}\n${point.content.trim()}`)
      .join('\n\n')}\n`;
  }

  function validatePrompt(source) {
    const prompt = createPrompt(source);
    const errors = [];
    const filename = validateFilename(prompt.filename);
    if (!filename) {
      errors.push({ code: 'INVALID_FILENAME', message: 'Nazwa musi kończyć się przez .json lub .txt i nie może zawierać ścieżki.' });
    } else if (formatFromFilename(filename) !== prompt.format) {
      errors.push({ code: 'FORMAT_MISMATCH', message: 'Rozszerzenie pliku nie odpowiada wybranemu formatowi.' });
    }

    if (prompt.format === 'json') {
      const instruction = prompt.instruction.trim();
      if (!instruction) errors.push({ code: 'EMPTY_PROMPT', message: 'Wpisz instrukcję dla asystenta.' });
      if (instruction.length > MAX_PROMPT_CHARS) {
        errors.push({ code: 'PROMPT_TOO_LONG', message: `Instrukcja może mieć maksymalnie ${MAX_PROMPT_CHARS} znaków.` });
      }
    } else {
      if (!prompt.points.length) errors.push({ code: 'EMPTY_POINTS', message: 'Dodaj co najmniej jeden punkt promptu.' });
      if (prompt.points.length > MAX_POINTS) errors.push({ code: 'TOO_MANY_POINTS', message: `Plik może zawierać maksymalnie ${MAX_POINTS} punktów.` });
      const seen = new Set();
      prompt.points.forEach((point, index) => {
        if (!Number.isSafeInteger(point.number) || point.number < 1 || point.number > 9999) {
          errors.push({ code: 'INVALID_POINT_NUMBER', message: `Punkt ${index + 1} ma nieprawidłowy numer.` });
        } else if (seen.has(point.number)) {
          errors.push({ code: 'DUPLICATE_POINT_NUMBER', message: `Numer punktu ${point.number} występuje więcej niż raz.` });
        }
        seen.add(point.number);
        const content = point.content.trim();
        if (!content) errors.push({ code: 'EMPTY_POINT', message: `Punkt ${point.number || index + 1} nie ma instrukcji.` });
        if (content.length > MAX_PROMPT_CHARS) {
          errors.push({ code: 'POINT_TOO_LONG', message: `Punkt ${point.number || index + 1} przekracza ${MAX_PROMPT_CHARS} znaków.` });
        }
        if (content.split('\n').some((line) => EXPLICIT_HEADER.test(line))) {
          errors.push({ code: 'NESTED_POINT_HEADER', message: `Treść punktu ${point.number || index + 1} zawiera zarezerwowany nagłówek ::punkt.` });
        }
      });
    }

    if (!errors.length) {
      const output = serializeUnchecked(prompt);
      if (byteLength(output) > MAX_FILE_BYTES) {
        errors.push({ code: 'FILE_TOO_LARGE', message: 'Plik promptu przekracza 256 KiB.' });
      }
    }
    return { valid: errors.length === 0, errors, prompt };
  }

  function serializePrompt(source) {
    const validation = validatePrompt(source);
    if (!validation.valid) throw new Error(validation.errors[0].message);
    return serializeUnchecked(validation.prompt);
  }

  return {
    MAX_FILE_BYTES,
    MAX_POINTS,
    MAX_PROMPT_CHARS,
    createPoint,
    createPrompt,
    extractJsonPrompt,
    filenameForFormat,
    formatFromFilename,
    parsePrompt,
    parseTxt,
    serializePrompt,
    validateFilename,
    validatePrompt
  };
});
