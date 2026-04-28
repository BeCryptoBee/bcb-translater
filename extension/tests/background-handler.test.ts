import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProcessRequest } from '~/lib/messages';
import type { StorageAdapter } from '~/lib/cache';

// Mock external collaborators so we can drive control flow precisely.
vi.mock('~/lib/llm-fallback', () => ({
  callWithFallback: vi.fn(),
}));
vi.mock('~/lib/providers/proxy', () => ({
  callProxy: vi.fn(),
}));

import { handleProcess } from '~/lib/background-handler';
import { callWithFallback } from '~/lib/llm-fallback';
import { callProxy } from '~/lib/providers/proxy';

const callWithFallbackMock = callWithFallback as unknown as ReturnType<typeof vi.fn>;
const callProxyMock = callProxy as unknown as ReturnType<typeof vi.fn>;

function createMemoryStore(): StorageAdapter & { dump: () => Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    async get(keys: string[]) {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (k in data) out[k] = data[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) {
        data[k] = v;
      }
    },
    async remove(keys: string[]) {
      for (const k of keys) delete data[k];
    },
    dump() {
      return { ...data };
    },
  };
}

interface ChromeStub {
  syncData: Record<string, unknown>;
  localData: Record<string, unknown>;
}

function stubChrome(initial?: Partial<ChromeStub>): ChromeStub {
  const syncData: Record<string, unknown> = { ...(initial?.syncData ?? {}) };
  const localData: Record<string, unknown> = { ...(initial?.localData ?? {}) };

  function makeArea(target: Record<string, unknown>) {
    return {
      async get(keys: string[] | string | Record<string, unknown> | null) {
        const out: Record<string, unknown> = {};
        if (keys == null) {
          return { ...target };
        }
        if (typeof keys === 'string') {
          if (keys in target) out[keys] = target[keys];
          return out;
        }
        if (Array.isArray(keys)) {
          for (const k of keys) {
            if (k in target) out[k] = target[k];
          }
          return out;
        }
        // object-with-defaults form: returns defaults overlaid by stored values
        for (const [k, def] of Object.entries(keys)) {
          out[k] = k in target ? target[k] : def;
        }
        return out;
      },
      async set(items: Record<string, unknown>) {
        for (const [k, v] of Object.entries(items)) target[k] = v;
      },
      async remove(keys: string[] | string) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete target[k];
      },
    };
  }

  vi.stubGlobal('chrome', {
    storage: { sync: makeArea(syncData), local: makeArea(localData) },
  });
  return { syncData, localData };
}

const baseReq: ProcessRequest = {
  type: 'process',
  mode: 'translate',
  text: 'Hello, world!',
  targetLang: 'uk',
};

