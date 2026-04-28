import { describe, it, expect } from 'vitest';
import { callWithFallback } from '~/lib/llm-fallback';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function geminiOk(text: string): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function groqOk(text: string): Response {
  return jsonResponse({ choices: [{ message: { content: text } }] });
}

function makeFetch(handlers: Array<(url: string) => Response>): typeof fetch {
  let i = 0;
  return (async (url: string) => {
    const h = handlers[i++];
    if (!h) throw new Error('unexpected fetch call');
    return h(url);
  }) as unknown as typeof fetch;
}

const baseInput = { prompt: 'hi', temperature: 0.3, apiKey: 'k' };

describe('callWithFallback', () => {
  it('returns primary (gemini) result on success and does not call fallback', async () => {
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      if (url.includes('googleapis.com')) return geminiOk('from-gemini');
      throw new Error('should not call groq');
    }) as unknown as typeof fetch;
    const r = await callWithFallback('auto', baseInput, fetchImpl);
    expect(r).toEqual({ text: 'from-gemini', provider: 'gemini' });
    expect(calls).toBe(1);
  });

  it('falls back to groq when gemini rate_limits', async () => {
    const fetchImpl = makeFetch([
      () => new Response('', { status: 429 }), // gemini
      () => groqOk('from-groq'), // groq
    ]);
    const r = await callWithFallback('auto', baseInput, fetchImpl);
    expect(r).toEqual({ text: 'from-groq', provider: 'groq' });
  });

  it('falls back to groq when gemini network errors', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('googleapis.com')) throw new Error('boom');
      return groqOk('from-groq');
    }) as unknown as typeof fetch;
    const r = await callWithFallback('auto', baseInput, fetchImpl);
    expect(r).toEqual({ text: 'from-groq', provider: 'groq' });
  });

  it('throws when both providers fail', async () => {
    const fetchImpl = makeFetch([
      () => new Response('', { status: 429 }),
      () => new Response('', { status: 429 }),
    ]);
    await expect(callWithFallback('auto', baseInput, fetchImpl)).rejects.toMatchObject({
      kind: 'rate_limit',
    });
  });

  it('preference "gemini" tries gemini first', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.includes('googleapis.com')) return geminiOk('g');
      return groqOk('q');
    }) as unknown as typeof fetch;
    const r = await callWithFallback('gemini', baseInput, fetchImpl);
    expect(r.provider).toBe('gemini');
    expect(urls[0]).toContain('googleapis.com');
  });

  it('preference "groq" tries groq first', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.includes('groq.com')) return groqOk('q');
      return geminiOk('g');
    }) as unknown as typeof fetch;
    const r = await callWithFallback('groq', baseInput, fetchImpl);
    expect(r.provider).toBe('groq');
    expect(urls[0]).toContain('groq.com');
  });

  it('preference "auto" defaults to gemini first', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.includes('googleapis.com')) return geminiOk('g');
      return groqOk('q');
    }) as unknown as typeof fetch;
    await callWithFallback('auto', baseInput, fetchImpl);
    expect(urls[0]).toContain('googleapis.com');
  });
});
