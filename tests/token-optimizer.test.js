'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compressSystemPrompt, estimateTokenCount, slidingContextWindow } = require('../netlify/token-optimizer.js');

describe('compressSystemPrompt', () => {
  it('usuwa nadmiarowe białe znaki', () => {
    const input = 'linia 1\n\n\n\nlinia 2\n\nlinia 3';
    const result = compressSystemPrompt(input);
    assert.ok(!result.includes('\n\n\n'), 'powinien usunąć potrójne nowe linie');
  });

  it('zachowuje zawartość semantyczną', () => {
    const input = 'Jesteś asystentem. Odpowiadaj po polsku.';
    const result = compressSystemPrompt(input);
    assert.ok(result.includes('asystentem'), 'zachowuje słowa kluczowe');
    assert.ok(result.includes('polsku'), 'zachowuje słowa kluczowe');
  });

  it('kompresja skraca tekst złożony z redundantnych spacji', () => {
    const input = 'słowo1   słowo2\t\tsłowo3';
    const result = compressSystemPrompt(input);
    assert.ok(result.length < input.length, 'wynik jest krótszy');
  });

  it('zwraca pusty string dla pustego wejścia', () => {
    assert.strictEqual(compressSystemPrompt(''), '');
    assert.strictEqual(compressSystemPrompt(null), '');
  });
});

describe('estimateTokenCount', () => {
  it('szacuje 1 token na 4 znaki', () => {
    assert.strictEqual(estimateTokenCount('abcd'), 1);
    assert.strictEqual(estimateTokenCount('abcdefgh'), 2);
  });

  it('zaokrągla w górę', () => {
    assert.strictEqual(estimateTokenCount('abc'), 1);
    assert.strictEqual(estimateTokenCount('abcde'), 2);
  });

  it('zwraca 0 dla pustego tekstu', () => {
    assert.strictEqual(estimateTokenCount(''), 0);
    assert.strictEqual(estimateTokenCount(null), 0);
  });
});

describe('slidingContextWindow', () => {
  function makeMessages(count) {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Wiadomość numer ${i + 1} z treścią.`
    }));
  }

  it('zwraca wszystkie wiadomości gdy mieszczą się w limicie', () => {
    const messages = makeMessages(4);
    const result = slidingContextWindow(messages, { maxTotalChars: 10000, keepLastN: 4 });
    assert.strictEqual(result.length, 4);
  });

  it('zawsze zachowuje keepLastN ostatnich wiadomości', () => {
    const messages = makeMessages(10);
    const result = slidingContextWindow(messages, { maxTotalChars: 50, keepLastN: 4 });
    const last4 = messages.slice(-4);
    assert.deepStrictEqual(result.slice(-4), last4);
  });

  it('przycina starsze wiadomości gdy przekroczony limit', () => {
    const messages = makeMessages(10);
    const result = slidingContextWindow(messages, { maxTotalChars: 100, keepLastN: 2 });
    assert.ok(result.length < messages.length, 'wynik jest krótszy');
    assert.deepStrictEqual(result.slice(-2), messages.slice(-2));
  });

  it('zwraca pustą tablicę dla pustego wejścia', () => {
    assert.deepStrictEqual(slidingContextWindow([]), []);
    assert.deepStrictEqual(slidingContextWindow(null), []);
  });

  it('skraca starsze wiadomości do maxOldMessageChars', () => {
    const longContent = 'x'.repeat(1000);
    const messages = [
      { role: 'user', content: longContent },
      { role: 'assistant', content: longContent },
      { role: 'user', content: 'nowe pytanie' }
    ];
    const result = slidingContextWindow(messages, { maxTotalChars: 5000, keepLastN: 1, maxOldMessageChars: 50 });
    const olderMsgs = result.slice(0, -1);
    for (const msg of olderMsgs) {
      assert.ok(msg.content.length <= 51, `wiadomość powinna być skrócona: ${msg.content.length}`);
    }
  });
});

