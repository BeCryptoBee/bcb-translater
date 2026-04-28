import { describe, it, expect } from 'vitest';
import { callProxy } from '~/lib/providers/proxy';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const baseInput = {
  mode: 'translate' as const,
  text: 'hi',
  targetLang: 'uk',
  installId: 'test-install-id',
};

describe('callProxy', () => {
  it('returns text/provider/remainingQuota on happy path', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        result: 'привіт',
        provider: 'gemini',
        remainingQuota: 99,
      })) as unknown as typeof fetch;
    const r = await callProxy(baseInput, fetchImpl);
    expect(r).toEqual({ text: 'привіт', provider: 'gemini', remainingQuota: 99 });
  });

  it('sends the request to the placeholder PROXY_URL with x-install-id header and JSON body', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      capturedBody = init.body as string;
      return jsonResponse({ result: 'ok', provider: 'gemini', remainingQuota: 1 });
    }) as unknown as typeof fetch;
    await callProxy(baseInput, fetchImpl);
    // The URL is a placeholder string-replaced at deploy time.
    expect(capturedUrl).toBe('__PROXY_URL__');
    expect(capturedHeaders['x-install-id']).toBe('test-install-id');
    expect(capturedHeaders['content-type']).toBe('application/json');
    const parsed = JSON.parse(capturedBody);
    expect(parsed).toEqual({ mode: 'translate', text: 'hi', targetLang: 'uk' });
  });

  it('throws rate_limit on 429', async () => {
    const fetchImpl = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    await expect(callProxy(baseInput, fetchImpl)).rejects.toMatchObject({ kind: 'rate_limit' });
  });

  it('throws server on non-ok non-429 status', async () => {
    const fetchImpl = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(callProxy(baseInput, fetchImpl)).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
  });

  it('throws malformed when JSON parsing fails', async () => {
    const fetchImpl = (async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })) as unknown as typeof fetch;
    await expect(callProxy(baseInput, fetchImpl)).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('throws malformed when result is not a string', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ result: 123, provider: 'gemini', remainingQuota: 0 })) as unknown as typeof fetch;
    await expect(callProxy(baseInput, fetchImpl)).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('throws network when fetch rejects', async () => {
    const fetchImpl = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    await expect(callProxy(baseInput, fetchImpl)).rejects.toMatchObject({ kind: 'network' });
  });
});
