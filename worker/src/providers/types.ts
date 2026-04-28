export type ProviderName = 'gemini' | 'groq';

export interface ProviderInput {
  system?: string;
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
