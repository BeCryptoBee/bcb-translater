import { describe, it, expect } from 'vitest';
import { pickSmartTarget } from '~/lib/lang-detect';

describe('pickSmartTarget', () => {
  it('Ukrainian source -> en', () => {
    expect(pickSmartTarget('uk', { targetLang: 'uk' })).toBe('en');
  });
  it('English source -> targetLang', () => {
    expect(pickSmartTarget('en', { targetLang: 'uk' })).toBe('uk');
  });
  it('Russian source -> targetLang', () => {
    expect(pickSmartTarget('ru', { targetLang: 'uk' })).toBe('uk');
  });
  it('unknown -> targetLang', () => {
    expect(pickSmartTarget('und', { targetLang: 'uk' })).toBe('uk');
  });
  it('targetLang other than uk: ru source still goes to targetLang', () => {
    expect(pickSmartTarget('ru', { targetLang: 'pl' })).toBe('pl');
  });
  it('Ukrainian source when targetLang is en: avoid no-op, go to en anyway', () => {
    expect(pickSmartTarget('uk', { targetLang: 'en' })).toBe('en');
  });
});
