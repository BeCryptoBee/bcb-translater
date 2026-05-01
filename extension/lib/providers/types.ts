export type ProviderName = 'gemini' | 'groq';

export interface ProviderInput {
  /** Optional system instruction. Sent in role:'system' (chat) or
   *  systemInstruction (Gemini). Use this for the rules so the model never
   *  treats them as data to translate or summarize. */
  system?: string;
  /** User content. The actual text to translate / summarize. */
  prompt: string;
  temperature: number;
  apiKey: string;
  /**
   * When set, the provider must produce JSON conforming to this schema.
   * Gemini uses responseSchema natively. Groq uses json_object mode (no
   * native schema enforcement on llama-3.3-70b-versatile) — schema is
   * advisory and the caller validates client-side.
   */
  jsonMode?: { schema: object };
}

export interface ProviderResult {
  text: string;
}

export type ProviderError =
  | { kind: 'rate_limit' }
  | { kind: 'auth' }
  | { kind: 'network' }
  | { kind: 'malformed' }
  | { kind: 'server'; status: number };

export interface Provider {
  name: ProviderName;
  call(input: ProviderInput, fetchImpl?: typeof fetch): Promise<ProviderResult>;
}
