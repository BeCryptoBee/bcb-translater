import type { Provider, ProviderInput, ProviderResult } from './types';

const buildUrl = (model: string, key: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

export const gemini: Provider = {
  name: 'gemini',
  async call(input: ProviderInput, fetchImpl: typeof fetch = fetch): Promise<ProviderResult> {
    let res: Response;
    try {
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: {
          temperature: input.temperature,
          responseMimeType: input.jsonMode ? 'application/json' : 'text/plain',
          thinkingConfig: { thinkingBudget: 0 },
          ...(input.jsonMode ? { responseSchema: input.jsonMode.schema } : {}),
        },
      };
      if (input.system) {
        body.systemInstruction = { parts: [{ text: input.system }] };
      }
      res = await fetchImpl(buildUrl('gemini-2.5-flash', input.apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw { kind: 'network' };
    }
    if (res.status === 429) throw { kind: 'rate_limit' };
    if (res.status === 401 || res.status === 403) throw { kind: 'auth' };
    if (res.status >= 500) throw { kind: 'server', status: res.status };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw { kind: 'malformed' };
    }
    const text = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })
      ?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw { kind: 'malformed' };
    return { text };
  },
};
