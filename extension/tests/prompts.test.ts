import { describe, it, expect } from 'vitest';
import { buildTranslatePrompt, buildSummarizePrompt, normalizeLang } from '~/lib/prompts';

describe('prompts', () => {
  it('translate system prompt embeds target language', () => {
    const p = buildTranslatePrompt({ text: 'hello', targetLang: 'Ukrainian' });
    expect(p.system).toContain("Translate the user's message into Ukrainian");
  });

  it('translate user message is the source text verbatim (no rules in user role)', () => {
    const p = buildTranslatePrompt({ text: 'sneaky\nbreak', targetLang: 'Ukrainian' });
    expect(p.user).toBe('sneaky\nbreak');
    // The user message must NOT carry the rules — that was the prompt-leak bug.
    expect(p.user).not.toMatch(/HARD RULES/);
    expect(p.user).not.toMatch(/Translate/);
  });

  it('summary system prompt embeds target language', () => {
    const p = buildSummarizePrompt({ text: 'hello', targetLang: 'Ukrainian' });
    expect(p.system).toContain('Ukrainian');
    expect(p.system).toMatch(/summarizer|essence/i);
  });

  it('does not interpolate or escape dollar signs in user text', () => {
    const p = buildTranslatePrompt({ text: '$BTC', targetLang: 'Ukrainian' });
    expect(p.user).toBe('$BTC');
  });

  it('normalizeLang maps ISO codes to language names', () => {
    expect(normalizeLang('uk')).toBe('Ukrainian');
    expect(normalizeLang('en')).toBe('English');
    expect(normalizeLang('Ukrainian')).toBe('Ukrainian');
    expect(normalizeLang('xx')).toBe('xx');
  });

  it('translate accepts ISO code and outputs full language name in system', () => {
    const p = buildTranslatePrompt({ text: 'hi', targetLang: 'uk' });
    expect(p.system).toContain('Ukrainian');
    expect(p.system).not.toContain('to uk');
  });
});
