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
