import { gemini } from './providers/gemini';
import { groq } from './providers/groq';
import type { Provider, ProviderInput, ProviderName } from './providers/types';

export async function callWithFallback(
  preference: 'auto' | ProviderName,
  input: ProviderInput,
  fetchImpl?: typeof fetch,
): Promise<{ text: string; provider: ProviderName }> {
  const order: Provider[] = preference === 'groq' ? [groq, gemini] : [gemini, groq];
  let lastErr: unknown;
  for (const p of order) {
    try {
      const r = await p.call(input, fetchImpl);
      return { text: r.text, provider: p.name };
    } catch (e) {
      lastErr = e;
      // Always continue to the next provider; if all fail, throw the last error.
    }
  }
  throw lastErr ?? { kind: 'unknown' };
}
