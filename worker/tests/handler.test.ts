import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/index';

function makeKV(): KVNamespace {
  const m = new Map<string, string>();
  return {
    async get(k: string) {
      return m.get(k) ?? null;
    },
    async put(k: string, v: string) {
      m.set(k, v);
    },
    async delete(k: string) {
      m.delete(k);
    },
  } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    QUOTA_KV: makeKV(),
    GEMINI_API_KEY: 'fake-gemini',
    GROQ_API_KEY: 'fake-groq',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function postRequest(opts: {
  url?: string;
  installId?: string | null;
  body?: unknown;
  rawBody?: string;
}): Request {
  const url = opts.url ?? 'https://worker.test/v1/process';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.installId !== null && opts.installId !== undefined) {
    headers['x-install-id'] = opts.installId;
  }
  const body =
    opts.rawBody !== undefined ? opts.rawBody : opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  return new Request(url, { method: 'POST', headers, body });
}

beforeEach(() => {
  // Default: any unmocked fetch becomes a server error so tests are forced to mock explicitly.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('worker fetch handler — routing', () => {
  it('GET /v1/process returns 404', async () => {
    const req = new Request('https://worker.test/v1/process', { method: 'GET' });
    const res = await worker.fetch!(req, makeEnv());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'not_found' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST other path returns 404', async () => {
    const req = new Request('https://worker.test/other', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    const res = await worker.fetch!(req, makeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('OPTIONS /v1/process returns 200 with CORS headers', async () => {
    const req = new Request('https://worker.test/v1/process', { method: 'OPTIONS' });
    const res = await worker.fetch!(req, makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('x-install-id');
  });
});

describe('worker fetch handler — input validation', () => {
  it('returns 400 missing_install_id when X-Install-Id header is absent', async () => {
    const req = postRequest({
      installId: null,
      body: { mode: 'translate', text: 'hi', targetLang: 'Ukrainian' },
    });
    const res = await worker.fetch!(req, makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_install_id' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns 400 invalid_json on unparsable body', async () => {
    const req = postRequest({ installId: 'i-1', rawBody: 'not-json{' });
    const res = await worker.fetch!(req, makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('returns 400 invalid_input on bad shape (missing mode)', async () => {
    const req = postRequest({
      installId: 'i-1',
      body: { text: 'hi', targetLang: 'Ukrainian' },
    });
    const res = await worker.fetch!(req, makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('returns 400 invalid_input on bad mode value', async () => {
    const req = postRequest({
      installId: 'i-1',
      body: { mode: 'explain', text: 'hi', targetLang: 'Ukrainian' },
    });
    const res = await worker.fetch!(req, makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('returns 400 too_long when text exceeds 10 KB', async () => {
    const req = postRequest({
      installId: 'i-1',
      body: { mode: 'translate', text: 'x'.repeat(10_001), targetLang: 'Ukrainian' },
    });
    const res = await worker.fetch!(req, makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'too_long' });
  });
});

describe('worker fetch handler — segmented translate', () => {
  it('returns segments+separators when upstream JSON is valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('generativelanguage.googleapis.com')) {
          return jsonResponse({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({ translations: ['Привіт.', 'Світ.'] }),
                }],
              },
            }],
          });
        }
        return new Response('', { status: 500 });
      }),
    );
    const env = makeEnv();
    const req = postRequest({
      installId: 'i-seg',
      // Multi-line input: pre-split produces 2 lines.
      body: { mode: 'translate', text: 'Hi.\nWorld.', targetLang: 'Ukrainian', segmented: true },
    });
    const res = await worker.fetch!(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: string;
      segments?: Array<{ src: string; tgt: string }>;
      separators?: string[];
    };
    expect(body.segments).toHaveLength(2);
    expect(body.separators).toEqual(['', '\n']);
    expect(body.result).toBe('Привіт.\nСвіт.');
  });

  it('falls back internally to flat when JSON is broken; counts as one quota call', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('generativelanguage.googleapis.com')) {
          calls += 1;
          return jsonResponse({
            candidates: [{
              content: { parts: [{ text: calls === 1 ? 'not json' : 'Привіт.\nСвіт.' }] },
            }],
          });
        }
        return new Response('', { status: 500 });
      }),
    );
    const env = makeEnv();
    const req = postRequest({
      installId: 'i-fallback',
      body: { mode: 'translate', text: 'Hi.\nWorld.', targetLang: 'Ukrainian', segmented: true },
    });
    const res = await worker.fetch!(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: string;
      segments?: unknown;
      remainingQuota: number;
    };
    expect(body.segments).toBeUndefined();
    expect(body.result).toBe('Привіт.\nСвіт.');
    expect(body.remainingQuota).toBe(49);
    expect(calls).toBe(2);
  });
});

describe('worker fetch handler — happy path', () => {
  it('translates successfully via gemini and returns 200 with quota decremented', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('generativelanguage.googleapis.com')) {
          return jsonResponse({
            candidates: [{ content: { parts: [{ text: 'Привіт, світ' }] } }],
          });
        }
        return new Response('', { status: 500 });
      }),
    );
    const env = makeEnv();
    const req = postRequest({
      installId: 'i-happy',
      body: { mode: 'translate', text: 'Hello world', targetLang: 'Ukrainian' },
    });
    const res = await worker.fetch!(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string; provider: string; remainingQuota: number };
    expect(body.result).toBe('Привіт, світ');
    expect(body.provider).toBe('gemini');
    expect(body.remainingQuota).toBe(49);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('worker fetch handler — quota', () => {
  it('returns 429 quota_exhausted when KV already at 50 for today', async () => {
    const env = makeEnv();
    const today = new Date().toISOString().slice(0, 10);
    await env.QUOTA_KV.put(`quota:i-full:${today}`, '50');
    const req = postRequest({
      installId: 'i-full',
      body: { mode: 'translate', text: 'hi', targetLang: 'Ukrainian' },
    });
    const res = await worker.fetch!(req, env);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'quota_exhausted' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('worker fetch handler — provider failures', () => {
  it('returns 502 provider_error when both providers fail with network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const env = makeEnv();
    const req = postRequest({
      installId: 'i-err',
      body: { mode: 'translate', text: 'hi', targetLang: 'Ukrainian' },
    });
    const res = await worker.fetch!(req, env);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'provider_error' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
