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
    // user message is the raw source; system carries the rules.
    expect(args[1].prompt).toBe('Hello, world!');
    expect(typeof args[1].system).toBe('string');
    expect(args[1].system).toMatch(/HARD RULES/);
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
    // The reinforced system prompt must mention the line-break reminder.
    const secondCall = callWithFallbackMock.mock.calls[1]!;
    expect(secondCall[1].system).toContain('REMINDER');
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

  describe('segmented (own-key path, translationHighlight=true)', () => {
    const baseSeg = {
      ...baseReq,
      text: 'Hello. World.',
    };

    it('successful batch returns segments and derived flat result', async () => {
      stubChrome({
        syncData: {
          userApiKey: 'k',
          provider: 'gemini',
          targetLang: 'uk',
          translationHighlight: true,
        },
      });
      const store = createMemoryStore();
      callWithFallbackMock.mockResolvedValueOnce({
        text: JSON.stringify({ translations: ['Привіт.', 'Світ.'] }),
        provider: 'gemini',
      });

      // Use multi-line input so pre-split produces 2 lines.
      const r = await handleProcess(
        { ...baseSeg, text: 'Hello.\nWorld.' },
        store,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.segments).toHaveLength(2);
        expect(r.separators).toEqual(['', '\n']);
        expect(r.result).toBe('Привіт.\nСвіт.');
      }
      expect(callWithFallbackMock).toHaveBeenCalledTimes(1);
      const call = callWithFallbackMock.mock.calls[0]!;
      expect(call[1].jsonMode).toBeDefined();
    });

    it('broken JSON triggers single retry with flat prompt and returns segments=undefined', async () => {
      stubChrome({
        syncData: {
          userApiKey: 'k',
          provider: 'gemini',
          targetLang: 'uk',
          translationHighlight: true,
        },
      });
      const store = createMemoryStore();
      callWithFallbackMock
        .mockResolvedValueOnce({ text: 'not json', provider: 'gemini' })
        .mockResolvedValueOnce({ text: 'Привіт.\nСвіт.', provider: 'gemini' });

      const r = await handleProcess(
        { ...baseSeg, text: 'Hello.\nWorld.' },
        store,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.segments).toBeUndefined();
        expect(r.result).toBe('Привіт.\nСвіт.');
      }
      expect(callWithFallbackMock).toHaveBeenCalledTimes(2);
      expect(callWithFallbackMock.mock.calls[0]![1].jsonMode).toBeDefined();
      expect(callWithFallbackMock.mock.calls[1]![1].jsonMode).toBeUndefined();
    });

    it('multi-paragraph input — separators preserve \\n\\n exactly', async () => {
      stubChrome({
        syncData: {
          userApiKey: 'k',
          provider: 'gemini',
          targetLang: 'uk',
          translationHighlight: true,
        },
      });
      const store = createMemoryStore();
      callWithFallbackMock.mockResolvedValueOnce({
        text: JSON.stringify({ translations: ['А.', 'Б.', 'В.'] }),
        provider: 'gemini',
      });

      const r = await handleProcess({ ...baseReq, text: 'A.\n\nB.\n\nC.' }, store);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result).toBe('А.\n\nБ.\n\nВ.');
        expect(r.segments).toHaveLength(3);
      }
      expect(callWithFallbackMock).toHaveBeenCalledTimes(1);
    });

    it('translation count mismatch falls back to flat', async () => {
      stubChrome({
        syncData: {
          userApiKey: 'k',
          provider: 'gemini',
          targetLang: 'uk',
          translationHighlight: true,
        },
      });
      const store = createMemoryStore();
      callWithFallbackMock
        .mockResolvedValueOnce({
          // Returns 1 string but pre-split produced 2 lines → mismatch.
          text: JSON.stringify({ translations: ['merged'] }),
          provider: 'gemini',
        })
        .mockResolvedValueOnce({ text: 'flat fallback', provider: 'gemini' });

      const r = await handleProcess(
        { ...baseSeg, text: 'Hello.\nWorld.' },
        store,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.segments).toBeUndefined();
        expect(r.result).toBe('flat fallback');
      }
    });
  });

  describe('segmented cache round-trip', () => {
    it('cache hit on segmented re-translate returns segments + separators', async () => {
      stubChrome({
        syncData: {
          userApiKey: 'k',
          provider: 'gemini',
          targetLang: 'uk',
          translationHighlight: true,
        },
      });
      const store = createMemoryStore();
      const text = 'Hello.\nWorld.';
      callWithFallbackMock.mockResolvedValueOnce({
        text: JSON.stringify({ translations: ['Привіт.', 'Світ.'] }),
        provider: 'gemini',
      });

      // First call: writes JSON envelope to cache.
      const first = await handleProcess(
        { type: 'process', mode: 'translate', text, targetLang: 'uk' },
        store,
      );
      expect(first.ok).toBe(true);
      callWithFallbackMock.mockClear();

      // Second call: cache hit must restore segments + separators.
      const second = await handleProcess(
        { type: 'process', mode: 'translate', text, targetLang: 'uk' },
        store,
      );
      expect(second).toMatchObject({
        ok: true,
        result: 'Привіт.\nСвіт.',
        cached: true,
      });
      if (second.ok) {
        expect(second.segments).toHaveLength(2);
        expect(second.separators).toEqual(['', '\n']);
      }
      expect(callWithFallbackMock).not.toHaveBeenCalled();
    });

    it('legacy plain-string cache entry still works (returns flat without segments)', async () => {
      stubChrome({ syncData: { userApiKey: 'k', provider: 'gemini', targetLang: 'uk' } });
      const store = createMemoryStore();
      // Pre-seed cache with a legacy plain-string entry.
      const cacheKey = await (
        await import('~/lib/cache')
      ).getCacheKey({ mode: 'translate', text: 'hi', targetLang: 'uk' });
      await store.set({
        [cacheKey]: { value: 'привіт', ts: Date.now(), bytes: 10 },
      });

      const r = await handleProcess(
        { type: 'process', mode: 'translate', text: 'hi', targetLang: 'uk' },
        store,
      );
      expect(r).toMatchObject({ ok: true, result: 'привіт', cached: true });
      if (r.ok) expect(r.segments).toBeUndefined();
    });
  });

  describe('segmented (proxy path)', () => {
    it('passes segmented=true to proxy and surfaces segments/separators', async () => {
      stubChrome({
        syncData: {
          userApiKey: '',
          provider: 'auto',
          targetLang: 'uk',
          translationHighlight: true,
        },
      });
      const store = createMemoryStore();
      callProxyMock.mockResolvedValueOnce({
        text: 'А. Б.',
        segments: [
          { src: 'A.', tgt: 'А.' },
          { src: 'B.', tgt: 'Б.' },
        ],
        separators: ['', ' '],
        provider: 'gemini',
        remainingQuota: 100,
      });

      const r = await handleProcess({ ...baseReq, text: 'A. B.' }, store);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.segments).toHaveLength(2);
        expect(r.separators).toEqual(['', ' ']);
        expect(r.result).toBe('А. Б.');
      }
      expect(callProxyMock.mock.calls[0]![0].segmented).toBe(true);
    });
  });

  describe('smartDirection', () => {
    // Use long enough text so franc-min returns a confident detection.
    const ukText =
      'Привіт, як ти сьогодні? Сподіваюся, у тебе все добре і робота йде як по маслу.';
    const enText =
      'Hello there, hope you are doing well today and the work is going smoothly for you.';

    it('uk source -> en target overriding settings.targetLang', async () => {
      stubChrome({ syncData: { userApiKey: 'k', provider: 'gemini', targetLang: 'uk' } });
      const store = createMemoryStore();
      callWithFallbackMock.mockResolvedValueOnce({ text: 'hello', provider: 'gemini' });

      const r = await handleProcess(
        { ...baseReq, text: ukText, smartDirection: true },
        store,
      );
      expect(r.ok).toBe(true);
      const call = callWithFallbackMock.mock.calls[0]!;
      expect(call[1].system).toMatch(/English/);
    });

    it('non-uk source -> targetLang from settings', async () => {
      stubChrome({ syncData: { userApiKey: 'k', provider: 'gemini', targetLang: 'uk' } });
      const store = createMemoryStore();
      callWithFallbackMock.mockResolvedValueOnce({ text: 'привіт', provider: 'gemini' });

      const r = await handleProcess(
        { ...baseReq, text: enText, smartDirection: true },
        store,
      );
      expect(r.ok).toBe(true);
      const call = callWithFallbackMock.mock.calls[0]!;
      expect(call[1].system).toMatch(/Ukrainian/);
    });

    it('smartDirection false uses request targetLang as before', async () => {
      stubChrome({ syncData: { userApiKey: 'k', provider: 'gemini', targetLang: 'uk' } });
      const store = createMemoryStore();
      callWithFallbackMock.mockResolvedValueOnce({ text: 'hello', provider: 'gemini' });

      const r = await handleProcess({ ...baseReq, text: ukText }, store);
      expect(r.ok).toBe(true);
      const call = callWithFallbackMock.mock.calls[0]!;
      expect(call[1].system).toMatch(/Ukrainian/);
    });
  });
});
