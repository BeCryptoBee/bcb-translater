import { franc } from 'franc-min';

const ISO6393_TO_ISO6391: Record<string, string> = {
  eng: 'en',
  ukr: 'uk',
  rus: 'ru',
  pol: 'pl',
  deu: 'de',
  spa: 'es',
  fra: 'fr',
  cmn: 'zh',
  jpn: 'ja',
  por: 'pt',
  ita: 'it',
  tur: 'tr',
  nld: 'nl',
  ara: 'ar',
};

export function detectLanguage(text: string): string {
  if (text.trim().length < 10) return 'und';
  const code3 = franc(text);
  if (code3 === 'und') return 'und';
  return ISO6393_TO_ISO6391[code3] ?? 'und';
}
