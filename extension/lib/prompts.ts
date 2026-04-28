// MIRRORED FILE: keep extension/lib/prompts.ts and worker/src/prompts.ts in sync.

export interface PromptInput {
  text: string;
  targetLang: string;
}

const LANG_NAMES: Record<string, string> = {
  uk: 'Ukrainian',
  en: 'English',
  pl: 'Polish',
  de: 'German',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  zh: 'Chinese',
  ja: 'Japanese',
  it: 'Italian',
  pt: 'Portuguese',
  tr: 'Turkish',
  nl: 'Dutch',
  ar: 'Arabic',
};

/**
 * Convert an ISO 639-1 code (e.g. "uk", "en") to its English language name
 * ("Ukrainian", "English"). LLMs reliably interpret full names as the target
 * language; ISO codes alone are ambiguous and often ignored. Anything not in
 * the map is returned unchanged so callers can also pass full names directly.
 */
export function normalizeLang(lang: string): string {
  return LANG_NAMES[lang.toLowerCase()] ?? lang;
}

export function buildTranslatePrompt({ text, targetLang }: PromptInput): string {
  const lang = normalizeLang(targetLang);
  return `You are a precise, idiomatic translator. Translate the text below to ${lang}.

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
  const lang = normalizeLang(targetLang);
  return `You are a concise summarizer. Summarize the text below in ${lang}.

HARD RULES:
1. 2-3 sentences for input under 500 chars; 4-6 sentences for longer input.
2. Preserve key facts: numbers, names, $TICKERS, dates, percentages.
3. Output in ${lang}, idiomatic and natural.
4. Output ONLY the summary. No prefixes, explanations, or quotation marks.

Source text (between markers):
<<<TEXT
${text}
TEXT>>>`;
}

export const TEMPERATURES = { translate: 0.3, summarize: 0.5 } as const;
