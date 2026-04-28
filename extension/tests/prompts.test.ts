import { describe, it, expect } from 'vitest';
import { buildTranslatePrompt, buildSummarizePrompt } from '~/lib/prompts';

describe('prompts', () => {
  it('translate prompt embeds target language', () => {
    const p = buildTranslatePrompt({ text: 'hello', targetLang: 'Ukrainian' });
    expect(p).toContain('Translate the text below to Ukrainian');
  });

  it('translate prompt wraps user text in delimiters', () => {
    const p = buildTranslatePrompt({ text: 'sneaky\nbreak', targetLang: 'Ukrainian' });
    expect(p).toContain('<<<TEXT\nsneaky\nbreak\nTEXT>>>');
  });

  it('summary prompt embeds target language', () => {
    const p = buildSummarizePrompt({ text: 'hello', targetLang: 'Ukrainian' });
    expect(p).toContain('Summarize the text below in Ukrainian');
  });

  it('does not interpolate dollar signs in user text', () => {
    const p = buildTranslatePrompt({ text: '$BTC', targetLang: 'Ukrainian' });
    expect(p).toContain('$BTC');
  });
});
