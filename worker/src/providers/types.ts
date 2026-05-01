export type ProviderName = 'gemini' | 'groq';

export interface ProviderInput {
  system?: string;
  prompt: string;
  temperature: number;
  apiKey: string;
  /** When set, the provider must produce JSON conforming to this schema.
   *  Gemini uses responseSchema natively; Groq uses json_object mode. */
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
