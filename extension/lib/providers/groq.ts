import type { Provider, ProviderInput, ProviderResult } from './types';

export const groq: Provider = {
  name: 'groq',
  async call(input: ProviderInput, fetchImpl: typeof fetch = fetch): Promise<ProviderResult> {
    let res: Response;
    try {
      // Build messages with an optional system role: putting the rules in
      // a system message prevents the model from treating them as data and
      // translating them along with the source text.
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (input.system) messages.push({ role: 'system', content: input.system });
      messages.push({ role: 'user', content: input.prompt });

      res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          temperature: input.temperature,
        }),
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
    const text = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
      ?.message?.content;
    if (typeof text !== 'string') throw { kind: 'malformed' };
    return { text };
  },
};
