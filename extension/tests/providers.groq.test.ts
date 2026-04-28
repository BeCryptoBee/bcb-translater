import { describe, it, expect } from 'vitest';
import { groq } from '~/lib/providers/groq';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('groq provider', () => {
  const baseInput = { prompt: 'hi', temperature: 0.3, apiKey: 'test-key' };

  it('returns extracted text on happy path', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        choices: [{ message: { content: 'привіт' } }],
      });
    const r = await groq.call(baseInput, fetchImpl as typeof fetch);
    expect(r.text).toBe('привіт');
  });

  it('sends bearer token and OpenAI-compatible body', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      capturedBody = init.body as string;
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }) as unknown as typeof fetch;
    await groq.call(baseInput, fetchImpl);
    expect(capturedUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(capturedHeaders.authorization).toBe('Bearer test-key');
    const parsed = JSON.parse(capturedBody);
    expect(parsed.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(parsed.temperature).toBe(0.3);
    expect(typeof parsed.model).toBe('string');
  });

  it('throws rate_limit on 429', async () => {
    const fetchImpl = async () => new Response('', { status: 429 });
    await expect(groq.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'rate_limit',
    });
  });

  it('throws auth on 401', async () => {
    const fetchImpl = async () => new Response('', { status: 401 });
    await expect(groq.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('throws auth on 403', async () => {
    const fetchImpl = async () => new Response('', { status: 403 });
    await expect(groq.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('throws server on 500', async () => {
    const fetchImpl = async () => new Response('', { status: 500 });
    await expect(groq.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
  });

  it('throws malformed when response is not JSON', async () => {
    const fetchImpl = async () =>
      new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } });
    await expect(groq.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('throws malformed when shape is wrong', async () => {
    const fetchImpl = async () => jsonResponse({ choices: [] });
    await expect(groq.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('throws network when fetch rejects', async () => {
    const fetchImpl = async () => {
      throw new Error('boom');
    };
    await expect(groq.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'network',
    });
  });
});
