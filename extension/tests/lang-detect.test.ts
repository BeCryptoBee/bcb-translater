import { describe, it, expect } from 'vitest';
import { detectLanguage } from '~/lib/lang-detect';

describe('detectLanguage', () => {
  it('detects english', () => {
    expect(detectLanguage('Hello there, this is a sentence in English.')).toBe('en');
  });

  it('detects ukrainian', () => {
    expect(detectLanguage('Привіт, як справи сьогодні? Це український текст.')).toBe('uk');
  });

  it('returns "und" for very short input', () => {
    expect(detectLanguage('hi')).toBe('und');
  });
});
