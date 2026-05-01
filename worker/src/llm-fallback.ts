import { gemini } from './providers/gemini';
import { groq } from './providers/groq';
import type { Provider, ProviderName } from './providers/types';

export async function callWithFallback(
  preference: 'auto' | ProviderName,
  promptInput: {
    system?: string;
    prompt: string;
    temperature: number;
    jsonMode?: { schema: object };
  },
  keys: { gemini: string; groq: string },
): Promise<{ text: string; provider: ProviderName }> {
  const order: Array<[Provider, string]> =
    preference === 'groq'
      ? [
          [groq, keys.groq],
          [gemini, keys.gemini],
        ]
      : [
          [gemini, keys.gemini],
          [groq, keys.groq],
        ];
  let lastErr: unknown;
  for (const [p, key] of order) {
    try {
      const r = await p.call({ ...promptInput, apiKey: key });
      return { text: r.text, provider: p.name };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? { kind: 'unknown' };
}
