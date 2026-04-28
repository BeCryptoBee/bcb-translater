import { describe, it, expect, vi, afterEach } from 'vitest';
import { gemini } from '../src/providers/gemini';
import { groq } from '../src/providers/groq';
import { callWithFallback } from '../src/llm-fallback';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gemini provider (worker mirror)', () => {
  const baseInput = { prompt: 'hi', temperature: 0.3, apiKey: 'test-key' };

  it('returns extracted text on happy path', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'привіт' }] } }],
      })) as unknown as typeof fetch;
    const r = await gemini.call(baseInput, fetchImpl);
    expect(r.text).toBe('привіт');
  });
});

describe('groq provider (worker mirror)', () => {
  const baseInput = { prompt: 'hi', temperature: 0.3, apiKey: 'test-key' };

  it('returns extracted text on happy path', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        choices: [{ message: { content: 'hello' } }],
      })) as unknown as typeof fetch;
    const r = await groq.call(baseInput, fetchImpl);
    expect(r.text).toBe('hello');
  });
});

describe('callWithFallback (worker)', () => {
  const promptInput = { prompt: 'hi', temperature: 0.3 };
  const keys = { gemini: 'g-key', groq: 'q-key' };

  it("preference 'auto' tries gemini first and returns its result on success", async () => {
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: 'from-gemini' }] } }],
        });
      }
      throw new Error('groq should not be called');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const r = await callWithFallback('auto', promptInput, keys);
    expect(r).toEqual({ text: 'from-gemini', provider: 'gemini' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("preference 'groq' tries groq first and returns its result on success", async () => {
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('api.groq.com')) {
        return jsonResponse({ choices: [{ message: { content: 'from-groq' } }] });
      }
      throw new Error('gemini should not be called');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const r = await callWithFallback('groq', promptInput, keys);
    expect(r).toEqual({ text: 'from-groq', provider: 'groq' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back from gemini to groq when gemini fails', async () => {
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com')) {
        return new Response('', { status: 500 });
      }
      return jsonResponse({ choices: [{ message: { content: 'fallback-ok' } }] });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const r = await callWithFallback('auto', promptInput, keys);
    expect(r).toEqual({ text: 'fallback-ok', provider: 'groq' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws the last error when both providers fail', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(callWithFallback('auto', promptInput, keys)).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('passes the matching key to each provider', async () => {
    const seen: Array<{ url: string; auth?: string | null }> = [];
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const auth =
        (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
      seen.push({ url: u, auth });
      if (u.includes('generativelanguage.googleapis.com')) {
        return new Response('', { status: 500 });
      }
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    vi.stubGlobal('fetch', fetchSpy);
    await callWithFallback('auto', promptInput, keys);
    expect(seen[0]?.url).toContain('key=g-key');
    expect(seen[1]?.auth).toBe('Bearer q-key');
  });
});
