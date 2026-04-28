import { describe, it, expect } from 'vitest';
import { isProcessRequest, isProcessResponse } from '~/lib/messages';

describe('messages', () => {
  it('accepts valid translate request', () => {
    expect(
      isProcessRequest({
        type: 'process',
        mode: 'translate',
        text: 'hello',
        targetLang: 'uk',
      }),
    ).toBe(true);
  });

  it('rejects missing mode', () => {
    expect(isProcessRequest({ type: 'process', text: 'hi', targetLang: 'uk' })).toBe(false);
  });

  it('accepts valid response', () => {
    expect(isProcessResponse({ ok: true, result: 'привіт', provider: 'gemini' })).toBe(true);
  });

  it('accepts error response', () => {
    expect(isProcessResponse({ ok: false, code: 'quota_exhausted', message: '...' })).toBe(true);
  });
});