describe('handleProcess', () => {
  beforeEach(() => {
    callWithFallbackMock.mockReset();
    callProxyMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns invalid_input for empty text', async () => {
    stubChrome();
    const store = createMemoryStore();
    const r = await handleProcess({ ...baseReq, text: '   ' }, store);
    expect(r).toEqual({ ok: false, code: 'invalid_input', message: expect.any(String) });
    expect(callWithFallbackMock).not.toHaveBeenCalled();
    expect(callProxyMock).not.toHaveBeenCalled();
  });

  it('returns too_long for text > 10 KB', async () => {
    stubChrome();
    const store = createMemoryStore();
    const big = 'a'.repeat(10_001);
    const r = await handleProcess({ ...baseReq, text: big }, store);
    expect(r).toEqual({ ok: false, code: 'too_long', message: expect.any(String) });
    expect(callWithFallbackMock).not.toHaveBeenCalled();
    expect(callProxyMock).not.toHaveBeenCalled();
  });

  it('returns cached result with cached:true on cache hit', async () => {
    stubChrome();
    const store = createMemoryStore();
    // Pre-warm cache by running once with own-key path.
    callWithFallbackMock.mockResolvedValueOnce({ text: 'привіт', provider: 'gemini' });
    stubChrome({ syncData: { userApiKey: 'k', provider: 'auto', targetLang: 'uk' } });
    const first = await handleProcess(baseReq, store);
    expect(first.ok).toBe(true);

    // Second call should hit the cache and NOT call providers again.
    callWithFallbackMock.mockClear();
    callProxyMock.mockClear();
    const second = await handleProcess(baseReq, store);
    expect(second).toMatchObject({ ok: true, result: 'привіт', provider: 'gemini', cached: true });
    expect(callWithFallbackMock).not.toHaveBeenCalled();
    expect(callProxyMock).not.toHaveBeenCalled();
  });

  it('uses own-key path (callWithFallback) when userApiKey is set', async () => {
    stubChrome({ syncData: { userApiKey: 'sk-x', provider: 'gemini', targetLang: 'uk' } });
    const store = createMemoryStore();
    callWithFallbackMock.mockResolvedValueOnce({ text: 'translated', provider: 'gemini' });

    const r = await handleProcess(baseReq, store);
    expect(r).toMatchObject({ ok: true, result: 'translated', provider: 'gemini' });
    expect(callWithFallbackMock).toHaveBeenCalledTimes(1);
    expect(callProxyMock).not.toHaveBeenCalled();
    const args = callWithFallbackMock.mock.calls[0]!;
    expect(args[0]).toBe('gemini');
    expect(args[1].apiKey).toBe('sk-x');
    expect(args[1].temperature).toBe(0.3);
    expect(typeof args[1].prompt).toBe('string');
    expect(args[1].prompt).toContain('Hello, world!');
  });

  it('uses proxy path when userApiKey is empty and increments local quota', async () => {
    const env = stubChrome({ syncData: { userApiKey: '', provider: 'auto', targetLang: 'uk' } });
    const store = createMemoryStore();
    callProxyMock.mockResolvedValueOnce({ text: 'p-result', provider: 'groq', remainingQuota: 99 });

    const r = await handleProcess(baseReq, store);
    expect(r).toMatchObject({
      ok: true,
      result: 'p-result',
      provider: 'groq',
      remainingQuota: 99,
    });
    expect(callProxyMock).toHaveBeenCalledTimes(1);
    expect(callWithFallbackMock).not.toHaveBeenCalled();
    const args = callProxyMock.mock.calls[0]![0];
    expect(args.mode).toBe('translate');
    expect(args.text).toBe('Hello, world!');
    expect(args.targetLang).toBe('uk');
    expect(typeof args.installId).toBe('string');
    expect(args.installId.length).toBeGreaterThan(0);

    // local quota should be incremented for today
    const todayKey = 'quota_' + new Date().toISOString().slice(0, 10);
    expect(env.localData[todayKey]).toBe(1);
  });

  it('returns quota_exhausted on rate_limit error', async () => {
    stubChrome({ syncData: { userApiKey: 'k', provider: 'auto', targetLang: 'uk' } });
    const store = createMemoryStore();
    callWithFallbackMock.mockRejectedValueOnce({ kind: 'rate_limit' });

    const r = await handleProcess(baseReq, store);
    expect(r).toEqual({
      ok: false,
      code: 'quota_exhausted',
      message: expect.any(String),
    });
  });

  it('returns network_error on network error', async () => {
    stubChrome({ syncData: { userApiKey: 'k', provider: 'auto', targetLang: 'uk' } });
    const store = createMemoryStore();
    callWithFallbackMock.mockRejectedValueOnce({ kind: 'network' });

    const r = await handleProcess(baseReq, store);
    expect(r).toEqual({
      ok: false,
      code: 'network_error',
      message: expect.any(String),
    });
  });

  it('returns provider_error for any other failure', async () => {
    stubChrome({ syncData: { userApiKey: 'k', provider: 'auto', targetLang: 'uk' } });
    const store = createMemoryStore();
    callWithFallbackMock.mockRejectedValueOnce({ kind: 'malformed' });

    const r = await handleProcess(baseReq, store);
    expect(r).toEqual({
      ok: false,
      code: 'provider_error',
      message: expect.any(String),
    });
  });

  it('retries translation once when result strips line breaks (own-key path)', async () => {
    stubChrome({ syncData: { userApiKey: 'k', provider: 'gemini', targetLang: 'uk' } });
    const store = createMemoryStore();
    const multiline = 'Line one.\nLine two.\nLine three.';
    callWithFallbackMock
      .mockResolvedValueOnce({ text: 'one two three', provider: 'gemini' }) // strips newlines
      .mockResolvedValueOnce({ text: 'один\nдва\nтри', provider: 'gemini' });

    const r = await handleProcess({ ...baseReq, text: multiline }, store);
    expect(r).toMatchObject({ ok: true, result: 'один\nдва\nтри', provider: 'gemini' });
    expect(callWithFallbackMock).toHaveBeenCalledTimes(2);
    // The reinforced prompt must mention the line-break reminder.
    const secondCall = callWithFallbackMock.mock.calls[1]!;
    expect(secondCall[1].prompt).toContain('REMINDER');
  });

  it('keeps original result if retry fails', async () => {
    stubChrome({ syncData: { userApiKey: 'k', provider: 'gemini', targetLang: 'uk' } });
    const store = createMemoryStore();
    const multiline = 'Line one.\nLine two.\nLine three.';
    callWithFallbackMock
      .mockResolvedValueOnce({ text: 'one two three', provider: 'gemini' })
      .mockRejectedValueOnce({ kind: 'network' });

    const r = await handleProcess({ ...baseReq, text: multiline }, store);
    expect(r).toMatchObject({ ok: true, result: 'one two three', provider: 'gemini' });
    expect(callWithFallbackMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry for summarize even if newlines drop', async () => {
    stubChrome({ syncData: { userApiKey: 'k', provider: 'gemini', targetLang: 'uk' } });
    const store = createMemoryStore();
    const multiline = 'Line one.\nLine two.\nLine three.';
    callWithFallbackMock.mockResolvedValueOnce({ text: 'short summary', provider: 'gemini' });

    const r = await handleProcess(
      { ...baseReq, mode: 'summarize', text: multiline },
      store,
    );
    expect(r).toMatchObject({ ok: true, result: 'short summary' });
    expect(callWithFallbackMock).toHaveBeenCalledTimes(1);
  });
});
