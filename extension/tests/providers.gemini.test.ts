import { describe, it, expect } from 'vitest';
import { gemini } from '~/lib/providers/gemini';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('gemini provider', () => {
  const baseInput = { prompt: 'hi', temperature: 0.3, apiKey: 'test-key' };

  it('returns extracted text on happy path', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'привіт' }] } }],
      });
    const r = await gemini.call(baseInput, fetchImpl as typeof fetch);
    expect(r.text).toBe('привіт');
  });

  it('sends prompt in correct request body and includes the api key in URL', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      });
    }) as unknown as typeof fetch;
    await gemini.call(baseInput, fetchImpl);
    expect(capturedUrl).toContain('generativelanguage.googleapis.com');
    expect(capturedUrl).toContain('key=test-key');
    const parsed = JSON.parse(capturedBody);
    expect(parsed.contents[0].parts[0].text).toBe('hi');
    expect(parsed.generationConfig.temperature).toBe(0.3);
  });

  it('throws rate_limit on 429', async () => {
    const fetchImpl = async () => new Response('', { status: 429 });
    await expect(gemini.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'rate_limit',
    });
  });

  it('throws auth on 401', async () => {
    const fetchImpl = async () => new Response('', { status: 401 });
    await expect(gemini.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('throws auth on 403', async () => {
    const fetchImpl = async () => new Response('', { status: 403 });
    await expect(gemini.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('throws server on 500', async () => {
    const fetchImpl = async () => new Response('', { status: 500 });
    await expect(gemini.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
  });

  it('throws malformed when response is not JSON', async () => {
    const fetchImpl = async () =>
      new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } });
    await expect(gemini.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('throws malformed when shape is wrong', async () => {
    const fetchImpl = async () => jsonResponse({ candidates: [] });
    await expect(gemini.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('throws network when fetch rejects', async () => {
    const fetchImpl = async () => {
      throw new Error('boom');
    };
    await expect(gemini.call(baseInput, fetchImpl as typeof fetch)).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('jsonMode flips responseMimeType and includes responseSchema', async () => {
    let capturedBody = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: '{"segments":[]}' }] } }],
      });
    }) as unknown as typeof fetch;
    await gemini.call(
      { ...baseInput, jsonMode: { schema: { type: 'object' } } },
      fetchImpl,
    );
    const body = JSON.parse(capturedBody);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toEqual({ type: 'object' });
  });
});
