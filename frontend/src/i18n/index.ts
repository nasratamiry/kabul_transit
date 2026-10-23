import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { isRtlLang } from '@/lib/digits';

import en from './locales/en.json';
import fa from './locales/fa.json';
import ps from './locales/ps.json';

export const LANGUAGES = [
  { code: 'fa', label: 'دری' },
  { code: 'ps', label: 'پښتو' },
  { code: 'en', label: 'English' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

export const LANG_STORAGE_KEY = 'kc.lang';
const SUPPORTED: string[] = LANGUAGES.map((l) => l.code);
const envDefault = import.meta.env.VITE_DEFAULT_LOCALE as string | undefined;
const DEFAULT_LANG = envDefault && SUPPORTED.includes(envDefault) ? envDefault : 'fa';

/** Keep <html lang dir> in step with the UI language: fa/ps → rtl, en → ltr. */
function applyDocumentLang(lang: string): void {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = isRtlLang(lang) ? 'rtl' : 'ltr';
}

i18n.on('languageChanged', applyDocumentLang);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { fa: { translation: fa }, ps: { translation: ps }, en: { translation: en } },
    supportedLngs: SUPPORTED,
    fallbackLng: DEFAULT_LANG,
    load: 'languageOnly',
    // Only an explicit choice counts; the browser's language never overrides Dari.
    detection: {
      order: ['localStorage'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

applyDocumentLang(i18n.resolvedLanguage ?? DEFAULT_LANG);

export default i18n;
