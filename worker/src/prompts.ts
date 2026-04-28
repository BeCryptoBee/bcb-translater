// MIRRORED FILE: keep extension/lib/prompts.ts and worker/src/prompts.ts in sync.

export interface PromptInput {
  text: string;
  targetLang: string;
}

export function buildTranslatePrompt({ text, targetLang }: PromptInput): string {
  return `You are a precise, idiomatic translator. Translate the text below to ${targetLang}.

HARD RULES:
1. Preserve ALL line breaks, paragraph breaks, indentation, bullet points, lists exactly as in source.
2. Do NOT translate: @mentions, #hashtags, URLs, $TICKERS, code in \`backticks\`, emoji.
3. Translate meaning naturally, not word-by-word. Match the register (casual / technical / formal).
4. Output ONLY the translation. No prefixes, explanations, or quotation marks around the result.

Source text (between markers):
<<<TEXT
${text}
TEXT>>>`;
}

export function buildSummarizePrompt({ text, targetLang }: PromptInput): string {
  return `You are a concise summarizer. Summarize the text below in ${targetLang}.

HARD RULES:
1. 2-3 sentences for input under 500 chars; 4-6 sentences for longer input.
2. Preserve key facts: numbers, names, $TICKERS, dates, percentages.
3. Output in ${targetLang}, idiomatic and natural.
4. Output ONLY the summary. No prefixes, explanations, or quotation marks.

Source text (between markers):
<<<TEXT
${text}
TEXT>>>`;
}

export const TEMPERATURES = { translate: 0.3, summarize: 0.5 } as const;
