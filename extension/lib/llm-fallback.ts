import { gemini } from './providers/gemini';
import { groq } from './providers/groq';
import type { Provider, ProviderInput, ProviderName } from './providers/types';

/**
 * Returns the provider that this API key belongs to, based on prefix, or null
 * if the prefix is unknown. Gemini keys start with "AIza" (Google API),
 * Groq keys start with "gsk_".
 */
export function detectKeyProvider(key: string): ProviderName | null {
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('gsk_')) return 'groq';
  return null;
}

export async function callWithFallback(
  preference: 'auto' | ProviderName,
  input: ProviderInput,
  fetchImpl?: typeof fetch,
): Promise<{ text: string; provider: ProviderName }> {
  // When the input.apiKey has a recognizable provider prefix, NEVER cross to a
  // different provider — sending one provider's key to another always 401s.
  // This makes 'auto' meaningful only when no key is supplied (proxy path) or
  // when the key prefix is unknown.
  const detected = detectKeyProvider(input.apiKey);
  if (detected) {
    const p: Provider = detected === 'groq' ? groq : gemini;
    const r = await p.call(input, fetchImpl);
    return { text: r.text, provider: p.name };
  }

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
